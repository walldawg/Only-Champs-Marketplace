// src/server/index.ts
import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";

import { registerGamesRoutes } from "./games.routes";
import { registerDecksRoutes } from "./decks.routes";
import { registerCatalogRoutes } from "./catalog.routes";
import { registerMarketplaceRoutes } from "./marketplace/marketplace.routes";

const app = Fastify({ logger: true });
const prisma = new PrismaClient();

async function main() {
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok" }));

  await registerCatalogRoutes(app);
  await registerDecksRoutes(app);
  await registerGamesRoutes(app);
  await registerMarketplaceRoutes(app, prisma, {
    basePath: "/market",
    getActorUserId: (req) => (req.headers["x-user-id"] as string) ?? null,
    isProfileHidden: async () => false,
  });

  // ===============================
  // WALLET + SIMULATION (Playable Loop v1)
  // ===============================

  const requireUserId = (req: any) => {
    const userId = (req.headers["x-user-id"] as string) ?? null;
    if (!userId) throw new Error("USER_REQUIRED");
    return userId;
  };

  // -------------------------------
  // WALLET ACTIVATE
  // -------------------------------
  app.post("/wallet/activate", async (req, reply) => {
    try {
      const userId = requireUserId(req);

      const existing = await prisma.wallet.findUnique({ where: { userId } });
      if (existing) return reply.send({ message: "WALLET_ALREADY_EXISTS" });

      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.create({
          data: {
            userId,
            assets: {
              create: { assetType: "EARNED", balance: 20 },
            },
          },
          include: { assets: true },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            assetType: "EARNED",
            amount: 20,
            reason: "WALLET_ACTIVATION",
          },
        });

        return wallet;
      });

      return reply.send({
        message: "WALLET_CREATED",
        bonus: 20,
        walletId: result.id,
      });
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // -------------------------------
  // WALLET SUMMARY
  // -------------------------------
  app.get("/wallet", async (req, reply) => {
    try {
      const userId = requireUserId(req);
      const wallet = await prisma.wallet.findUnique({
        where: { userId },
        include: { assets: true },
      });
      if (!wallet) return reply.code(404).send({ error: "WALLET_NOT_FOUND" });
      return reply.send(wallet);
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // -------------------------------
  // DEV TOPUP (reason is enum, so pin to ADMIN_ADJUST)
  // -------------------------------
  app.post("/wallet/dev/topup", async (req: any, reply) => {
    try {
      const userId = requireUserId(req);
      const assetType = String(req.body?.assetType ?? "EARNED");
      const amount = Number(req.body?.amount ?? 0);

      if (!["EARNED", "BONUS", "PAID"].includes(assetType)) {
        return reply.code(400).send({ error: "BAD_REQUEST" });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return reply.code(400).send({ error: "BAD_REQUEST" });
      }

      const wallet = await prisma.wallet.findUnique({
        where: { userId },
        include: { assets: true },
      });
      if (!wallet) throw new Error("WALLET_REQUIRED");

      const existing = wallet.assets.find((a) => a.assetType === assetType);

      const updated = await prisma.$transaction(async (tx) => {
        const asset = existing
          ? await tx.walletAsset.update({
              where: { id: existing.id },
              data: { balance: { increment: amount } },
            })
          : await tx.walletAsset.create({
              data: {
                walletId: wallet.id,
                assetType: assetType as any,
                balance: amount,
              },
            });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            assetType: assetType as any,
            amount,
            reason: "ADMIN_ADJUST",
          },
        });

        return asset;
      });

      return reply.send({
        message: "TOPUP_OK",
        assetType,
        amount,
        balance: updated.balance,
      });
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // -------------------------------
  // SIMULATION (Atomic Spend Test)
  // -------------------------------
  app.post("/simulate", async (req: any, reply) => {
    try {
      const userId = requireUserId(req);

      const numMatches = Number(req.body?.numMatches ?? 25);
      const numOpponentDecks = Number(req.body?.numOpponentDecks ?? 1);
      const depth = Number(req.body?.depth ?? 1);

      if (numMatches <= 0) throw new Error("BAD_REQUEST");
      if (numOpponentDecks <= 0) throw new Error("BAD_REQUEST");
      if (depth <= 0) throw new Error("BAD_REQUEST");

      const computeUnits = numMatches * numOpponentDecks + depth * 50;
      const bobuxCost = Math.ceil(computeUnits / 100);

      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId },
          include: { assets: true },
        });
        if (!wallet) throw new Error("WALLET_REQUIRED");

        const spendOrder = ["EARNED", "BONUS", "PAID"] as const;

        const totalAvailable = spendOrder.reduce((sum, t) => {
          const a = wallet.assets.find((x) => x.assetType === t);
          return sum + (a?.balance ?? 0);
        }, 0);

        if (totalAvailable < bobuxCost) throw new Error("INSUFFICIENT_BOBUX");

        let remaining = bobuxCost;

        for (const assetType of spendOrder) {
          if (remaining <= 0) break;

          const asset = wallet.assets.find((a) => a.assetType === assetType);
          if (!asset) continue;

          const deduct = Math.min(asset.balance, remaining);
          if (deduct <= 0) continue;

          await tx.walletAsset.update({
            where: { id: asset.id },
            data: { balance: { decrement: deduct } },
          });

          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              assetType,
              amount: -deduct,
              reason: "SIMULATION_SPEND",
            },
          });

          remaining -= deduct;
        }

        const job = await tx.simulationJob.create({
          data: {
            userId,
            mode: "STANDARD",
            status: "COMPLETE",
            cu: computeUnits,
            estimatedBobux: bobuxCost,
            inputJson: req.body ?? {},
          },
        });

        return { jobId: job.id };
      });

      return reply.send({
        message: "SIMULATION_COMPLETE",
        bobuxCost,
        computeUnits,
        jobId: result.jobId,
      });
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  const port = 3000;
  const host = "127.0.0.1";
  await app.listen({ port, host });
  app.log.info(`server listening on http://${host}:${port}`);
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
