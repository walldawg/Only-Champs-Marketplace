import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * LFBO Phase 8B (Rule Encoding Readiness) — Read-only rule retrieval routes.
 * No gameplay changes. No writes. Pure data surfacing.
 */
export async function rulesRoutes(app: FastifyInstance) {
  // -------------------------------------------------------
  // GET /rulesets/:key/:version
  // -------------------------------------------------------
  app.get("/rulesets/:key/:version", async (req, reply) => {
    const { key, version } = req.params as { key: string; version: string };

    const parsedVersion = parseInt(version, 10);
    if (Number.isNaN(parsedVersion)) {
      return reply.status(400).send({ error: "Invalid version number" });
    }

    const ruleset = await prisma.ruleSet.findUnique({
      where: {
        key_version: {
          key,
          version: parsedVersion,
        },
      },
    });

    if (!ruleset) {
      return reply.status(404).send({ error: "RuleSet not found" });
    }

    return {
      key: ruleset.key,
      version: ruleset.version,
      status: ruleset.status,
      rulesJson: ruleset.rulesJson,
    };
  });

  // -------------------------------------------------------
  // GET /modes/:modeKey/ruleset
  // -------------------------------------------------------
  app.get("/modes/:modeKey/ruleset", async (req, reply) => {
    const { modeKey } = req.params as { modeKey: string };

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

    return {
      modeKey,
      ruleSetKey: ruleset.key,
      ruleSetVersion: ruleset.version,
      status: ruleset.status,
      rulesJson: ruleset.rulesJson,
    };
  });
}
