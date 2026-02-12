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

export async function registerCatalogRoutes(app: FastifyInstance) {
  /**
   * Gym lobby stats:
   * /catalog/summary?setCode=griffey
   */
  app.get("/catalog/summary", async (req) => {
    const { setCode } = (req.query as { setCode?: string }) ?? {};

    const conceptWhere = setCode ? `WHERE setCode = ?` : "";
    const conceptParams = setCode ? [setCode] : [];

    const conceptRows = (await prisma.$queryRawUnsafe(
      `
      SELECT setCode as setCode, type as type, COUNT(*) as count
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
      {
        setCode: string;
        conceptCounts: Record<string, number>;
        versionCounts: Record<string, number>;
      }
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

    const whereConcept = {
      setCode,
      ...(type ? { type: type as CardType } : {}),
    };

    const [total, concepts] = await Promise.all([
      prisma.cardConcept.count({ where: whereConcept }),
      prisma.cardConcept.findMany({
        where: whereConcept,
        orderBy: [{ type: "asc" }, { slug: "asc" }],
        skip: offset,
        take: limit,
        select: {
          hybridKey: true,
          setCode: true,
          type: true,
          slug: true,
          name: true,
        },
      }),
    ]);

    const conceptKeys = concepts.map((c) => c.hybridKey);

    const versionCounts = await prisma.cardVersion.groupBy({
      by: ["conceptKey"],
      where: { conceptKey: { in: conceptKeys } },
      _count: { _all: true },
    });

    const versionCountByConceptKey = new Map<string, number>();
    for (const r of versionCounts) {
      versionCountByConceptKey.set(r.conceptKey, r._count._all);
    }

    let versionsByConceptKey: Map<string, any[]> | undefined;

    if (includeVersions) {
      const versions = await prisma.cardVersion.findMany({
        where: { conceptKey: { in: conceptKeys } },
        orderBy: [{ conceptKey: "asc" }, { versionCode: "asc" }],
        select: {
          versionKey: true,
          conceptKey: true,
          conceptType: true,
          versionCode: true,
          finish: true,
          attributes: true,
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
        base.versions = versionsByConceptKey.get(c.hybridKey) ?? [];
      }

      return base;
    });

    return {
      setCode,
      filter: { type: type ?? null },
      paging: { limit, offset, total },
      items,
    };
  });

  /**
   * Single concept drill-down.
   *
   * GET /catalog/concepts/:conceptKey?includeVersions=true&limit=100&offset=0
   * Example conceptKey: griffey:HERO:NO_003
   */
  app.get("/catalog/concepts/:conceptKey", async (req, reply) => {
    const { conceptKey } = req.params as { conceptKey: string };
    const q =
      (req.query as { includeVersions?: string; limit?: string; offset?: string }) ?? {};

    const includeVersions = asBool(q.includeVersions, true);
    const limit = Math.min(Math.max(asInt(q.limit, 100), 1), 500);
    const offset = Math.max(asInt(q.offset, 0), 0);

    const concept = await prisma.cardConcept.findUnique({
      where: { hybridKey: conceptKey },
      select: {
        hybridKey: true,
        setCode: true,
        type: true,
        slug: true,
        name: true,
        meta: true,
      },
    });

    if (!concept) {
      return reply.code(404).send({ error: `Concept not found: ${conceptKey}` });
    }

    const versionCount = await prisma.cardVersion.count({
      where: { conceptKey },
    });

    let versions: any[] = [];
    if (includeVersions) {
      versions = await prisma.cardVersion.findMany({
        where: { conceptKey },
        orderBy: [{ versionCode: "asc" }],
        skip: offset,
        take: limit,
        select: {
          versionKey: true,
          conceptKey: true,
          conceptType: true,
          versionCode: true,
          finish: true,
          attributes: true,
          requirements: true,
        },
      });
    }

    return {
      concept: {
        conceptKey: concept.hybridKey,
        setCode: concept.setCode,
        type: concept.type,
        slug: concept.slug,
        name: concept.name,
        meta: concept.meta,
      },
      versions: includeVersions
        ? {
            paging: { limit, offset, total: versionCount },
            items: versions,
          }
        : null,
      versionCount,
    };
  });

  /**
   * Alias route to avoid colons in URLs:
   * GET /catalog/sets/:setCode/:type/:slug?includeVersions=true&limit=100&offset=0
   *
   * Example:
   *   /catalog/sets/griffey/HERO/NO_003
   */
  app.get("/catalog/sets/:setCode/:type/:slug", async (req, reply) => {
    const { setCode, type, slug } = req.params as { setCode: string; type: string; slug: string };
    const q =
      (req.query as { includeVersions?: string; limit?: string; offset?: string }) ?? {};

    const t = type.toUpperCase();
    if (!isCardType(t)) {
      return reply.code(400).send({ error: `Invalid type "${type}". Use HERO|PLAY|HOTDOG.` });
    }

    const conceptKey = `${setCode}:${t}:${slug}`;

    const includeVersions = asBool(q.includeVersions, true);
    const limit = Math.min(Math.max(asInt(q.limit, 100), 1), 500);
    const offset = Math.max(asInt(q.offset, 0), 0);

    const concept = await prisma.cardConcept.findUnique({
      where: { hybridKey: conceptKey },
      select: {
        hybridKey: true,
        setCode: true,
        type: true,
        slug: true,
        name: true,
        meta: true,
      },
    });

    if (!concept) {
      return reply.code(404).send({ error: `Concept not found: ${conceptKey}` });
    }

    const versionCount = await prisma.cardVersion.count({
      where: { conceptKey },
    });

    let versions: any[] = [];
    if (includeVersions) {
      versions = await prisma.cardVersion.findMany({
        where: { conceptKey },
        orderBy: [{ versionCode: "asc" }],
        skip: offset,
        take: limit,
        select: {
          versionKey: true,
          conceptKey: true,
          conceptType: true,
          versionCode: true,
          finish: true,
          attributes: true,
          requirements: true,
        },
      });
    }

    return {
      concept: {
        conceptKey: concept.hybridKey,
        setCode: concept.setCode,
        type: concept.type,
        slug: concept.slug,
        name: concept.name,
        meta: concept.meta,
      },
      versions: includeVersions
        ? {
            paging: { limit, offset, total: versionCount },
            items: versions,
          }
        : null,
      versionCount,
    };
  });
}
