
/**
 * LFBO Phase 8E — Step 2 (FAST)
 * Backfill CardVersion.setCode from CardConcept.setCode using a single SQL update.
 *
 * SQLite-friendly. Safe to run multiple times.
 *
 * Usage:
 *   npx -y tsx scripts/phase8E_backfillCardVersionSetCode_FAST.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("== Phase 8E Backfill (FAST): CardVersion.setCode ==");

  const before = await prisma.cardVersion.count({ where: { setCode: null } });
  console.log("CardVersion rows with NULL setCode (before):", before);

  if (before === 0) {
    console.log("Nothing to backfill. PASS.");
    return;
  }

  // One-shot backfill: setCode = (select setCode from CardConcept where hybridKey = conceptKey)
  // Only updates rows where setCode IS NULL and a matching concept exists.
  const updatedRows = await prisma.$executeRawUnsafe<number>(`
    UPDATE CardVersion
    SET setCode = (
      SELECT c.setCode
      FROM CardConcept c
      WHERE c.hybridKey = CardVersion.conceptKey
    )
    WHERE CardVersion.setCode IS NULL
      AND EXISTS (
        SELECT 1
        FROM CardConcept c2
        WHERE c2.hybridKey = CardVersion.conceptKey
      );
  `);

  console.log("Updated rows (SQL):", updatedRows);

  const after = await prisma.cardVersion.count({ where: { setCode: null } });
  console.log("CardVersion rows with NULL setCode (after):", after);

  if (after === 0) {
    console.log("Backfill complete. PASS.");
  } else {
    console.log("Backfill incomplete. FAIL.");
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
