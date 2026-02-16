// Marketplace Engine routes (API only, no UI)
// Design:
// - Catalog is read-only; all pointers use versionKey.
// - Ownership can exist unverified.
// - Verification is required to expose availability, list, and transfer.
// - Hidden profiles expose ONLY AVAILABLE_* items (enforced at query layer).
//
// NOTE: These route modules are framework-agnostic about how Prisma is attached.
// They export register functions that take (app, prisma, opts). Wire them into your server.

import type { FastifyReply, FastifyRequest } from "fastify";

export function requireActorUserId(
  req: FastifyRequest,
  reply: FastifyReply,
  getActorUserId?: (req: any) => string | null
): string | null {
  const actor = getActorUserId ? getActorUserId(req) : null;
  const headerActor = (req.headers["x-user-id"] as string | undefined) ?? null;
  const userId = actor ?? headerActor;
  if (!userId) {
    reply.code(401).send({ error: "UNAUTHORIZED", message: "Missing actor user id (provide x-user-id header or wire auth)." });
    return null;
  }
  return userId;
}

export function assertInt(n: any, name: string): number {
  const v = Number(n);
  if (!Number.isInteger(v)) throw new Error(`${name} must be an integer`);
  return v;
}

export function assertNonEmptyString(v: any, name: string): string {
  if (typeof v !== "string" || v.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return v.trim();
}

export function nowIso() {
  return new Date().toISOString();
}
