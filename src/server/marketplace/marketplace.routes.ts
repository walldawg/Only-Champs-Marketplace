// Marketplace Engine routes (API only, no UI)
// Design:
// - Catalog is read-only; all pointers use versionKey.
// - Ownership can exist unverified.
// - Verification is required to expose availability, list, and transfer.
// - Hidden profiles expose ONLY AVAILABLE_* items (enforced at query layer).
//
// NOTE: These route modules are framework-agnostic about how Prisma is attached.
// They export register functions that take (app, prisma, opts). Wire them into your server.

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

import { registerOwnershipRoutes } from "./ownership.routes";
import { registerVerificationRoutes } from "./verifications.routes";
import { registerInventoryVisibilityRoutes } from "./visibility.routes";
import { registerListingsRoutes } from "./listings.routes";
import { registerOrdersRoutes } from "./orders.routes";

export type MarketplaceRegisterOptions = {
  basePath?: string; // default "/market"
  // Provide a function to resolve the acting user id for auth (replace with your auth middleware).
  // If not provided, routes will require `x-user-id` header for write ops.
  getActorUserId?: (req: any) => string | null;
  // Optional: resolve whether a profile is hidden (privacy). If not provided, assumes PUBLIC.
  isProfileHidden?: (userId: string) => Promise<boolean>;
};

export async function registerMarketplaceRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  opts: MarketplaceRegisterOptions = {}
) {
  const basePath = opts.basePath ?? "/market";

  await app.register(async (subApp) => {
    registerOwnershipRoutes(subApp, prisma, opts);
    registerVerificationRoutes(subApp, prisma, opts);
    registerInventoryVisibilityRoutes(subApp, prisma, opts);
    registerListingsRoutes(subApp, prisma, opts);
    registerOrdersRoutes(subApp, prisma, opts);
  }, { prefix: basePath });
}
