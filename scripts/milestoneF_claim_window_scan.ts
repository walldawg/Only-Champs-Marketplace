// scripts/milestoneF_claim_window_scan.ts
// Milestone F — Layer 4: Claim Window Enforcement
// Scan AWARDED entries that have claimExpiresAt and are past due.
// If not claimed, append UNCLAIMED_EXPIRED referencing the AWARDED entry.
// Append-only ledger. No mutation. No deletions.
//
// Run:
//   npx -y tsx scripts/milestoneF_claim_window_scan.ts
//
// Notes:
// - Determinism: behavior is deterministic given a fixed "now".
//   For certification, pass NOW_ISO env var to fix time.
//     NOW_ISO="2026-02-13T00:00:00.000Z" npx -y tsx scripts/milestoneF_claim_window_scan.ts

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

  // Find AWARDED entries with a claim window that has expired
  const awarded = await (prisma as any).boBuckLedger.findMany({
    where: {
      type: "AWARDED",
      claimExpiresAt: { not: null, lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: 1000,
  });

  if (awarded.length === 0) {
    console.log("Milestone F Layer 4: no AWARDED entries past claim window");
    process.exit(0);
  }

  let createdCount = 0;
  let skippedAlreadyClaimed = 0;
  let skippedAlreadyExpired = 0;

  for (const a of awarded) {
    // If already CLAIMED, do nothing
    const claimed = await (prisma as any).boBuckLedger.findFirst({
      where: { parentEntryId: a.id, type: "CLAIMED" },
    });
    if (claimed) {
      skippedAlreadyClaimed++;
      continue;
    }

    // If already UNCLAIMED_EXPIRED, do nothing (idempotent)
    const already = await (prisma as any).boBuckLedger.findFirst({
      where: { parentEntryId: a.id, type: "UNCLAIMED_EXPIRED" },
    });
    if (already) {
      skippedAlreadyExpired++;
      continue;
    }

    await (prisma as any).boBuckLedger.create({
      data: {
        userId: a.userId,
        type: "UNCLAIMED_EXPIRED",
        origin: a.origin,
        amount: a.amount,
        contextId: a.contextId,
        awardedAt: a.awardedAt ?? null,
        claimedAt: null,
        expiresAt: null,
        spentAt: null,
        claimExpiresAt: a.claimExpiresAt ?? null,
        parentEntryId: a.id,
      },
    });

    createdCount++;
  }

  console.log("Milestone F Layer 4: claim window scan complete");
  console.log(JSON.stringify({
    nowIso: now.toISOString(),
    scannedAwarded: awarded.length,
    createdUnclaimedExpired: createdCount,
    skippedAlreadyClaimed,
    skippedAlreadyUnclaimedExpired: skippedAlreadyExpired,
  }, null, 2));

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
