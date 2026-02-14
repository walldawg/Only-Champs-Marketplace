import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * LFBO Phase 8C — RuleSet-driven validation adapter (non-breaking)
 * Adds a parallel endpoint that validates using RuleSet JSON instead of modeRegistry.
 * Does NOT modify existing validation logic.
 *
 * Endpoint:
 *  POST /modes/:modeKey/validate-deck-ruleset
 *
 * Payload (8C adapter test payload):
 *  { "deck": [ { "type": "HERO" }, ... ] }
 */
export async function ruleSetValidationRoutes(app: FastifyInstance) {
  app.post("/modes/:modeKey/validate-deck-ruleset", async (req, reply) => {
    const { modeKey } = req.params as { modeKey: string };
    const body = (req.body ?? {}) as any;

    const deck = Array.isArray(body.deck) ? body.deck : null;
    if (!deck) {
      return reply.status(400).send({ error: "Expected body.deck as an array" });
    }

    const binding = await prisma.modeRuleBinding.findUnique({
      where: { modeKey },
    });

    if (!binding) {
      return reply.status(404).send({ error: "No RuleSet bound to this mode" });
    }

    const ruleset = await prisma.ruleSet.findUnique({
      where: {
        key_version: {
          key: binding.ruleSetKey,
          version: binding.ruleSetVersion,
        },
      },
    });

    if (!ruleset) {
      return reply.status(404).send({ error: "Bound RuleSet not found" });
    }

    const rules = ruleset.rulesJson as any;

    const errors: string[] = [];

    if (rules.deckSize && deck.length !== rules.deckSize) {
      errors.push(`Deck must contain exactly ${rules.deckSize} cards`);
    }

    if (rules.allowedTypes) {
      for (const card of deck) {
        const t = (card as any)?.type;
        if (t && !rules.allowedTypes.includes(t)) {
          errors.push(`Card type ${t} not allowed in this mode`);
        }
      }
    }

    return {
      modeKey,
      ruleSetKey: ruleset.key,
      ruleSetVersion: ruleset.version,
      status: ruleset.status,
      valid: errors.length === 0,
      errors,
    };
  });
}
