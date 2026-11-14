import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationUrl = process.env.DIRECT_URL;
if (migrationUrl) {
  const connection = new URL(migrationUrl);
  const configuredCaPath = connection.searchParams.get("sslrootcert");
  if (connection.searchParams.get("sslmode") !== "verify-full" || !configuredCaPath) {
    throw new Error("DIRECT_URL must set sslmode=verify-full and sslrootcert to the Supabase CA certificate path.");
  }
  const caPath = isAbsolute(configuredCaPath) ? configuredCaPath : resolve(projectRoot, configuredCaPath);
  if (!existsSync(caPath)) throw new Error("DIRECT_URL sslrootcert file does not exist at the configured path.");
  connection.searchParams.set("sslrootcert", caPath);
  process.env.DIRECT_URL = connection.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Prisma can validate/generate without a live database; set DIRECT_URL before migrations.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
});
