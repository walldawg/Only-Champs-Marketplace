// scripts/importMfgXlsx.ts
//
// Import a manufacturer XLSX into Canonical catalog:
// - CardConcept: one per (setCode, cardType, cardNumber)  [Option A]
// - CardVersion: one per distinct (variation/treatment/weapon/notation) combo
//
// Usage examples:
//   npx -y tsx scripts/importMfgXlsx.ts --setCode GRIFFEY --type HERO   --xlsx "data/raw/griffey/griffey_hero.xlsx" --sheet 1
//   npx -y tsx scripts/importMfgXlsx.ts --setCode GRIFFEY --type PLAY   --xlsx "data/raw/griffey/griffey_play.xlsx" --sheet 1
//   npx -y tsx scripts/importMfgXlsx.ts --setCode GRIFFEY --type HOTDOG --xlsx "data/raw/griffey/griffey_hotdog.xlsx" --sheet 1
//
// Optional:
//   --dryRun true
//
// Expected header row columns (case-insensitive match):
//   Card #, Hero, Variation, Treatment, Weapon, Notation, Power, Athlete Inspiration, Play Cost, Play Ability

import fs from "node:fs";
import path from "node:path";
import { PrismaClient, CardType } from "@prisma/client";
import * as XLSX from "xlsx";

type Args = {
  setCode: string;
  type: CardType;
  xlsx: string;
  sheet: string; // name or 1-based index string
  dryRun: boolean;
};

function getArg(flag: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}
function requireArg(flag: string): string {
  const v = getArg(flag);
  if (!v) throw new Error(`Missing required arg: ${flag}`);
  return v;
}
function toBool(v: string | undefined, fallback: boolean): boolean {
  if (!v) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(v.toLowerCase());
}

function normalizeToken(s: string): string {
  return (s || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function conceptSlugFor(cardNumber: number): string {
  return `NO_${String(cardNumber).padStart(3, "0")}`;
}

function versionCodeFor(row: Record<string, any>): string {
  const parts = [row["Variation"], row["Treatment"], row["Weapon"], row["Notation"]]
    .map((x) => (x ?? "").toString().trim())
    .filter((x) => x.length > 0);

  const code = normalizeToken(parts.join("_"));
  return code.length > 0 ? code : "BASE";
}

function parseIntSafe(v: any): number | null {
  if (v === null || v === undefined) return null;
  const s = v.toString().trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * FIX:
 * Manufacturer uses typed card numbers like "PL-1" / "HD-1".
 * We extract the trailing integer.
 */
function parseCardNumber(row: Record<string, any>): number {
  const raw = (row["Card #"] ?? "").toString().trim();
  if (!raw) throw new Error(`Invalid Card # ""`);

  // Accept:
  // "12" -> 12
  // "PL-12" -> 12
  // "HD-12" -> 12
  // "PL 12" -> 12
  // "PL-012" -> 12
  const m = raw.match(/(\d+)\s*$/);
  if (!m) {
    throw new Error(`Invalid Card # "${raw}"`);
  }
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid Card # "${raw}"`);
  }
  return n;
}

function detectName(row: Record<string, any>): string {
  const name = (row["Hero"] ?? "").toString().trim();
  return name.length > 0 ? name : "UNKNOWN";
}

function normalizeHeaders(o: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const map: Record<string, string> = {
    "card #": "Card #",
    hero: "Hero",
    variation: "Variation",
    treatment: "Treatment",
    weapon: "Weapon",
    notation: "Notation",
    power: "Power",
    "athlete inspiration": "Athlete Inspiration",
    "play cost": "Play Cost",
    "play ability": "Play Ability",
  };

  for (const [k, v] of Object.entries(o)) {
    const key = map[k.trim().toLowerCase()] ?? k;
    out[key] = v;
  }
  return out;
}

function readXlsxRows(xlsxPath: string, sheetSelector: string): Array<Record<string, any>> {
  const abs = path.resolve(xlsxPath);
  if (!fs.existsSync(abs)) throw new Error(`XLSX not found: ${abs}`);

  const wb = XLSX.readFile(abs, { cellText: true, cellDates: true });
  const sheet =
    wb.Sheets[wb.SheetNames[Number(sheetSelector) - 1]] ?? wb.Sheets[sheetSelector];

  if (!sheet) {
    throw new Error(
      `Sheet not found. Provided "${sheetSelector}". Available: ${wb.SheetNames.join(", ")}`
    );
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: "",
    raw: false,
  });

  return rawRows.map(normalizeHeaders);
}

async function main() {
  const args: Args = {
    setCode: requireArg("--setCode"),
    type: requireArg("--type") as CardType,
    xlsx: requireArg("--xlsx"),
    sheet: getArg("--sheet") ?? "1",
    dryRun: toBool(getArg("--dryRun"), false),
  };

  if (!Object.values(CardType).includes(args.type)) {
    throw new Error(
      `Invalid --type "${args.type}". Must be one of: ${Object.values(CardType).join(", ")}`
    );
  }

  const prisma = new PrismaClient();
  const rows = readXlsxRows(args.xlsx, args.sheet);

  console.log(`== import start ==`);
  console.log(`setCode=${args.setCode}`);
  console.log(`type=${args.type}`);
  console.log(`xlsx=${args.xlsx}`);
  console.log(`sheet=${args.sheet}`);
  console.log(`rows=${rows.length}`);
  console.log(`dryRun=${args.dryRun}`);

  let createdConcepts = 0;
  let updatedConcepts = 0;
  let createdVersions = 0;
  let updatedVersions = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row["Card #"] && !row["Hero"]) continue;

    const cardNumber = parseCardNumber(row);
    const name = detectName(row);

    const slug = conceptSlugFor(cardNumber);
    const conceptKey = `${args.setCode}:${args.type}:${slug}`;

    const versionCode = versionCodeFor(row);
    const versionKey = `${args.setCode}:${args.type}:${slug}:${versionCode}`;

    const attributes: Record<string, unknown> = {
      cardNumber,
      power: parseIntSafe(row["Power"]) ?? undefined,
      playCost: (row["Play Cost"] ?? "").toString().trim() || undefined,
      playAbility: (row["Play Ability"] ?? "").toString().trim() || undefined,
      variation: (row["Variation"] ?? "").toString().trim() || undefined,
      treatment: (row["Treatment"] ?? "").toString().trim() || undefined,
      weapon: (row["Weapon"] ?? "").toString().trim() || undefined,
      notation: (row["Notation"] ?? "").toString().trim() || undefined,
      athleteInspiration: (row["Athlete Inspiration"] ?? "").toString().trim() || undefined,
    };

    if (args.dryRun) continue;

    const existingConcept = await prisma.cardConcept.findUnique({
      where: { hybridKey: conceptKey },
      select: { hybridKey: true, name: true },
    });

    if (!existingConcept) {
      await prisma.cardConcept.create({
        data: {
          hybridKey: conceptKey,
          setCode: args.setCode,
          type: args.type,
          slug,
          name,
          meta: {
            source: { xlsx: path.basename(args.xlsx), sheet: args.sheet, rowIndex: i + 1 },
          } as any,
        },
      });
      createdConcepts++;
    } else if (!existingConcept.name || existingConcept.name === "UNKNOWN") {
      await prisma.cardConcept.update({
        where: { hybridKey: conceptKey },
        data: { name },
      });
      updatedConcepts++;
    }

    const existingVersion = await prisma.cardVersion.findUnique({
      where: { versionKey },
      select: { versionKey: true },
    });

    if (!existingVersion) {
      await prisma.cardVersion.create({
        data: {
          versionKey,
          conceptKey,
          conceptType: args.type,
          versionCode,
          attributes: attributes as any,
          requirements: {} as any,
        },
      });
      createdVersions++;
    } else {
      await prisma.cardVersion.update({
        where: { versionKey },
        data: { attributes: attributes as any },
      });
      updatedVersions++;
    }
  }

  if (!args.dryRun) {
    console.log(`== import results ==`);
    console.log(`createdConcepts=${createdConcepts}`);
    console.log(`updatedConcepts=${updatedConcepts}`);
    console.log(`createdVersions=${createdVersions}`);
    console.log(`updatedVersions=${updatedVersions}`);
  } else {
    console.log(`== dryRun == (no DB writes)`);
  }

  await prisma.$disconnect();
  console.log(`== done ==`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
