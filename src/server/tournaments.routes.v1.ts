// src/server/tournaments.routes.v1.ts
// Tournament persistence v1 — derive standings from stored EngineMatchArtifactV1 and store immutable snapshot.
// + B2: GET /tournaments/:tournamentId/rewards (pure derivation; no payout authority; no writes)
// + B2.1: rewardPolicyJson stored per tournament (tie payout configurable; ranking = COMPETITION)

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

import crypto from "node:crypto";
import { deriveStandingsV1, type TournamentV1 } from "../tournaments/tournament.v1";

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

// -------------------------------
// Deterministic Reward Model V1
// -------------------------------
const REWARD_MODEL_V1 = {
  modelId: "REWARD_MODEL_V1",
  type: "PLACEMENT_TABLE",
  currency: "REWARD_UNITS",
  rules: [
    { rank: 1, units: 100 },
    { rank: 2, units: 60 },
    { rank: 3, units: 40 },
  ],
  fallbackUnits: 0,
} as const;

function unitsForRank(rank: number): number {
  const rule = REWARD_MODEL_V1.rules.find((r) => r.rank === rank);
  return rule ? rule.units : REWARD_MODEL_V1.fallbackUnits;
}

// -------------------------------
// Reward Policy (tournament-scoped)
// -------------------------------
type RankingStyleV1 = "COMPETITION"; // 1,1,3
type TiePayoutStyleV1 = "DUPLICATE" | "SPLIT";

type RewardPolicyV1 = {
  ranking: RankingStyleV1;
  tiePayout: TiePayoutStyleV1;
};

const DEFAULT_REWARD_POLICY_V1: RewardPolicyV1 = {
  ranking: "COMPETITION",
  tiePayout: "DUPLICATE",
};

function normalizeRewardPolicy(input: any): RewardPolicyV1 {
  const ranking: RankingStyleV1 = input?.ranking === "COMPETITION" ? "COMPETITION" : DEFAULT_REWARD_POLICY_V1.ranking;
  const tiePayout: TiePayoutStyleV1 =
    input?.tiePayout === "SPLIT"
      ? "SPLIT"
      : input?.tiePayout === "DUPLICATE"
        ? "DUPLICATE"
        : DEFAULT_REWARD_POLICY_V1.tiePayout;
  return { ranking, tiePayout };
}

/**
 * standingsJson in DB is an envelope object.
 * Ranked rows may appear under "rows" (preferred) or other legacy keys.
 */
function extractStandingsRows(standingsJson: any): any[] {
  if (Array.isArray(standingsJson)) return standingsJson;
  if (!standingsJson || typeof standingsJson !== "object") return [];

  const candidates = [
    standingsJson.rows,
    standingsJson.standings,
    standingsJson.table,
    standingsJson.entries,
    standingsJson.placements,
    standingsJson.ranked,
    standingsJson.items,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function extractTotals(standingsJson: any): any | null {
  if (!standingsJson || typeof standingsJson !== "object") return null;
  return standingsJson.totals ?? null;
}

// Tie key: what constitutes "same placement" for ranking.
// We treat equal points AND wins as a tie. (entityId is only a deterministic tiebreaker for ordering.)
function tieKey(entry: any): string {
  const points = typeof entry?.points === "number" ? entry.points : null;
  const wins = typeof entry?.wins === "number" ? entry.wins : null;
  return `${points ?? "?"}|${wins ?? "?"}`;
}

function splitUnitsDeterministic(total: number, n: number, stableOrderKeys: string[]): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return stableOrderKeys.map((_, i) => (i < rem ? base + 1 : base));
}

export async function registerTournamentRoutesV1(app: FastifyInstance, prisma: PrismaClient) {
  // -------------------------------
  // POST /tournaments/derive-and-store
  // Body: { tournamentId?, name?, matchIds: string[], rewardPolicy? }
  // rewardPolicy: { ranking?: "COMPETITION", tiePayout?: "DUPLICATE"|"SPLIT" }
  // -------------------------------
  app.post("/tournaments/derive-and-store", async (req: any, reply) => {
    try {
      const body = req.body ?? {};
      const matchIds: string[] = Array.isArray(body.matchIds) ? body.matchIds.map(String) : [];
      if (matchIds.length === 0) return reply.code(400).send({ ok: false, error: "matchIds required" });

      const rows = await (prisma as any).engineMatchArtifactV1.findMany({
        where: { matchId: { in: matchIds } },
      });

      const foundIds = new Set(rows.map((r: any) => r.matchId));
      const missingMatchIds = matchIds.filter((id) => !foundIds.has(id));

      const tournament: TournamentV1 = {
        tournamentId: String(body.tournamentId ?? newId("T_API")),
        name: String(body.name ?? "Tournament"),
        matchIds,
        createdAtIso: new Date().toISOString(),
      };

      const rewardPolicy = normalizeRewardPolicy(body.rewardPolicy);

      const sponsorId = body.sponsorId ? String(body.sponsorId) : null;

      const matchResults = rows.map((r: any) => r.matchResultJson as any);
      const standings = deriveStandingsV1({ tournament, matchResults });

      const stored = await (prisma as any).tournamentArtifactV1.upsert({
        where: { tournamentId: tournament.tournamentId },
        create: {
          tournamentId: tournament.tournamentId,
          name: tournament.name,
          matchIdsJson: matchIds as any,
          standingsJson: standings as any,
          rewardPolicyJson: rewardPolicy as any,
          sponsorId,
        },
        update: {
          name: tournament.name,
          matchIdsJson: matchIds as any,
          standingsJson: standings as any,
          rewardPolicyJson: rewardPolicy as any,
          sponsorId,
        },
      });

      return reply.send({
        ok: true,
        stored: { id: stored.id, tournamentId: stored.tournamentId, createdAt: stored.createdAt },
        tournament,
        rewardPolicy,
        standings,
        found: rows.length,
        missingMatchIds,
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  // -------------------------------
  // GET /tournaments/:tournamentId
  // -------------------------------
  app.get("/tournaments/:tournamentId", async (req: any, reply) => {
    try {
      const tournamentId = String(req.params?.tournamentId ?? "");
      if (!tournamentId) return reply.code(400).send({ ok: false, error: "tournamentId required" });

      const row = await (prisma as any).tournamentArtifactV1.findUnique({ where: { tournamentId } });
      if (!row) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
      const sponsorRow = row?.sponsorId ? await (prisma as any).sponsor.findUnique({ where: { id: row.sponsorId } }) : null;
      return reply.send({
        ok: true,
        artifact: {
          tournamentId: row.tournamentId,
          name: row.name,
          createdAt: row.createdAt,
          matchIds: row.matchIdsJson,
          standings: row.standingsJson,
          rewardPolicy: row.rewardPolicyJson ?? null,
          sponsorId: row.sponsorId ?? null,
        },
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  // -------------------------------
  // GET /tournaments/:tournamentId/rewards   (B2)
  // Pure derivation from stored standings snapshot. No writes. No payout authority.
  // Ranking: COMPETITION (1,1,3)
  // Tie payout: DUPLICATE or SPLIT (tournament-scoped policy)
  // -------------------------------
  app.get("/tournaments/:tournamentId/rewards", async (req: any, reply) => {
    try {
      const tournamentId = String(req.params?.tournamentId ?? "");
      if (!tournamentId) return reply.code(400).send({ ok: false, error: "tournamentId required" });

      const row = await (prisma as any).tournamentArtifactV1.findUnique({ where: { tournamentId } });
      if (!row) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
      const sponsorRow = row?.sponsorId ? await (prisma as any).sponsor.findUnique({ where: { id: row.sponsorId } }) : null;
      const standingsJson = row.standingsJson;
      const totals = extractTotals(standingsJson);
      const rankedRows = extractStandingsRows(standingsJson);

      const policy = normalizeRewardPolicy(row.rewardPolicyJson ?? null);

      const matches = typeof totals?.matches === "number" ? totals.matches : null;

      if (!Array.isArray(rankedRows) || rankedRows.length === 0) {
        let note: string | null = null;
        if (matches === 0) {
          note = "No placements: standings snapshot reflects zero matches.";
        } else if (matches && matches > 0) {
          note = "No placements: standings snapshot currently stores totals only (ranked rows not present).";
        } else {
          note = "No placements: ranked standings rows not present in stored snapshot.";
        }

        return reply.send({
          ok: true,
          tournamentId,
          source: { standings: "stored", rewards: "derived" },
          model: REWARD_MODEL_V1,
          rewardPolicy: policy,
          standingsTotals: totals,
          note,
          sponsorId: row.sponsorId ?? null,
          sponsor: (sponsorRow ? { id: sponsorRow.id, name: sponsorRow.name, slug: sponsorRow.slug } : null) ? { id: sponsor.id, name: sponsor.name, slug: sponsor.slug } : null,
          placements: [],
        });
      }

      const placements: any[] = [];
      let i = 0;
      let currentRank = 1;

      while (i < rankedRows.length) {
        const key = tieKey(rankedRows[i]);
        const groupStart = i;
        while (i < rankedRows.length && tieKey(rankedRows[i]) === key) i++;
        const group = rankedRows.slice(groupStart, i);

        if (policy.tiePayout === "DUPLICATE") {
          for (const entry of group) {
            placements.push({
              rank: currentRank,
              entityId: entry.entityId ?? entry.playerId ?? entry.teamId ?? null,
              label: entry.label ?? entry.name ?? null,
              totals: entry.totals ?? null,
              reward: { units: unitsForRank(currentRank) },
            });
          }
        } else {
          const poolRanks = Array.from({ length: group.length }, (_, idx) => currentRank + idx);
          const poolUnits = poolRanks.reduce((sum, rnk) => sum + unitsForRank(rnk), 0);

          const stableKeys = group.map((entry: any) => String(entry.entityId ?? entry.playerId ?? entry.teamId ?? ""));
          const shares = splitUnitsDeterministic(poolUnits, group.length, stableKeys);

          for (let j = 0; j < group.length; j++) {
            const entry = group[j];
            placements.push({
              rank: currentRank,
              entityId: entry.entityId ?? entry.playerId ?? entry.teamId ?? null,
              label: entry.label ?? entry.name ?? null,
              totals: entry.totals ?? null,
              reward: { units: shares[j] },
              split: { poolUnits, groupSize: group.length },
            });
          }
        }

        currentRank += group.length; // COMPETITION jump
      }

      return reply.send({
        ok: true,
        tournamentId,
        source: { standings: "stored", rewards: "derived" },
        model: REWARD_MODEL_V1,
        rewardPolicy: policy,
        standingsTotals: totals,
        note: null,
        placements,
      
          sponsorId: row.sponsorId ?? null,
          sponsor: (sponsorRow ? { id: sponsorRow.id, name: sponsorRow.name, slug: sponsorRow.slug } : null) ? { id: sponsor.id, name: sponsor.name, slug: sponsor.slug } : null,
});
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  // -------------------------------
  // GET /tournaments/:tournamentId/rewards/cost
  // Pure derivation from stored standings snapshot. No writes. No payout authority.
  // Returns total reward units for the current standings snapshot.
  // -------------------------------
  app.get("/tournaments/:tournamentId/rewards/cost", async (req: any, reply) => {
    try {
      const tournamentId = String(req.params?.tournamentId ?? "");
      if (!tournamentId) return reply.code(400).send({ ok: false, error: "tournamentId required" });

      const row = await (prisma as any).tournamentArtifactV1.findUnique({ where: { tournamentId } });
      if (!row) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });

      const standingsJson = row.standingsJson;
      const totals = extractTotals(standingsJson);
      const rankedRows = extractStandingsRows(standingsJson);
      const policy = normalizeRewardPolicy(row.rewardPolicyJson ?? null);

      const matches = typeof totals?.matches === "number" ? totals.matches : null;

      if (!Array.isArray(rankedRows) || rankedRows.length === 0) {
        let note: string | null = null;
        if (matches === 0) {
          note = "No placements: standings snapshot reflects zero matches.";
        } else if (matches && matches > 0) {
          note = "No placements: standings snapshot currently stores totals only (ranked rows not present).";
        } else {
          note = "No placements: ranked standings rows not present in stored snapshot.";
        }

        return reply.send({
          ok: true,
          tournamentId,
          sponsorId: row.sponsorId ?? null,
          unitsTotal: 0,
          note,
        });
      }

      let unitsTotal = 0;
      let i = 0;
      let currentRank = 1;

      while (i < rankedRows.length) {
        const key = tieKey(rankedRows[i]);
        const groupStart = i;
        while (i < rankedRows.length && tieKey(rankedRows[i]) === key) i++;
        const group = rankedRows.slice(groupStart, i);

        if (policy.tiePayout === "DUPLICATE") {
          unitsTotal += group.length * unitsForRank(currentRank);
        } else {
          const ranks = Array.from({ length: group.length }, (_, idx) => currentRank + idx);
          const total = ranks.reduce((acc, r) => acc + unitsForRank(r), 0);
          unitsTotal += total;
        }

        currentRank += group.length;
      }

      return reply.send({
        ok: true,
        tournamentId,
        sponsorId: row.sponsorId ?? null,
        unitsTotal,
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });



  // -------------------------------
  // Sponsors (Phase 7 — metadata only)
  // -------------------------------

  // GET /sponsors (read-only)
  app.get("/sponsors", async (req: any, reply) => {
    try {
      const sponsors = await (prisma as any).sponsor.findMany({
        orderBy: { createdAt: "asc" },
      });
      return reply.send({ ok: true, count: sponsors.length, sponsors });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  // POST /sponsors (minimal create)
  // Body: { name, slug }
  app.post("/sponsors", async (req: any, reply) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      const slug = String(req.body?.slug ?? "").trim();

      if (!name) return reply.code(400).send({ ok: false, error: "name required" });
      if (!slug) return reply.code(400).send({ ok: false, error: "slug required" });

      const created = await (prisma as any).sponsor.create({
        data: { name, slug },
      });

      return reply.send({ ok: true, sponsor: created });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

}
