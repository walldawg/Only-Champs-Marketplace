// src/server/catalog.routes.ts
import type { FastifyInstance } from "fastify";
import { PrismaClient, CardType } from "@prisma/client";

const prisma = new PrismaClient();

type SummaryRowConcept = { setCode: string; type: string; count: number };
type SummaryRowVersion = { setCode: string; conceptType: string; count: number };

function asInt(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["1", "true", "yes", "y", "on"].includes(v.toLowerCase());
  return fallback;
}

function isCardType(v: unknown): v is CardType {
  return v === "HERO" || v === "PLAY" || v === "HOTDOG";
}

function asObjectOrEmpty(v: unknown): Record<string, any> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, any>;
  return {};
}

function cardBackForSet(setCode: string): { key: string; setCode: string } {
  // Convention: BACK_{SETCODE_UPPER}. Keep stable and predictable.
  return { key: `BACK_${String(setCode).toUpperCase()}`, setCode };
}

type ArtFront =
  | { level: "BASE" | "TREATMENT" | "OFFICIAL" | "VERIFIED"; key: string };

function resolveArtFront(v: {
  artOfficialKey?: string | null;
  artVerifiedKey?: string | null;
}): ArtFront {
  if (v.artOfficialKey) return { level: "OFFICIAL", key: v.artOfficialKey };
  if (v.artVerifiedKey) return { level: "VERIFIED", key: v.artVerifiedKey };
  // Phase 8H: CardViewModelV1 freeze requires an artFront object.
  // Until Base/Treatment art keys exist in the schema, we return a stable placeholder.
  return { level: "BASE", key: "ART_BASE_PENDING" };
}
/**
 * Catalog browsing routes (Concepts + Versions).
 *
 * Exported as registerCatalogRoutes for index.ts compatibility.
 */
export async function registerCatalogRoutes(app: FastifyInstance) {
  /**
   * Summary: available sets + counts
   * GET /catalog/sets
   */
  app.get("/catalog/sets", async (req, reply) => {
    const q = (req.query as { setCode?: string }) ?? {};
    const setCode = q.setCode?.trim();

    const conceptWhere = setCode ? `WHERE setCode = ?` : "";
    const conceptParams = setCode ? [setCode] : [];

    const conceptRows = (await prisma.$queryRawUnsafe(
      `
      SELECT setCode, type, COUNT(*) as count
      FROM CardConcept
      ${conceptWhere}
      GROUP BY setCode, type
      ORDER BY setCode ASC, type ASC
      `,
      ...conceptParams
    )) as SummaryRowConcept[];

    const versionWhere = setCode ? `WHERE cc.setCode = ?` : "";
    const versionParams = setCode ? [setCode] : [];

    const versionRows = (await prisma.$queryRawUnsafe(
      `
      SELECT cc.setCode as setCode, cv.conceptType as conceptType, COUNT(*) as count
      FROM CardVersion cv
      JOIN CardConcept cc ON cc.hybridKey = cv.conceptKey
      ${versionWhere}
      GROUP BY cc.setCode, cv.conceptType
      ORDER BY cc.setCode ASC, cv.conceptType ASC
      `,
      ...versionParams
    )) as SummaryRowVersion[];

    const sets: Record<
      string,
      { setCode: string; conceptCounts: Record<string, number>; versionCounts: Record<string, number> }
    > = {};

    for (const r of conceptRows) {
      sets[r.setCode] ??= { setCode: r.setCode, conceptCounts: {}, versionCounts: {} };
      sets[r.setCode].conceptCounts[r.type] = asInt(r.count);
    }

    for (const r of versionRows) {
      sets[r.setCode] ??= { setCode: r.setCode, conceptCounts: {}, versionCounts: {} };
      sets[r.setCode].versionCounts[r.conceptType] = asInt(r.count);
    }

    return { sets: Object.values(sets).sort((a, b) => a.setCode.localeCompare(b.setCode)) };
  });

  /**
   * Browse a set (paginated concepts).
   *
   * GET /catalog/sets/:setCode/cards?type=HERO&limit=50&offset=0&includeVersions=true
   */
  app.get("/catalog/sets/:setCode/cards", async (req, reply) => {
    const { setCode } = req.params as { setCode: string };
    const q =
      (req.query as { type?: string; limit?: string; offset?: string; includeVersions?: string }) ??
      {};

    const type = q.type?.toUpperCase();
    if (type && !isCardType(type)) {
      return reply.code(400).send({ error: `Invalid type "${q.type}". Use HERO|PLAY|HOTDOG.` });
    }

    const limit = Math.min(Math.max(asInt(q.limit, 50), 1), 200);
    const offset = Math.max(asInt(q.offset, 0), 0);
    const includeVersions = asBool(q.includeVersions, false);

    const whereConcept = { setCode, ...(type ? { type: type as CardType } : {}) };

    const [total, concepts] = await Promise.all([
      prisma.cardConcept.count({ where: whereConcept }),
      prisma.cardConcept.findMany({
        where: whereConcept,
        orderBy: [{ type: "asc" }, { slug: "asc" }],
        skip: offset,
        take: limit,
        select: { hybridKey: true, setCode: true, type: true, slug: true, name: true },
      }),
    ]);

    const conceptKeys = concepts.map((c) => c.hybridKey);

    const versionCounts = await prisma.cardVersion.groupBy({
      by: ["conceptKey"],
      where: { conceptKey: { in: conceptKeys } },
      _count: { _all: true },
    });

    const versionCountByConceptKey = new Map<string, number>();
    for (const r of versionCounts) versionCountByConceptKey.set(r.conceptKey, r._count._all);

    let versionsByConceptKey: Map<string, any[]> | undefined;

    if (includeVersions) {
      const versions = await prisma.cardVersion.findMany({
        where: { conceptKey: { in: conceptKeys } },
        orderBy: [{ conceptKey: "asc" }, { versionCode: "asc" }],
        select: {
          versionKey: true,
          conceptKey: true,
          // NOTE: keep setCode selected so we can validate + backfill behavior.
          setCode: true,
          conceptType: true,
          versionCode: true,
          finish: true,
          attributes: true,
          requirements: true,
          // Art resolution ladder (fields must exist in schema)
          artVerifiedKey: true,
          artOfficialKey: true,
        },
      });

      versionsByConceptKey = new Map<string, any[]>();
      for (const v of versions) {
        const arr = versionsByConceptKey.get(v.conceptKey) ?? [];
        arr.push(v);
        versionsByConceptKey.set(v.conceptKey, arr);
      }
    }

    const items = concepts.map((c) => {
      const base: any = {
        conceptKey: c.hybridKey,
        setCode: c.setCode,
        type: c.type,
        slug: c.slug,
        name: c.name,
        versionCount: versionCountByConceptKey.get(c.hybridKey) ?? 0,
      };

      if (includeVersions && versionsByConceptKey) {
        base.versions = (versionsByConceptKey.get(c.hybridKey) ?? []).map((v) => {
          const sc = (v.setCode ?? c.setCode) as string;
          return {
            versionKey: v.versionKey,
            conceptKey: v.conceptKey,
            setCode: sc,
            conceptType: v.conceptType,
            versionCode: v.versionCode,
            finish: v.finish,
            attributes: v.attributes,
            requirements: asObjectOrEmpty(v.requirements),
            cardBack: cardBackForSet(sc),
            artFront: resolveArtFront(v),
          };
        });
      }

      return base;
    });

    return { setCode, filter: { type: type ?? null }, paging: { limit, offset, total }, items };
  });

  /**
   * Single concept drill-down.
   *
   * GET /catalog/concepts/:conceptKey?includeVersions=true&limit=100&offset=0
   */
  app.get("/catalog/concepts/:conceptKey", async (req, reply) => {
    const { conceptKey } = req.params as { conceptKey: string };
    const q = (req.query as { includeVersions?: string; limit?: string; offset?: string }) ?? {};

    const includeVersions = asBool(q.includeVersions, true);
    const limit = Math.min(Math.max(asInt(q.limit, 100), 1), 500);
    const offset = Math.max(asInt(q.offset, 0), 0);

    const concept = await prisma.cardConcept.findUnique({
      where: { hybridKey: conceptKey },
      select: { hybridKey: true, setCode: true, type: true, slug: true, name: true, meta: true },
    });

    if (!concept) return reply.code(404).send({ error: "Concept not found" });

    const result: any = {
      concept: {
        conceptKey: concept.hybridKey,
        setCode: concept.setCode,
        type: concept.type,
        slug: concept.slug,
        name: concept.name,
        meta: concept.meta ?? null,
      },
    };

    if (!includeVersions) return result;

    const total = await prisma.cardVersion.count({ where: { conceptKey } });

    const versions = await prisma.cardVersion.findMany({
      where: { conceptKey },
      orderBy: [{ versionCode: "asc" }],
      skip: offset,
      take: limit,
      select: {
        versionKey: true,
        conceptKey: true,
        setCode: true,
        conceptType: true,
        versionCode: true,
        finish: true,
        attributes: true,
        requirements: true,
        artVerifiedKey: true,
        artOfficialKey: true,
      },
    });

    result.versions = {
      paging: { limit, offset, total },
      items: versions.map((v) => {
        const sc = (v.setCode ?? concept.setCode) as string;
        return {
          versionKey: v.versionKey,
          conceptKey: v.conceptKey,
          setCode: sc,
          conceptType: v.conceptType,
          versionCode: v.versionCode,
          finish: v.finish,
          attributes: v.attributes,
          requirements: asObjectOrEmpty(v.requirements),
          cardBack: cardBackForSet(sc),
          artFront: resolveArtFront(v),
        };
      }),
    };

    result.versionCount = total;
    return result;
  });

  /**
   * Direct path for a single card by {setCode}/{type}/{slug}.
   *
   * GET /catalog/sets/:setCode/:type/:slug?includeVersions=true&limit=100&offset=0
   */
  app.get("/catalog/sets/:setCode/:type/:slug", async (req, reply) => {
    const { setCode, type, slug } = req.params as { setCode: string; type: string; slug: string };
    const q = (req.query as { includeVersions?: string; limit?: string; offset?: string }) ?? {};

    const t = type.toUpperCase();
    if (!isCardType(t)) {
      return reply.code(400).send({ error: `Invalid type "${type}". Use HERO|PLAY|HOTDOG.` });
    }

    const includeVersions = asBool(q.includeVersions, true);
    const limit = Math.min(Math.max(asInt(q.limit, 100), 1), 500);
    const offset = Math.max(asInt(q.offset, 0), 0);

    const concept = await prisma.cardConcept.findUnique({
      where: { setCode_type_slug: { setCode, type: t as CardType, slug } },
      select: { hybridKey: true, setCode: true, type: true, slug: true, name: true, meta: true },
    });

    if (!concept) return reply.code(404).send({ error: "Concept not found" });

    const result: any = {
      concept: {
        conceptKey: concept.hybridKey,
        setCode: concept.setCode,
        type: concept.type,
        slug: concept.slug,
        name: concept.name,
        meta: concept.meta ?? null,
      },
    };

    if (!includeVersions) return result;

    const total = await prisma.cardVersion.count({ where: { conceptKey: concept.hybridKey } });

    const versions = await prisma.cardVersion.findMany({
      where: { conceptKey: concept.hybridKey },
      orderBy: [{ versionCode: "asc" }],
      skip: offset,
      take: limit,
      select: {
        versionKey: true,
        conceptKey: true,
        setCode: true,
        conceptType: true,
        versionCode: true,
        finish: true,
        attributes: true,
        requirements: true,
        artVerifiedKey: true,
        artOfficialKey: true,
      },
    });

    result.versions = {
      paging: { limit, offset, total },
      items: versions.map((v) => {
        const sc = (v.setCode ?? concept.setCode) as string;
        return {
          versionKey: v.versionKey,
          conceptKey: v.conceptKey,
          setCode: sc,
          conceptType: v.conceptType,
          versionCode: v.versionCode,
          finish: v.finish,
          attributes: v.attributes,
          requirements: asObjectOrEmpty(v.requirements),
          cardBack: cardBackForSet(sc),
          artFront: resolveArtFront(v),
        };
      }),
    };

    result.versionCount = total;
    return result;
  });
}
