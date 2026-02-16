/**
 * SingleEliminationDeriverV1 — Artifact-only derivation for SINGLE_ELIMINATION brackets.
 *
 * Phase 10 Structure #2:
 * - Implementation file (runtime code)
 * - Consumes MatchArtifactV1[] only (NO engine calls, NO replay inspection)
 * - Reads ONLY: artifact.result.winnerParticipantId, artifact.result.placements, artifact.result.scoresByParticipantId
 * - Uses TournamentV1.schedule as the bracket spine (round + position + participantIds + matchId)
 * - Produces TournamentStandingsTableV1 + TournamentProgressSnapshotV1 with a real bracket snapshot
 *
 * Minimal rules:
 * - Each completed slot yields:
 *   - winner gets win (+1 point)
 *   - all other participants in that match get loss
 * - Bracket snapshot:
 *   - For each slot: participants, matchId, completed flag, winner, deterministicHash (if present)
 * - Tournament completion:
 *   - Consider complete when all scheduled slots with matchId have artifacts
 *
 * Determinism:
 * - Snapshot ordering is stable by (round asc, position asc, slotId asc).
 */

import type { MatchArtifactV1, IdString, JSONObject } from "./MatchArtifactV1";
import type {
  TournamentDeriverV1,
  TournamentV1,
  TournamentStandingsTableV1,
  TournamentStandingsRowV1,
  TournamentProgressSnapshotV1,
  TournamentMatchSlotV1,
} from "./TournamentV1";

function nowIso(): string {
  return new Date().toISOString();
}

function assertStructure(tournament: TournamentV1) {
  if (tournament.header.structure !== "SINGLE_ELIMINATION") {
    throw new Error("Tournament structure mismatch: expected SINGLE_ELIMINATION");
  }
}

function assertBindingMatches(tournament: TournamentV1, artifact: MatchArtifactV1): void {
  const th = tournament.header;
  const ah = artifact.header;

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
}

function safeGetRow(rows: Map<IdString, TournamentStandingsRowV1>, pid: IdString): TournamentStandingsRowV1 | null {
  return rows.get(pid) ?? null;
}

function deriveWinnerFromArtifact(artifact: MatchArtifactV1): IdString | null {
  // Allowed reads only.
  const winner = artifact.result.winnerParticipantId;
  if (winner) return winner;

  const placements = artifact.result.placements;
  if (placements && placements.length > 0) {
    const best = Math.min(...placements.map((p) => p.placement));
    const top = placements.filter((p) => p.placement === best).map((p) => p.participantId);
    // Single-elim expects one winner; if multiple, treat as no-winner.
    return top.length === 1 ? top[0] : null;
  }

  const scores = artifact.result.scoresByParticipantId;
  if (scores && Object.keys(scores).length > 0) {
    const entries = Object.entries(scores) as Array<[IdString, number]>;
    const max = Math.max(...entries.map(([, v]) => v));
    const top = entries.filter(([, v]) => v === max).map(([pid]) => pid);
    return top.length === 1 ? top[0] : null;
  }

  return null;
}

function stableSortSlots(slots: TournamentMatchSlotV1[]): TournamentMatchSlotV1[] {
  return slots.slice().sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    const pa = a.position ?? "";
    const pb = b.position ?? "";
    const p = pa.localeCompare(pb);
    if (p !== 0) return p;
    return a.slotId.localeCompare(b.slotId);
  });
}

function stableSortRows(rows: TournamentStandingsRowV1[]): TournamentStandingsRowV1[] {
  // In single-elim, primary is wins, then points, then participantId.
  return rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.points !== a.points) return b.points - a.points;
    return a.participantId.localeCompare(b.participantId);
  });
}

export interface SingleEliminationBracketSlotSnapshotV1 {
  slotId: IdString;
  round: number;
  position?: string;
  participantIds: IdString[];
  matchId?: IdString;

  completed: boolean;
  winnerParticipantId?: IdString | null;
  deterministicHash?: string;

  extra?: JSONObject;
}

export interface SingleEliminationBracketSnapshotV1 {
  structure: "SINGLE_ELIMINATION";
  rounds: Array<{
    round: number;
    slots: SingleEliminationBracketSlotSnapshotV1[];
  }>;
  championParticipantId?: IdString | null;
}

export class SingleEliminationDeriverV1 implements TournamentDeriverV1 {
  deriveStandings(params: { tournament: TournamentV1; artifacts: MatchArtifactV1[] }): TournamentStandingsTableV1 {
    const { tournament, artifacts } = params;
    assertStructure(tournament);

    const rowsMap = initRows(tournament);

    const byMatchId = new Map<IdString, MatchArtifactV1>();
    for (const a of artifacts) {
      assertBindingMatches(tournament, a);
      byMatchId.set(a.header.matchId, a);
    }

    const schedule = tournament.schedule ?? [];
    const usedArtifacts: Array<{ matchId: IdString; deterministicHash: string }> = [];

    for (const slot of schedule) {
      if (!slot.matchId) continue;
      const artifact = byMatchId.get(slot.matchId);
      if (!artifact) continue;

      const winner = deriveWinnerFromArtifact(artifact);
      if (!winner) continue;

      usedArtifacts.push({ matchId: artifact.header.matchId, deterministicHash: artifact.deterministicHash.value });

      // Winner gets win; all other participants in the artifact get loss.
      for (const p of artifact.participants) {
        const row = safeGetRow(rowsMap, p.participantId);
        if (!row) continue;
        if (p.participantId === winner) bumpWin(row);
        else bumpLoss(row);
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
        scoring: { win: 1, loss: 0 },
      } as JSONObject,
    };
  }

  deriveProgress(params: { tournament: TournamentV1; artifacts: MatchArtifactV1[] }): TournamentProgressSnapshotV1 {
    const { tournament, artifacts } = params;
    assertStructure(tournament);

    const byMatchId = new Map<IdString, MatchArtifactV1>();
    for (const a of artifacts) {
      assertBindingMatches(tournament, a);
      byMatchId.set(a.header.matchId, a);
    }

    const schedule = tournament.schedule ?? [];
    const sortedSlots = stableSortSlots(schedule);

    const slotSnapshots: SingleEliminationBracketSlotSnapshotV1[] = [];
    let matchesPlanned = 0;
    let matchesCompleted = 0;

    for (const slot of sortedSlots) {
      if (slot.matchId) matchesPlanned += 1;

      const artifact = slot.matchId ? byMatchId.get(slot.matchId) : undefined;
      const completed = Boolean(artifact);

      if (completed) matchesCompleted += 1;

      const winner = artifact ? deriveWinnerFromArtifact(artifact) : null;

      slotSnapshots.push({
        slotId: slot.slotId,
        round: slot.round,
        position: slot.position,
        participantIds: slot.participantIds,
        matchId: slot.matchId,
        completed,
        winnerParticipantId: winner,
        deterministicHash: artifact?.deterministicHash.value,
        extra: slot.extra,
      });
    }

    // Group by round
    const roundsMap = new Map<number, SingleEliminationBracketSlotSnapshotV1[]>();
    for (const s of slotSnapshots) {
      const list = roundsMap.get(s.round) ?? [];
      list.push(s);
      roundsMap.set(s.round, list);
    }

    const rounds = Array.from(roundsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([round, slots]) => ({
        round,
        slots: slots.slice().sort((a, b) => (a.position ?? "").localeCompare(b.position ?? "") || a.slotId.localeCompare(b.slotId)),
      }));

    // Champion heuristic: winner of highest round latest slot if completed
    const maxRound = rounds.length ? Math.max(...rounds.map((r) => r.round)) : undefined;
    let champion: IdString | null | undefined = undefined;
    if (maxRound !== undefined) {
      const finalRound = rounds.find((r) => r.round === maxRound);
      if (finalRound) {
        const finalCompletedWinners = finalRound.slots
          .filter((s) => s.completed && s.winnerParticipantId)
          .map((s) => s.winnerParticipantId as IdString);
        champion = finalCompletedWinners.length === 1 ? finalCompletedWinners[0] : null;
      }
    }

    const bracketSnapshot: SingleEliminationBracketSnapshotV1 = {
      structure: "SINGLE_ELIMINATION",
      rounds,
      championParticipantId: champion,
    };

    const status =
      matchesPlanned > 0 && matchesCompleted >= matchesPlanned ? "COMPLETED" : tournament.header.status;

    return {
      tournamentId: tournament.header.tournamentId,
      derivedAt: nowIso(),
      status,
      currentRound: undefined,
      matchesCompleted,
      matchesPlanned,
      view: bracketSnapshot as unknown as JSONObject,
    };
  }
}

export default SingleEliminationDeriverV1;
