// src/server/tournaments/tournament.v1.ts
// Deterministic Tournament Derivation v1
// Pure function. No side effects.
// Ranked rows require competitor identity embedded in match results.
// If identity is absent, totals are still correct and rows will be empty.

export type TournamentV1 = {
  tournamentId: string;
  name: string;
  matchIds: string[];
  createdAtIso: string;
};

// Observed EngineMatchArtifactV1.matchResultJson shape (plus optional identity fields)
type MatchResultRecordV1 = {
  matchId?: string;
  sessionId?: string;
  formatId?: string;
  formatVersion?: number;
  gameModeId?: string;
  gameModeVersion?: number;
  engineCompatVersion?: number;

  result?: {
    winner?: "HOME" | "AWAY" | "DRAW";
    winReason?: string;
    totalBattles?: number;
  };

  // Optional identity fields (owned by Game/session layer, carried through the bridge)
  homeCompetitorId?: string | null;
  awayCompetitorId?: string | null;
};

type EntityTotals = {
  entityId: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
};

function ensure(map: Map<string, EntityTotals>, entityId: string): EntityTotals {
  const existing = map.get(entityId);
  if (existing) return existing;
  const fresh: EntityTotals = { entityId, matches: 0, wins: 0, losses: 0, draws: 0, points: 0 };
  map.set(entityId, fresh);
  return fresh;
}

export function deriveStandingsV1(params: { tournament: TournamentV1; matchResults: MatchResultRecordV1[] }) {
  const { tournament, matchResults } = params;

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;

  const perEntity = new Map<string, EntityTotals>();
  let identityPresentCount = 0;

  for (const m of matchResults) {
    const winner = m?.result?.winner;

    if (winner === "HOME") homeWins++;
    else if (winner === "AWAY") awayWins++;
    else draws++;

    const homeId = typeof m.homeCompetitorId === "string" ? m.homeCompetitorId : null;
    const awayId = typeof m.awayCompetitorId === "string" ? m.awayCompetitorId : null;

    if (!homeId || !awayId) continue;
    identityPresentCount++;

    const home = ensure(perEntity, homeId);
    const away = ensure(perEntity, awayId);

    home.matches++;
    away.matches++;

    if (winner === "HOME") {
      home.wins++;
      home.points += 3;
      away.losses++;
    } else if (winner === "AWAY") {
      away.wins++;
      away.points += 3;
      home.losses++;
    } else {
      home.draws++;
      away.draws++;
      home.points += 1;
      away.points += 1;
    }
  }

  const rows = Array.from(perEntity.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.entityId.localeCompare(b.entityId);
  });

  return {
    tournamentId: tournament.tournamentId,
    totals: {
      matches: matchResults.length,
      homeWins,
      awayWins,
      draws,
    },
    rows,
    meta: {
      rankedRowsEligible: identityPresentCount > 0,
      identityMissing: identityPresentCount === 0 && matchResults.length > 0,
      identityFieldsRequired: ["homeCompetitorId", "awayCompetitorId"],
    },
  };
}
