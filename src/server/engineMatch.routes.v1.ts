// src/server/engineMatch.routes.v1.ts
// Phase 5 Option 1: HTTP wiring for certified Engine → Match → Insight → Store → Tournament → Rewards
// No gameplay authority. Consumes certified artifacts only.

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

import {
  loadAppConfigDefault,
  loadFormatRegistryDefault,
  loadGameModeRegistryDefault,
} from "../config/registryLoaders.v1";

import { replayOnceV1 } from "../engine/replayHarness.v1";
import { buildPostGameBundleV1 } from "../postgame/postGameBundle.v1";
import { deriveStandingsV1, type TournamentV1 } from "../tournaments/tournament.v1";
import { deriveRewardsV1 } from "../rewards/rewardEngine.v1";

import crypto from "node:crypto";

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function registerEngineMatchRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // Boot-load registries once (read-only)
  const appConfig = loadAppConfigDefault();
  const formatRegistry = loadFormatRegistryDefault();
  const gameModeRegistry = loadGameModeRegistryDefault();

  // -------------------------------
  // POST /engine/matches/run
  // -------------------------------
  // Optional identity fields:
  // - homeCompetitorId, awayCompetitorId (strings)
  // These enable ranked standings + placement payouts in downstream tournament derivation.
  app.post("/engine/matches/run", async (req: any, reply) => {
    try {
      const body = req.body ?? {};

      const sessionId = String(body.sessionId ?? newId("S_API"));
      const matchId = String(body.matchId ?? newId("M_API"));

      const pointer = {
        format: {
          formatId: String(body.formatId ?? "FMT_ROOKIE"),
          formatVersion: Number(body.formatVersion ?? 1),
        },
        gameMode: {
          gameModeId: String(body.gameModeId ?? "GM_SCORED"),
          gameModeVersion: Number(body.gameModeVersion ?? 1),
        },
      };

      // Run (certified)
      const matchResult = replayOnceV1({
        inputs: { sessionId, matchId, pointer },
        appConfig,
        formatRegistry,
        gameModeRegistry,
      });

      // Attach identity if provided (keeps engine certified; identity is metadata only)
      const homeCompetitorId =
        typeof body.homeCompetitorId === "string" && body.homeCompetitorId.trim()
          ? body.homeCompetitorId.trim()
          : null;

      const awayCompetitorId =
        typeof body.awayCompetitorId === "string" && body.awayCompetitorId.trim()
          ? body.awayCompetitorId.trim()
          : null;

      const matchResultWithIdentity = { ...matchResult, homeCompetitorId, awayCompetitorId } as any;

      // Postgame bundle (certified + metadata passthrough)
      const bundle = buildPostGameBundleV1({ matchResult: matchResultWithIdentity });

      // Persist (Milestone C2 model)
      const row = await prisma.engineMatchArtifactV1.create({
        data: {
          matchId: matchResult.matchId,
          sessionId: matchResult.sessionId,

          formatId: matchResult.formatId,
          formatVersion: matchResult.formatVersion,
          gameModeId: matchResult.gameModeId,
          gameModeVersion: matchResult.gameModeVersion,
          engineCompatVersion: matchResult.engineCompatVersion,

          pointerJson: pointer as any,
          snapshotsJson: {
            formatSnapshot: {
              formatId: matchResult.formatId,
              formatVersion: matchResult.formatVersion,
              engineCompatVersion: matchResult.engineCompatVersion,
            },
            gameModeSnapshot: {
              gameModeId: matchResult.gameModeId,
              gameModeVersion: matchResult.gameModeVersion,
              engineCompatVersion: matchResult.engineCompatVersion,
            },
          } as any,
          matchResultJson: matchResultWithIdentity as any,
          insightRecordJson: bundle.insightRecord as any,
        },
      });

      return reply.send({
        ok: true,
        stored: {
          id: row.id,
          matchId: row.matchId,
          sessionId: row.sessionId,
          createdAt: row.createdAt,
        },
        bundle,
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e.message ?? "BAD_REQUEST" });
    }
  });

  // -------------------------------
  // GET /engine/matches/:matchId
  // -------------------------------
  app.get("/engine/matches/:matchId", async (req: any, reply) => {
    try {
      const matchId = String(req.params?.matchId ?? "");
      if (!matchId) throw new Error("BAD_REQUEST");

      const row = await prisma.engineMatchArtifactV1.findUnique({ where: { matchId } });
      if (!row) return reply.code(404).send({ ok: false, error: "NOT_FOUND" });

      return reply.send({
        ok: true,
        artifact: {
          matchId: row.matchId,
          sessionId: row.sessionId,
          createdAt: row.createdAt,
          pointer: row.pointerJson,
          snapshots: row.snapshotsJson,
          matchResult: row.matchResultJson,
          insightRecord: row.insightRecordJson,
        },
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e.message ?? "BAD_REQUEST" });
    }
  });

  // -------------------------------
  // POST /engine/tournaments/derive
  // Body: { tournamentId?, name?, matchIds: string[] }
  // -------------------------------
  app.post("/engine/tournaments/derive", async (req: any, reply) => {
    try {
      const body = req.body ?? {};
      const matchIds: string[] = Array.isArray(body.matchIds) ? body.matchIds.map(String) : [];
      if (matchIds.length === 0) throw new Error("BAD_REQUEST");

      const rows = await prisma.engineMatchArtifactV1.findMany({
        where: { matchId: { in: matchIds } },
      });

      const tournament: TournamentV1 = {
        tournamentId: String(body.tournamentId ?? newId("T_API")),
        name: String(body.name ?? "Tournament"),
        matchIds,
        createdAtIso: new Date().toISOString(),
      };

      const matchResults = rows.map((r) => r.matchResultJson as any);
      const standings = deriveStandingsV1({ tournament, matchResults });

      return reply.send({ ok: true, tournament, standings, found: rows.length });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e.message ?? "BAD_REQUEST" });
    }
  });

  // -------------------------------
  // POST /engine/rewards/derive
  // Body: { tournamentId, name?, matchIds: string[] }
  // Derives standings from stored matches, then derives rewards.
  // -------------------------------
  app.post("/engine/rewards/derive", async (req: any, reply) => {
    try {
      const body = req.body ?? {};
      const matchIds: string[] = Array.isArray(body.matchIds) ? body.matchIds.map(String) : [];
      if (matchIds.length === 0) throw new Error("BAD_REQUEST");

      const rows = await prisma.engineMatchArtifactV1.findMany({
        where: { matchId: { in: matchIds } },
      });

      const tournament: TournamentV1 = {
        tournamentId: String(body.tournamentId ?? newId("T_API")),
        name: String(body.name ?? "Tournament"),
        matchIds,
        createdAtIso: new Date().toISOString(),
      };

      const matchResults = rows.map((r) => r.matchResultJson as any);
      const standings = deriveStandingsV1({ tournament, matchResults });
      const rewards = deriveRewardsV1({ tournament, standings });

      return reply.send({ ok: true, tournament, standings, rewards, found: rows.length });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e.message ?? "BAD_REQUEST" });
    }
  });
}
