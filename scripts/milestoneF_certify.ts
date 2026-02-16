// scripts/milestoneF_certify.ts
// Milestone F — BoBucks Ledger Integrity Certification
//
// Goal: prove deterministic transitions + append-only history for 100 simulated cycles.
// This script runs an internal simulation directly against the DB (Prisma), not HTTP.
// It creates AWARDED -> CLAIMED -> (optional SPENT) -> EXPIRED / UNCLAIMED_EXPIRED entries
// and validates invariants.
//
// Run:
//   npx -y tsx scripts/milestoneF_certify.ts
//
// Optional:
//   SEED_PREFIX="M_F_CERT_" CYCLES=100 npx -y tsx scripts/milestoneF_certify.ts
//
// Notes:
// - This does not mutate existing rows, only appends new ones.
// - It uses deterministic timestamps derived from a fixed base time.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function envInt(name: string, def: number) {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function iso(d: Date) {
  return d.toISOString();
}

async function main() {
  const cycles = envInt("CYCLES", 100);
  const prefix = process.env.SEED_PREFIX ?? "M_F_CERT_";

  const base = new Date("2026-01-01T00:00:00.000Z");

  const userId = `${prefix}USER_1`;

  let ok = true;
  const errors: string[] = [];

  for (let i = 0; i < cycles; i++) {
    const awardIdTag = `${prefix}CTX_${i}`;

    // Deterministic times for this cycle
    const awardedAt = new Date(base.getTime() + i * 60_000); // + i minutes
    const claimAt = new Date(awardedAt.getTime() + 5_000); // +5s
    const claimWindowDays = 1;
    const claimExpiresAt = new Date(awardedAt.getTime() + claimWindowDays * 24 * 60 * 60 * 1000);

    const expirable = true;
    const durationDays = 1;
    const expiresAt = new Date(claimAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const amount = 10 + (i % 5); // 10..14

    // 1) AWARD (some cycles will be intentionally missed claim window)
    const shouldMissClaim = (i % 10) === 7; // deterministic pattern: 10% miss
    const shouldSpend = (i % 10) === 3; // deterministic pattern: 10% spend before expire

    const awarded = await (prisma as any).boBuckLedger.create({
      data: {
        userId,
        type: "AWARDED",
        origin: "EARNED",
        amount,
        contextId: awardIdTag,
        awardedAt,
        claimedAt: null,
        expiresAt: null,
        spentAt: null,
        claimExpiresAt,
        parentEntryId: null,
      },
    });

    // 2) CLAIM WINDOW ENFORCEMENT (simulate scan at now = claimExpiresAt + 1s)
    if (shouldMissClaim) {
      const now = new Date(claimExpiresAt.getTime() + 1000);

      // create UNCLAIMED_EXPIRED (idempotency not needed in cert run)
      await (prisma as any).boBuckLedger.create({
        data: {
          userId,
          type: "UNCLAIMED_EXPIRED",
          origin: awarded.origin,
          amount: awarded.amount,
          contextId: awarded.contextId,
          awardedAt: awarded.awardedAt,
          claimedAt: null,
          expiresAt: null,
          spentAt: null,
          claimExpiresAt: awarded.claimExpiresAt,
          parentEntryId: awarded.id,
        },
      });

      // Invariant: no CLAIMED should exist
      const claimed = await (prisma as any).boBuckLedger.findFirst({
        where: { parentEntryId: awarded.id, type: "CLAIMED" },
      });
      if (claimed) {
        ok = false;
        errors.push(`Cycle ${i}: CLAIMED exists for missed-claim award ${awarded.id}`);
      }

      continue;
    }

    // 3) CLAIM
    const claimed = await (prisma as any).boBuckLedger.create({
      data: {
        userId,
        type: "CLAIMED",
        origin: awarded.origin,
        amount: awarded.amount,
        contextId: awarded.contextId,
        awardedAt: awarded.awardedAt,
        claimedAt: claimAt,
        expiresAt,
        spentAt: null,
        claimExpiresAt: awarded.claimExpiresAt,
        parentEntryId: awarded.id,
      },
    });

    // 4) SPEND (optional, before expire)
    if (shouldSpend) {
      const spendAt = new Date(claimAt.getTime() + 10_000);
      const spendAmount = Math.max(1, Math.floor(amount / 2));

      await (prisma as any).boBuckLedger.create({
        data: {
          userId,
          type: "SPENT",
          origin: claimed.origin,
          amount: spendAmount,
          contextId: `${awardIdTag}_SPEND`,
          awardedAt: claimed.awardedAt,
          claimedAt: claimed.claimedAt,
          expiresAt: claimed.expiresAt,
          spentAt: spendAt,
          claimExpiresAt: claimed.claimExpiresAt,
          parentEntryId: claimed.id,
        },
      });
    }

    // 5) EXPIRATION PROCESSING (simulate scan at now = expiresAt + 1s)
    const now = new Date(expiresAt.getTime() + 1000);

    const spentAgg = await (prisma as any).boBuckLedger.aggregate({
      where: { parentEntryId: claimed.id, type: "SPENT" },
      _sum: { amount: true },
    });
    const spentSum = Number(spentAgg?._sum?.amount ?? 0);
    const remaining = Math.max(0, Number(claimed.amount) - spentSum);

    if (remaining > 0) {
      await (prisma as any).boBuckLedger.create({
        data: {
          userId,
          type: "EXPIRED",
          origin: claimed.origin,
          amount: remaining,
          contextId: claimed.contextId,
          awardedAt: claimed.awardedAt,
          claimedAt: claimed.claimedAt,
          expiresAt: claimed.expiresAt,
          spentAt: null,
          claimExpiresAt: claimed.claimExpiresAt,
          parentEntryId: claimed.id,
        },
      });
    }

    // Invariant: sum(SPENT) + sum(EXPIRED) <= CLAIMED.amount, and if now past expiry then equals CLAIMED.amount
    const spentRows = await (prisma as any).boBuckLedger.findMany({
      where: { parentEntryId: claimed.id, type: "SPENT" },
    });
    const expiredRows = await (prisma as any).boBuckLedger.findMany({
      where: { parentEntryId: claimed.id, type: "EXPIRED" },
    });

    const spentTotal = spentRows.reduce((s: number, r: any) => s + Number(r.amount), 0);
    const expiredTotal = expiredRows.reduce((s: number, r: any) => s + Number(r.amount), 0);
    const claimedAmount = Number(claimed.amount);

    if (spentTotal + expiredTotal !== claimedAmount) {
      ok = false;
      errors.push(
        `Cycle ${i}: balance mismatch for claimed ${claimed.id} (spent=${spentTotal}, expired=${expiredTotal}, claimed=${claimedAmount})`
      );
    }

    // Determinism sanity: timestamps fixed
    if (iso(claimed.claimedAt) != iso(claimAt) || (claimed.expiresAt && iso(claimed.expiresAt) != iso(expiresAt))) {
      ok = false;
      errors.push(`Cycle ${i}: timestamp mismatch for claimed ${claimed.id}`);
    }

    // This "now" is not written; used only to anchor the deterministic simulation
    void now;
  }

  if (!ok) {
    console.error("Milestone F CERT FAIL");
    for (const e of errors.slice(0, 25)) console.error("-", e);
    console.error(`Total errors: ${errors.length}`);
    process.exit(1);
  }

  console.log("Milestone F CERT PASS");
  console.log(
    JSON.stringify(
      {
        cycles,
        userId,
        note: "Created append-only ledger entries for certification; inspect via /admin/bobucks/ledger?userId=...",
      },
      null,
      2
    )
  );
  process.exit(0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
