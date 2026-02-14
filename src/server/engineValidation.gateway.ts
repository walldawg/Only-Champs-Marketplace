import type { PrismaClient } from "@prisma/client";

/**
 * LFBO Phase 8D — Engine readiness validation gateway (non-breaking)
 *
 * Goal:
 *  - Allow engine routes to enforce deck validity via RuleSet data (ModeRuleBinding -> RuleSet).
 *  - If no RuleSet is bound for the provided modeKey, validation is skipped (passes) to avoid behavior change.
 *
 * NOTE:
 *  - No gameplay logic changes.
 *  - Uses existing catalog (CardVersion.conceptType) for type checks.
 */

export type EngineDeckValidationResult = {
  ok: boolean;
  skipped: boolean;
  modeKey: string;
  ruleSet?: { key: string; version: number; status: string };
  errors: Array<{
    deckId: string;
    messages: string[];
  }>;
};

export async function validateDecksForModeRuleSet(opts: {
  prisma: PrismaClient;
  modeKey: string;
  deckIds: string[];
}): Promise<EngineDeckValidationResult> {
  const { prisma, modeKey, deckIds } = opts;

  const errors: EngineDeckValidationResult["errors"] = [];

  // Resolve binding
  const binding = await (prisma as any).modeRuleBinding.findUnique({
    where: { modeKey },
  });

  if (!binding) {
    return { ok: true, skipped: true, modeKey, errors };
  }

  const ruleset = await (prisma as any).ruleSet.findUnique({
    where: {
      key_version: {
        key: binding.ruleSetKey,
        version: binding.ruleSetVersion,
      },
    },
  });

  if (!ruleset) {
    // Binding exists but ruleset missing — treat as hard error (system integrity)
    return {
      ok: false,
      skipped: false,
      modeKey,
      ruleSet: { key: binding.ruleSetKey, version: binding.ruleSetVersion, status: "MISSING" },
      errors: deckIds.map((deckId) => ({
        deckId,
        messages: ["Bound RuleSet not found"],
      })),
    };
  }

  const rules = (ruleset.rulesJson ?? {}) as any;
  const deckSize = typeof rules.deckSize === "number" ? rules.deckSize : null;
  const allowedTypes = Array.isArray(rules.allowedTypes) ? rules.allowedTypes.map(String) : null;

  // Load decks + cards
  const decks = await (prisma as any).deck.findMany({
    where: { id: { in: deckIds } },
    select: {
      id: true,
      cards: { select: { versionKey: true, qty: true } },
    },
  });

  const found = new Map(decks.map((d: any) => [d.id, d]));
  for (const deckId of deckIds) {
    if (!found.has(deckId)) {
      errors.push({ deckId, messages: ["Deck not found"] });
    }
  }

  // Collect all version keys for catalog lookup
  const allVersionKeys: string[] = [];
  for (const d of decks) {
    for (const c of d.cards ?? []) allVersionKeys.push(String(c.versionKey));
  }

  const versions = allVersionKeys.length
    ? await (prisma as any).cardVersion.findMany({
        where: { versionKey: { in: allVersionKeys } },
        select: { versionKey: true, conceptType: true },
      })
    : [];

  const byVersionKey = new Map(versions.map((v: any) => [v.versionKey, v]));

  for (const d of decks) {
    const msgs: string[] = [];
    const totalCards = (d.cards ?? []).reduce((sum: number, c: any) => sum + (c.qty ?? 0), 0);

    if (deckSize !== null && totalCards !== deckSize) {
      msgs.push(`Deck must contain exactly ${deckSize} cards`);
    }

    if (allowedTypes) {
      for (const c of d.cards ?? []) {
        const v = byVersionKey.get(c.versionKey);
        if (!v) {
          msgs.push(`Catalog missing versionKey ${c.versionKey}`);
          continue;
        }
        const t = String(v.conceptType ?? "");
        if (t && !allowedTypes.includes(t)) {
          msgs.push(`Card type ${t} not allowed in this mode`);
        }
      }
    }

    if (msgs.length) errors.push({ deckId: d.id, messages: msgs });
  }

  return {
    ok: errors.length === 0,
    skipped: false,
    modeKey,
    ruleSet: { key: ruleset.key, version: ruleset.version, status: ruleset.status },
    errors,
  };
}
