// src/rewards/rewardEngine.v1.ts
// Milestone E (E1): Pure reward derivation.
// Inputs: tournament + standings (derived) + matchIds (references)
// Output: RewardGrantV1[] (immutable). No DB writes here.

import type { TournamentV1, TournamentStandingsV1 } from "../tournaments/tournament.v1";

export type RewardGrantV1 = {
  grantId: string;
  tournamentId: string;
  // Rewards reference immutable artifacts; they never modify them.
  referencedMatchIds: string[];
  kind: "TOURNAMENT_COMPLETION_BADGE";
  label: string;
  issuedAtIso: string;
};

export function deriveRewardsV1(args: {
  tournament: TournamentV1;
  standings: TournamentStandingsV1;
}): RewardGrantV1[] {
  // Minimal, deterministic rule:
  // If tournament has >= 1 match, issue one completion badge grant referencing matchIds.
  const matchCount = args.standings.totals.matches;

  if (matchCount <= 0) return deepFreeze([] as RewardGrantV1[]);

  const grant: RewardGrantV1 = {
    grantId: `GRANT_${args.tournament.tournamentId}_COMPLETION_V1`,
    tournamentId: args.tournament.tournamentId,
    referencedMatchIds: [...args.tournament.matchIds],
    kind: "TOURNAMENT_COMPLETION_BADGE",
    label: `Completed tournament (${matchCount} matches)`,
    issuedAtIso: new Date().toISOString(),
  };

  // Return a frozen array of frozen grants
  return deepFreeze([grant]);
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    Object.freeze(obj);
    // @ts-ignore
    for (const key of Object.keys(obj)) {
      // @ts-ignore
      const v = obj[key];
      if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
    }
  }
  return obj;
}
