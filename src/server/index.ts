// src/server/index.ts
import Fastify from "fastify";
import cors from "@fastify/cors";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";

async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // health
  app.get("/health", async () => {
    return { status: "ok" as const };
  });

  // Placeholder: routes will be registered here later (catalog/decks/games/etc.)
  // app.register(catalogRoutes)
  // app.register(decksRoutes)
  // app.register(gamesRoutes)

  return app;
}

async function main() {
  const app = await buildApp();

  // Clean shutdown
  const shutdown = async (signal: string) => {
    try {
      app.log.info({ signal }, "shutdown: start");
      await app.close();
      app.log.info("shutdown: complete");
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "shutdown: failed");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error({ err }, "server failed to start");
    process.exit(1);
  }
}

void main();
