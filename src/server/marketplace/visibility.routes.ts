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
import type { PrismaClient, InventoryVisibilityState } from "@prisma/client";
import { requireActorUserId, assertNonEmptyString } from "./utils";
import type { MarketplaceRegisterOptions } from "./marketplace.routes";

export function registerInventoryVisibilityRoutes(app: FastifyInstance, prisma: PrismaClient, opts: MarketplaceRegisterOptions) {
  // GET /market/visibility (actor; version + instance)
  app.get("/visibility", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const version = await prisma.inventoryVisibilityVersion.findMany({
      where: { ownerId: actorId },
      orderBy: [{ updatedAt: "desc" }],
    });
    const instances = await prisma.inventoryVisibilityInstance.findMany({
      where: { ownerId: actorId },
      orderBy: [{ updatedAt: "desc" }],
    });

    reply.send({ ownerId: actorId, version, instances });
  });

  // POST /market/visibility/version
  // body: { versionKey, visibility: PRIVATE|AVAILABLE_TRADE|AVAILABLE_SELL, autoMatchEnabled? }
  // Rule: availability requires an APPROVED VERSION verification.
  app.post("/visibility/version", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const body = (req.body ?? {}) as any;
    const versionKey = assertNonEmptyString(body.versionKey, "versionKey");
    const visibility = assertNonEmptyString(body.visibility, "visibility") as InventoryVisibilityState;
    const autoMatchEnabled = !!body.autoMatchEnabled;

    if (visibility !== "PRIVATE") {
      const v = await prisma.verification.findFirst({
        where: { ownerId: actorId, scope: "VERSION", versionKey, status: "APPROVED" },
        orderBy: [{ updatedAt: "desc" }],
      });
      if (!v) return reply.code(400).send({ error: "NOT_VERIFIED", message: "Approved VERSION verification required to set availability" });
    }

    const row = await prisma.inventoryVisibilityVersion.upsert({
      where: { ownerId_versionKey: { ownerId: actorId, versionKey } },
      update: { visibility, autoMatchEnabled },
      create: { ownerId: actorId, versionKey, visibility, autoMatchEnabled },
    });

    reply.send({ visibility: row });
  });

  // POST /market/visibility/instance
  // body: { instanceId, visibility, autoMatchEnabled? }
  // Rule: availability requires an APPROVED INSTANCE verification.
  app.post("/visibility/instance", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const body = (req.body ?? {}) as any;
    const instanceId = assertNonEmptyString(body.instanceId, "instanceId");
    const visibility = assertNonEmptyString(body.visibility, "visibility") as InventoryVisibilityState;
    const autoMatchEnabled = !!body.autoMatchEnabled;

    const inst = await prisma.userCardInstance.findUnique({ where: { id: instanceId } });
    if (!inst) return reply.code(404).send({ error: "NOT_FOUND" });
    if (inst.ownerId !== actorId) return reply.code(403).send({ error: "FORBIDDEN" });

    if (visibility !== "PRIVATE") {
      const v = await prisma.verification.findFirst({
        where: { ownerId: actorId, scope: "INSTANCE", instanceId, status: "APPROVED" },
        orderBy: [{ updatedAt: "desc" }],
      });
      if (!v) return reply.code(400).send({ error: "NOT_VERIFIED", message: "Approved INSTANCE verification required to set availability" });
    }

    const row = await prisma.inventoryVisibilityInstance.upsert({
      where: { ownerId_instanceId: { ownerId: actorId, instanceId } },
      update: { visibility, autoMatchEnabled },
      create: { ownerId: actorId, instanceId, visibility, autoMatchEnabled },
    });

    reply.send({ visibility: row });
  });

  // GET /market/public/available/:userId
  // Hidden profile rule: outsiders can see ONLY AVAILABLE_* items.
  app.get("/public/available/:userId", async (req, reply) => {
    const viewerId = requireActorUserId(req, reply, opts.getActorUserId); // viewer required (helps rate limiting / abuse controls)
    if (!viewerId) return;

    const userId = (req.params as any).userId as string;
    const isHidden = opts.isProfileHidden ? await opts.isProfileHidden(userId) : false;

    // If profile is hidden: only AVAILABLE_* are ever returned (locked decision)
    const allowStates: InventoryVisibilityState[] = ["AVAILABLE_TRADE", "AVAILABLE_SELL"];

    const version = await prisma.inventoryVisibilityVersion.findMany({
      where: {
        ownerId: userId,
        visibility: { in: allowStates },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    const instances = await prisma.inventoryVisibilityInstance.findMany({
      where: {
        ownerId: userId,
        visibility: { in: allowStates },
      },
      orderBy: [{ updatedAt: "desc" }],
      include: { instance: true },
    });

    reply.send({
      userId,
      profileHidden: !!isHidden,
      available: {
        version,
        instances,
      },
    });
  });
}
