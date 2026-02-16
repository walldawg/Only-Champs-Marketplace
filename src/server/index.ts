// src/server/index.ts
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";

import { registerGamesRoutes } from "./games.routes";
import { registerDecksRoutes } from "./decks.routes";
import { registerDecksUiRoutes } from "./decks.ui.routes";
import * as catalog from "./catalog.routes";
import { registerMarketplaceRoutes } from "./marketplace/marketplace.routes";
import { registerEngineMatchRoutes } from "./engineMatch.routes.v1";
import { registerTournamentRoutesV1 } from "./tournaments.routes.v1";
import { registerSponsorPoolRoutesV1 } from "./sponsorPools.routes.v1";
import { registerBoBucksRoutesV1 } from "./bobucks.routes.v1";
import { registerRulesRoutesV1 } from "./rules.routes";

const app = Fastify({ logger: true });
const prisma = new PrismaClient();

// Catalog route export compatibility:
// Some branches export `registerCatalogRoutes`, others export `catalogRoutes`.
const registerCatalogRoutesFn = () => {
  const candidate = (catalog as any).registerCatalogRoutes ?? (catalog as any).catalogRoutes;
  if (typeof candidate !== "function") {
    throw new Error("Catalog routes module missing export: registerCatalogRoutes or catalogRoutes");
  }
  return candidate as (app: any) => Promise<void>;
};

async function main() {
  await registerCatalogRoutesFn()(app);

  // Deck API + UI surfaces
  await registerDecksRoutes(app);
  await registerDecksUiRoutes(app);

  // Prisma-owned routes
  await registerGamesRoutes(app, prisma);
  await registerEngineMatchRoutes(app, prisma);
  await registerTournamentRoutesV1(app, prisma);
  await registerSponsorPoolRoutesV1(app, prisma);
  await registerBoBucksRoutesV1(app, prisma);
  await registerRulesRoutesV1(app, prisma);

  await registerMarketplaceRoutes(app, prisma, {
    basePath: "/market",
    getActorUserId: (req) => (req.headers["x-user-id"] as string) ?? null,
  });

  await app.listen({ port: 3000, host: "127.0.0.1" });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
