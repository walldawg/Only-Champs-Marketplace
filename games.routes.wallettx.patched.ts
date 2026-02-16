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

    // Snapshot tally at score time (immutable per battle once scored)
  rookie.tally = zoneResults.map((z) => z.outcome);

  rookie.results = { zoneCount: 7, zones: zoneResults, winsBySeat, draws, matchWinner };
  rookie.phase = "SCORED";
  rookie.scoredAt = nowIso();
  return next;
}

async function applyRookieAction(state: any, seats: number[], type: string, payload: any) {
  let next = ensureRookieState(state);
  const rookie = next.rookie;
  const p = ensureObj(payload);

  if (type === "ROOKIE_BEGIN_MATCH") {
    // Minimal lifecycle step: unlock scoring by entering MATCH phase
    if (rookie.phase === "SETUP") rookie.phase = "MATCH";
    rookie.matchBeganAt = nowIso();
    return next;
  }

  if (type === "ROOKIE_END_MATCH") {
    // Minimal match finalization. Does not mutate gameplay; just freezes end state.
    if (rookie.phase !== "SCORED") {
      throw { error: "rookie_end_invalid", phaseInvalid: { phase: rookie.phase, required: "SCORED" } };
    }

    const matchWinner = rookie?.results?.matchWinner ?? null;
    rookie.rewardEligible = {
      type: "COIN",
      winnerSeat: typeof matchWinner === "number" ? matchWinner : null,
      amount: typeof matchWinner === "number" ? 1 : 0,
      reason: typeof matchWinner === "number" ? "ROOKIE_MATCH_WIN" : "ROOKIE_MATCH_NO_WINNER",
      createdAt: nowIso(),
    };

    rookie.phase = "ENDED";
    rookie.endedAt = nowIso();
    return next;
  }

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
      if (e?.error === "rookie_end_invalid") return reply.code(400).send(e);
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

  // POST /games/:id/reward/claim
  // Credits the caller's wallet (x-user-id) if they are the winning seat and rewardEligible is present.
  // Idempotency: writes rookie.rewardPaidAt in game state and refuses subsequent claims.
  app.post("/games/:id/reward/claim", async (req, reply) => {
    const gameId = (req.params as any).id as string;
    const userId = String((req.headers as any)["x-user-id"] ?? "");

    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const body: any = (req.body ?? {}) as any;
    const seat = typeof body?.seat === "number" ? body.seat : null;
    if (typeof seat !== "number") return reply.code(400).send(badRequest("seat required"));

    const result = await prisma.$transaction(async (tx) => {
      const game = await tx.game.findUnique({
        where: { id: gameId },
        include: { players: { orderBy: { seat: "asc" } } },
      });
      if (!game) return { ok: false, status: 404 as const, payload: { error: "not_found", gameId } };

      const state: any = ensureObj(game.state);
      const rookie: any = ensureObj(state.rookie);
      const phase = rookie.phase;

      if (phase !== "ENDED") {
        return {
          ok: false,
          status: 409 as const,
          payload: { error: "REWARD_NOT_READY", phase, required: "ENDED" },
        };
      }

      const reward = ensureObj(rookie.rewardEligible);
      const winnerSeat = reward.winnerSeat;
      const amount = reward.amount;

      if (winnerSeat !== seat) {
        return {
          ok: false,
          status: 403 as const,
          payload: { error: "NOT_WINNER", seat, winnerSeat },
        };
      }

      if (typeof amount !== "number" || amount <= 0) {
        return {
          ok: false,
          status: 409 as const,
          payload: { error: "NO_REWARD", amount },
        };
      }

      if (rookie.rewardPaidAt) {
        return {
          ok: true,
          status: 200 as const,
          payload: { message: "REWARD_ALREADY_CLAIMED", paidAt: rookie.rewardPaidAt },
        };
      }

      const wallet = await tx.wallet.findUnique({
        where: { userId },
        include: { assets: true },
      });
      if (!wallet) {
        return { ok: false, status: 409 as const, payload: { error: "WALLET_REQUIRED" } };
      }

      // Ensure EARNED asset exists
      let earned = wallet.assets.find((a: any) => a.assetType === "EARNED") ?? null;
      if (!earned) {
        earned = await tx.walletAsset.create({
          data: { walletId: wallet.id, assetType: "EARNED", balance: 0 },
        });
      }

      await tx.walletAsset.update({
        where: { id: earned.id },
        data: { balance: earned.balance + amount },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          assetType: "EARNED",
          amount,
          reason: "ROOKIE_MATCH_WIN",
        },
      });

      // Mark paid in game state for idempotency
      rookie.rewardPaidAt = nowIso();
      state.rookie = rookie;

      await tx.game.update({
        where: { id: gameId },
        data: { state },
      });

      return {
        ok: true,
        status: 200 as const,
        payload: { message: "REWARD_CLAIMED", amount, assetType: "EARNED", paidAt: rookie.rewardPaidAt },
      };
    });

    return reply.code(result.status).send(result.payload);
  });

  // GET /wallet/tx?limit=50
  // Returns recent wallet transactions for the caller (x-user-id).
  app.get("/wallet/tx", async (req, reply) => {
    const userId = String((req.headers as any)["x-user-id"] ?? "");
    if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

    const q: any = (req.query ?? {}) as any;
    const rawLimit = q.limit;
    const limitNum = typeof rawLimit === "string" ? Number(rawLimit) : typeof rawLimit === "number" ? rawLimit : 50;
    const limit = Number.isFinite(limitNum) ? Math.max(1, Math.min(200, Math.trunc(limitNum))) : 50;

    const wallet = await prisma.wallet.findUnique({ where: { userId }, select: { id: true } });
    if (!wallet) return reply.code(404).send({ error: "WALLET_NOT_FOUND" });

    const items = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        walletId: true,
        assetType: true,
        amount: true,
        reason: true,
        createdAt: true,
      },
    });

    return reply.send({ userId, walletId: wallet.id, limit, items });
  });


}

export default registerGamesRoutes;
