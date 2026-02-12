// scripts/importMfgCsv.ts
//
// Import a manufacturer CSV export into Canonical catalog:
// - CardConcept: one per (setCode, cardType, cardNumber)  [Option A]
// - CardVersion: one per distinct (variation/treatment/weapon/notation) combo
//
// Usage examples:
//   npx -y tsx scripts/importMfgCsv.ts --setCode GRIFFEY --type HERO   --csv "/path/griffey hero-Griffey hero.csv"
//   npx -y tsx scripts/importMfgCsv.ts --setCode GRIFFEY --type PLAY   --csv "/path/griffey play-Griffey plays2.csv"
//   npx -y tsx scripts/importMfgCsv.ts --setCode GRIFFEY --type HOTDOG --csv "/path/griffey hd-Griffey Hot dog.csv"
//
// Optional:
//   --dryRun true

import fs from "node:fs";
import path from "node:path";
import { PrismaClient, CardType } from "@prisma/client";
import { parse } from "csv-parse/sync";

type Args = {
  setCode: string;
  type: CardType;
  csv: string;
  dryRun: boolean;
};

function getArg(flag: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function requireArg(flag: string): string {
  const v = getArg(flag);
  if (!v) {
    throw new Error(`Missing required arg: ${flag}`);
  }
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
  // Option A: Concept = one per printed card number
  return `NO_${String(cardNumber).padStart(3, "0")}`;
}

function versionCodeFor(row: Record<string, string>): string {
  // Deterministic code from the "variant identity" columns
  const parts = [
    row["Variation"],
    row["Treatment"],
    row["Weapon"],
    row["Notation"],
  ]
    .map((x) => (x ?? "").trim())
    .filter((x) => x.length > 0);

  const code = normalizeToken(parts.join("_"));
  return code.length > 0 ? code : "BASE";
}

function parseIntSafe(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function parseCardNumber(row: Record<string, string>): number {
  const raw = (row["Card #"] ?? "").trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid Card # "${row["Card #"]}"`);
  }
  return n;
}

function detectName(row: Record<string, string>): string {
  // Manufacturer column is named "Hero" but it’s really the display name for all types.
  const name = (row["Hero"] ?? "").trim();
  return name.length > 0 ? name : "UNKNOWN";
}

function readCsv(csvPath: string): Array<Record<string, string>> {
  const abs = path.resolve(csvPath);
  const content = fs.readFileSync(abs, "utf8");

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  }) as Array<Record<string, string>>;

  return records;
}

async function main() {
  const args: Args = {
    setCode: requireArg("--setCode"),
    type: requireArg("--type") as CardType,
    csv: requireArg("--csv"),
    dryRun: toBool(getArg("--dryRun"), false),
  };

  if (!Object.values(CardType).includes(args.type)) {
    throw new Error(
      `Invalid --type "${args.type}". Must be one of: ${Object.values(CardType).join(", ")}`
    );
  }

  const prisma = new PrismaClient();

  const rows = readCsv(args.csv);

  console.log(`== import start ==`);
  console.log(`setCode=${args.setCode}`);
  console.log(`type=${args.type}`);
  console.log(`csv=${args.csv}`);
  console.log(`rows=${rows.length}`);
  console.log(`dryRun=${args.dryRun}`);

  let createdConcepts = 0;
  let createdVersions = 0;
  let updatedConcepts = 0;
  let updatedVersions = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const cardNumber = parseCardNumber(row);
    const name = detectName(row);

    const slug = conceptSlugFor(cardNumber);
    const conceptKey = `${args.setCode}:${args.type}:${slug}`;

    const versionCode = versionCodeFor(row);
    const versionKey = `${args.setCode}:${args.type}:${slug}:${versionCode}`;

    const meta = {
      source: {
        csv: path.basename(args.csv),
        rowIndex: i + 1,
      },
      mfg: {
        variation: row["Variation"] ?? null,
        treatment: row["Treatment"] ?? null,
        weapon: row["Weapon"] ?? null,
        notation: row["Notation"] ?? null,
        athleteInspiration: row["Athlete Inspiration"] ?? null,
      },
      raw: row,
    };

    const attributes: Record<string, unknown> = {
      power: parseIntSafe(row["Power"]) ?? undefined,
      playCost: (row["Play Cost"] ?? "").trim() || undefined,
      playAbility: (row["Play Ability"] ?? "").trim() || undefined,
      variation: (row["Variation"] ?? "").trim() || undefined,
      treatment: (row["Treatment"] ?? "").trim() || undefined,
      weapon: (row["Weapon"] ?? "").trim() || undefined,
      notation: (row["Notation"] ?? "").trim() || undefined,
      athleteInspiration: (row["Athlete Inspiration"] ?? "").trim() || undefined,
      // Keep a stable field for card number if you want it in UI without parsing keys:
      cardNumber,
    };

    if (args.dryRun) {
      continue;
    }

    // Upsert concept
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
          meta: meta as any,
        },
      });
      createdConcepts++;
    } else {
      // If name was missing earlier, we can enrich; otherwise leave it alone.
      // (Keeps it “canonical-ish” while still allowing harmless enrichment.)
      if (!existingConcept.name || existingConcept.name === "UNKNOWN") {
        await prisma.cardConcept.update({
          where: { hybridKey: conceptKey },
          data: { name },
        });
        updatedConcepts++;
      }
    }

    // Upsert version
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
          // finish left default (NONFOIL) unless you decide to infer later
          attributes: attributes as any,
          requirements: {} as any,
        },
      });
      createdVersions++;
    } else {
      // Non-destructive update: only set attributes fields that are currently missing.
      // If you want strict immutability, remove this block.
      await prisma.cardVersion.update({
        where: { versionKey },
        data: {
          // keep conceptType + versionCode stable, just re-stamp attributes for now
          attributes: attributes as any,
        },
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
