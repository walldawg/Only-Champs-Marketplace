// src/server/modeRegistry.ts
export const MODE_CODES = ["ROOKIE", "SUBSTITUTION", "PLAYMAKER"] as const;

export type ModeCode = (typeof MODE_CODES)[number];

export function isKnownMode(modeCode: unknown): modeCode is ModeCode {
  return typeof modeCode === "string" && (MODE_CODES as readonly string[]).includes(modeCode);
}
