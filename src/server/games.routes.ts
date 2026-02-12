// src/server/games.routes.ts
// Full file replacement — Engine Core v1 persistence via Prisma (Game/GamePlayer/GameEvent)
// Keeps existing route paths. No UI. No Event Authority. No overlay drift.

import type { FastifyInstance } from "fastify";
import { PrismaClient, GameStatus } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

const prisma =
  global.__prisma__ ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") global.__prisma__ = prisma;

type CreateGameBody = {
  modeCode?: string;
  players: Array<{ seat: number; deckId: string }>;
};

type ActionBody = {
  type: string;
  payload?: any;
};

function badRequest(message: string, extra?: Record<string, any>) {
  return { error: "bad_request", message, ...(extra ?? {}) };
}

function ensureObj(x: any) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function seatsSorted(players: Array<{ seat: number }>) {
  return [...players].map((p) => p.seat).sort((a, b) => a - b);
}

function seatsUnique(players: Array<{ seat: number }>) {
  const s = players.map((p) => p.seat);
  return new Set(s).size === s.length;
}

function nowIso() {
  return new Date().toISOString();
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
  if (!next.rookie.phase) next.rookie.phase = "SETUP";
  return next;
}

// --- Optional catalog helpers (best-effort; throws if unavailable during scoring) ---
async function getCardVersion(versionKey: string): Promise<any | null> {
  try {
    const client: any = prisma as any;
    if (!client.cardVersion?.findUnique) return null;
    return await client.cardVersion.findUnique({ where: { versionKey } });
  } catch {
    return null;
  }
}

async function isHeroVersion(versionKey: string): Promise<boolean | null> {
  const v = await getCardVersion(versionKey);
  if (!v) return null;
  const conceptType = v.conceptType ?? v.type ?? v.concept?.type ?? null;
  if (typeof conceptType !== "string") return null;
  return conceptType === "HERO";
}

async function getHeroPower(versionKey: string): Promise<number | null> {
  const v = await getCardVersion(versionKey);
  if (!v) return null;
  const attrs = v.attributes ?? v.attrs ?? v.meta ?? null;
  const p = attrs?.power;
  return typeof p === "number" ? p : null;
}

async function rookieScoreOrThrow(state: any, seats: number[]) {
  const next = ensureRookieState(state);
  const rookie = next.rookie;

  const phase = rookie.phase;
  if (phase !== "MATCH" && phase !== "ENDED") {
    throw { error: "rookie_score_invalid", phaseInvalid: { phase, allowed: ["MATCH", "ENDED"] } };
  }

  if (!(seats.length === 2 && seats[0] === 1 && seats[1] === 2)) {
    throw { error: "rookie_score_invalid", seatsInvalid: { seats, required: [1, 2] } };
  }

  const placements = ensureObj(rookie.placements);
  const revealedZones = ensureObj(rookie.revealedZones);

  for (const seat of seats) {
    const bySeat = ensureObj(placements[String(seat)] ?? placements[seat]);
    for (let z = 0; z < 7; z++) {
      const key = bySeat[String(z)] ?? bySeat[z];
      if (!key || typeof key !== "string") throw { error: "rookie_score_invalid", missingPlacement: { seat, zoneIndex: z } };

      const hero = await isHeroVersion(key);
      if (hero === false) throw { error: "rookie_score_invalid", nonHeroPlacement: { seat, zoneIndex: z, versionKey: key } };
      if (hero === null) throw { error: "rookie_score_invalid", catalogUnavailable: { seat, zoneIndex: z, versionKey: key } };
    }
  }

  for (let z = 0; z < 7; z++) {
    const r = revealedZones[String(z)] ?? revealedZones[z];
    if (r !== true) throw { error: "rookie_score_invalid", missingReveal: { zoneIndex: z } };
  }

  const zoneResults: Array<{ zoneIndex: number; outcome: "P1" | "P2" | "DRAW"; winningSeat?: number }> = [];
  const winsBySeat: Record<number, number> = { 1: 0, 2: 0 };
  let draws = 0;

  for (let z = 0; z < 7; z++) {
    const p1Key =
      placements["1"]?.[String(z)] ?? placements["1"]?.[z] ?? placements[1]?.[String(z)] ?? placements[1]?.[z];
    const p2Key =
      placements["2"]?.[String(z)] ?? placements["2"]?.[z] ?? placements[2]?.[String(z)] ?? placements[2]?.[z];

    const p1Power = await getHeroPower(p1Key);
    const p2Power = await getHeroPower(p2Key);
    if (typeof p1Power !== "number" || typeof p2Power !== "number") {
      throw { error: "rookie_score_invalid", powerLookupFailed: { zoneIndex: z, p1Key, p2Key } };
    }

    if (p1Power > p2Power) {
      winsBySeat[1] += 1;
      zoneResults.push({ zoneIndex: z, outcome: "P1", winningSeat: 1 });
    } else if (p2Power > p1Power) {
      winsBySeat[2] += 1;
      zoneResults.push({ zoneIndex: z, outcome: "P2", winningSeat: 2 });
    } else {
      draws += 1;
      zoneResults.push({ zoneIndex: z, outcome: "DRAW" });
    }
  }

  let matchWinner: number | null = null;
  if (winsBySeat[1] > winsBySeat[2]) matchWinner = 1;
  else if (winsBySeat[2] > winsBySeat[1]) matchWinner = 2;

  rookie.results = { zoneCount: 7, zones: zoneResults, winsBySeat, draws, matchWinner };
  rookie.phase = "SCORED";
  rookie.scoredAt = nowIso();
  return next;
}

async function applyRookieAction(state: any, seats: number[], type: string, payload: any) {
  let next = ensureRookieState(state);
  const rookie = next.rookie;
  const p = ensureObj(payload);

  if (type === "ROOKIE_PLACE") {
    const seat = p.seat;
    const zoneIndex = p.zoneIndex;
    const versionKey = p.versionKey;
    if (typeof seat !== "number" || typeof zoneIndex !== "number" || typeof versionKey !== "string") return next;

    rookie.placements = ensureObj(rookie.placements);
    const seatKey = String(seat);
    const bySeat = ensureObj(rookie.placements[seatKey] ?? rookie.placements[seat]);
    bySeat[String(zoneIndex)] = versionKey;
    rookie.placements[seatKey] = bySeat;

    rookie.lastPlaceAt = ensureObj(rookie.lastPlaceAt);
    rookie.lastPlaceAt[seatKey] = nowIso();
    return next;
  }

  if (type === "ROOKIE_REVEAL" || type === "ROOKIE_HIDE") {
    const zoneIndex = p.zoneIndex;
    if (typeof zoneIndex !== "number") return next;
    rookie.revealedZones = ensureObj(rookie.revealedZones);
    rookie.revealedZones[String(zoneIndex)] = type === "ROOKIE_REVEAL";
    return next;
  }

  if (type === "ROOKIE_SCORE_MATCH" || type === "ROOKIE_RESOLVE_MATCH") {
    return await rookieScoreOrThrow(next, seats);
  }

  return next;
}

async function applyReducer(modeCode: string | null, state: any, seats: number[], type: string, payload: any) {
  if (type === "END_TURN") return applyEndTurn(state, seats);

  const mc = (modeCode ?? "").toUpperCase();
  if (mc === "ROOKIE" && type.startsWith("ROOKIE_")) return await applyRookieAction(state, seats, type, payload);

  return state;
}

async function nextSeq(tx: any, gameId: string) {
  const last = await tx.gameEvent.findFirst({
    where: { gameId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return (last?.seq ?? 0) + 1;
}

// IMPORTANT: export name matches src/server/index.ts expectation
export async function registerGamesRoutes(app: FastifyInstance) {
  // POST /games
  app.post("/games", async (req, reply) => {
    const body = (req.body ?? {}) as Partial<CreateGameBody>;
    const modeCode = body.modeCode ? String(body.modeCode) : null;

    const players = Array.isArray(body.players) ? body.players : [];
    if (players.length === 0) return reply.code(400).send(badRequest("players required"));
    if (!seatsUnique(players)) return reply.code(400).send(badRequest("duplicate seats"));

    const deckIds = players.map((p) => p.deckId);
    const found = await prisma.deck.findMany({ where: { id: { in: deckIds } }, select: { id: true } });
    const foundIds = new Set(found.map((d) => d.id));
    const missing = deckIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) return reply.code(400).send({ error: "unknown_deck", missing });

    const gameId = await prisma.$transaction(async (tx) => {
      const g = await tx.game.create({ data: { modeCode, status: GameStatus.LOBBY, state: {} } });

      await tx.gamePlayer.createMany({
        data: players.map((p) => ({ gameId: g.id, seat: p.seat, deckId: p.deckId })),
      });

      await tx.gameEvent.create({
        data: { gameId: g.id, seq: 1, type: "CREATE", payload: { modeCode, players } },
      });

      return g.id;
    });

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { players: { orderBy: { seat: "asc" } }, events: { orderBy: { seq: "asc" } } },
    });

    return reply.code(201).send(game);
  });

  // GET /games/:id
  app.get("/games/:id", async (req, reply) => {
    const gameId = (req.params as any).id as string;

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { players: { orderBy: { seat: "asc" } }, events: { orderBy: { seq: "asc" } } },
    });

    if (!game) return reply.code(404).send({ error: "not_found", gameId });
    return reply.send(game);
  });

  // POST /games/:id/start
  app.post("/games/:id/start", async (req, reply) => {
    const gameId = (req.params as any).id as string;

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { players: { orderBy: { seat: "asc" } } },
    });

    if (!game) return reply.code(404).send({ error: "not_found", gameId });
    if (game.status !== GameStatus.LOBBY) return reply.code(409).send({ error: "invalid_state", message: "game is not in LOBBY" });

    const seats = seatsSorted(game.players);
    let state: any = ensureObj(game.state);
    state.modeCode = game.modeCode ?? null;
    state.turn = 1;
    state.activeSeat = seats[0];

    if ((game.modeCode ?? "").toUpperCase() === "ROOKIE") {
      state = ensureRookieState(state);
      state.rookie.phase = "SETUP";
    }

    const updated = await prisma.$transaction(async (tx) => {
      const seq = await nextSeq(tx, gameId);
      await tx.gameEvent.create({ data: { gameId, seq, type: "START", payload: {} } });

      return await tx.game.update({
        where: { id: gameId },
        data: { status: GameStatus.ACTIVE, state },
        include: { players: { orderBy: { seat: "asc" } }, events: { orderBy: { seq: "asc" } } },
      });
    });

    return reply.send(updated);
  });

  // POST /games/:id/actions
  app.post("/games/:id/actions", async (req, reply) => {
    const gameId = (req.params as any).id as string;
    const body = (req.body ?? {}) as Partial<ActionBody>;

    const type = body.type ? String(body.type) : "";
    if (!type) return reply.code(400).send({ error: "bad_request", message: "type required" });

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { players: { orderBy: { seat: "asc" } } },
    });

    if (!game) return reply.code(404).send({ error: "not_found", gameId });
    if (game.status !== GameStatus.ACTIVE) return reply.code(409).send({ error: "invalid_state", message: "game is not ACTIVE" });

    const seats = seatsSorted(game.players);

    let nextState: any;
    try {
      nextState = await applyReducer(game.modeCode ?? null, game.state, seats, type, body.payload);
    } catch (e: any) {
      if (e?.error === "rookie_score_invalid") return reply.code(400).send(e);
      return reply.code(400).send(badRequest("action reducer failed"));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const seq = await nextSeq(tx, gameId);
      await tx.gameEvent.create({ data: { gameId, seq, type, payload: body.payload ?? {} } });

      return await tx.game.update({
        where: { id: gameId },
        data: { state: nextState },
        include: { players: { orderBy: { seat: "asc" } }, events: { orderBy: { seq: "asc" } } },
      });
    });

    return reply.send(updated);
  });
}

export default registerGamesRoutes;
