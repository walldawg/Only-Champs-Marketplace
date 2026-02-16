// src/server/bobucks.routes.v1.ts
// Milestone F — Soft Economy Foundation
// Includes:
// - Admin Ledger (read-only, optional contextId filter)
// - Minimal Balance Endpoint (derived, read-only, optional contextId filter)
// Append-only ledger. No mutation logic modified.

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

export async function registerBoBucksRoutesV1(app: FastifyInstance, prisma: PrismaClient) {

  // -------------------------------
  // ADMIN LEDGER (read-only, filterable)
  // -------------------------------
  app.get("/admin/bobucks/ledger", async (req: any, reply) => {
    try {
      const userId = String(req.query?.userId ?? "").trim();
      if (!userId) return reply.code(400).send({ ok: false, error: "userId required" });

      const contextId = req.query?.contextId ? String(req.query.contextId) : null;

      const where: any = { userId };
      if (contextId) where.contextId = contextId;

      const rows = await (prisma as any).boBuckLedger.findMany({
        where,
        orderBy: { createdAt: "asc" },
      });

      return reply.send({
        ok: true,
        userId,
        contextId: contextId ?? null,
        count: rows.length,
        entries: rows,
      });

    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  // -------------------------------
  // MINIMAL BALANCE (derived, read-only, filterable)
  // -------------------------------
  app.get("/bobucks/v1/balance", async (req: any, reply) => {
    try {
      const userId = String(req.query?.userId ?? "").trim();
      if (!userId) return reply.code(400).send({ ok: false, error: "userId required" });

      const contextId = req.query?.contextId ? String(req.query.contextId) : null;

      const whereClaimed: any = { userId, type: "CLAIMED" };
      if (contextId) whereClaimed.contextId = contextId;

      const claimed = await (prisma as any).boBuckLedger.findMany({
        where: whereClaimed,
      });

      let totalClaimed = 0;
      let totalSpent = 0;
      let totalExpired = 0;
      let available = 0;

      for (const c of claimed) {

        const childFilterBase: any = { parentEntryId: c.id };
        if (contextId) childFilterBase.contextId = contextId;

        const spentRows = await (prisma as any).boBuckLedger.findMany({
          where: { ...childFilterBase, type: "SPENT" },
        });

        const expiredRows = await (prisma as any).boBuckLedger.findMany({
          where: { ...childFilterBase, type: "EXPIRED" },
        });

        const claimedAmount = Number(c.amount);
        const spentSum = spentRows.reduce((s: number, r: any) => s + Number(r.amount), 0);
        const expiredSum = expiredRows.reduce((s: number, r: any) => s + Number(r.amount), 0);

        totalClaimed += claimedAmount;
        totalSpent += spentSum;
        totalExpired += expiredSum;

        const remaining = Math.max(0, claimedAmount - spentSum - expiredSum);
        available += remaining;
      }

      return reply.send({
        ok: true,
        userId,
        contextId: contextId ?? null,
        summary: {
          totalClaimed,
          totalSpent,
          totalExpired,
          available,
        },
      });

    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

}
