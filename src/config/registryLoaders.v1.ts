// src/config/registryLoaders.v1.ts
// Milestone A: A2/A3/A4 loaders (read-only). No engine wiring yet.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

function readJsonFile<T>(absPath: string, schema: z.ZodType<T>): T {
  if (!fs.existsSync(absPath)) throw new Error(`CONFIG_NOT_FOUND: ${absPath}`);
  const raw = fs.readFileSync(absPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`CONFIG_INVALID_JSON: ${absPath}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `CONFIG_SCHEMA_VIOLATION: ${absPath}\n` +
        result.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n")
    );
  }
  return result.data;
}

function repoRootConfigPath(filename: string) {
  return path.join(process.cwd(), "config", filename);
}

// ---- Schemas ----

const FormatPointerSchema = z.object({
  formatId: z.string().min(1),
  formatVersion: z.number().int().positive(),
});

const FormatDistributionSchema = z.object({
  distributionId: z.string().min(1),
  distributionVersion: z.number().int().positive(),
  registries: z
    .array(
      z.object({
        formatRegistryId: z.string().min(1),
        formatRegistryVersion: z.number().int().positive(),
        isDefault: z.boolean().optional(),
      })
    )
    .min(1),
});

const FormatRegistrySchema = z.object({
  formatRegistryId: z.string().min(1),
  formatRegistryVersion: z.number().int().positive(),
  formats: z
    .array(
      z.object({
        formatId: z.string().min(1),
        formatVersion: z.number().int().positive(),
        engineCompatVersion: z.number().int().positive(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
      })
    )
    .min(1),
});

const GameModeRegistrySchema = z.object({
  gameModeRegistryId: z.string().min(1),
  gameModeRegistryVersion: z.number().int().positive(),
  gameModes: z
    .array(
      z.object({
        gameModeId: z.string().min(1),
        gameModeVersion: z.number().int().positive(),
        engineCompatVersion: z.number().int().positive(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        formatGate: z
          .object({
            mode: z.enum(["ALLOW_LIST", "DENY_LIST", "OPEN"]),
            allowedFormats: z.array(FormatPointerSchema).optional(),
            deniedFormats: z.array(FormatPointerSchema).optional(),
          })
          .optional(),
      })
    )
    .min(1),
});

const AppConfigSchema = z.object({
  activeFormatDistribution: z.object({
    distributionId: z.string().min(1),
    distributionVersion: z.number().int().positive(),
  }),
  activeGameModeRegistry: z.object({
    gameModeRegistryId: z.string().min(1),
    gameModeRegistryVersion: z.number().int().positive(),
  }),
  engineSupportedCompatVersions: z.array(z.number().int().positive()).min(1),
});

// ---- Types ----
export type FormatDistribution = z.infer<typeof FormatDistributionSchema>;
export type FormatRegistry = z.infer<typeof FormatRegistrySchema>;
export type GameModeRegistry = z.infer<typeof GameModeRegistrySchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ---- A2 ----
export function loadFormatDistributionDefault(): FormatDistribution {
  const p = repoRootConfigPath("formatDistribution.default.json");
  const dist = readJsonFile(p, FormatDistributionSchema);

  const seen = new Set<string>();
  for (const r of dist.registries) {
    const key = `${r.formatRegistryId}@${r.formatRegistryVersion}`;
    if (seen.has(key)) throw new Error(`CONFIG_DUPLICATE_FORMAT_REGISTRY_POINTER: ${key}`);
    seen.add(key);
  }
  return dist;
}

export function selectDefaultFormatRegistryPointer(dist: FormatDistribution): {
  formatRegistryId: string;
  formatRegistryVersion: number;
} {
  const flagged = dist.registries.filter((r) => r.isDefault === true);
  if (flagged.length > 1) throw new Error("CONFIG_MULTIPLE_DEFAULT_FORMAT_REGISTRIES");
  const chosen = flagged.length === 1 ? flagged[0] : dist.registries[0];
  return { formatRegistryId: chosen.formatRegistryId, formatRegistryVersion: chosen.formatRegistryVersion };
}

export function loadFormatRegistryDefault(): FormatRegistry {
  const p = repoRootConfigPath("formatRegistry.default.json");
  const reg = readJsonFile(p, FormatRegistrySchema);

  const seen = new Set<string>();
  for (const f of reg.formats) {
    const key = `${f.formatId}@${f.formatVersion}`;
    if (seen.has(key)) throw new Error(`CONFIG_DUPLICATE_FORMAT_POINTER: ${key}`);
    seen.add(key);
  }
  return reg;
}

// ---- A3 ----
export function loadGameModeRegistryDefault(): GameModeRegistry {
  const p = repoRootConfigPath("gameModeRegistry.default.json");
  const reg = readJsonFile(p, GameModeRegistrySchema);

  const seen = new Set<string>();
  for (const gm of reg.gameModes) {
    const key = `${gm.gameModeId}@${gm.gameModeVersion}`;
    if (seen.has(key)) throw new Error(`CONFIG_DUPLICATE_GAMEMODE_POINTER: ${key}`);
    seen.add(key);
  }
  return reg;
}

// ---- A4 ----
export function loadAppConfigDefault(): AppConfig {
  const p = repoRootConfigPath("appConfig.default.json");
  const cfg = readJsonFile(p, AppConfigSchema);

  const seen = new Set<number>();
  for (const v of cfg.engineSupportedCompatVersions) {
    if (seen.has(v)) throw new Error(`CONFIG_DUPLICATE_ENGINE_COMPAT: ${v}`);
    seen.add(v);
  }
  return cfg;
}
