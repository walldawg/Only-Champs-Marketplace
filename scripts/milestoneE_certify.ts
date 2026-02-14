// scripts/milestoneE_certify.ts
// Milestone E (E1): Rewards consume standings + matchIds only and never affect outcomes.
// Cert:
// - standings deterministic (same as Milestone D)
// - rewards deterministic (same inputs => same rewards shape)
// - replay from stored matches still matches 100/100 after deriving rewards
//
// Run: npx -y tsx scripts/milestoneE_certify.ts

import { PrismaClient } from "@prisma/client";

import {
  loadAppConfigDefault,
  loadFormatRegistryDefault,
  loadGameModeRegistryDefault,
} from "../src/config/registryLoaders.v1";

import { replayFromStoredAndCompareV1 } from "../src/store/replayFromStore.v1";
import { deriveStandingsV1, type TournamentV1 } from "../src/tournaments/tournament.v1";
import { deriveRewardsV1 } from "../src/rewards/rewardEngine.v1";

const prisma = new PrismaClient();

async function main() {
  const app = loadAppConfigDefault();
  const fr = loadFormatRegistryDefault();
  const gr = loadGameModeRegistryDefault();

  const rows = await prisma.engineMatchArtifactV1.findMany({
    where: { matchId: { startsWith: "M_CDB_CERT_" } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  if (rows.length === 0) {
    throw new Error("MILESTONE_E_NO_MATCHES_FOUND: run milestoneC_db_certify.ts first");
  }

  const tournament: TournamentV1 = {
    tournamentId: "T_E_CERT_1",
    name: "Milestone E Cert Tournament",
    matchIds: rows.map((r) => r.matchId),
    createdAtIso: new Date().toISOString(),
  };

  const matchResults = rows.map((r) => r.matchResultJson as any);

  // Standings must be pure/deterministic
  const s1 = deriveStandingsV1({ tournament, matchResults });
  const s2 = deriveStandingsV1({ tournament, matchResults });
  if (JSON.stringify(s1) !== JSON.stringify(s2)) {
    console.error("Milestone E CERT FAIL: standings not deterministic");
    console.error("s1:", s1);
    console.error("s2:", s2);
    process.exit(1);
  }

  // Rewards must be pure/deterministic (same inputs => same output “shape”)
  // NOTE: issuedAtIso is time-based; we normalize it out for determinism check.
  const r1 = deriveRewardsV1({ tournament, standings: s1 });
  const r2 = deriveRewardsV1({ tournament, standings: s1 });

  const norm = (x: any) => JSON.stringify(x, (k, v) => (k === "issuedAtIso" ? "__TIME__" : v));
  if (norm(r1) !== norm(r2)) {
    console.error("Milestone E CERT FAIL: rewards not deterministic (ignoring time)");
    console.error("r1:", r1);
    console.error("r2:", r2);
    process.exit(1);
  }

  // Critical: rewards must not affect replay
  // (We derive rewards, then replay all matches from stored pointers and compare.)
  const failures: Array<{ matchId: string; diffs: string[] }> = [];

  for (const row of rows) {
    const stored = {
      matchId: row.matchId,
      sessionId: row.sessionId,
      pointer: row.pointerJson as any,
      snapshots: row.snapshotsJson as any,
      matchResult: row.matchResultJson as any,
      insightRecord: row.insightRecordJson as any,
      createdAtIso: row.createdAt.toISOString(),
    };

    const diff = replayFromStoredAndCompareV1({
      stored,
      appConfig: app,
      formatRegistry: fr,
      gameModeRegistry: gr,
    });

    if (!diff.ok) failures.push({ matchId: row.matchId, diffs: diff.diffs });
  }

  if (failures.length > 0) {
    console.error(`Milestone E CERT FAIL: ${failures.length}/${rows.length} replay mismatches`);
    for (const f of failures.slice(0, 10)) {
      console.error(`- ${f.matchId}: ${f.diffs.join("; ")}`);
    }
    process.exit(1);
  }

  console.log("Milestone E CERT PASS: rewards derived from standings; replay unaffected");
  console.log("Standings:", s1);
  console.log("Rewards:", r1);
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
