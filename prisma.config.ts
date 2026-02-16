import { defineConfig } from "prisma/config";
import "dotenv/config";

// IMPORTANT:
// SQLite file paths are resolved relative to the schema location (./prisma).
// We standardize on repo-root ./dev.db by using file:../dev.db.
const url = process.env.DATABASE_URL ?? "file:../dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
