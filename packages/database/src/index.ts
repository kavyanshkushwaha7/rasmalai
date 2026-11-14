import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client";
import { getVerifiedSupabaseUserId } from "./supabase-auth";

export type DatabaseTransaction = Prisma.TransactionClient;

const globalForPrisma = globalThis as unknown as { rasmalaiPrisma?: PrismaClient };

function findProjectRoot() {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, "packages/database/prisma/schema.prisma"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("Could not locate the project root to resolve the database CA certificate.");
}

function getVerifiedConnectionConfig(connectionString: string) {
  const url = new URL(connectionString);
  if (url.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("DATABASE_URL must set sslmode=verify-full.");
  }
  const configuredCaPath = url.searchParams.get("sslrootcert");
  if (!configuredCaPath) {
    throw new Error("DATABASE_URL must set sslrootcert to the Supabase CA certificate path.");
  }

  const caPath = isAbsolute(configuredCaPath)
    ? configuredCaPath
    : resolve(findProjectRoot(), configuredCaPath);
  const ca = readFileSync(caPath, "utf8");
  if (!ca.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("The DATABASE_URL sslrootcert file is not a PEM certificate.");
  }

  // node-postgres replaces its SSL object when SSL URL parameters are present.
  // Remove them after loading the CA, then enforce verified TLS in the adapter.
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to access Rasmalai profile data.");
  }
  const connection = getVerifiedConnectionConfig(connectionString);

  return new PrismaClient({
    adapter: new PrismaPg(connection),
  });
}

function getPrisma() {
  if (!globalForPrisma.rasmalaiPrisma) {
    globalForPrisma.rasmalaiPrisma = createPrismaClient();
  }
  return globalForPrisma.rasmalaiPrisma;
}

export async function withAuthenticatedUser<T>(
  accessToken: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  const userId = await getVerifiedSupabaseUserId(accessToken);

  return getPrisma().$transaction(async (transaction) => {
    await transaction.$executeRaw`SET LOCAL ROLE authenticated`;
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await transaction.$queryRaw`SELECT set_config('request.jwt.claims', ${claims}, true)`;
    return operation(transaction);
  }, { maxWait: 5000, timeout: 15000 });
}

/**
 * Establish a verified Supabase identity for trusted realtime RPCs. Unlike
 * withAuthenticatedUser, this intentionally keeps the login role as `prisma`;
 * server-only game and social RPCs are granted to that role, while
 * browser-facing authenticated users retain read-only RLS access.
 */
export async function withRealtimeUser<T>(
  accessToken: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  const userId = await getVerifiedSupabaseUserId(accessToken);

  return getPrisma().$transaction(async (transaction) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await transaction.$queryRaw`SELECT set_config('request.jwt.claims', ${claims}, true)`;
    return operation(transaction);
  }, { maxWait: 5000, timeout: 15000 });
}

export const isDatabaseConfigured = () => {
  if (!process.env.DATABASE_URL) return false;
  try {
    getVerifiedConnectionConfig(process.env.DATABASE_URL);
    return true;
  } catch {
    return false;
  }
};
