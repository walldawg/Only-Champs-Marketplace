// src/config/resolvers.v1.ts
// Milestone A: A5/A6 resolvers (pointer → resolved entity) against active registries.

import { z } from "zod";
import type { AppConfig, FormatRegistry, GameModeRegistry } from "./registryLoaders.v1";

const FormatPointerSchema = z.object({
  formatId: z.string().min(1),
  formatVersion: z.number().int().positive(),
});

const GameModePointerSchema = z.object({
  gameModeId: z.string().min(1),
  gameModeVersion: z.number().int().positive(),
});

export type FormatPointer = z.infer<typeof FormatPointerSchema>;
export type GameModePointer = z.infer<typeof GameModePointerSchema>;

export type ResolvedFormat = {
  formatId: string;
  formatVersion: number;
  engineCompatVersion: number;
  name?: string;
  description?: string;
};

export type ResolvedGameMode = {
  gameModeId: string;
  gameModeVersion: number;
  engineCompatVersion: number;
  name?: string;
  description?: string;
  formatGate?: {
    mode: "ALLOW_LIST" | "DENY_LIST" | "OPEN";
    allowedFormats?: { formatId: string; formatVersion: number }[];
    deniedFormats?: { formatId: string; formatVersion: number }[];
  };
};

function requireSupportedCompat(appConfig: AppConfig, compat: number, label: string) {
  if (!appConfig.engineSupportedCompatVersions.includes(compat)) {
    throw new Error(`ENGINE_COMPAT_UNSUPPORTED: ${label} compat=${compat}`);
  }
}

// A5
export function resolveFormat(
  args: {
    appConfig: AppConfig;
    formatRegistry: FormatRegistry;
    pointer: FormatPointer;
  }
): ResolvedFormat {
  const pointer = FormatPointerSchema.parse(args.pointer);

  const found = args.formatRegistry.formats.find(
    (f) => f.formatId === pointer.formatId && f.formatVersion === pointer.formatVersion
  );
  if (!found) {
    throw new Error(`FORMAT_NOT_FOUND: ${pointer.formatId}@${pointer.formatVersion}`);
  }

  requireSupportedCompat(args.appConfig, found.engineCompatVersion, `Format ${pointer.formatId}@${pointer.formatVersion}`);

  return {
    formatId: found.formatId,
    formatVersion: found.formatVersion,
    engineCompatVersion: found.engineCompatVersion,
    name: found.name,
    description: found.description,
  };
}

// A6
export function resolveGameMode(
  args: {
    appConfig: AppConfig;
    gameModeRegistry: GameModeRegistry;
    pointer: GameModePointer;
  }
): ResolvedGameMode {
  const pointer = GameModePointerSchema.parse(args.pointer);

  const found = args.gameModeRegistry.gameModes.find(
    (g) => g.gameModeId === pointer.gameModeId && g.gameModeVersion === pointer.gameModeVersion
  );
  if (!found) {
    throw new Error(`GAMEMODE_NOT_FOUND: ${pointer.gameModeId}@${pointer.gameModeVersion}`);
  }

  requireSupportedCompat(
    args.appConfig,
    found.engineCompatVersion,
    `GameMode ${pointer.gameModeId}@${pointer.gameModeVersion}`
  );

  return {
    gameModeId: found.gameModeId,
    gameModeVersion: found.gameModeVersion,
    engineCompatVersion: found.engineCompatVersion,
    name: found.name,
    description: found.description,
    formatGate: found.formatGate as any,
  };
}
