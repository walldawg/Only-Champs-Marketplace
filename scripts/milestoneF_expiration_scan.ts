// scripts/milestoneF_expiration_scan.ts
// Milestone F — Layer 5: Expiration Processing Job
// Scan CLAIMED entries with expiresAt that are past due.
// For each, compute remaining (amount - sum(SPENT children)) and append EXPIRED for the remaining.
// Append-only ledger. No mutation. No deletions.
//
// Run:
//   npx -y tsx scripts/milestoneF_expiration_scan.ts
//
// Deterministic time for tests:
//   NOW_ISO="2026-02-15T00:00:00.000Z" npx -y tsx scripts/milestoneF_expiration_scan.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function getNow(): Date {
  const fromEnv = process.env.NOW_ISO;
  if (!fromEnv) return new Date();
  const d = new Date(fromEnv);
  if (isNaN(d.getTime())) throw new Error("NOW_ISO invalid");
  return d;
}

async function main() {
  const now = getNow();

  const claimed = await (prisma as any).boBuckLedger.findMany({
    where: {
      type: "CLAIMED",
      expiresAt: { not: null, lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });

  if (claimed.length === 0) {
    console.log("Milestone F Layer 5: no CLAIMED entries past expiresAt");
    process.exit(0);
  }

  let createdCount = 0;
  let skippedAlreadyExpired = 0;
  let skippedFullySpent = 0;

  for (const c of claimed) {
    // Idempotent: if already has EXPIRED child, skip
    const already = await (prisma as any).boBuckLedger.findFirst({
      where: { parentEntryId: c.id, type: "EXPIRED" },
    });
    if (already) {
      skippedAlreadyExpired++;
      continue;
    }

    // Compute spent amount (children SPENT entries referencing this CLAIMED entry)
    const spentAgg = await (prisma as any).boBuckLedger.aggregate({
      where: { parentEntryId: c.id, type: "SPENT" },
      _sum: { amount: true },
    });

    const spentSum = Number(spentAgg?._sum?.amount ?? 0);
    const remaining = Math.max(0, Number(c.amount) - spentSum);

    if (remaining <= 0) {
      skippedFullySpent++;
      continue;
    }

    await (prisma as any).boBuckLedger.create({
      data: {
        userId: c.userId,
        type: "EXPIRED",
        origin: c.origin,
        amount: remaining,
        contextId: c.contextId,
        awardedAt: c.awardedAt ?? null,
        claimedAt: c.claimedAt ?? null,
        expiresAt: c.expiresAt ?? null,
        spentAt: null,
        claimExpiresAt: c.claimExpiresAt ?? null,
        parentEntryId: c.id,
      },
    });

    createdCount++;
  }

  console.log("Milestone F Layer 5: expiration scan complete");
  console.log(
    JSON.stringify(
      {
        nowIso: now.toISOString(),
        scannedClaimed: claimed.length,
        createdExpired: createdCount,
        skippedAlreadyExpired,
        skippedFullySpent,
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
