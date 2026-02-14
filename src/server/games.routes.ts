// src/server/games.routes.ts
// Full file replacement — Engine Core v1 persistence via Prisma (Game/GamePlayer/GameEvent)
// Keeps existing route paths. No UI. No Event Authority. No overlay drift.

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { GameStatus } from "@prisma/client";

import {
  loadAppConfigDefault,
  loadFormatRegistryDefault,
  loadGameModeRegistryDefault,
} from "../config/registryLoaders.v1";
import { replayOnceV1 } from "../engine/replayHarness.v1";
import { buildPostGameBundleV1 } from "../postgame/postGameBundle.v1";

import crypto from "node:crypto";
import { deriveStandingsV1, type TournamentV1 } from "../tournaments/tournament.v1";



import { validateDecksForModeRuleSet } from "./engineValidation.gateway";
type CreateGameBody = {
  modeCode?: string;

  gameModeId?: string;
  gameModeVersion?: number;
  formatId?: string;
  formatVersion?: number;

  players: Array<{ seat: number; deckId: string }>;
};

type ActionBody = {
  type: string;
  payload?: any;
};

type FormatSnapshot = {
  id: string;
  name: string;
  version: number;
  engineCompatVersion: number;
  setup: { initialDrawSize: number; deckOrderAtStart: "AS_BUILT" | "DETERMINISTIC_SHUFFLE" };
  coins: { coinsPerBattle: number; persistBetweenBattles: boolean; winConditionCoinTarget?: number };
  suddenDeath: { enabled: boolean; trigger: "TIE" };
  reshuffle: { mode: "NONE" | "ON_EXHAUST" | "PHASE_BOUNDARY" };
};

type GameModeSnapshot = {
  id: string;
  name: string;
  version: number;
  engineCompatVersion: number;
  allowedFormats: { type: "ANY" } | { type: "ALLOW_LIST"; formats: Array<{ formatId: string; formatVersion: number }> };
  flow: { setupRequired: true; battleLoop: "STANDARD"; endScreen: "STANDARD" };
};

type SessionPointers = {
  gameModeId: string;
  gameModeVersion: number;
  formatId: string;
  formatVersion: number;
};

type SessionSnapshots = {
  formatSnapshot: FormatSnapshot;
  gameModeSnapshot: GameModeSnapshot;
};

type SessionStateV1 = {
  pointers: SessionPointers;
  snapshots?: SessionSnapshots;
};

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function badRequest(message: string, extra?: Record<string, any>) {
  return { error: "bad_request", message, ...(extra ?? {}) };
}

function ensureObj(x: any) {
  return x && typeof x === "object" ? x : {};
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function seatsSorted(players: Array<{ seat: number }>) {
  return players.map((p) => p.seat).slice().sort((a, b) => a - b);
}

function seatsUnique(players: Array<{ seat: number }>) {
  const s = new Set(players.map((p) => p.seat));
  return s.size === players.length;
}

function parseSupportedCompatVersions(): number[] {
  const raw = String(process.env.ENGINE_SUPPORTED_COMPAT_VERSIONS ?? "").trim();
  if (!raw) return [1];

  try {
    const asJson = JSON.parse(raw);
    if (Array.isArray(asJson)) {
      const out = asJson.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1);
      return out.length > 0 ? Array.from(new Set(out)) : [1];
    }
  } catch {
    // ignore
  }

  const out = raw
    .split(",")
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isInteger(n) && n >= 1);

  return out.length > 0 ? Array.from(new Set(out)) : [1];
}

const ENGINE_SUPPORTED_COMPAT_VERSIONS = parseSupportedCompatVersions();

// Defaults MUST match engine registries.
const DEFAULT_FORMAT: FormatSnapshot = {
  id: "FMT_ROOKIE",
  name: "Rookie Format",
  version: 1,
  engineCompatVersion: 1,
  setup: { initialDrawSize: 0, deckOrderAtStart: "AS_BUILT" },
  coins: { coinsPerBattle: 0, persistBetweenBattles: false },
  suddenDeath: { enabled: false, trigger: "TIE" },
  reshuffle: { mode: "NONE" },
};

const DEFAULT_GAMEMODE: GameModeSnapshot = {
  id: "GM_SCORED",
  name: "Scored Game Mode",
  version: 1,
  engineCompatVersion: 1,
  allowedFormats: { type: "ANY" },
  flow: { setupRequired: true, battleLoop: "STANDARD", endScreen: "STANDARD" },
};

function resolveFormatPointers(p: Partial<SessionPointers>) {
  const formatId = String(p.formatId ?? DEFAULT_FORMAT.id);
  const formatVersion = Number(p.formatVersion ?? DEFAULT_FORMAT.version);

  if (!formatId) return { ok: false as const, error: { error: "bad_request", message: "formatId required" } };
  if (!Number.isInteger(formatVersion) || formatVersion < 1)
    return { ok: false as const, error: { error: "bad_request", message: "formatVersion invalid" } };

  if (formatId !== DEFAULT_FORMAT.id || formatVersion !== DEFAULT_FORMAT.version)
    return { ok: false as const, error: { error: "unknown_format", formatId, formatVersion } };

  const engineCompatVersion = DEFAULT_FORMAT.engineCompatVersion;
  if (!ENGINE_SUPPORTED_COMPAT_VERSIONS.includes(engineCompatVersion)) {
    return {
      ok: false as const,
      error: { error: "unsupported_engine_compat", engineCompatVersion, supported: ENGINE_SUPPORTED_COMPAT_VERSIONS },
    };
  }

  return { ok: true as const, format: DEFAULT_FORMAT, formatId, formatVersion };
}

function resolveGameModePointers(p: Partial<SessionPointers>) {
  const gameModeId = String(p.gameModeId ?? DEFAULT_GAMEMODE.id);
  const gameModeVersion = Number(p.gameModeVersion ?? DEFAULT_GAMEMODE.version);

  if (!gameModeId) return { ok: false as const, error: { error: "bad_request", message: "gameModeId required" } };
  if (!Number.isInteger(gameModeVersion) || gameModeVersion < 1)
    return { ok: false as const, error: { error: "bad_request", message: "gameModeVersion invalid" } };

  if (gameModeId !== DEFAULT_GAMEMODE.id || gameModeVersion !== DEFAULT_GAMEMODE.version)
    return { ok: false as const, error: { error: "unknown_gamemode", gameModeId, gameModeVersion } };

  const engineCompatVersion = DEFAULT_GAMEMODE.engineCompatVersion;
  if (!ENGINE_SUPPORTED_COMPAT_VERSIONS.includes(engineCompatVersion)) {
    return {
      ok: false as const,
      error: { error: "unsupported_engine_compat", engineCompatVersion, supported: ENGINE_SUPPORTED_COMPAT_VERSIONS },
    };
  }

  return { ok: true as const, gameMode: DEFAULT_GAMEMODE, gameModeId, gameModeVersion };
}

function assertGameModeAllowsFormat(gameMode: GameModeSnapshot, formatId: string, formatVersion: number) {
  if (gameMode.allowedFormats.type === "ANY") return { ok: true as const };
  const allowed = gameMode.allowedFormats.formats.some((f) => f.formatId === formatId && f.formatVersion === formatVersion);
  if (!allowed)
    return {
      ok: false as const,
      error: { error: "format_not_allowed", formatId, formatVersion, gameModeId: gameMode.id },
    };
  return { ok: true as const };
}

function ensureSessionStateV1(state: any): SessionStateV1 | null {
  const s = ensureObj(state)?.session;
  const ss = ensureObj(s);
  const pointers = ensureObj(ss.pointers);

  const gameModeId = typeof pointers.gameModeId === "string" ? pointers.gameModeId : "";
  const formatId = typeof pointers.formatId === "string" ? pointers.formatId : "";
  const gameModeVersion = typeof pointers.gameModeVersion === "number" ? pointers.gameModeVersion : NaN;
  const formatVersion = typeof pointers.formatVersion === "number" ? pointers.formatVersion : NaN;

  if (!gameModeId || !formatId) return null;
  if (!Number.isInteger(gameModeVersion) || gameModeVersion < 1) return null;
  if (!Number.isInteger(formatVersion) || formatVersion < 1) return null;

  const out: SessionStateV1 = { pointers: { gameModeId, gameModeVersion, formatId, formatVersion } };
  if (ss.snapshots) out.snapshots = ss.snapshots as SessionSnapshots;
  return out;
}

function applyEndTurn(state: any, seats: number[]) {
  const next = clone(ensureObj(state));
  const turn = typeof next.turn === "number" ? next.turn : 0;
  const activeSeat = typeof next.activeSeat === "number" ? next.activeSeat : seats[0];

  const idx = Math.max(0, seats.indexOf(activeSeat));
  next.turn = turn + 1;
  next.activeSeat = seats[(idx + 1) % seats.length];
  return next;
}

function ensureRookieState(state: any) {
  const next = clone(ensureObj(state));
  next.rookie = ensureObj(next.rookie);

  next.rookie = {
    ...next.rookie,
    phase: next.rookie.phase ?? "SETUP",
    score: typeof next.rookie.score === "number" ? next.rookie.score : 0,
    end: next.rookie.end ?? null,
    rewardEligible: !!next.rookie.rewardEligible,
    rewardPaidAt: next.rookie.rewardPaidAt ?? null,
  };

  return next;
}

async function applyRookieAction(state: any, seats: number[], type: string, payload: any) {
  const next = ensureRookieState(state);

  if (type === "ROOKIE_SCORE") {
    const score = Number(payload?.score);
    if (!Number.isFinite(score)) throw { error: "rookie_score_invalid" };
    next.rookie.score = score;
    return next;
  }

  if (type === "ROOKIE_END") {
    const winnerSeat = Number(payload?.winnerSeat);
    if (!Number.isInteger(winnerSeat) || !seats.includes(winnerSeat)) throw { error: "rookie_end_invalid" };
    next.rookie.end = { winnerSeat };
    next.rookie.phase = "COMPLETE";
    next.rookie.rewardEligible = true;
    return next;
  }

  return next;
}

async function applyReducer(modeCode: string | null, state: any, seats: number[], type: string, payload: any) {
  const mode = String(modeCode ?? "").toUpperCase();
  if (mode === "ROOKIE") return await applyRookieAction(state, seats, type, payload);

  if (type === "END_TURN") return applyEndTurn(state, seats);

  return clone(ensureObj(state));
}

async function nextSeq(tx: PrismaClient, gameId: string): Promise<number> {
  const last = await (tx as any).gameEvent.findFirst({
    where: { gameId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return (last?.seq ?? 0) + 1;
}

export async function registerGamesRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // Boot-load registries once (read-only). Matches /engine pipeline behavior.
  const appConfig = loadAppConfigDefault();
  const formatRegistry = loadFormatRegistryDefault();
  const gameModeRegistry = loadGameModeRegistryDefault();

  // POST /games
  app.post("/games", async (req: any, reply) => {
    const body = (req.body ?? {}) as CreateGameBody;

    const modeCode = body.modeCode ?? null;
    const players = Array.isArray(body.players) ? body.players : [];
    if (players.length < 1) return reply.code(400).send(badRequest("players required"));

    if (!seatsUnique(players)) return reply.code(400).send({ error: "bad_request", message: "duplicate seats" });

    const seats = seatsSorted(players);
    if (seats[0] !== 1) return reply.code(400).send({ error: "bad_request", message: "seat 1 required" });

    const deckIds = players.map((p) => p.deckId);
    const decks = await prisma.deck.findMany({ where: { id: { in: deckIds } }, select: { id: true } });
    const foundIds = new Set(decks.map((d) => d.id));
    const missing = deckIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) return reply.code(400).send({ error: "unknown_deck", missing });

    const fmt = resolveFormatPointers({ formatId: body.formatId, formatVersion: body.formatVersion });
    if (!fmt.ok) return reply.code(400).send(fmt.error);

    const gm = resolveGameModePointers({ gameModeId: body.gameModeId, gameModeVersion: body.gameModeVersion });
    if (!gm.ok) return reply.code(400).send(gm.error);

    const allowed = assertGameModeAllowsFormat(gm.gameMode, fmt.formatId, fmt.formatVersion);
    if (!allowed.ok) return reply.code(400).send(allowed.error);

    const initialState = {
      session: {
        pointers: {
          gameModeId: gm.gameModeId,
          gameModeVersion: gm.gameModeVersion,
          formatId: fmt.formatId,
          formatVersion: fmt.formatVersion,
        },
      } satisfies SessionStateV1,
    };

    const gameId = await prisma.$transaction(async (tx) => {
      const g = await (tx as any).game.create({ data: { modeCode, status: GameStatus.LOBBY, state: initialState } });

      await (tx as any).gamePlayer.createMany({
        data: players.map((p) => ({ gameId: g.id, seat: p.seat, deckId: p.deckId })),
      });

      const seq = await nextSeq(tx, g.id);
      await (tx as any).gameEvent.create({ data: { gameId: g.id, seq, type: "GAME_CREATED", payload: { players } } });

      return g.id as string;
    });

    const created = await (prisma as any).game.findUnique({
      where: { id: gameId },
      include: { players: { orderBy: { seat: "asc" } }, events: { orderBy: { seq: "asc" } } },
    });

    return reply.send(created);

        // POST /games/engine/tournaments/derive
  // Body: { tournamentId?, name?, gameIds: string[] }
  // Resolves gameIds -> official stored matchIds -> standings from certified artifacts.
  app.post("/games/engine/tournaments/derive", async (req: any, reply) => {
    const body = req.body ?? {};
    const gameIds: string[] = Array.isArray(body.gameIds) ? body.gameIds.map(String) : [];
    if (gameIds.length === 0) return reply.code(400).send({ error: "bad_request", message: "gameIds required" });

    const tournamentId = String(body.tournamentId ?? `T_GAME_${crypto.randomUUID()}`);
    const name = String(body.name ?? "Tournament");

    const matchIds: string[] = [];
    const missingGameIds: string[] = [];

    for (const gameId of gameIds) {
      const ev = await (prisma as any).gameEvent.findFirst({
        where: { gameId, type: "GAME_ENGINE_MATCH_STORED" },
        orderBy: { seq: "desc" },
        select: { payload: true },
      });

      const p = ensureObj(ev?.payload);
      const matchId = typeof p.matchId === "string" ? p.matchId : "";
      if (!matchId) {
        missingGameIds.push(gameId);
        continue;
      }
      matchIds.push(matchId);
    }

    if (matchIds.length === 0) {
      return reply.code(404).send({
        ok: false,
        error: "NOT_FOUND",
        message: "no stored matches found for provided gameIds",
        missingGameIds,
      });
    }

    const rows = await (prisma as any).engineMatchArtifactV1.findMany({
      where: { matchId: { in: matchIds } },
    });

    const foundMatchIdSet = new Set(rows.map((r: any) => r.matchId));
    const missingMatchIds = matchIds.filter((id) => !foundMatchIdSet.has(id));

    const tournament: TournamentV1 = {
      tournamentId,
      name,
      matchIds,
      createdAtIso: new Date().toISOString(),
    };

    const matchResults = rows.map((r: any) => r.matchResultJson as any);
    const standings = deriveStandingsV1({ tournament, matchResults });

    return reply.send({
      ok: true,
      tournament,
      standings,
      found: rows.length,
      missingGameIds,
      missingMatchIds,
    });
  });


  });
  // GET /games/:id/engine/match
  // Convenience: returns the official stored artifact for this game (if engine/run has been executed).
    // GET /games/:id/engine/match
  // Convenience: returns the official stored artifact for this game (if engine/run has been executed).
  app.get("/games/:id/engine/match", async (req: any, reply) => {
    const gameId = String(req.params?.id ?? "");
    if (!gameId) return reply.code(400).send({ error: "bad_request", message: "id required" });

    const existing = await (prisma as any).gameEvent.findFirst({
      where: { gameId, type: "GAME_ENGINE_MATCH_STORED" },
      orderBy: { seq: "desc" },
      select: { payload: true, seq: true },
    });

    if (!existing?.payload) {
      return reply.code(404).send({ ok: false, error: "NOT_FOUND", message: "no engine match stored for game", gameId });
    }

    const p = ensureObj(existing.payload);
    const matchId = typeof p.matchId === "string" ? p.matchId : "";
    if (!matchId) {
      return reply
        .code(500)
        .send({ ok: false, error: "CORRUPT_EVENT", message: "stored event missing matchId", gameId });
    }

    const row = await (prisma as any).engineMatchArtifactV1.findUnique({ where: { matchId } });
    if (!row) return reply.code(404).send({ ok: false, error: "NOT_FOUND", message: "artifact missing", matchId });

    const mr: any = row.matchResultJson as any;
    const result = ensureObj(mr?.result);

    return reply.send({
      ok: true,
      stored: { id: row.id, matchId: row.matchId, sessionId: row.sessionId, createdAt: row.createdAt },

      summary: {
        matchId: row.matchId,
        sessionId: row.sessionId,
        format: {
          id: String(mr?.formatId ?? row.formatId),
          version: Number(mr?.formatVersion ?? row.formatVersion),
          engineCompatVersion: Number(mr?.engineCompatVersion ?? row.engineCompatVersion),
        },
        gameMode: {
          id: String(mr?.gameModeId ?? row.gameModeId),
          version: Number(mr?.gameModeVersion ?? row.gameModeVersion),
          engineCompatVersion: Number(mr?.engineCompatVersion ?? row.engineCompatVersion),
        },
        result: {
          winner: result.winner ?? null,
          winReason: result.winReason ?? null,
          totalBattles: typeof result.totalBattles === "number" ? result.totalBattles : null,
        },
      },

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
  });


  // POST /games/:id/setup
  app.post("/games/:id/setup", async (req: any, reply) => {
    const gameId = String(req.params?.id ?? "");
    if (!gameId) return reply.code(400).send({ error: "bad_request", message: "id required" });

    const game = await (prisma as any).game.findUnique({
      where: { id: gameId },
      include: { players: { orderBy: { seat: "asc" } } },
    });

    if (!game) return reply.code(404).send({ error: "not_found", gameId });
    if (game.status !== GameStatus.LOBBY) return reply.code(409).send({ error: "invalid_state", status: game.status });

    const seats = (game.players ?? []).map((p: any) => p.seat).slice().sort((a: number, b: number) => a - b);
    if (seats.length < 1) return reply.code(400).send({ error: "bad_request", message: "no players" });

    const state = clone(ensureObj(game.state));
    state.turn = 1;
    state.activeSeat = seats[0];

    const session = ensureSessionStateV1(state);
    if (!session) return reply.code(400).send({ error: "bad_request", message: "session pointers missing in state" });

    if (session.snapshots) return reply.code(409).send({ error: "invalid_state", message: "snapshots already captured" });

    const fmt = resolveFormatPointers(session.pointers);
    if (!fmt.ok) return reply.code(400).send(fmt.error);

    const gm = resolveGameModePointers(session.pointers);
    if (!gm.ok) return reply.code(400).send(gm.error);

    const allowed = assertGameModeAllowsFormat(gm.gameMode, fmt.formatId, fmt.formatVersion);
    if (!allowed.ok) return reply.code(400).send(allowed.error);

    state.session = {
      pointers: session.pointers,
      snapshots: { formatSnapshot: fmt.format, gameModeSnapshot: gm.gameMode },
    } satisfies SessionStateV1;

    let nextState = state;
    if ((game.modeCode ?? "").toUpperCase() === "ROOKIE") {
      nextState = ensureRookieState(state);
      nextState.rookie.phase = "SETUP";
    }

    const updated = await prisma.$transaction(async (tx) => {
      const seq = await nextSeq(tx, gameId);
      await (tx as any).gameEvent.create({ data: { gameId, seq, type: "GAME_SETUP", payload: {} } });

      return await (tx as any).game.update({
        where: { id: gameId },
        data: { status: GameStatus.ACTIVE, state: nextState },
        include: { players: { orderBy: { seat: "asc" } }, events: { orderBy: { seq: "asc" } } },
      });
    });

        
    return reply.send(updated);

  });

app.post("/games/:id/action", async (req: any, reply) => {
    const gameId = String(req.params?.id ?? "");
    const body = (req.body ?? {}) as ActionBody;
    if (!gameId) return reply.code(400).send({ error: "bad_request", message: "id required" });
    if (!body?.type) return reply.code(400).send({ error: "bad_request", message: "type required" });

    const game = await (prisma as any).game.findUnique({
      where: { id: gameId },
      include: { players: { orderBy: { seat: "asc" } } },
    });

    if (!game) return reply.code(404).send({ error: "not_found", gameId });
    if (game.status !== GameStatus.ACTIVE) return reply.code(409).send({ error: "invalid_state", status: game.status });

    const seats = (game.players ?? []).map((p: any) => p.seat).slice().sort((a: number, b: number) => a - b);

    let nextState: any;
    try {
      nextState = await applyReducer(game.modeCode ?? null, game.state, seats, body.type, body.payload);
    } catch (e: any) {
      if (e?.error === "rookie_score_invalid") return reply.code(400).send(e);
      if (e?.error === "rookie_end_invalid") return reply.code(400).send(e);
      return reply.code(400).send(badRequest("action reducer failed"));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const seq = await nextSeq(tx, gameId);
      await (tx as any).gameEvent.create({
        data: { gameId, seq, type: body.type, payload: body.payload ?? null },
      });

      return await (tx as any).game.update({
        where: { id: gameId },
        data: { state: nextState },
        include: { players: { orderBy: { seat: "asc" } }, events: { orderBy: { seq: "asc" } } },
      });
    });

    return reply.send(updated);
  });

  // POST /games/:id/engine/run
  // Idempotent: once a GAME_ENGINE_MATCH_STORED event exists, return that artifact instead of rerunning.
  app.post("/games/:id/engine/run", async (req: any, reply) => {
    try {
      const gameId = String(req.params?.id ?? "");
      if (!gameId) return reply.code(400).send({ error: "bad_request", message: "id required" });

      // If already stored, return existing (idempotent).
      const existing = await (prisma as any).gameEvent.findFirst({
        where: { gameId, type: "GAME_ENGINE_MATCH_STORED" },
        orderBy: { seq: "desc" },
        select: { payload: true, seq: true },
      });

      if (existing?.payload) {
        const p = ensureObj(existing.payload);
        const matchId = typeof p.matchId === "string" ? p.matchId : "";
        if (matchId) {
          const row = await (prisma as any).engineMatchArtifactV1.findUnique({ where: { matchId } });
          if (row) {
            return reply.send({
              ok: true,
              already: true,
              stored: { id: row.id, matchId: row.matchId, sessionId: row.sessionId, createdAt: row.createdAt },
            });
          }
        }
        // If the event exists but artifact is missing, fall through and re-run (self-heal).
      }

      const game = await (prisma as any).game.findUnique({
        where: { id: gameId },
        include: { players: { orderBy: { seat: "asc" } } },
      });
      if (!game) return reply.code(404).send({ error: "not_found", gameId });
      if (game.status !== GameStatus.ACTIVE) return reply.code(409).send({ error: "invalid_state", status: game.status });

      const state = ensureObj(game.state);
      const session = ensureSessionStateV1(state);
      if (!session) return reply.code(400).send({ error: "bad_request", message: "session pointers missing in state" });

      if (!session.snapshots) {
        return reply.code(409).send({ error: "invalid_state", message: "session snapshots missing; call /setup first" });
      }

      const fmt = resolveFormatPointers(session.pointers);
      if (!fmt.ok) return reply.code(400).send(fmt.error);

      const gm = resolveGameModePointers(session.pointers);
      if (!gm.ok) return reply.code(400).send(gm.error);

      const allowed = assertGameModeAllowsFormat(gm.gameMode, fmt.formatId, fmt.formatVersion);
      if (!allowed.ok) return reply.code(400).send(allowed.error);

      // 8D: Engine readiness — enforce RuleSet-driven deck validation (HTTP 400 on invalid).
      // Non-breaking: if no RuleSet is bound for this modeKey, validation is skipped (passes).
      const modeKeyForRules = String((game.modeCode ?? "") || (gm.gameModeId ?? "")).toUpperCase();
      const deckIdsToValidate = (game.players ?? []).map((p: any) => p.deckId).filter(Boolean);

      const deckValidation = await validateDecksForModeRuleSet({
        prisma: prisma as any,
        modeKey: modeKeyForRules,
        deckIds: deckIdsToValidate,
      });

      if (!deckValidation.ok) {
        return reply.code(400).send({
          error: "deck_invalid",
          modeKey: deckValidation.modeKey,
          skipped: deckValidation.skipped,
          ruleSet: deckValidation.ruleSet ?? null,
          errors: deckValidation.errors,
        });
      }


      const sessionId = newId(`S_GAME_${gameId}`);
      const matchId = newId(`M_GAME_${gameId}`);

      const pointer = {
        format: { formatId: fmt.formatId, formatVersion: fmt.formatVersion },
        gameMode: { gameModeId: gm.gameModeId, gameModeVersion: gm.gameModeVersion },
      };

      const matchResult = replayOnceV1({
        inputs: { sessionId, matchId, pointer },
        appConfig,
        formatRegistry,
        gameModeRegistry,
      });

      const playersBySeat = (game.players ?? []).slice().sort((a: any, b: any) => (a.seat ?? 0) - (b.seat ?? 0));
      const homeCompetitorId = playersBySeat[0]?.deckId ?? null;
      const awayCompetitorId = playersBySeat[1]?.deckId ?? null;

      const matchResultWithIdentity = { ...matchResult, homeCompetitorId, awayCompetitorId } as any;

      const bundle = buildPostGameBundleV1({ matchResult: matchResultWithIdentity });

      const row = await (prisma as any).engineMatchArtifactV1.create({
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

      await prisma.$transaction(async (tx) => {
        const seq = await nextSeq(tx, gameId);
        await (tx as any).gameEvent.create({
          data: {
            gameId,
            seq,
            type: "GAME_ENGINE_MATCH_STORED",
            payload: { matchId: row.matchId, sessionId: row.sessionId, artifactId: row.id },
          },
        });
      });

      return reply.send({
        ok: true,
        stored: { id: row.id, matchId: row.matchId, sessionId: row.sessionId, createdAt: row.createdAt },
        bundle,
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  // POST /games/:id/reward/claim
  app.post("/games/:id/reward/claim", async (req: any, reply) => {
    const gameId = (req.params as any).id as string;
    const userId = String((req.headers as any)["x-user-id"] ?? "");

    if (!userId) return reply.code(400).send({ error: "bad_request", message: "x-user-id required" });

    const game = await (prisma as any).game.findUnique({
      where: { id: gameId },
      include: { players: { orderBy: { seat: "asc" } } },
    });

    if (!game) return reply.code(404).send({ error: "not_found", gameId });

    const state = ensureRookieState(game.state);
    const end = ensureObj(state.rookie.end);
    const winnerSeat = Number(end.winnerSeat);

    const winner = (game.players ?? []).find((p: any) => p.seat === winnerSeat);
    if (!winner) return reply.code(400).send({ error: "bad_request", message: "winner seat not found" });

    if (!state.rookie.rewardEligible) return reply.code(409).send({ error: "not_eligible" });
    if (state.rookie.rewardPaidAt) return reply.code(409).send({ error: "already_paid" });

    const updated = await prisma.$transaction(async (tx) => {
      const seq = await nextSeq(tx, gameId);
      await (tx as any).gameEvent.create({ data: { gameId, seq, type: "REWARD_CLAIM", payload: { userId } } });

      state.rookie.rewardPaidAt = new Date().toISOString();

      return await (tx as any).game.update({
        where: { id: gameId },
        data: { state },
        include: { players: { orderBy: { seat: "asc" } }, events: { orderBy: { seq: "asc" } } },
      });
    });

    return reply.send(updated);
  });

  // GET /wallet/tx
  app.get("/wallet/tx", async (req: any, reply) => {
    const userId = String((req.headers as any)["x-user-id"] ?? "");
    if (!userId) return reply.code(400).send({ error: "bad_request", message: "x-user-id required" });

    const txs = await (prisma as any).walletTx.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return reply.send(txs);
  });

  // POST /games/engine/tournaments/derive
  // Body: { tournamentId?, name?, gameIds: string[] }
  app.post("/games/engine/tournaments/derive", async (req: any, reply) => {
    try {
      const body = req.body ?? {};
      const gameIds: string[] = Array.isArray(body.gameIds)
        ? body.gameIds.map(String)
        : [];

      if (gameIds.length === 0) {
        return reply.code(400).send({ error: "bad_request", message: "gameIds required" });
      }

      const games = await (prisma as any).game.findMany({
        where: { id: { in: gameIds } },
        include: { events: true },
      });

      const foundGameIds = new Set(games.map((g: any) => g.id));
      const missingGameIds = gameIds.filter((id) => !foundGameIds.has(id));

      const matchIds: string[] = [];

      for (const g of games) {
        const engineEvent = (g.events ?? [])
          .filter((e: any) => e.type === "GAME_ENGINE_MATCH_STORED")
          .sort((a: any, b: any) => b.seq - a.seq)[0];

        if (engineEvent?.payload?.matchId) {
          matchIds.push(String(engineEvent.payload.matchId));
        }
      }

      const rows = await (prisma as any).engineMatchArtifactV1.findMany({
        where: { matchId: { in: matchIds } },
      });

      const foundMatchIds = new Set(rows.map((r: any) => r.matchId));
      const missingMatchIds = matchIds.filter((id) => !foundMatchIds.has(id));

      const matchResults = rows.map((r: any) => r.matchResultJson);

      const tournament = {
        tournamentId: String(body.tournamentId ?? `T_GAME_${Date.now()}`),
        name: String(body.name ?? "Tournament"),
        matchIds,
        createdAtIso: new Date().toISOString(),
      };

      const { deriveStandingsV1 } = await import("../tournaments/tournament.v1");
      const standings = deriveStandingsV1({ tournament, matchResults });

      return reply.send({
        ok: true,
        found: rows.length,
        missingGameIds,
        missingMatchIds,
        tournament,
        standings,
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e.message ?? "BAD_REQUEST" });
    }
  });

}
