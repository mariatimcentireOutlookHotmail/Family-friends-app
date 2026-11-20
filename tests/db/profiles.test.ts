/// <reference types="node" />
/**
 * Privacy-rule tests for profiles. Each test runs in a transaction that is
 * rolled back.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, createTestDb } from "./testDb";

const alice = "00000000-0000-4000-8000-00000000000a";
const bob = "00000000-0000-4000-8000-00000000000b";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  // Signing up = a new row in auth.users; the trigger should add a profile.
  await db.exec(`
    insert into auth.users (id, email) values
      ('${alice}', 'alice@example.com'), ('${bob}', 'bob@example.com');
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("begin");
});

afterEach(async () => {
  await db.exec("rollback");
});

async function query<T = Record<string, unknown>>(actor: string, sql: string, params: unknown[] = []) {
  return as(db, actor, async () => db.query<T>(sql, params));
}

describe("profiles", () => {
  it("are created automatically when someone signs up", async () => {
    const { rows } = await query("admin", "select id, locale from public.profiles order by id");
    expect(rows).toEqual([
      { id: alice, locale: null },
      { id: bob, locale: null },
    ]);
  });

  it("each user sees only their own profile", async () => {
    const { rows } = await query(alice, "select id from public.profiles");
    expect(rows).toEqual([{ id: alice }]);
  });

  it("signed-out visitors can't read profiles", async () => {
    await expect(query("anon", "select * from public.profiles")).rejects.toThrow(/permission denied/);
  });

  it("users can change their own language, not someone else's", async () => {
    const own = await query(alice, "update public.profiles set locale = 'id' where id = $1", [alice]);
    expect(own.affectedRows).toBe(1);
    const other = await query(alice, "update public.profiles set locale = 'id' where id = $1", [bob]);
    expect(other.affectedRows).toBe(0);
    const { rows } = await query("admin", "select locale from public.profiles where id = $1", [bob]);
    expect(rows).toEqual([{ locale: null }]);
  });

  it("only supported languages are accepted", async () => {
    await expect(
      query(alice, "update public.profiles set locale = 'fr' where id = $1", [alice]),
    ).rejects.toThrow(/check constraint/);
  });

  it("users can't create, delete or take over profiles", async () => {
    await expect(
      query(alice, "insert into public.profiles (id) values ($1)", [alice]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      query(alice, "delete from public.profiles where id = $1", [alice]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      query(alice, "update public.profiles set id = $1 where id = $2", [bob, alice]),
    ).rejects.toThrow(/cannot change|duplicate key|row-level security/);
  });

  it("deleting an account deletes its profile", async () => {
    await query("admin", "delete from auth.users where id = $1", [bob]);
    const { rows } = await query("admin", "select id from public.profiles where id = $1", [bob]);
    expect(rows).toHaveLength(0);
  });
});
