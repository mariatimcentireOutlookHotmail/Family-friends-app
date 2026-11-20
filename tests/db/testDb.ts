/// <reference types="node" />
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

/**
 * A fresh in-memory Postgres with Supabase's basics (tests/db/supabase-stub.sql)
 * and every migration in supabase/migrations applied in order.
 */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

/**
 * Who a query runs as:
 *  - a user id: a signed-in app user (like a request with their login token)
 *  - "anon": a signed-out visitor
 *  - "admin": the database owner, bypassing all rules (for setting up data)
 */
export type Actor = string | "anon" | "admin";

/**
 * Run fn as the given actor. Settings are local to the current transaction,
 * so call this inside a test that runs in a transaction (see rls.test.ts).
 */
export async function as<T>(db: PGlite, actor: Actor, fn: () => Promise<T>): Promise<T> {
  // A savepoint lets a test check that something fails, then carry on: on an
  // error we roll back to it, which also undoes the role switch.
  await db.exec("reset role; savepoint as_actor");
  try {
    if (actor === "admin") {
      await db.query("select set_config('request.jwt.claims', '', true)");
    } else if (actor === "anon") {
      await db.query("select set_config('request.jwt.claims', '', true)");
      await db.exec("set local role anon");
    } else {
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: actor, role: "authenticated" }),
      ]);
      await db.exec("set local role authenticated");
    }
    const result = await fn();
    await db.exec("reset role; release savepoint as_actor");
    return result;
  } catch (e) {
    await db.exec("rollback to savepoint as_actor; reset role");
    throw e;
  }
}
