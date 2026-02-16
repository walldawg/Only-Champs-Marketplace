// src/server/engineMatch.routes.v1.ts
// FULL FILE REPLACEMENT — Ruleset binding + persistence + debug surface.
// Goal: If modeKey is bound (modeRuleBinding → ruleSet), attach:
//   - pointer.ruleset
//   - snapshotsJson.ruleSetSnapshot + ruleSetJson
//   - timeline extra.rulesetId via SessionV1.rulesetId / matchResult builder
// No gameplay changes. Deterministic replay only.
//
// Patch v1.0.2:
// - matchType is NOT locked. Caller may pass matchType (e.g., TRAINING, RANKED, TOURNAMENT).
// - Default matchType to TRAINING when omitted/blank.
// - Persist matchType inside matchResultJson (JSON payload) without schema changes.

import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

import { loadAppConfigDefault, loadFormatRegistryDefault, loadGameModeRegistryDefault } from "../config/registryLoaders.v1";
import { replayOnceV1 } from "../engine/replayHarness.v1";
import { buildPostGameBundleV1 } from "../postgame/postGameBundle.v1";

function newId(prefix: string): string {
  return `${prefix}_${cryptoRandom()}`;
}

function cryptoRandom(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("node:crypto");
  return crypto.randomUUID();
}

function upper(s: any): string {
  return String(s ?? "").trim().toUpperCase();
}

export async function registerEngineMatchRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // Boot-load registries once (read-only)
  const appConfig = loadAppConfigDefault();
  const formatRegistry = loadFormatRegistryDefault();
  const gameModeRegistry = loadGameModeRegistryDefault();

  // -------------------------------
  // POST /engine/matches/run
  // -------------------------------
  app.post("/engine/matches/run", async (req: any, reply) => {
    try {
      const body = req.body ?? {};

      const sessionId = String(body.sessionId ?? newId("S_API"));
      const matchId = String(body.matchId ?? newId("M_API"));

      // Caller-controlled metadata (must not affect deterministic gameplay).
      // Default: TRAINING
      const matchType = upper(body.matchType ?? "TRAINING") || "TRAINING";

      // Build pointer (and only then optionally attach ruleset)
      const pointer: any = {
        format: {
          formatId: String(body.formatId ?? "FMT_ROOKIE"),
          formatVersion: Number(body.formatVersion ?? 1),
        },
        gameMode: {
          gameModeId: String(body.gameModeId ?? "GM_SCORED"),
          gameModeVersion: Number(body.gameModeVersion ?? 1),
        },
      };

      // Optional identity injection (for ranked/tournament standings)
      const homeCompetitorId =
        typeof body.homeCompetitorId === "string" && body.homeCompetitorId.trim()
          ? body.homeCompetitorId.trim()
          : null;

      const awayCompetitorId =
        typeof body.awayCompetitorId === "string" && body.awayCompetitorId.trim()
          ? body.awayCompetitorId.trim()
          : null;

      // Optional ruleset snapshot (modeKey → binding → ruleset)
      const modeKey = upper(body.modeKey ?? body.modeCode ?? "");
      let ruleSetSnapshot: { ruleSetKey: string; ruleSetVersion: number } | null = null;
      let ruleSetJson: any | null = null;

      if (modeKey) {
        const bindingRow = await (prisma as any).modeRuleBinding.findUnique({
          where: { modeKey },
        });

        if (bindingRow?.ruleSetKey && typeof bindingRow.ruleSetVersion === "number") {
          ruleSetSnapshot = {
            ruleSetKey: String(bindingRow.ruleSetKey),
            ruleSetVersion: Number(bindingRow.ruleSetVersion),
          };

          // Attach to pointer so SessionV1 has the bound ruleset pointer
          pointer.ruleset = ruleSetSnapshot;

          const rs = await (prisma as any).ruleSet.findUnique({
            where: { key_version: { key: ruleSetSnapshot.ruleSetKey, version: ruleSetSnapshot.ruleSetVersion } },
          });

          if (rs?.rulesJson) ruleSetJson = rs.rulesJson;
        }
      }

      // Run (certified)
      const matchResult = replayOnceV1({
        inputs: {
          sessionId,
          matchId,
          pointer,
          ruleSetJson, // optional (null allowed)
        } as any,
        appConfig,
        formatRegistry,
        gameModeRegistry,
      });

      // Attach matchType (metadata) + identity if present
      const matchResultWithMeta: any = {
        ...matchResult,
        matchType,
      };

      const matchResultWithIdentity =
        homeCompetitorId || awayCompetitorId
          ? ({ ...matchResultWithMeta, homeCompetitorId, awayCompetitorId } as any)
          : (matchResultWithMeta as any);

      // Postgame bundle (certified)
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
            ruleSetSnapshot: ruleSetSnapshot ?? null,
            ruleSetJson: ruleSetJson ?? null,
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
        row,
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e.message ?? "BAD_REQUEST" });
    }
  });
}
