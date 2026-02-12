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

// V1 order model:
// - preview validates listing availability + totals (no writes)
// - create reserves qty on listing lines (increments qtyReserved)
// - confirm finalizes (reserved -> sold) and writes transfer records + buyer inventory
// - cancel releases reservation (decrements qtyReserved) and restores seller availability ONLY for version lines (because we lock at listing create)

type OrderItem = { listingLineId?: string; listingId?: string; versionKey?: string; qty?: number; instanceId?: string };

export function registerOrdersRoutes(app: FastifyInstance, prisma: PrismaClient, opts: MarketplaceRegisterOptions) {
  // POST /market/orders/preview
  // body: { items: [{ listingId, versionKey, qty }...] }
  app.post("/orders/preview", async (req, reply) => {
    const buyerId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!buyerId) return;

    const body = (req.body ?? {}) as any;
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return reply.code(400).send({ error: "BAD_REQUEST", message: "items required" });

    let subtotalCents = 0;
    const resolved: any[] = [];

    for (const it of items) {
      const listingId = assertNonEmptyString(it.listingId, "listingId");
      const versionKey = it.versionKey ? assertNonEmptyString(it.versionKey, "versionKey") : null;
      const instanceId = it.instanceId ? assertNonEmptyString(it.instanceId, "instanceId") : null;

      const qty = it.qty != null ? assertInt(it.qty, "qty") : 1;
      if (qty <= 0) return reply.code(400).send({ error: "BAD_REQUEST", message: "qty must be > 0" });

      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        include: { lines: true, instanceLines: true },
      });
      if (!listing) return reply.code(404).send({ error: "NOT_FOUND", message: `Listing ${listingId} not found` });
      if (listing.status !== "ACTIVE") return reply.code(400).send({ error: "NOT_ACTIVE", message: "Listing not active" });

      if (instanceId) {
        const li = listing.instanceLines.find(x => x.instanceId === instanceId);
        if (!li) return reply.code(400).send({ error: "BAD_REQUEST", message: "Instance not in listing" });
        if (li.reserved || li.sold) return reply.code(400).send({ error: "UNAVAILABLE", message: "Instance unavailable" });

        const price = listing.priceCents ?? 0;
        subtotalCents += price;
        resolved.push({ listingId, instanceId, qty: 1, unitPriceCents: price, lineTotalCents: price });
      } else {
        if (!versionKey) return reply.code(400).send({ error: "BAD_REQUEST", message: "versionKey required for quantity item" });
        const line = listing.lines.find(x => x.versionKey === versionKey);
        if (!line) return reply.code(400).send({ error: "BAD_REQUEST", message: "versionKey not in listing" });

        const remaining = line.qtyListed - line.qtyReserved - line.qtySold;
        if (remaining < qty) return reply.code(400).send({ error: "UNAVAILABLE", message: "Not enough quantity available in listing" });

        const price = listing.priceCents ?? 0;
        subtotalCents += price * qty;
        resolved.push({ listingId, versionKey, qty, unitPriceCents: price, lineTotalCents: price * qty });
      }
    }

    reply.send({ buyerId, subtotalCents, items: resolved });
  });

  // POST /market/orders  (reserve)
  // body: same as preview
  app.post("/orders", async (req, reply) => {
    const buyerId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!buyerId) return;

    const body = (req.body ?? {}) as any;
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return reply.code(400).send({ error: "BAD_REQUEST", message: "items required" });

    const created = await prisma.$transaction(async (tx) => {
      let subtotalCents = 0;

      const order = await tx.order.create({
        data: { buyerId, status: "PENDING", currency: "USD", subtotalCents: 0 },
      });

      for (const it of items) {
        const listingId = assertNonEmptyString(it.listingId, "listingId");
        const versionKey = it.versionKey ? assertNonEmptyString(it.versionKey, "versionKey") : null;
        const instanceId = it.instanceId ? assertNonEmptyString(it.instanceId, "instanceId") : null;
        const qty = it.qty != null ? assertInt(it.qty, "qty") : 1;

        const listing = await tx.listing.findUnique({
          where: { id: listingId },
          include: { lines: true, instanceLines: true },
        });
        if (!listing) throw new Error(`NOT_FOUND:LISTING:${listingId}`);
        if (listing.status !== "ACTIVE") throw new Error(`NOT_ACTIVE:LISTING:${listingId}`);

        if (instanceId) {
          const li = listing.instanceLines.find(x => x.instanceId === instanceId);
          if (!li) throw new Error(`BAD_REQUEST:INSTANCE_NOT_IN_LISTING:${instanceId}`);
          if (li.reserved || li.sold) throw new Error(`UNAVAILABLE:INSTANCE:${instanceId}`);

          await tx.listingLineInstance.update({ where: { id: li.id }, data: { reserved: true } });

          const price = listing.priceCents ?? 0;
          subtotalCents += price;

          await tx.orderLine.create({
            data: { orderId: order.id, listingId, instanceId, qty: 1, unitPriceCents: price, lineTotalCents: price },
          });
        } else {
          if (!versionKey) throw new Error("BAD_REQUEST:VERSIONKEY_REQUIRED");
          if (qty <= 0) throw new Error("BAD_REQUEST:QTY");

          const line = listing.lines.find(x => x.versionKey === versionKey);
          if (!line) throw new Error(`BAD_REQUEST:VERSION_NOT_IN_LISTING:${versionKey}`);

          const remaining = line.qtyListed - line.qtyReserved - line.qtySold;
          if (remaining < qty) throw new Error(`UNAVAILABLE:QTY:${versionKey}`);

          await tx.listingLine.update({
            where: { id: line.id },
            data: { qtyReserved: { increment: qty } },
          });

          const price = listing.priceCents ?? 0;
          subtotalCents += price * qty;

          await tx.orderLine.create({
            data: { orderId: order.id, listingId, versionKey, qty, unitPriceCents: price, lineTotalCents: price * qty },
          });

          // Note: seller inventory was already locked at listing create (Option 1).
          // Order reserve does NOT touch OwnershipLot.qtyAvailable for version lines.
        }
      }

      await tx.order.update({ where: { id: order.id }, data: { subtotalCents } });

      return tx.order.findUnique({ where: { id: order.id }, include: { lines: true } });
    });

    reply.code(201).send({ order: created });
  });

  // POST /market/orders/:id/confirm
  app.post("/orders/:id/confirm", async (req, reply) => {
    const buyerId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!buyerId) return;

    const id = (req.params as any).id as string;

    const confirmed = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, include: { lines: true } });
      if (!order) throw new Error("NOT_FOUND");
      if (order.buyerId !== buyerId) throw new Error("FORBIDDEN");
      if (order.status !== "PENDING") throw new Error("BAD_STATE");

      // finalize each line: reserved->sold for listing lines, create buyer inventory, write transfers+ledger
      for (const line of order.lines) {
        if (line.instanceId) {
          const listing = await tx.listing.findUnique({
            where: { id: line.listingId! },
            include: { instanceLines: true },
          });
          if (!listing) throw new Error("LISTING_NOT_FOUND");

          const li = listing.instanceLines.find(x => x.instanceId === line.instanceId);
          if (!li || !li.reserved || li.sold) throw new Error("INSTANCE_NOT_RESERVED");

          await tx.listingLineInstance.update({ where: { id: li.id }, data: { reserved: false, sold: true } });

          // Transfer instance ownership (custody move)
          const inst = await tx.userCardInstance.findUnique({ where: { id: line.instanceId } });
          if (!inst) throw new Error("INSTANCE_MISSING");
          const fromUserId = inst.ownerId;

          await tx.userCardInstance.update({ where: { id: inst.id }, data: { ownerId: buyerId } });

          await tx.inventoryTransfer.create({
            data: { fromUserId, toUserId: buyerId, orderId: order.id, status: "COMPLETED", completedAt: new Date() },
          });

          await tx.inventoryLedger.create({
            data: {
              ownerId: fromUserId,
              versionKey: inst.versionKey,
              deltaQty: -1,
              reason: "TRANSFER_COMPLETE" as LedgerReason,
              refType: "ORDER",
              refId: order.id,
            },
          });

          await tx.inventoryLedger.create({
            data: {
              ownerId: buyerId,
              versionKey: inst.versionKey,
              deltaQty: +1,
              reason: "TRANSFER_COMPLETE" as LedgerReason,
              refType: "ORDER",
              refId: order.id,
            },
          });
        } else {
          // version qty line
          const listingId = line.listingId!;
          const versionKey = line.versionKey!;
          const qty = line.qty;

          const listing = await tx.listing.findUnique({
            where: { id: listingId },
            include: { lines: true },
          });
          if (!listing) throw new Error("LISTING_NOT_FOUND");

          const ll = listing.lines.find(x => x.versionKey === versionKey);
          if (!ll) throw new Error("LINE_NOT_FOUND");
          if (ll.qtyReserved < qty) throw new Error("NOT_ENOUGH_RESERVED");

          await tx.listingLine.update({
            where: { id: ll.id },
            data: { qtyReserved: { decrement: qty }, qtySold: { increment: qty } },
          });

          // Move custody: decrement seller lot total (not available; already locked), increment buyer lot total+available
          const sellerId = listing.sellerId;

          // decrement seller qtyTotal (pick freshest lot)
          const sellerLot = await tx.ownershipLot.findFirst({
            where: { ownerId: sellerId, versionKey, qtyTotal: { gte: qty } },
            orderBy: [{ updatedAt: "desc" }],
          });
          if (!sellerLot) throw new Error("SELLER_LOT_MISSING");

          await tx.ownershipLot.update({
            where: { id: sellerLot.id },
            data: { qtyTotal: { decrement: qty } },
          });

          // mint/add to buyer ownership (simple: create a new lot)
          const buyerLot = await tx.ownershipLot.create({
            data: { ownerId: buyerId, versionKey, qtyTotal: qty, qtyAvailable: qty, acquiredAt: new Date(), source: "PURCHASE" },
          });

          await tx.inventoryTransfer.create({
            data: { fromUserId: sellerId, toUserId: buyerId, orderId: order.id, status: "COMPLETED", completedAt: new Date() },
          });

          await tx.inventoryLedger.create({
            data: { ownerId: sellerId, versionKey, deltaQty: -qty, reason: "SALE_COMPLETE" as LedgerReason, refType: "ORDER", refId: order.id },
          });
          await tx.inventoryLedger.create({
            data: { ownerId: buyerId, versionKey, deltaQty: +qty, reason: "SALE_COMPLETE" as LedgerReason, refType: "ORDER", refId: order.id },
          });
        }
      }

      const updated = await tx.order.update({
        where: { id },
        data: { status: "CONFIRMED" },
        include: { lines: true },
      });

      return updated;
    });

    reply.send({ order: confirmed });
  });

  // POST /market/orders/:id/cancel
  app.post("/orders/:id/cancel", async (req, reply) => {
    const buyerId = requireActorUserId(req, reply, opts.getActorUserId);
    if (!buyerId) return;

    const id = (req.params as any).id as string;

    const cancelled = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, include: { lines: true } });
      if (!order) throw new Error("NOT_FOUND");
      if (order.buyerId !== buyerId) throw new Error("FORBIDDEN");
      if (order.status !== "PENDING") throw new Error("BAD_STATE");

      for (const line of order.lines) {
        if (line.instanceId) {
          const listing = await tx.listing.findUnique({ where: { id: line.listingId! }, include: { instanceLines: true } });
          if (!listing) continue;
          const li = listing.instanceLines.find(x => x.instanceId === line.instanceId);
          if (li && li.reserved && !li.sold) {
            await tx.listingLineInstance.update({ where: { id: li.id }, data: { reserved: false } });
          }
        } else {
          const listing = await tx.listing.findUnique({ where: { id: line.listingId! }, include: { lines: true } });
          if (!listing) continue;
          const ll = listing.lines.find(x => x.versionKey === line.versionKey);
          if (ll && ll.qtyReserved >= line.qty) {
            await tx.listingLine.update({ where: { id: ll.id }, data: { qtyReserved: { decrement: line.qty } } });
          }
        }
      }

      return tx.order.update({ where: { id }, data: { status: "CANCELLED" }, include: { lines: true } });
    });

    reply.send({ order: cancelled });
  });
}
