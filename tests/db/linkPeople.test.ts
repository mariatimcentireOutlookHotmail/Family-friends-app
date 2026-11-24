/// <reference types="node" />
/**
 * Tests for link_people (connecting people already in the tree).
 * Each test runs in a transaction that is rolled back.
 *
 * Tan tree: alice owner, bob editor, cara viewer; dan outsider.
 * People: me, dad (my parent), grandpa (dad's parent), uncle (added as dad's
 * sibling only), aunt, and other (in another tree).
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, createTestDb } from "./testDb";

const alice = "00000000-0000-4000-8000-00000000000a";
const bob = "00000000-0000-4000-8000-00000000000b";
const cara = "00000000-0000-4000-8000-00000000000c";
const dan = "00000000-0000-4000-8000-00000000000d";

const tan = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const me = "20000000-0000-4000-8000-000000000001";
const dad = "20000000-0000-4000-8000-000000000002";
const grandpa = "20000000-0000-4000-8000-000000000003";
const uncle = "20000000-0000-4000-8000-000000000004";
const aunt = "20000000-0000-4000-8000-000000000005";
const stranger = "20000000-0000-4000-8000-000000000009";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${alice}', 'a@x.com'), ('${bob}', 'b@x.com'), ('${cara}', 'c@x.com'), ('${dan}', 'd@x.com');
    insert into public.trees (id, name, created_by) values
      ('${tan}', 'Tan family', '${alice}'), ('${other}', 'Other', '${dan}');
    insert into public.tree_members (tree_id, user_id, role) values
      ('${tan}', '${bob}', 'editor'), ('${tan}', '${cara}', 'viewer');
    insert into public.persons (id, tree_id, sex, living_status) values
      ('${me}', '${tan}', 'female', 'living'), ('${dad}', '${tan}', 'male', 'living'),
      ('${grandpa}', '${tan}', 'male', 'deceased'), ('${uncle}', '${tan}', 'male', 'living'),
      ('${aunt}', '${tan}', 'female', 'living'), ('${stranger}', '${other}', 'male', 'living');
    insert into public.person_names (person_id, full_display, is_primary)
      select id, 'P ' || id, true from public.persons;
    insert into public.relationships (tree_id, person_a, person_b, type, subtype) values
      ('${tan}', '${dad}', '${me}', 'parent', 'biological'),
      ('${tan}', '${grandpa}', '${dad}', 'parent', 'biological'),
      ('${tan}', '${dad}', '${uncle}', 'sibling', 'full');
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

async function run<T = Record<string, unknown>>(actor: string, sql: string, params: unknown[] = []) {
  return as(db, actor, async () => db.query<T>(sql, params));
}
const link = (actor: string, person: string, relation: string, others: string[], subtype: string | null = "biological") =>
  run<{ n: number }>(actor, "select public.link_people($1, $2, $3::uuid[], $4::public.relationship_subtype) as n", [
    person,
    relation,
    `{${others.join(",")}}`,
    subtype,
  ]);
const isParentOf = async (parent: string, child: string) =>
  (await run("admin", "select 1 from public.relationships where type = 'parent' and person_a = $1 and person_b = $2", [parent, child])).rows.length === 1;

describe("link_people", () => {
  it("connects grandfather and uncle as father and son (either direction)", async () => {
    expect((await link(bob, uncle, "parent", [grandpa])).rows[0]!.n).toBe(1);
    expect(await isParentOf(grandpa, uncle)).toBe(true);
  });

  it("can make someone the parent of several children at once", async () => {
    await link(alice, grandpa, "child", [uncle, aunt]);
    expect(await isParentOf(grandpa, uncle)).toBe(true);
    expect(await isParentOf(grandpa, aunt)).toBe(true);
  });

  it("stores two-way links once, in a fixed order", async () => {
    await link(alice, aunt, "sibling", [dad], "full");
    const rows = (await run<{ a: string; b: string }>("admin", "select person_a as a, person_b as b from public.relationships where type = 'sibling' and $1 in (person_a, person_b)", [aunt])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.a < rows[0]!.b).toBe(true);
  });

  it("is all or nothing: a bad second link keeps the first from being added", async () => {
    // me can't be grandpa's parent (he'd be his own ancestor).
    await expect(link(alice, grandpa, "parent", [aunt, me])).rejects.toThrow(/own ancestor/);
    expect(await isParentOf(aunt, grandpa)).toBe(false);
  });

  it("refuses duplicates, self-links and people from other trees", async () => {
    await expect(link(alice, me, "parent", [dad])).rejects.toThrow();
    await expect(link(alice, me, "sibling", [me])).rejects.toThrow();
    await expect(link(alice, me, "friend", [stranger])).rejects.toThrow();
  });

  it("is for owners and editors only", async () => {
    await expect(link(cara, uncle, "parent", [grandpa])).rejects.toThrow();
    await expect(link(dan, uncle, "parent", [grandpa])).rejects.toThrow();
    expect(await isParentOf(grandpa, uncle)).toBe(false);
  });
});
