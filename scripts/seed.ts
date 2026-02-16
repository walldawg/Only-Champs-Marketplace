// scripts/seed.ts
import "dotenv/config";
import { PrismaClient, CardType, Finish } from "@prisma/client";

const prisma = new PrismaClient();

type SeedConcept = {
  setCode: string;
  type: CardType;
  slug: string;
  name?: string;
};

type SeedVersion = {
  concept: SeedConcept;
  versionCode: string;
  finish?: Finish;
  attributes?: Record<string, unknown>;
  requirements?: Record<string, unknown>;
};

function conceptKey(c: SeedConcept): string {
  return `${c.setCode}:${c.type}:${c.slug}`;
}

function versionKey(c: SeedConcept, versionCode: string): string {
  return `${c.setCode}:${c.type}:${c.slug}:${versionCode}`;
}

async function upsertConcept(c: SeedConcept) {
  const key = conceptKey(c);

  await prisma.cardConcept.upsert({
    where: { hybridKey: key },
    create: {
      hybridKey: key,
      setCode: c.setCode,
      type: c.type,
      slug: c.slug,
      name: c.name ?? null,
      meta: {},
    },
    update: {
      name: c.name ?? null,
    },
  });

  return key;
}

async function upsertVersion(v: SeedVersion) {
  const cKey = await upsertConcept(v.concept);

  const vKey = versionKey(v.concept, v.versionCode);

  await prisma.cardVersion.upsert({
    where: { versionKey: vKey },
    create: {
      versionKey: vKey,
      conceptKey: cKey,
      conceptType: v.concept.type,
      versionCode: v.versionCode,
      finish: v.finish ?? Finish.NONFOIL,
      attributes: v.attributes ?? {},
      requirements: v.requirements ?? {},
    },
    update: {
      finish: v.finish ?? Finish.NONFOIL,
      attributes: v.attributes ?? {},
      requirements: v.requirements ?? {},
      conceptType: v.concept.type,
    },
  });

  return vKey;
}

async function main() {
  // Minimal Engine Core v1 seed set
  const setCode = "CORE";

  const seed: SeedVersion[] = [
    // 2 HERO CardVersions with attributes.power
    {
      concept: { setCode, type: CardType.HERO, slug: "bo-jackson", name: "Bo Jackson" },
      versionCode: "V1",
      attributes: { power: 90 },
    },
    {
      concept: { setCode, type: CardType.HERO, slug: "ken-griffey-jr", name: "Ken Griffey Jr." },
      versionCode: "V1",
      attributes: { power: 88 },
    },

    // 1 PLAY CardVersion
    {
      concept: { setCode, type: CardType.PLAY, slug: "home-run", name: "Home Run" },
      versionCode: "V1",
      attributes: {},
    },

    // 1 HOTDOG CardVersion
    {
      concept: { setCode, type: CardType.HOTDOG, slug: "ballpark-dog", name: "Ballpark Dog" },
      versionCode: "V1",
      attributes: {},
    },
  ];

  const keys: string[] = [];
  for (const v of seed) {
    const k = await upsertVersion(v);
    keys.push(k);
  }

  console.log("Seed complete. Upserted CardVersions:");
  for (const k of keys) console.log(`- ${k}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
