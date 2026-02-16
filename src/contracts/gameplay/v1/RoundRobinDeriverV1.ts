/**
 * RoundRobinDeriverV1 — Minimal artifact-only standings derivation for ROUND_ROBIN.
 *
 * Phase 10 Step 2:
 * - Implementation file (runtime code)
 * - Consumes MatchArtifactV1[] only (NO engine calls, NO replay inspection)
 * - Reads ONLY: artifact.result.winnerParticipantId, artifact.result.placements, artifact.result.scoresByParticipantId
 * - Produces TournamentStandingsTableV1 + TournamentProgressSnapshotV1
 *
 * Notes:
 * - Scoring rules (minimal):
 *   win=1 point, tie=0.5 point, loss=0 points
 * - If winnerParticipantId exists -> winner win, others loss (for 1v1 or multi)
 * - If placements provided and no explicit winner:
 *     - placement 1 participants are treated as winners
 *     - if multiple placement 1 => tie among them (each gets tie)
 * - If neither winner nor placements available:
 *     - if scoresByParticipantId exists, highest score wins; ties become ties
 *     - if insufficient, the match is ignored (no stat changes)
 *
 * Determinism:
 * - Output ordering is stable: rows sorted by points desc, then wins desc, then participantId asc.
 */

import type {
  MatchArtifactV1,
  IdString,
  JSONObject,
} from "./MatchArtifactV1";

import type {
  TournamentDeriverV1,
  TournamentV1,
  TournamentStandingsTableV1,
  TournamentStandingsRowV1,
  TournamentProgressSnapshotV1,
} from "./TournamentV1";

function nowIso(): string {
  return new Date().toISOString();
}

function assertBindingMatches(tournament: TournamentV1, artifact: MatchArtifactV1): void {
  const th = tournament.header;
  const ah = artifact.header;

  // Binding enforcement: artifacts must match the tournament's locked binding.
  if (ah.universeCode !== th.universeCode) throw new Error("Artifact universeCode mismatch");
  if (ah.engineCode !== th.engineCode) throw new Error("Artifact engineCode mismatch");
  if (ah.engineVersion !== th.engineVersion) throw new Error("Artifact engineVersion mismatch");
  if (ah.modeCode !== th.modeCode) throw new Error("Artifact modeCode mismatch");
}

function initRows(tournament: TournamentV1): Map<IdString, TournamentStandingsRowV1> {
  const rows = new Map<IdString, TournamentStandingsRowV1>();
  for (const p of tournament.participants) {
    rows.set(p.participantId, {
      participantId: p.participantId,
      label: p.label,
      wins: 0,
      losses: 0,
      ties: 0,
      points: 0,
      tieBreakers: {},
      extra: p.extra,
    });
  }
  return rows;
}

function bumpWin(row: TournamentStandingsRowV1) {
  row.wins += 1;
  row.points += 1;
}

function bumpLoss(row: TournamentStandingsRowV1) {
  row.losses += 1;
  row.points += 0;
}

function bumpTie(row: TournamentStandingsRowV1) {
  row.ties += 1;
  row.points += 0.5;
}

function safeGetRow(rows: Map<IdString, TournamentStandingsRowV1>, pid: IdString): TournamentStandingsRowV1 | null {
  return rows.get(pid) ?? null;
}

/**
 * Determine match outcome groups from the allowed fields only.
 * Returns { winners: IdString[], losers: IdString[], ties: IdString[] }
 */
function deriveOutcomeFromArtifact(artifact: MatchArtifactV1): {
  winners: IdString[];
  losers: IdString[];
  ties: IdString[];
  participantsInMatch: IdString[];
} {
  const participantsInMatch = artifact.participants.map((p) => p.participantId);

  // 1) winnerParticipantId is simplest.
  const winner = artifact.result.winnerParticipantId;
  if (winner) {
    const winners = [winner];
    const losers = participantsInMatch.filter((pid) => pid !== winner);
    return { winners, losers, ties: [], participantsInMatch };
  }

  // 2) placements: all placement=1 are "winners"; multiple placement=1 -> tie among them.
  const placements = artifact.result.placements;
  if (placements && placements.length > 0) {
    const best = Math.min(...placements.map((p) => p.placement));
    const top = placements.filter((p) => p.placement === best).map((p) => p.participantId);
    if (top.length === 1) {
      const winners = top;
      const losers = participantsInMatch.filter((pid) => pid !== top[0]);
      return { winners, losers, ties: [], participantsInMatch };
    }
    // multi-top => treat as ties among the top group; others are losers
    const ties = top;
    const losers = participantsInMatch.filter((pid) => !ties.includes(pid));
    return { winners: [], losers, ties, participantsInMatch };
  }

  // 3) scoresByParticipantId: highest score wins; ties if equal max.
  const scores = artifact.result.scoresByParticipantId;
  if (scores && Object.keys(scores).length > 0) {
    const entries = Object.entries(scores) as Array<[IdString, number]>;
    const max = Math.max(...entries.map(([, v]) => v));
    const top = entries.filter(([, v]) => v === max).map(([pid]) => pid);
    if (top.length === 1) {
      const winners = top;
      const losers = participantsInMatch.filter((pid) => pid !== top[0]);
      return { winners, losers, ties: [], participantsInMatch };
    }
    const ties = top;
    const losers = participantsInMatch.filter((pid) => !ties.includes(pid));
    return { winners: [], losers, ties, participantsInMatch };
  }

  // 4) Unknown/insufficient => ignore (no changes)
  return { winners: [], losers: [], ties: [], participantsInMatch };
}

function stableSortRows(rows: TournamentStandingsRowV1[]): TournamentStandingsRowV1[] {
  return rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.participantId.localeCompare(b.participantId);
  });
}

export class RoundRobinDeriverV1 implements TournamentDeriverV1 {
  deriveStandings(params: { tournament: TournamentV1; artifacts: MatchArtifactV1[] }): TournamentStandingsTableV1 {
    const { tournament, artifacts } = params;

    const rowsMap = initRows(tournament);

    // Use deterministic iteration order: sort by matchId asc, then deterministicHash asc.
    const sortedArtifacts = artifacts.slice().sort((a, b) => {
      const am = a.header.matchId.localeCompare(b.header.matchId);
      if (am !== 0) return am;
      return a.deterministicHash.value.localeCompare(b.deterministicHash.value);
    });

    const usedArtifacts: Array<{ matchId: IdString; deterministicHash: string }> = [];

    for (const artifact of sortedArtifacts) {
      assertBindingMatches(tournament, artifact);

      // Track as used only if it impacts standings (i.e., has at least one winner/tie/loser).
      const outcome = deriveOutcomeFromArtifact(artifact);

      if (
        outcome.winners.length === 0 &&
        outcome.ties.length === 0 &&
        outcome.losers.length === 0
      ) {
        continue; // ignore unscorable artifacts
      }

      usedArtifacts.push({
        matchId: artifact.header.matchId,
        deterministicHash: artifact.deterministicHash.value,
      });

      // Apply scoring:
      // - winners win
      // - losers lose
      // - ties tie (only among tied group)
      for (const pid of outcome.winners) {
        const row = safeGetRow(rowsMap, pid);
        if (row) bumpWin(row);
      }
      for (const pid of outcome.losers) {
        const row = safeGetRow(rowsMap, pid);
        if (row) bumpLoss(row);
      }
      for (const pid of outcome.ties) {
        const row = safeGetRow(rowsMap, pid);
        if (row) bumpTie(row);
      }
    }

    const rows = stableSortRows(Array.from(rowsMap.values()));

    return {
      tournamentId: tournament.header.tournamentId,
      derivedAt: nowIso(),
      sourceArtifacts: usedArtifacts,
      rows,
      summary: {
        structure: tournament.header.structure,
        status: tournament.header.status,
        participants: tournament.participants.length,
        artifactsUsed: usedArtifacts.length,
        scoring: { win: 1, tie: 0.5, loss: 0 },
      } as JSONObject,
    };
  }

  deriveProgress(params: { tournament: TournamentV1; artifacts: MatchArtifactV1[] }): TournamentProgressSnapshotV1 {
    const { tournament, artifacts } = params;

    // Count only artifacts that match binding (ignore mismatches by throwing early) and have a deterministicHash.
    const sortedArtifacts = artifacts.slice().sort((a, b) => a.header.matchId.localeCompare(b.header.matchId));

    let matchesCompleted = 0;
    for (const artifact of sortedArtifacts) {
      assertBindingMatches(tournament, artifact);
      matchesCompleted += 1;
    }

    const matchesPlanned = tournament.schedule?.length;

    const snapshot: TournamentProgressSnapshotV1 = {
      tournamentId: tournament.header.tournamentId,
      derivedAt: nowIso(),
      status: tournament.header.status,
      currentRound: undefined,
      matchesCompleted,
      matchesPlanned,
      view: {
        structure: tournament.header.structure,
        matchesPlanned,
        matchesCompleted,
      } as JSONObject,
    };

    return snapshot;
  }
}

export default RoundRobinDeriverV1;
