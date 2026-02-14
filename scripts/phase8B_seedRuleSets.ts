/**
 * LFBO Phase 8B — Seed minimal RuleSet + ModeRuleBinding (for route validation)
 *
 * Usage:
 *   npx -y tsx scripts/phase8B_seedRuleSets.ts
 *
 * Idempotent:
 *  - Upserts RuleSet (ROOKIE, v1)
 *  - Upserts ModeRuleBinding (modeKey=ROOKIE -> ROOKIE v1)
 *
 * Note: This is readiness-only. It does NOT change gameplay or engine behavior.
 */
import { PrismaClient, RuleSetStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const ruleSetKey = "ROOKIE";
  const ruleSetVersion = 1;

  const rulesJson = {
    // Minimal identity payload to prove data retrieval works.
    // Replace later with real encoded constraints during 8B hardening.
    deckSize: 7,
    allowedTypes: ["HERO", "PLAY"],
    notes: "Phase 8B seed: minimal RuleSet for route validation only.",
  };

  await prisma.ruleSet.upsert({
    where: { key_version: { key: ruleSetKey, version: ruleSetVersion } },
    update: {
      status: RuleSetStatus.ACTIVE,
      rulesJson,
    },
    create: {
      key: ruleSetKey,
      version: ruleSetVersion,
      status: RuleSetStatus.ACTIVE,
      rulesJson,
    },
  });

  await prisma.modeRuleBinding.upsert({
    where: { modeKey: "ROOKIE" },
    update: {
      ruleSetKey,
      ruleSetVersion,
    },
    create: {
      modeKey: "ROOKIE",
      ruleSetKey,
      ruleSetVersion,
    },
  });

  console.log("PASS: Seeded RuleSet(ROOKIE v1) + ModeRuleBinding(ROOKIE -> ROOKIE v1)");
}

main()
  .catch((e) => {
    console.error("FAIL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
