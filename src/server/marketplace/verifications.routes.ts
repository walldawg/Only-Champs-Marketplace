// Marketplace Engine routes (API only, no UI)
// Design:
// - Catalog is read-only; all pointers use versionKey.
// - Ownership can exist unverified.
// - Verification is required to expose availability, list, and transfer.
// - Hidden profiles expose ONLY AVAILABLE_* items (enforced at query layer).
//
// NOTE: These route modules are framework-agnostic about how Prisma is attached.
// They export register functions that take (app, prisma, opts). Wire them into your server.

import type { FastifyInstance } from "fastify";
import type { PrismaClient, VerificationScope, VerificationLane, VerificationStatus, InventoryVisibilityState } from "@prisma/client";
import { requireActorUserId, assertNonEmptyString } from "./utils";
import type { MarketplaceRegisterOptions } from "./marketplace.routes";

function isApproved(v: { status: VerificationStatus }) {
  return v.status === "APPROVED";
}

export function registerVerificationRoutes(app: FastifyInstance, prisma: PrismaClient, opts: MarketplaceRegisterOptions) {
  // POST /market/verifications/submit
  // body: { scope: "VERSION"|"INSTANCE", versionKey?, instanceId?, evidence?: [{type, uri, meta?}] , lane?: "COMMUNITY"|"ADMIN" }
  app.post("/verifications/submit", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const body = (req.body ?? {}) as any;
    const scope = assertNonEmptyString(body.scope, "scope") as VerificationScope;
    const lane = (body.lane ? assertNonEmptyString(body.lane, "lane") : "COMMUNITY") as VerificationLane;

    const versionKey = body.versionKey ? assertNonEmptyString(body.versionKey, "versionKey") : null;
    const instanceId = body.instanceId ? assertNonEmptyString(body.instanceId, "instanceId") : null;

    if (scope === "VERSION") {
      if (!versionKey) return reply.code(400).send({ error: "BAD_REQUEST", message: "versionKey required for VERSION scope" });
      const cv = await prisma.cardVersion.findUnique({ where: { versionKey } });
      if (!cv) return reply.code(400).send({ error: "UNKNOWN_VERSIONKEY", message: "versionKey not found in catalog" });
    } else if (scope === "INSTANCE") {
      if (!instanceId) return reply.code(400).send({ error: "BAD_REQUEST", message: "instanceId required for INSTANCE scope" });
      const inst = await prisma.userCardInstance.findUnique({ where: { id: instanceId } });
      if (!inst) return reply.code(400).send({ error: "UNKNOWN_INSTANCE", message: "instanceId not found" });
      if (inst.ownerId !== actorId) return reply.code(403).send({ error: "FORBIDDEN", message: "You do not own this instance" });
    } else {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "Invalid scope" });
    }

    const evidence = Array.isArray(body.evidence) ? body.evidence : [];

    const created = await prisma.verification.create({
      data: {
        ownerId: actorId,
        scope,
        lane,
        status: "SUBMITTED",
        versionKey: versionKey ?? undefined,
        instanceId: instanceId ?? undefined,
        evidence: evidence.length
          ? {
              create: evidence.map((e: any) => ({
                type: assertNonEmptyString(e.type, "evidence.type"),
                uri: assertNonEmptyString(e.uri, "evidence.uri"),
                meta: e.meta ?? {},
              })),
            }
          : undefined,
      },
      include: { evidence: true },
    });

    reply.code(201).send({ verification: created });
  });

  // GET /market/verifications/:id
  app.get("/verifications/:id", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const id = (req.params as any).id as string;
    const v = await prisma.verification.findUnique({
      where: { id },
      include: { evidence: true, votes: true, escalation: true },
    });
    if (!v) return reply.code(404).send({ error: "NOT_FOUND" });
    if (v.ownerId !== actorId) return reply.code(403).send({ error: "FORBIDDEN" });

    reply.send({ verification: v });
  });

  // GET /market/verifications/status?versionKey=...  (actor)
  app.get("/verifications/status", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const q = (req.query ?? {}) as any;
    const versionKey = q.versionKey ? assertNonEmptyString(q.versionKey, "versionKey") : null;
    const instanceId = q.instanceId ? assertNonEmptyString(q.instanceId, "instanceId") : null;

    if (!versionKey && !instanceId) return reply.code(400).send({ error: "BAD_REQUEST", message: "Provide versionKey or instanceId" });

    const where: any = { ownerId: actorId };
    if (versionKey) where.versionKey = versionKey;
    if (instanceId) where.instanceId = instanceId;

    const latest = await prisma.verification.findFirst({
      where,
      orderBy: [{ updatedAt: "desc" }],
    });

    reply.send({ ok: !!latest, verification: latest, approved: latest ? isApproved(latest) : false });
  });

  // POST /market/verifications/:id/vote  (community lane)
  // body: { vote: "APPROVE"|"REJECT" }
  app.post("/verifications/:id/vote", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const id = (req.params as any).id as string;
    const body = (req.body ?? {}) as any;
    const vote = assertNonEmptyString(body.vote, "vote");

    const v = await prisma.verification.findUnique({ where: { id } });
    if (!v) return reply.code(404).send({ error: "NOT_FOUND" });
    if (v.lane !== "COMMUNITY") return reply.code(400).send({ error: "BAD_REQUEST", message: "Not a COMMUNITY verification" });
    if (v.status !== "SUBMITTED") return reply.code(400).send({ error: "BAD_REQUEST", message: "Verification is not open for voting" });
    if (v.ownerId === actorId) return reply.code(400).send({ error: "BAD_REQUEST", message: "Owner cannot vote on own verification" });

    const created = await prisma.verificationVote.upsert({
      where: { verificationId_voterId: { verificationId: id, voterId: actorId } },
      update: { vote: vote as any },
      create: { verificationId: id, voterId: actorId, vote: vote as any },
    });

    reply.send({ vote: created });
  });

  // POST /market/verifications/:id/community/close
  // Server decides approve/reject using simple v1 rule:
  // approve if approves >= 2 and rejects == 0, else keep SUBMITTED unless explicitly rejected by admin later.
  app.post("/verifications/:id/community/close", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const id = (req.params as any).id as string;
    const v = await prisma.verification.findUnique({
      where: { id },
      include: { votes: true },
    });
    if (!v) return reply.code(404).send({ error: "NOT_FOUND" });
    if (v.ownerId !== actorId) return reply.code(403).send({ error: "FORBIDDEN" });
    if (v.lane !== "COMMUNITY") return reply.code(400).send({ error: "BAD_REQUEST", message: "Not a COMMUNITY verification" });
    if (v.status !== "SUBMITTED") return reply.code(400).send({ error: "BAD_REQUEST", message: "Already decided" });

    const approves = v.votes.filter(x => x.vote === "APPROVE").length;
    const rejects = v.votes.filter(x => x.vote === "REJECT").length;

    let nextStatus: VerificationStatus = "SUBMITTED";
    if (approves >= 2 && rejects === 0) nextStatus = "APPROVED";
    if (rejects >= 2 && approves === 0) nextStatus = "REJECTED";

    const decided = await prisma.verification.update({
      where: { id },
      data: nextStatus === "SUBMITTED" ? {} : { status: nextStatus, decidedAt: new Date() },
    });

    reply.send({ verification: decided, tallies: { approves, rejects } });
  });

  // Admin endpoints (wire auth externally; v1 uses x-user-id only and assumes caller is admin)
  app.post("/verifications/:id/admin/approve", async (req, reply) => {
    const adminId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!adminId) return;

    const id = (req.params as any).id as string;
    const v = await prisma.verification.findUnique({ where: { id } });
    if (!v) return reply.code(404).send({ error: "NOT_FOUND" });

    const decided = await prisma.verification.update({
      where: { id },
      data: { status: "APPROVED", lane: "ADMIN", decidedAt: new Date() },
    });

    reply.send({ verification: decided });
  });

  app.post("/verifications/:id/admin/reject", async (req, reply) => {
    const adminId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!adminId) return;

    const id = (req.params as any).id as string;
    const v = await prisma.verification.findUnique({ where: { id } });
    if (!v) return reply.code(404).send({ error: "NOT_FOUND" });

    const decided = await prisma.verification.update({
      where: { id },
      data: { status: "REJECTED", lane: "ADMIN", decidedAt: new Date() },
    });

    reply.send({ verification: decided });
  });

  app.post("/verifications/:id/admin/revoke", async (req, reply) => {
    const adminId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!adminId) return;

    const id = (req.params as any).id as string;
    const v = await prisma.verification.findUnique({ where: { id } });
    if (!v) return reply.code(404).send({ error: "NOT_FOUND" });

    const decided = await prisma.verification.update({
      where: { id },
      data: { status: "REVOKED", lane: "ADMIN", decidedAt: new Date() },
    });

    reply.send({ verification: decided });
  });

  // Escalate (owner can request escalation; admin resolves later)
  app.post("/verifications/:id/escalate", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const id = (req.params as any).id as string;
    const body = (req.body ?? {}) as any;
    const reason = assertNonEmptyString(body.reason, "reason");

    const v = await prisma.verification.findUnique({ where: { id } });
    if (!v) return reply.code(404).send({ error: "NOT_FOUND" });
    if (v.ownerId !== actorId) return reply.code(403).send({ error: "FORBIDDEN" });

    const esc = await prisma.verificationEscalation.upsert({
      where: { verificationId: id },
      update: { reason },
      create: { verificationId: id, reason },
    });

    reply.send({ escalation: esc });
  });
}
