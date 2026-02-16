// src/server/rules.routes.ts
// RuleSet + ModeRuleBinding HTTP v1
// - RuleSets are immutable-intent snapshots (upserted by key+version).
// - ModeRuleBinding maps a modeKey -> (ruleSetKey, ruleSetVersion).
// No gameplay authority.

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

function asInt(x: any, fallback: number): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function asString(x: any, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

export async function registerRulesRoutesV1(app: FastifyInstance, prisma: PrismaClient) {
  // -------------------------------
  // POST /rulesets
  // Body: { key: string, version: number, status?: "ACTIVE"|"DRAFT"|"DEPRECATED", rulesJson: any }
  // Upserts the RuleSet (key+version). Intended for admin/tooling only.
  // -------------------------------
  app.post("/rulesets", async (req: any, reply) => {
    try {
      const body = req.body ?? {};
      const key = asString(body.key);
      const version = asInt(body.version, NaN as any);
      if (!key) return reply.code(400).send({ error: "bad_request", message: "key required" });
      if (!Number.isFinite(version)) return reply.code(400).send({ error: "bad_request", message: "version required" });

      const statusRaw = asString(body.status, "ACTIVE").toUpperCase();
      const status = statusRaw === "DRAFT" ? "DRAFT" : statusRaw === "DEPRECATED" ? "DEPRECATED" : "ACTIVE";

      const rulesJson = body.rulesJson ?? {};
      const stored = await (prisma as any).ruleSet.upsert({
        where: { key_version: { key, version } },
        create: { key, version, status, rulesJson },
        update: { status, rulesJson },
      });

      return reply.send({
        ok: true,
        stored: { id: stored.id, key: stored.key, version: stored.version, status: stored.status, updatedAt: stored.updatedAt },
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  // -------------------------------
  // GET /rulesets/:key/:version
  // -------------------------------
  app.get("/rulesets/:key/:version", async (req: any, reply) => {
    const key = String((req.params as any).key ?? "");
    const version = Number((req.params as any).version ?? NaN);

    if (!key || !Number.isFinite(version)) {
      return reply.code(400).send({ error: "bad_request" });
    }

    const rs = await (prisma as any).ruleSet.findUnique({
      where: { key_version: { key, version } },
    });

    if (!rs) return reply.code(404).send({ error: "ruleset_not_found" });

    return reply.send({
      ok: true,
      ruleset: {
        id: rs.id,
        key: rs.key,
        version: rs.version,
        status: rs.status,
        rulesJson: rs.rulesJson,
        createdAt: rs.createdAt,
        updatedAt: rs.updatedAt,
      },
    });
  });

  // -------------------------------
  // POST /modes/:modeKey/ruleset
  // Body: { ruleSetKey: string, ruleSetVersion: number }
  // Upserts the binding (modeKey unique).
  // -------------------------------
  app.post("/modes/:modeKey/ruleset", async (req: any, reply) => {
    try {
      const modeKey = String((req.params as any).modeKey ?? "");
      if (!modeKey) return reply.code(400).send({ error: "bad_request", message: "modeKey required" });

      const body = req.body ?? {};
      const ruleSetKey = asString(body.ruleSetKey);
      const ruleSetVersion = asInt(body.ruleSetVersion, NaN as any);
      if (!ruleSetKey) return reply.code(400).send({ error: "bad_request", message: "ruleSetKey required" });
      if (!Number.isFinite(ruleSetVersion)) return reply.code(400).send({ error: "bad_request", message: "ruleSetVersion required" });

      // Ensure referenced RuleSet exists (avoid binding to nothing).
      const exists = await (prisma as any).ruleSet.findUnique({
        where: { key_version: { key: ruleSetKey, version: ruleSetVersion } },
        select: { id: true },
      });
      if (!exists) return reply.code(404).send({ error: "ruleset_not_found", ruleSetKey, ruleSetVersion });

      const stored = await (prisma as any).modeRuleBinding.upsert({
        where: { modeKey },
        create: { modeKey: modeKey.toUpperCase(), ruleSetKey, ruleSetVersion },
        update: { ruleSetKey, ruleSetVersion },
      });

      return reply.send({
        ok: true,
        binding: {
          id: stored.id,
          modeKey: stored.modeKey,
          ruleSetKey: stored.ruleSetKey,
          ruleSetVersion: stored.ruleSetVersion,
          updatedAt: stored.updatedAt,
        },
      });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e?.message ?? "BAD_REQUEST" });
    }
  });

  // -------------------------------
  // GET /modes/:modeKey/ruleset
  // -------------------------------
  app.get("/modes/:modeKey/ruleset", async (req: any, reply) => {
    const modeKey = String((req.params as any).modeKey ?? "").toUpperCase();
    if (!modeKey) return reply.code(400).send({ error: "bad_request" });

    const binding = await (prisma as any).modeRuleBinding.findUnique({ where: { modeKey } });
    if (!binding) return reply.code(404).send({ error: "mode_ruleset_not_bound" });

    return reply.send({
      ok: true,
      binding: {
        modeKey: binding.modeKey,
        ruleSetKey: binding.ruleSetKey,
        ruleSetVersion: binding.ruleSetVersion,
      },
    });
  });
}
