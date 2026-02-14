
/**
 * LFBO Phase 8E — Step 2 (FIX)
 * Backfill CardVersion.setCode from CardConcept.setCode
 *
 * NOTE: CardVersion primary key is versionKey (no `id` field).
 * Safe to run multiple times.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("== Phase 8E Backfill: CardVersion.setCode ==");

  const nullCountBefore = await prisma.cardVersion.count({
    where: { setCode: null },
  });

  console.log("CardVersion rows with NULL setCode (before):", nullCountBefore);

  if (nullCountBefore === 0) {
    console.log("Nothing to backfill. PASS.");
    return;
  }

  // Pull all versions with null setCode
  const versions = await prisma.cardVersion.findMany({
    where: { setCode: null },
    select: { versionKey: true, conceptKey: true },
  });

  let updated = 0;
  let missingConcept = 0;

  for (const v of versions) {
    const concept = await prisma.cardConcept.findUnique({
      where: { hybridKey: v.conceptKey },
      select: { setCode: true },
    });

    if (!concept) {
      missingConcept += 1;
      continue;
    }

    await prisma.cardVersion.update({
      where: { versionKey: v.versionKey },
      data: { setCode: concept.setCode },
    });

    updated += 1;
  }

  const nullCountAfter = await prisma.cardVersion.count({
    where: { setCode: null },
  });

  console.log("Updated rows:", updated);
  console.log("Rows missing concept:", missingConcept);
  console.log("CardVersion rows with NULL setCode (after):", nullCountAfter);

  if (nullCountAfter === 0) {
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
