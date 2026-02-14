// src/server/sponsorPools.routes.v1.ts
// Phase 8 — Sponsor Funding Pools (append-only, no BoBucks issuance)

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

function asPositiveInt(n: any): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i !== n) return null;
  if (i <= 0) return null;
  return i;
}



function computePoolSummary(ledger: any[]): { totalCredit: number; totalDebit: number; balance: number } {
  const totalCredit = ledger.reduce((acc: number, r: any) => (r.type === "CREDIT" ? acc + r.amount : acc), 0);
  const totalDebit = ledger.reduce((acc: number, r: any) => (r.type === "DEBIT" ? acc + r.amount : acc), 0);
  return { totalCredit, totalDebit, balance: totalCredit - totalDebit };
}

async function computePoolTotals(prisma: PrismaClient, poolId: string): Promise<{ totalCredit: number; totalDebit: number; balance: number }> {
  const creditAgg = await (prisma as any).sponsorPoolLedger.aggregate({
    where: { poolId, type: "CREDIT" },
    _sum: { amount: true },
  });

  const debitAgg = await (prisma as any).sponsorPoolLedger.aggregate({
    where: { poolId, type: "DEBIT" },
    _sum: { amount: true },
  });

  const totalCredit = Number(creditAgg?._sum?.amount ?? 0);
  const totalDebit = Number(debitAgg?._sum?.amount ?? 0);

  return { totalCredit, totalDebit, balance: totalCredit - totalDebit };
}

export async function registerSponsorPoolRoutesV1(app: FastifyInstance, prisma: PrismaClient) {

  app.post("/admin/sponsor-pools", async (req: any, reply) => {
    try {
      const sponsorId = String(req.body?.sponsorId ?? "").trim();
      const name = String(req.body?.name ?? "").trim();

      if (!sponsorId) return reply.code(400).send({ ok: false, error: "sponsorId required" });
      if (!name) return reply.code(400).send({ ok: false, error: "name required" });

      const created = await (prisma as any).sponsorPool.create({
        data: { sponsorId, name },
      });

      return reply.send({ ok: true, pool: created });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  app.post("/admin/sponsor-pools/:poolId/credit", async (req: any, reply) => {
    try {
      const poolId = String(req.params?.poolId ?? "");
      const amount = asPositiveInt(req.body?.amount);
      const contextId = req.body?.contextId ? String(req.body.contextId) : null;

      if (!poolId) return reply.code(400).send({ ok: false, error: "poolId required" });
      if (!amount) return reply.code(400).send({ ok: false, error: "amount must be positive integer" });

      const entry = await (prisma as any).sponsorPoolLedger.create({
        data: { poolId, type: "CREDIT", amount, contextId },
      });

      return reply.send({ ok: true, entry });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  app.post("/admin/sponsor-pools/:poolId/debit", async (req: any, reply) => {
    try {
      const poolId = String(req.params?.poolId ?? "");
      const amount = asPositiveInt(req.body?.amount);
      const contextId = req.body?.contextId ? String(req.body.contextId) : null;

      if (!poolId) return reply.code(400).send({ ok: false, error: "poolId required" });
      if (!amount) return reply.code(400).send({ ok: false, error: "amount must be positive integer" });

      const ledger = await (prisma as any).sponsorPoolLedger.findMany({ where: { poolId } });

      const balance = ledger.reduce((acc: number, row: any) => {
        return row.type === "CREDIT" ? acc + row.amount : acc - row.amount;
      }, 0);

      if (balance - amount < 0) {
        return reply.code(400).send({ ok: false, error: "INSUFFICIENT_POOL_BALANCE" });
      }

      const entry = await (prisma as any).sponsorPoolLedger.create({
        data: { poolId, type: "DEBIT", amount, contextId },
      });

      return reply.send({ ok: true, entry });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

    // LEDGER (inspection)
  // Query params: type=CREDIT|DEBIT, contextId=..., limit=...
  // Includes: pool + sponsor identity + derived totals
  app.get("/admin/sponsor-pools/:poolId/ledger", async (req: any, reply) => {
    try {
      const poolId = String(req.params?.poolId ?? "");
      if (!poolId) return reply.code(400).send({ ok: false, error: "poolId required" });

      const qTypeRaw = req.query?.type;
      const qType = qTypeRaw === "CREDIT" || qTypeRaw === "DEBIT" ? qTypeRaw : null;
      const qContextId = req.query?.contextId ? String(req.query.contextId) : null;

      let limit: number | null = null;
      if (req.query?.limit != null) {
        const n = Number(req.query.limit);
        if (Number.isFinite(n)) {
          const i = Math.trunc(n);
          if (i > 0) limit = Math.min(i, 5000);
        }
      }

      const pool = await (prisma as any).sponsorPool.findUnique({ where: { id: poolId } });
      if (!pool) return reply.code(404).send({ ok: false, error: "POOL_NOT_FOUND" });

      const sponsor = pool.sponsorId
        ? await (prisma as any).sponsor.findUnique({ where: { id: pool.sponsorId } })
        : null;

      const where: any = { poolId };
      if (qType) where.type = qType;
      if (qContextId) where.contextId = qContextId;

      const ledger = await (prisma as any).sponsorPoolLedger.findMany({
        where,
        orderBy: { createdAt: "asc" },
        ...(limit ? { take: limit } : {}),
      });

      const summary = computePoolSummary(ledger);
      const summaryPoolTotal = await computePoolTotals(prisma, poolId);

      return reply.send({
        ok: true,
        pool: { id: pool.id, name: pool.name, sponsorId: pool.sponsorId, createdAt: pool.createdAt },
        sponsor: sponsor ? { id: sponsor.id, name: sponsor.name, slug: sponsor.slug } : null,
        filters: { type: qType, contextId: qContextId, limit },
        summary,
        summaryPoolTotal,
        count: ledger.length,
        ledger,
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  // INSPECT alias (same behavior as /ledger)
  app.get("/admin/sponsor-pools/:poolId/inspect", async (req: any, reply) => {
    try {
      const poolId = String(req.params?.poolId ?? "");
      if (!poolId) return reply.code(400).send({ ok: false, error: "poolId required" });

      const qTypeRaw = req.query?.type;
      const qType = qTypeRaw === "CREDIT" || qTypeRaw === "DEBIT" ? qTypeRaw : null;
      const qContextId = req.query?.contextId ? String(req.query.contextId) : null;

      let limit: number | null = null;
      if (req.query?.limit != null) {
        const n = Number(req.query.limit);
        if (Number.isFinite(n)) {
          const i = Math.trunc(n);
          if (i > 0) limit = Math.min(i, 5000);
        }
      }

      const pool = await (prisma as any).sponsorPool.findUnique({ where: { id: poolId } });
      if (!pool) return reply.code(404).send({ ok: false, error: "POOL_NOT_FOUND" });

      const sponsor = pool.sponsorId
        ? await (prisma as any).sponsor.findUnique({ where: { id: pool.sponsorId } })
        : null;

      const where: any = { poolId };
      if (qType) where.type = qType;
      if (qContextId) where.contextId = qContextId;

      const ledger = await (prisma as any).sponsorPoolLedger.findMany({
        where,
        orderBy: { createdAt: "asc" },
        ...(limit ? { take: limit } : {}),
      });

      const summary = computePoolSummary(ledger);
      const summaryPoolTotal = await computePoolTotals(prisma, poolId);

      return reply.send({
        ok: true,
        pool: { id: pool.id, name: pool.name, sponsorId: pool.sponsorId, createdAt: pool.createdAt },
        sponsor: sponsor ? { id: sponsor.id, name: sponsor.name, slug: sponsor.slug } : null,
        filters: { type: qType, contextId: qContextId, limit },
        summary,
        summaryPoolTotal,
        count: ledger.length,
        ledger,
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  app.get("/admin/sponsor-pools/:poolId/balance", async (req: any, reply) => {
    try {
      const poolId = String(req.params?.poolId ?? "");
      if (!poolId) return reply.code(400).send({ ok: false, error: "poolId required" });

      const ledger = await (prisma as any).sponsorPoolLedger.findMany({ where: { poolId } });

      const balance = ledger.reduce((acc: number, row: any) => {
        return row.type === "CREDIT" ? acc + row.amount : acc - row.amount;
      }, 0);

      return reply.send({ ok: true, poolId, balance });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });
}
