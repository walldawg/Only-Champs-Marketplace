import "dotenv/config";
import { PrismaClient, CardType, Finish } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

type CanonicalJsonConceptInput = {
  type: CardType;
  slug: string;
  name?: string;
  meta?: Record<string, unknown>;
  versions: Array<{
    versionCode: string;
    finish?: Finish;
    attributes?: Record<string, unknown>;
    requirements?: Record<string, unknown>;
  }>;
};

type CanonicalJsonPayload = {
  setCode: string;
  concepts: CanonicalJsonConceptInput[];
};

type PlanOp = {
  kind: "concept" | "version";
  op: "create" | "update";
  key: string;
};

type ImportPlan = {
  setCode: string;
  conceptRows: Array<{
    key: string;
    setCode: string;
    type: CardType;
    slug: string;
    name: string | null;
    meta: Record<string, unknown>;
  }>;
  versionRows: Array<{
    key: string;
    conceptKey: string;
    setCode: string;
    conceptType: CardType;
    versionCode: string;
    finish: Finish;
    attributes: Record<string, unknown>;
    requirements: Record<string, unknown>;
  }>;
  counts: {
    created: number;
    updated: number;
    skipped: number;
  };
  sample: PlanOp[];
};

type ImportReport = {
  reportId: string;
  startedAt: string;
  finishedAt: string;
  mode: "dry-run" | "execute";
  importerKey: "phase7_importCanonicalJson_v1";
  inputSummary: {
    inputPath: string;
    setCode: string;
    conceptCount: number;
    versionCount: number;
  };
  counts: {
    created: number;
    updated: number;
    skipped: number;
  };
  warnings: string[];
  errors: string[];
  sample: PlanOp[];
};

type Args = {
  inputPath: string;
  dryRun: boolean;
  confirm: boolean;
};

const IMPORTER_KEY = "phase7_importCanonicalJson_v1" as const;
const REPORT_DIR = path.resolve(process.cwd(), "data", "import_reports");
const SAMPLE_LIMIT = 20;

function getArgValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const next = args[i + 1];
  if (!next || next.startsWith("--")) return "";
  return next;
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === "") return fallback;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  throw new Error(`Invalid boolean value: ${v}`);
}

function parseArgs(argv: string[]): Args {
  const inputPath = (getArgValue(argv, "--input") || "").trim();
  if (!inputPath) {
    throw new Error("Missing required --input <path-to-json>");
  }

  const hasExecuteFlag = argv.includes("--execute");
  const dryRun = hasExecuteFlag
    ? false
    : parseBool(getArgValue(argv, "--dry-run"), true);

  const confirm = parseBool(getArgValue(argv, "--confirm"), false);

  if (!dryRun && !confirm) {
    throw new Error("Execute mode requires --confirm true");
  }

  return { inputPath, dryRun, confirm };
}

function ensureObject(v: unknown, label: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`${label} must be an object`);
  }
  return v as Record<string, unknown>;
}

function readString(v: unknown, label: string): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return v.trim();
}

function parseCardType(v: unknown, label: string): CardType {
  if (v === "HERO" || v === "PLAY" || v === "HOTDOG") return v;
  throw new Error(`${label} must be HERO|PLAY|HOTDOG`);
}

function parseFinish(v: unknown, label: string): Finish | undefined {
  if (v == null || v === "") return undefined;
  if (v === "NONFOIL" || v === "FOIL") return v;
  throw new Error(`${label} must be NONFOIL|FOIL`);
}

function parsePayload(raw: unknown): CanonicalJsonPayload {
  const root = ensureObject(raw, "payload");
  const setCode = readString(root.setCode, "payload.setCode");

  if (!Array.isArray(root.concepts) || root.concepts.length === 0) {
    throw new Error("payload.concepts must be a non-empty array");
  }

  const conceptKeySeen = new Set<string>();
  const versionKeySeen = new Set<string>();

  const concepts: CanonicalJsonConceptInput[] = root.concepts.map((rawConcept, ci) => {
    const c = ensureObject(rawConcept, `payload.concepts[${ci}]`);
    const type = parseCardType(c.type, `payload.concepts[${ci}].type`);
    const slug = readString(c.slug, `payload.concepts[${ci}].slug`);

    const conceptKey = `${setCode}:${type}:${slug}`;
    if (conceptKeySeen.has(conceptKey)) {
      throw new Error(`Duplicate concept in payload: ${conceptKey}`);
    }
    conceptKeySeen.add(conceptKey);

    if (!Array.isArray(c.versions) || c.versions.length === 0) {
      throw new Error(`payload.concepts[${ci}].versions must be a non-empty array`);
    }

    const versions = c.versions.map((rawVersion, vi) => {
      const v = ensureObject(rawVersion, `payload.concepts[${ci}].versions[${vi}]`);
      const versionCode = readString(v.versionCode, `payload.concepts[${ci}].versions[${vi}].versionCode`);
      const finish = parseFinish(v.finish, `payload.concepts[${ci}].versions[${vi}].finish`);

      const attributes = v.attributes == null
        ? {}
        : ensureObject(v.attributes, `payload.concepts[${ci}].versions[${vi}].attributes`);
      const requirements = v.requirements == null
        ? {}
        : ensureObject(v.requirements, `payload.concepts[${ci}].versions[${vi}].requirements`);

      const versionKey = `${setCode}:${type}:${slug}:${versionCode}`;
      if (versionKeySeen.has(versionKey)) {
        throw new Error(`Duplicate version in payload: ${versionKey}`);
      }
      versionKeySeen.add(versionKey);

      return { versionCode, finish, attributes, requirements };
    });

    const concept: CanonicalJsonConceptInput = { type, slug, versions };

    if (c.name != null) concept.name = readString(c.name, `payload.concepts[${ci}].name`);
    if (c.meta != null) concept.meta = ensureObject(c.meta, `payload.concepts[${ci}].meta`);

    return concept;
  });

  return { setCode, concepts };
}

async function buildPlan(prisma: PrismaClient, payload: CanonicalJsonPayload): Promise<ImportPlan> {
  const conceptRows: ImportPlan["conceptRows"] = [];
  const versionRows: ImportPlan["versionRows"] = [];

  for (const concept of payload.concepts) {
    const conceptKey = `${payload.setCode}:${concept.type}:${concept.slug}`;
    conceptRows.push({
      key: conceptKey,
      setCode: payload.setCode,
      type: concept.type,
      slug: concept.slug,
      name: concept.name ?? null,
      meta: concept.meta ?? {},
    });

    for (const version of concept.versions) {
      const versionKey = `${payload.setCode}:${concept.type}:${concept.slug}:${version.versionCode}`;
      versionRows.push({
        key: versionKey,
        conceptKey,
        setCode: payload.setCode,
        conceptType: concept.type,
        versionCode: version.versionCode,
        finish: version.finish ?? Finish.NONFOIL,
        attributes: version.attributes ?? {},
        requirements: version.requirements ?? {},
      });
    }
  }

  const [existingConcepts, existingVersions] = await Promise.all([
    prisma.cardConcept.findMany({
      where: { hybridKey: { in: conceptRows.map((x) => x.key) } },
      select: { hybridKey: true },
    }),
    prisma.cardVersion.findMany({
      where: { versionKey: { in: versionRows.map((x) => x.key) } },
      select: { versionKey: true },
    }),
  ]);

  const existingConceptSet = new Set(existingConcepts.map((x) => x.hybridKey));
  const existingVersionSet = new Set(existingVersions.map((x) => x.versionKey));

  let created = 0;
  let updated = 0;
  const sample: PlanOp[] = [];

  for (const c of conceptRows) {
    const op: PlanOp["op"] = existingConceptSet.has(c.key) ? "update" : "create";
    if (op === "create") created += 1;
    else updated += 1;
    if (sample.length < SAMPLE_LIMIT) sample.push({ kind: "concept", op, key: c.key });
  }

  for (const v of versionRows) {
    const op: PlanOp["op"] = existingVersionSet.has(v.key) ? "update" : "create";
    if (op === "create") created += 1;
    else updated += 1;
    if (sample.length < SAMPLE_LIMIT) sample.push({ kind: "version", op, key: v.key });
  }

  return {
    setCode: payload.setCode,
    conceptRows,
    versionRows,
    counts: {
      created,
      updated,
      skipped: 0,
    },
    sample,
  };
}

async function executePlan(prisma: PrismaClient, plan: ImportPlan): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const c of plan.conceptRows) {
      await tx.cardConcept.upsert({
        where: { hybridKey: c.key },
        create: {
          hybridKey: c.key,
          setCode: c.setCode,
          type: c.type,
          slug: c.slug,
          name: c.name,
          meta: c.meta as any,
        },
        update: {
          name: c.name,
          meta: c.meta as any,
        },
      });
    }

    for (const v of plan.versionRows) {
      await tx.cardVersion.upsert({
        where: { versionKey: v.key },
        create: {
          versionKey: v.key,
          conceptKey: v.conceptKey,
          setCode: v.setCode,
          conceptType: v.conceptType,
          versionCode: v.versionCode,
          finish: v.finish,
          attributes: v.attributes as any,
          requirements: v.requirements as any,
        },
        update: {
          setCode: v.setCode,
          conceptType: v.conceptType,
          versionCode: v.versionCode,
          finish: v.finish,
          attributes: v.attributes as any,
          requirements: v.requirements as any,
        },
      });
    }
  });
}

async function writeReport(report: ImportReport): Promise<string> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const fileName = `${report.startedAt.replace(/[:.]/g, "-")}_${report.reportId}.json`;
  const outputPath = path.join(REPORT_DIR, fileName);
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  return outputPath;
}

async function readPayload(inputPath: string): Promise<CanonicalJsonPayload> {
  const abs = path.resolve(process.cwd(), inputPath);
  const raw = await fs.readFile(abs, "utf8");
  const parsed = JSON.parse(raw);
  return parsePayload(parsed);
}

function buildReport(
  startedAt: string,
  finishedAt: string,
  args: Args,
  payload: CanonicalJsonPayload,
  plan: ImportPlan,
  warnings: string[],
  errors: string[]
): ImportReport {
  return {
    reportId: crypto.randomUUID(),
    startedAt,
    finishedAt,
    mode: args.dryRun ? "dry-run" : "execute",
    importerKey: IMPORTER_KEY,
    inputSummary: {
      inputPath: args.inputPath,
      setCode: payload.setCode,
      conceptCount: plan.conceptRows.length,
      versionCount: plan.versionRows.length,
    },
    counts: plan.counts,
    warnings,
    errors,
    sample: plan.sample,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  let payload: CanonicalJsonPayload | null = null;
  let plan: ImportPlan | null = null;
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    payload = await readPayload(args.inputPath);
    plan = await buildPlan(prisma, payload);

    if (!args.dryRun) {
      await executePlan(prisma, plan);
    }
  } catch (err: any) {
    errors.push(err?.message ?? String(err));
  }

  const finishedAt = new Date().toISOString();

  const fallbackPayload: CanonicalJsonPayload = payload ?? { setCode: "UNKNOWN", concepts: [] };
  const fallbackPlan: ImportPlan =
    plan ??
    ({
      setCode: fallbackPayload.setCode,
      conceptRows: [],
      versionRows: [],
      counts: { created: 0, updated: 0, skipped: 0 },
      sample: [],
    } as ImportPlan);

  const report = buildReport(startedAt, finishedAt, args, fallbackPayload, fallbackPlan, warnings, errors);
  const reportPath = await writeReport(report);

  console.log(`mode=${report.mode}`);
  console.log(`setCode=${report.inputSummary.setCode}`);
  console.log(`conceptCount=${report.inputSummary.conceptCount}`);
  console.log(`versionCount=${report.inputSummary.versionCount}`);
  console.log(`created=${report.counts.created}`);
  console.log(`updated=${report.counts.updated}`);
  console.log(`skipped=${report.counts.skipped}`);
  console.log(`reportPath=${reportPath}`);
  console.log(`errors=${report.errors.length}`);

  await prisma.$disconnect();

  if (errors.length > 0) {
    console.log("exitCode=1");
    process.exit(1);
  }

  console.log("exitCode=0");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
