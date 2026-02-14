// src/server/index.ts
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";

import { registerGamesRoutes } from "./games.routes";
import { registerDecksRoutes } from "./decks.routes";
import { registerCatalogRoutes } from "./catalog.routes";
import { registerMarketplaceRoutes } from "./marketplace/marketplace.routes";
import { registerEngineMatchRoutes } from "./engineMatch.routes.v1";
import { registerTournamentRoutesV1 } from "./tournaments.routes.v1";
import { registerSponsorPoolRoutesV1 } from "./sponsorPools.routes.v1";
import { registerBoBucksRoutesV1 } from "./bobucks.routes.v1";

import { ruleSetValidationRoutes } from "./ruleSetValidation.routes";
const app = Fastify({ logger: true });
const prisma = new PrismaClient();

async function main() {
  await registerCatalogRoutes(app);
  await registerDecksRoutes(app);

  // Prisma-owned routes
  await registerGamesRoutes(app, prisma);
  await registerEngineMatchRoutes(app, prisma);
  await registerTournamentRoutesV1(app, prisma);
  await registerSponsorPoolRoutesV1(app, prisma);
  await registerBoBucksRoutesV1(app, prisma);

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

  app.register(ruleSetValidationRoutes);
