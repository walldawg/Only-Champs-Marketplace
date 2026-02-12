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
import type { PrismaClient, ListingKind, ListingStatus, LedgerReason } from "@prisma/client";
import { requireActorUserId, assertInt, assertNonEmptyString } from "./utils";
import type { MarketplaceRegisterOptions } from "./marketplace.routes";

type CreateListingBody = {
  kind: ListingKind; // SALE or TRADE
  currency?: string;
  priceCents?: number; // required if kind=SALE (v1 rule)
  notes?: string;
  lines?: Array<{ versionKey: string; qty: number }>;
  instances?: Array<{ instanceId: string }>;
};

// V1 enforcement (locked): Option 1 inventory lock on listing create.
// - quantity listings deduct from OwnershipLot.qtyAvailable immediately.
// - cancelling listing releases the remaining unsold qty back.

export function registerListingsRoutes(app: FastifyInstance, prisma: PrismaClient, opts: MarketplaceRegisterOptions) {
  // GET /market/listings?status=ACTIVE&versionKey=...
  app.get("/listings", async (req, reply) => {
    const q = (req.query ?? {}) as any;
    const status = q.status ? String(q.status) : "ACTIVE";
    const versionKey = q.versionKey ? String(q.versionKey) : null;

    const listings = await prisma.listing.findMany({
      where: {
        status: status as ListingStatus,
        ...(versionKey ? { lines: { some: { versionKey } } } : {}),
      },
      include: { lines: true, instanceLines: true },
      orderBy: [{ updatedAt: "desc" }],
    });

    reply.send({ listings });
  });

  // GET /market/listings/:id
  app.get("/listings/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: { lines: true, instanceLines: { include: { instance: true } } },
    });
    if (!listing) return reply.code(404).send({ error: "NOT_FOUND" });
    reply.send({ listing });
  });

  // POST /market/listings
  // body: CreateListingBody
  app.post("/listings", async (req, reply) => {
    const sellerId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!sellerId) return;

    const body = (req.body ?? {}) as any as CreateListingBody;
    const kind = assertNonEmptyString(body.kind, "kind") as ListingKind;
    const currency = body.currency ? assertNonEmptyString(body.currency, "currency") : undefined;
    const notes = body.notes ? String(body.notes) : undefined;

    const priceCents = body.priceCents != null ? Number(body.priceCents) : undefined;
    if (kind === "SALE" && (priceCents == null || !Number.isInteger(priceCents) || priceCents <= 0)) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "priceCents required (>0 integer) for SALE listing" });
    }

    const lines = Array.isArray(body.lines) ? body.lines : [];
    const instances = Array.isArray(body.instances) ? body.instances : [];

    if (lines.length === 0 && instances.length === 0) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "Provide at least one line or instance" });
    }

    // Validate lines (FIFO aggregate availability)
    for (const line of lines) {
      const versionKey = assertNonEmptyString(line.versionKey, "lines.versionKey");
      const qty = assertInt(line.qty, "lines.qty");
      if (qty <= 0) return reply.code(400).send({ error: "BAD_REQUEST", message: "qty must be > 0" });

      const ver = await prisma.verification.findFirst({
        where: { ownerId: sellerId, scope: "VERSION", versionKey, status: "APPROVED" },
        orderBy: [{ updatedAt: "desc" }],
      });
      if (!ver) return reply.code(400).send({ error: "NOT_VERIFIED", message: `Approved VERSION verification required for ${versionKey}` });

      const lots = await prisma.ownershipLot.findMany({
        where: { ownerId: sellerId, versionKey },
        orderBy: [{ acquiredAt: "asc" }, { createdAt: "asc" }],
      });

      const totalAvailable = lots.reduce((sum, lot) => sum + lot.qtyAvailable, 0);
      if (totalAvailable < qty) {
        return reply.code(400).send({ error: "INSUFFICIENT_INVENTORY", message: `Not enough available qty for ${versionKey}` });
      }
    }

    // Validate instances: must be owned + APPROVED INSTANCE verification
    for (const instLine of instances) {
      const instanceId = assertNonEmptyString(instLine.instanceId, "instances.instanceId");
      const inst = await prisma.userCardInstance.findUnique({ where: { id: instanceId } });
      if (!inst) return reply.code(400).send({ error: "UNKNOWN_INSTANCE", message: `Instance ${instanceId} not found` });
      if (inst.ownerId !== sellerId) return reply.code(403).send({ error: "FORBIDDEN", message: `You do not own instance ${instanceId}` });

      const ver = await prisma.verification.findFirst({
        where: { ownerId: sellerId, scope: "INSTANCE", instanceId, status: "APPROVED" },
        orderBy: [{ updatedAt: "desc" }],
      });
      if (!ver) return reply.code(400).send({ error: "NOT_VERIFIED", message: `Approved INSTANCE verification required for ${instanceId}` });
    }

    // Transaction: create listing and lock inventory immediately (Option 1 - FIFO)
    const created = await prisma.$transaction(async (tx) => {
      const listing = await tx.listing.create({
        data: {
          sellerId,
          kind,
          status: "ACTIVE",
          currency,
          priceCents,
          notes,
        },
      });

      for (const line of lines) {
        const versionKey = line.versionKey;
        let remaining = line.qty;

        const lots = await tx.ownershipLot.findMany({
          where: { ownerId: sellerId, versionKey },
          orderBy: [{ acquiredAt: "asc" }, { createdAt: "asc" }],
        });

        for (const lot of lots) {
          if (remaining <= 0) break;
          if (lot.qtyAvailable <= 0) continue;

          const decrement = Math.min(lot.qtyAvailable, remaining);

          await tx.ownershipLot.update({
            where: { id: lot.id },
            data: { qtyAvailable: { decrement } },
          });

          remaining -= decrement;
        }

        if (remaining > 0) {
          throw new Error(`INSUFFICIENT_INVENTORY:${versionKey}`);
        }

        await tx.listingLine.create({
          data: { listingId: listing.id, versionKey, qtyListed: line.qty },
        });

        await tx.inventoryLedger.create({
          data: {
            ownerId: sellerId,
            versionKey,
            deltaQty: -line.qty,
            reason: "LIST_CREATE_LOCK",
            refType: "LISTING",
            refId: listing.id,
          },
        });
      }

      for (const instLine of instances) {
        const instanceId = instLine.instanceId;
        await tx.listingLineInstance.create({
          data: { listingId: listing.id, instanceId },
        });
        // v1 does not "lock" instance ownership qty; instance is unique and will be reserved on order.
      }

      return tx.listing.findUnique({
        where: { id: listing.id },
        include: { lines: true, instanceLines: true },
      });
    });

    reply.code(201).send({ listing: created });
  });

  // POST /market/listings/:id/pause (seller)
  app.post("/listings/:id/pause", async (req, reply) => {
    const sellerId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!sellerId) return;

    const id = (req.params as any).id as string;
    const listing = await prisma.listing.findUnique({ where: { id } });
    if (!listing) return reply.code(404).send({ error: "NOT_FOUND" });
    if (listing.sellerId !== sellerId) return reply.code(403).send({ error: "FORBIDDEN" });

    const updated = await prisma.listing.update({
      where: { id },
      data: { status: "PAUSED" },
      include: { lines: true, instanceLines: true },
    });

    reply.send({ listing: updated });
  });

  // POST /market/listings/:id/cancel (seller) — releases remaining unsold qty back to availability.
  app.post("/listings/:id/cancel", async (req, reply) => {
    const sellerId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!sellerId) return;

    const id = (req.params as any).id as string;

    const updated = await prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id },
        include: { lines: true, instanceLines: true },
      });
      if (!listing) throw new Error("NOT_FOUND");
      if (listing.sellerId !== sellerId) throw new Error("FORBIDDEN");

      if (listing.status === "CANCELLED") return listing;

      // Release quantity lines: qtyRemaining = qtyListed - qtyReserved - qtySold
      for (const line of listing.lines) {
        const remaining = line.qtyListed - line.qtyReserved - line.qtySold;
        if (remaining > 0) {
          const lot = await tx.ownershipLot.findFirst({
            where: { ownerId: sellerId, versionKey: line.versionKey },
            orderBy: [{ updatedAt: "desc" }],
          });
          if (!lot) throw new Error(`NO_OWNERSHIP_LOT:${line.versionKey}`);

          await tx.ownershipLot.update({
            where: { id: lot.id },
            data: { qtyAvailable: { increment: remaining } },
          });

          await tx.inventoryLedger.create({
            data: {
              ownerId: sellerId,
              versionKey: line.versionKey,
              deltaQty: remaining,
              reason: "LIST_CANCEL_RELEASE" as any,
              refType: "LISTING",
              refId: id,
            },
          });
        }
      }

      const updatedListing = await tx.listing.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: { lines: true, instanceLines: true },
      });

      return updatedListing;
    }).catch((e: any) => {
      const msg = String(e?.message ?? e);
      if (msg.includes("NOT_FOUND")) return null;
      throw e;
    });

    if (!updated) return reply.code(404).send({ error: "NOT_FOUND" });
    reply.send({ listing: updated });
  });
}
