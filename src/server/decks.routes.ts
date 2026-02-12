// src/server/decks.routes.ts
// Full file — Deck Overlay v1 persistence (LOCKED routes)
// Routes unchanged (same paths). Advisory validator only.

import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

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

type CreateDeckBody = {
  name: string;
  ownerUserId?: string;
};

type PutCardsBody = {
  cards: Array<{ versionKey: string; qty: number }>;
};

function ensureObj(x: any) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

function asNonEmptyString(x: any): string | null {
  if (typeof x !== "string") return null;
  const s = x.trim();
  return s.length ? s : null;
}

function asPositiveInt(x: any): number | null {
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  const n = Math.floor(x);
  return n > 0 ? n : null;
}

function summarizeTypes(rows: Array<{ conceptType: string }>) {
  let heroes = 0;
  let plays = 0;
  let hotdogs = 0;

  for (const r of rows) {
    if (r.conceptType === "HERO") heroes += 1;
    else if (r.conceptType === "PLAY") plays += 1;
    else if (r.conceptType === "HOTDOG") hotdogs += 1;
  }

  return { heroes, plays, hotdogs };
}

export async function registerDecksRoutes(app: FastifyInstance) {
  // POST /decks
  app.post("/decks", async (req, reply) => {
    const body = ensureObj(req.body) as Partial<CreateDeckBody>;
    const name = asNonEmptyString(body.name);
    if (!name) return reply.code(400).send({ error: "bad_request", message: "name required" });

    const ownerUserId = body.ownerUserId ? String(body.ownerUserId) : null;

    const deck = await prisma.deck.create({
      data: { name, ownerUserId: ownerUserId ?? undefined },
      select: {
        id: true,
        name: true,
        ownerUserId: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return reply.code(201).send(deck);
  });

  // GET /decks/:id
  app.get("/decks/:id", async (req, reply) => {
    const deckId = (req.params as any).id as string;

    const deck = await prisma.deck.findUnique({
      where: { id: deckId },
      select: {
        id: true,
        name: true,
        ownerUserId: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        cards: {
          orderBy: { createdAt: "asc" },
          select: { versionKey: true, qty: true },
        },
      },
    });

    if (!deck) return reply.code(404).send({ error: "not_found", deckId });
    return reply.send(deck);
  });

  // PUT /decks/:id/cards  (replace contents)
  app.put("/decks/:id/cards", async (req, reply) => {
    const deckId = (req.params as any).id as string;
    const body = ensureObj(req.body) as Partial<PutCardsBody>;

    const cards = Array.isArray(body.cards) ? body.cards : null;
    if (!cards) return reply.code(400).send({ error: "bad_request", message: "cards required" });

    // normalize + merge duplicates by versionKey
    const merged = new Map<string, number>();
    for (const c of cards) {
      const vk = asNonEmptyString((c as any)?.versionKey);
      const qty = asPositiveInt((c as any)?.qty);
      if (!vk || qty === null) return reply.code(400).send({ error: "bad_request", message: "invalid cards entry" });
      merged.set(vk, (merged.get(vk) ?? 0) + qty);
    }

    const versionKeys = [...merged.keys()];

    const deckExists = await prisma.deck.findUnique({ where: { id: deckId }, select: { id: true } });
    if (!deckExists) return reply.code(404).send({ error: "not_found", deckId });

    // verify all versionKeys exist
    if (versionKeys.length > 0) {
      const found = await prisma.cardVersion.findMany({
        where: { versionKey: { in: versionKeys } },
        select: { versionKey: true },
      });
      const foundSet = new Set(found.map((v) => v.versionKey));
      const missing = versionKeys.find((vk) => !foundSet.has(vk));
      if (missing) return reply.code(400).send({ error: "unknown_version", versionKey: missing });
    }

    await prisma.$transaction(async (tx) => {
      await tx.deckCardVersion.deleteMany({ where: { deckId } });

      if (versionKeys.length > 0) {
        await tx.deckCardVersion.createMany({
          data: versionKeys.map((versionKey) => ({
            deckId,
            versionKey,
            qty: merged.get(versionKey)!,
          })),
        });
      }
    });

    return reply.code(204).send();
  });

  // GET /decks/:id/validate  (advisory, read-only)
  app.get("/decks/:id/validate", async (req, reply) => {
    const deckId = (req.params as any).id as string;

    const deck = await prisma.deck.findUnique({
      where: { id: deckId },
      select: {
        id: true,
        cards: { select: { versionKey: true, qty: true } },
      },
    });

    if (!deck) return reply.code(404).send({ error: "not_found", deckId });

    const versionKeys = deck.cards.map((c) => c.versionKey);
    const versions = versionKeys.length
      ? await prisma.cardVersion.findMany({
          where: { versionKey: { in: versionKeys } },
          select: { versionKey: true, conceptType: true },
        })
      : [];

    const byKey = new Map(versions.map((v) => [v.versionKey, v]));
    const totalCards = deck.cards.reduce((sum, c) => sum + c.qty, 0);

    // Count types with qty weighting
    let heroes = 0;
    let plays = 0;
    let hotdogs = 0;

    for (const c of deck.cards) {
      const v = byKey.get(c.versionKey);
      // If catalog is incomplete, treat as warning but do not hard-fail.
      if (!v) continue;
      if (v.conceptType === "HERO") heroes += c.qty;
      else if (v.conceptType === "PLAY") plays += c.qty;
      else if (v.conceptType === "HOTDOG") hotdogs += c.qty;
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    // HOTDOG gate (current rule): requires at least 1 HERO
    if (hotdogs > 0 && heroes < 1) {
      errors.push("HOTDOG gate: deck contains HOTDOG but has zero HERO cards (requires at least 1 HERO).");
    }

    // catalog gaps warning
    const missingCatalog = deck.cards
      .map((c) => c.versionKey)
      .filter((vk) => !byKey.has(vk));
    if (missingCatalog.length > 0) {
      warnings.push(`Catalog missing ${missingCatalog.length} referenced versionKey(s); type counts may be incomplete.`);
    }

    const ok = errors.length === 0;

    return reply.send({
      deckId,
      ok,
      errors,
      warnings,
      summary: { totalCards, heroes, plays, hotdogs },
    });
  });
}

export default registerDecksRoutes;
