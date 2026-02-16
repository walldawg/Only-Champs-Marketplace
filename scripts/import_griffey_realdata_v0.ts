import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, CardType, Finish } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

type RawRow = {
  cardNo: string;
  name: string;
  variation: string;
  treatment: string;
  weapon: string;
  notation: string;
  power: string;
  athleteInspiration: string;
  playCost: string;
  playAbility: string;
};

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function normalizeVersionCode(variation: string): string {
  const v = (variation ?? "").trim();
  if (!v) return "V1";
  return v
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function inferCardTypeFromTreatment(treatment: string): CardType {
  const t = (treatment ?? "").trim().toLowerCase();
  if (t === "plays") return CardType.PLAY;
  if (t === "hot dog" || t === "hotdog") return CardType.HOTDOG;
  return CardType.HERO;
}

function conceptKey(setCode: string, type: CardType, slug: string): string {
  return `${setCode}:${type}:${slug}`;
}

function versionKey(setCode: string, type: CardType, slug: string, versionCode: string): string {
  return `${setCode}:${type}:${slug}:${versionCode}`;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Reads first sheet of an .xlsx (or any sheetname if provided) and returns rows keyed by header names.
 * We rely on your consistent header row:
 * Card #, Hero, Variation, Treatment, Weapon, Notation, Power, Athlete Inspiration, Play Cost, Play Ability
 */
function parseXlsx(filePath: string, sheetName?: string): RawRow[] {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const targetSheetName = sheetName ?? wb.SheetNames[0];
  if (!targetSheetName) die(`No sheets found in ${filePath}`);

  const ws = wb.Sheets[targetSheetName];
  if (!ws) die(`Sheet not found (${targetSheetName}) in ${filePath}`);

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    raw: false,
  });

  const rows: RawRow[] = json.map((r) => ({
    cardNo: toStr(r["Card #"]),
    name: toStr(r["Hero"]),
    variation: toStr(r["Variation"]),
    treatment: toStr(r["Treatment"]),
    weapon: toStr(r["Weapon"]),
    notation: toStr(r["Notation"]),
    power: toStr(r["Power"]),
    athleteInspiration: toStr(r["Athlete Inspiration"]),
    playCost: toStr(r["Play Cost"]),
    playAbility: toStr(r["Play Ability"]),
  }));

  // Filter blanks
  return rows.filter((x) => x.name.length > 0);
}

/**
 * CSV fallback: still here, but XLSX is preferred.
 * This fallback is minimal and assumes no quoted commas/newlines.
 */
function parseCsvUnsafe(filePath: string): RawRow[] {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name: string) => {
    const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i === -1) die(`Missing column "${name}" in ${filePath}`);
    return i;
  };

  const iCard = idx("Card #");
  const iHero = idx("Hero");
  const iVar = idx("Variation");
  const iTreat = idx("Treatment");
  const iWeap = idx("Weapon");
  const iNote = idx("Notation");
  const iPow = idx("Power");
  const iAth = idx("Athlete Inspiration");
  const iCost = idx("Play Cost");
  const iAbil = idx("Play Ability");

  const rows: RawRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r].split(",");
    rows.push({
      cardNo: (cols[iCard] ?? "").trim(),
      name: (cols[iHero] ?? "").trim(),
      variation: (cols[iVar] ?? "").trim(),
      treatment: (cols[iTreat] ?? "").trim(),
      weapon: (cols[iWeap] ?? "").trim(),
      notation: (cols[iNote] ?? "").trim(),
      power: (cols[iPow] ?? "").trim(),
      athleteInspiration: (cols[iAth] ?? "").trim(),
      playCost: (cols[iCost] ?? "").trim(),
      playAbility: (cols[iAbil] ?? "").trim(),
    });
  }
  return rows.filter((x) => x.name.length > 0);
}

function parseFile(filePath: string): RawRow[] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx" || ext === ".xlsm" || ext === ".xls") return parseXlsx(filePath);
  if (ext === ".csv") return parseCsvUnsafe(filePath);
  die(`Unsupported file type: ${filePath} (expected .xlsx or .csv)`);
}

async function upsertOne(setCode: string, row: RawRow) {
  const type = inferCardTypeFromTreatment(row.treatment);
  const slug = slugify(row.name);
  const cKey = conceptKey(setCode, type, slug);
  const vCode = normalizeVersionCode(row.variation);
  const vKey = versionKey(setCode, type, slug, vCode);

  const meta = {
    raw: {
      cardNo: row.cardNo || null,
      variation: row.variation || null,
      treatment: row.treatment || null,
      weapon: row.weapon || null,
      notation: row.notation || null,
      athleteInspiration: row.athleteInspiration || null,
      playAbility: row.playAbility || null,
      playCost: row.playCost || null,
      power: row.power || null,
    },
  };

  const attributes: Record<string, unknown> = {};
  if (type === CardType.HERO) {
    const p = Number(row.power);
    if (!Number.isFinite(p)) die(`HERO row missing numeric Power: ${row.name} (${row.power})`);
    attributes.power = p;
  }

  const requirements: Record<string, unknown> = {};
  const cost = Number(row.playCost);
  if (Number.isFinite(cost) && cost > 0) requirements.playCost = cost;

  await prisma.cardConcept.upsert({
    where: { hybridKey: cKey },
    create: {
      hybridKey: cKey,
      setCode,
      type,
      slug,
      name: row.name,
      meta,
    },
    update: {
      name: row.name,
      meta,
    },
  });

  await prisma.cardVersion.upsert({
    where: { versionKey: vKey },
    create: {
      versionKey: vKey,
      conceptKey: cKey,
      conceptType: type,
      versionCode: vCode,
      finish: Finish.NONFOIL,
      attributes,
      requirements,
    },
    update: {
      conceptType: type,
      finish: Finish.NONFOIL,
      attributes,
      requirements,
    },
  });

  return { vKey, type };
}

async function main() {
  const setCode = process.env.SET_CODE?.trim();
  if (!setCode) die('Missing SET_CODE. Example: SET_CODE="GRIFFEY" ...');

  const args = process.argv.slice(2);
  const argVal = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const heroPath = argVal("--hero");
  const playPath = argVal("--play");
  const hotdogPath = argVal("--hotdog");
  if (!heroPath || !playPath || !hotdogPath) die("Missing args: --hero --play --hotdog");

  for (const p of [heroPath, playPath, hotdogPath]) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) die(`File not found: ${abs}`);
  }

  const hero = parseFile(path.resolve(heroPath));
  const play = parseFile(path.resolve(playPath));
  const hotdog = parseFile(path.resolve(hotdogPath));

  const all = [...hero, ...play, ...hotdog];

  const stats: Record<string, number> = { HERO: 0, PLAY: 0, HOTDOG: 0 };
  for (const row of all) {
    const { type } = await upsertOne(setCode, row);
    stats[type] += 1;
  }

  console.log("Import complete.");
  console.log(stats);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
