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
import type { PrismaClient, LedgerReason } from "@prisma/client";
import { requireActorUserId, assertInt, assertNonEmptyString } from "./utils";
import type { MarketplaceRegisterOptions } from "./marketplace.routes";

export function registerOwnershipRoutes(app: FastifyInstance, prisma: PrismaClient, opts: MarketplaceRegisterOptions) {
  // GET /market/ownership (actor)
  app.get("/ownership", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const lots = await prisma.ownershipLot.findMany({
      where: { ownerId: actorId },
      orderBy: [{ updatedAt: "desc" }],
    });

    reply.send({ ownerId: actorId, lots });
  });

  // POST /market/ownership/mint (admin/dev tool)
  // body: { ownerId?, versionKey, qty }
  app.post("/ownership/mint", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const body = (req.body ?? {}) as any;
    const ownerId = (body.ownerId ? assertNonEmptyString(body.ownerId, "ownerId") : actorId);
    const versionKey = assertNonEmptyString(body.versionKey, "versionKey");
    const qty = assertInt(body.qty, "qty");
    if (qty <= 0) return reply.code(400).send({ error: "BAD_REQUEST", message: "qty must be > 0" });

    // ensure catalog exists
    const cv = await prisma.cardVersion.findUnique({ where: { versionKey } });
    if (!cv) return reply.code(400).send({ error: "UNKNOWN_VERSIONKEY", message: "versionKey not found in catalog" });

    const lot = await prisma.ownershipLot.create({
      data: {
        ownerId,
        versionKey,
        qtyTotal: qty,
        qtyAvailable: qty,
        acquiredAt: new Date(),
        source: "MINT",
      },
    });

    await prisma.inventoryLedger.create({
      data: {
        ownerId,
        versionKey,
        deltaQty: qty,
        reason: "MINT" as LedgerReason,
        refType: "OWNERSHIP_LOT",
        refId: lot.id,
      },
    });

    reply.code(201).send({ lot });
  });

  // POST /market/ownership/adjust (admin correction)
  // body: { ownerId, versionKey, deltaQty, reason?, note? }
  app.post("/ownership/adjust", async (req, reply) => {
    const actorId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!actorId) return;

    const body = (req.body ?? {}) as any;
    const ownerId = assertNonEmptyString(body.ownerId, "ownerId");
    const versionKey = assertNonEmptyString(body.versionKey, "versionKey");
    const deltaQty = assertInt(body.deltaQty, "deltaQty");
    if (deltaQty === 0) return reply.code(400).send({ error: "BAD_REQUEST", message: "deltaQty must be non-zero" });

    // Choose a lot to adjust (most recent). This keeps v1 simple.
    const lot = await prisma.ownershipLot.findFirst({
      where: { ownerId, versionKey },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (!lot) return reply.code(404).send({ error: "NOT_FOUND", message: "No ownership lot found for ownerId+versionKey" });

    const newTotal = lot.qtyTotal + deltaQty;
    const newAvail = lot.qtyAvailable + deltaQty;
    if (newTotal < 0 || newAvail < 0) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "Adjustment would make qty negative" });
    }

    const updated = await prisma.ownershipLot.update({
      where: { id: lot.id },
      data: { qtyTotal: newTotal, qtyAvailable: newAvail },
    });

    await prisma.inventoryLedger.create({
      data: {
        ownerId,
        versionKey,
        deltaQty,
        reason: "ADMIN_ADJUST" as any,
        refType: "OWNERSHIP_LOT",
        refId: updated.id,
      },
    });

    reply.send({ lot: updated });
  });
}
