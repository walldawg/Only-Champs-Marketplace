// scripts/milestoneD_certify.ts
// Milestone D (D1): Tournament consumes match results only and cannot affect replay.
// Run: npx -y tsx scripts/milestoneD_certify.ts

import { PrismaClient } from "@prisma/client";

import {
  loadAppConfigDefault,
  loadFormatRegistryDefault,
  loadGameModeRegistryDefault,
} from "../src/config/registryLoaders.v1";

import { replayFromStoredAndCompareV1 } from "../src/store/replayFromStore.v1";
import { deriveStandingsV1, type TournamentV1 } from "../src/tournaments/tournament.v1";

const prisma = new PrismaClient();

async function main() {
  const app = loadAppConfigDefault();
  const fr = loadFormatRegistryDefault();
  const gr = loadGameModeRegistryDefault();

  // Pull the matches created by C2 (or any 100 if you want to widen later)
  const rows = await prisma.engineMatchArtifactV1.findMany({
    where: { matchId: { startsWith: "M_CDB_CERT_" } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  if (rows.length === 0) {
    throw new Error("MILESTONE_D_NO_MATCHES_FOUND: run milestoneC_db_certify.ts first");
  }

  const tournament: TournamentV1 = {
    tournamentId: "T_D_CERT_1",
    name: "Milestone D Cert Tournament",
    matchIds: rows.map((r) => r.matchId),
    createdAtIso: new Date().toISOString(),
  };

  const matchResults = rows.map((r) => r.matchResultJson as any);

  // Derive standings twice — must be identical (pure derivation)
  const s1 = deriveStandingsV1({ tournament, matchResults });
  const s2 = deriveStandingsV1({ tournament, matchResults });

  const standingsEqual = JSON.stringify(s1) === JSON.stringify(s2);
  if (!standingsEqual) {
    console.error("Milestone D CERT FAIL: standings not deterministic");
    console.error("s1:", s1);
    console.error("s2:", s2);
    process.exit(1);
  }

  // Verify tournament is non-authoritative: replay-from-stored still matches for all included matches
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
    console.error(`Milestone D CERT FAIL: ${failures.length}/${rows.length} replay mismatches`);
    for (const f of failures.slice(0, 10)) {
      console.error(`- ${f.matchId}: ${f.diffs.join("; ")}`);
    }
    process.exit(1);
  }

  console.log("Milestone D CERT PASS: standings derived from match records; tournament did not affect replay");
  console.log("Standings:", s1);
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
