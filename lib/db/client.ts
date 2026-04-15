import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Serverless-safe connection pool
// Netlify Functions are stateless — limit connections to avoid exhausting the DB
const connectionString = process.env.DATABASE_URL;

// SSL: only enforce in environments that explicitly opt in via env var.
// Many self-hosted Postgres instances (e.g. Easypanel) terminate SSL at the
// proxy layer and expose plain TCP internally.
const useSSL = process.env.DATABASE_SSL === "require";

const client = postgres(connectionString, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: useSSL ? "require" : false,
});

export const db = drizzle(client, { schema });
export type Database = typeof db;
