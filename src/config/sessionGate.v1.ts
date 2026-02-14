// src/config/sessionGate.v1.ts
// Milestone A: A7 pre-Setup composition gate.
// Validates: format exists, gamemode exists, compat supported, gamemode format gating.

import type { AppConfig, FormatRegistry, GameModeRegistry } from "./registryLoaders.v1";
import { resolveFormat, resolveGameMode } from "./resolvers.v1";

export type SessionPointer = {
  format: { formatId: string; formatVersion: number };
  gameMode: { gameModeId: string; gameModeVersion: number };
};

function ptrKey(f: { formatId: string; formatVersion: number }) {
  return `${f.formatId}@${f.formatVersion}`;
}

function isAllowedByGate(args: {
  gate?: {
    mode: "ALLOW_LIST" | "DENY_LIST" | "OPEN";
    allowedFormats?: { formatId: string; formatVersion: number }[];
    deniedFormats?: { formatId: string; formatVersion: number }[];
  };
  format: { formatId: string; formatVersion: number };
}) {
  const { gate, format } = args;
  if (!gate || gate.mode === "OPEN") return true;

  if (gate.mode === "ALLOW_LIST") {
    const allowed = gate.allowedFormats ?? [];
    return allowed.some((f) => f.formatId === format.formatId && f.formatVersion === format.formatVersion);
  }

  if (gate.mode === "DENY_LIST") {
    const denied = gate.deniedFormats ?? [];
    return !denied.some((f) => f.formatId === format.formatId && f.formatVersion === format.formatVersion);
  }

  // exhaustive
  return false;
}

export function validateSessionCanEnterSetup(args: {
  appConfig: AppConfig;
  formatRegistry: FormatRegistry;
  gameModeRegistry: GameModeRegistry;
  session: SessionPointer;
}): {
  formatSnapshot: ReturnType<typeof resolveFormat>;
  gameModeSnapshot: ReturnType<typeof resolveGameMode>;
} {
  const formatSnapshot = resolveFormat({
    appConfig: args.appConfig,
    formatRegistry: args.formatRegistry,
    pointer: args.session.format,
  });

  const gameModeSnapshot = resolveGameMode({
    appConfig: args.appConfig,
    gameModeRegistry: args.gameModeRegistry,
    pointer: args.session.gameMode,
  });

  const ok = isAllowedByGate({
    gate: gameModeSnapshot.formatGate,
    format: { formatId: formatSnapshot.formatId, formatVersion: formatSnapshot.formatVersion },
  });

  if (!ok) {
    throw new Error(
      `SESSION_GATE_REJECTED: gameMode ${gameModeSnapshot.gameModeId}@${gameModeSnapshot.gameModeVersion} disallows format ${ptrKey({
        formatId: formatSnapshot.formatId,
        formatVersion: formatSnapshot.formatVersion,
      })}`
    );
  }

  return { formatSnapshot, gameModeSnapshot };
}
