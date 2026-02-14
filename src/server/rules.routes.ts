import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * LFBO Phase 8B (Rule Encoding Readiness) — Read-only rule retrieval routes.
 * No gameplay changes. No writes. Pure data surfacing.
 */
export async function rulesRoutes(app: FastifyInstance) {
  // Preflight: if Prisma Client was generated without these models, fail fast with a clear error.
  const hasRuleSet = typeof (prisma as any).ruleSet !== "undefined";
  const hasModeRuleBinding = typeof (prisma as any).modeRuleBinding !== "undefined";

  if (!hasRuleSet || !hasModeRuleBinding) {
    app.log.error(
      {
        hasRuleSet,
        hasModeRuleBinding,
        prismaKeysSample: Object.keys(prisma).slice(0, 50),
      },
      "Prisma Client missing delegates for RuleSet/ModeRuleBinding. Run `npx prisma generate` and fully restart the server process."
    );
  }

  // -------------------------------------------------------
  // GET /rulesets/:key/:version
  // -------------------------------------------------------
  app.get("/rulesets/:key/:version", async (req, reply) => {
    if (typeof (prisma as any).ruleSet === "undefined") {
      return reply.status(500).send({
        error: "prisma_client_missing_delegate",
        delegate: "ruleSet",
        hint: "Run `npx prisma generate` and fully restart the server process.",
      });
    }

    const { key, version } = req.params as { key: string; version: string };

    const parsedVersion = parseInt(version, 10);
    if (Number.isNaN(parsedVersion)) {
      return reply.status(400).send({ error: "Invalid version number" });
    }

    const ruleset = await (prisma as any).ruleSet.findUnique({
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
    if (typeof (prisma as any).modeRuleBinding === "undefined") {
      return reply.status(500).send({
        error: "prisma_client_missing_delegate",
        delegate: "modeRuleBinding",
        hint: "Run `npx prisma generate` and fully restart the server process.",
      });
    }
    if (typeof (prisma as any).ruleSet === "undefined") {
      return reply.status(500).send({
        error: "prisma_client_missing_delegate",
        delegate: "ruleSet",
        hint: "Run `npx prisma generate` and fully restart the server process.",
      });
    }

    const { modeKey } = req.params as { modeKey: string };

    const binding = await (prisma as any).modeRuleBinding.findUnique({
      where: { modeKey },
    });

    if (!binding) {
      return reply.status(404).send({ error: "No RuleSet bound to this mode" });
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
