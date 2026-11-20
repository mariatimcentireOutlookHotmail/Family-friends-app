/// <reference types="node" />
/**
 * Tests for editing people (save_person), editing and removing links, and
 * deleting people. Each test runs in a transaction that is rolled back.
 *
 * Cast: alice owner, bob editor, cara viewer, erin viewer who claimed erinP,
 * dan outsider. People: grandpa, me (unclaimed), erinP (claimed by erin).
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, createTestDb } from "./testDb";

const alice = "00000000-0000-4000-8000-00000000000a";
const bob = "00000000-0000-4000-8000-00000000000b";
const cara = "00000000-0000-4000-8000-00000000000c";
const dan = "00000000-0000-4000-8000-00000000000d";
const erin = "00000000-0000-4000-8000-00000000000e";

const tanTree = "10000000-0000-4000-8000-000000000001";
const grandpa = "20000000-0000-4000-8000-000000000001";
const me = "20000000-0000-4000-8000-000000000003";
const erinP = "20000000-0000-4000-8000-000000000004";
const link1 = "30000000-0000-4000-8000-000000000001";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${alice}', 'a@x.com'), ('${bob}', 'b@x.com'), ('${cara}', 'c@x.com'),
      ('${dan}', 'd@x.com'), ('${erin}', 'e@x.com');
    insert into public.trees (id, name, created_by) values ('${tanTree}', 'Tan family', '${alice}');
    insert into public.tree_members (tree_id, user_id, role) values
      ('${tanTree}', '${bob}', 'editor'), ('${tanTree}', '${cara}', 'viewer'), ('${tanTree}', '${erin}', 'viewer');
    insert into public.persons (id, tree_id, claimed_by_user_id, sex, living_status) values
      ('${grandpa}', '${tanTree}', null, 'male', 'living'),
      ('${me}', '${tanTree}', null, 'unknown', 'living'),
      ('${erinP}', '${tanTree}', '${erin}', 'female', 'living');
    insert into public.person_names (person_id, full_display, is_primary) values
      ('${grandpa}', 'Wrong Name', true), ('${grandpa}', 'Old aka', false),
      ('${erinP}', 'Erin Tan', true);
    insert into public.relationships (id, tree_id, person_a, person_b, type, subtype) values
      ('${link1}', '${tanTree}', '${grandpa}', '${me}', 'parent', 'biological');
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

const SAVE = "select public.save_person($1, $2::jsonb, $3::public.sex, $4::public.living_status)";

function save(actor: string, person: string, names: unknown, sex = "male", living = "deceased") {
  return run(actor, SAVE, [person, JSON.stringify(names), sex, living]);
}

async function namesOf(person: string) {
  return (
    await run("admin", "select full_display, type, is_primary from public.person_names where person_id = $1 order by is_primary desc, full_display", [person])
  ).rows;
}

// -----------------------------------------------------------------------------
describe("save_person", () => {
  it("editors can fix an unclaimed person's names and details", async () => {
    await save(bob, grandpa, [
      { full_display: "陈大明", script: "Hani", type: "birth" },
      { full_display: "Tan Tai Ming", script: "Latn", type: "aka" },
    ]);
    expect(await namesOf(grandpa)).toEqual([
      { full_display: "陈大明", type: "birth", is_primary: true },
      { full_display: "Tan Tai Ming", type: "aka", is_primary: false },
    ]);
    expect((await run("admin", "select sex, living_status from public.persons where id = $1", [grandpa])).rows)
      .toEqual([{ sex: "male", living_status: "deceased" }]);
  });

  it("a claimed person can be edited only by the person who claimed it", async () => {
    await expect(save(alice, erinP, [{ full_display: "Not Erin" }], "female", "living")).rejects.toThrow(/can't edit/);
    await expect(save(bob, erinP, [{ full_display: "Not Erin" }], "female", "living")).rejects.toThrow(/can't edit/);
    await save(erin, erinP, [{ full_display: "Erin Tan-Lim" }], "female", "living");
    expect(await namesOf(erinP)).toEqual([{ full_display: "Erin Tan-Lim", type: "birth", is_primary: true }]);
  });

  it("viewers can't edit; outsiders can't even find the person", async () => {
    await expect(save(cara, grandpa, [{ full_display: "X" }])).rejects.toThrow(/can't edit/);
    await expect(save(dan, grandpa, [{ full_display: "X" }])).rejects.toThrow(/not found/);
    await expect(save("anon", grandpa, [{ full_display: "X" }])).rejects.toThrow(/permission denied/);
  });

  it("is all or nothing: a bad name keeps the old names and details", async () => {
    await expect(save(bob, grandpa, [{ full_display: "OK" }, { full_display: "   " }])).rejects.toThrow(/check constraint/);
    await expect(save(bob, grandpa, [])).rejects.toThrow(/At least one name/);
    expect(await namesOf(grandpa)).toEqual([
      { full_display: "Wrong Name", type: "birth", is_primary: true },
      { full_display: "Old aka", type: "birth", is_primary: false },
    ]);
    expect((await run("admin", "select living_status from public.persons where id = $1", [grandpa])).rows)
      .toEqual([{ living_status: "living" }]);
  });
});

// -----------------------------------------------------------------------------
describe("editing and removing links", () => {
  it("editors can change the subtype and certainty; viewers can't", async () => {
    const edit = "update public.relationships set subtype = 'adoptive', certainty = 'probable' where id = $1";
    expect((await run(cara, edit, [link1])).affectedRows).toBe(0);
    expect((await run(bob, edit, [link1])).affectedRows).toBe(1);
    expect((await run("admin", "select subtype, certainty from public.relationships where id = $1", [link1])).rows)
      .toEqual([{ subtype: "adoptive", certainty: "probable" }]);
  });

  it("removing a link keeps both people", async () => {
    expect((await run(cara, "delete from public.relationships where id = $1", [link1])).affectedRows).toBe(0);
    expect((await run(bob, "delete from public.relationships where id = $1", [link1])).affectedRows).toBe(1);
    expect((await run("admin", "select count(*)::int as n from public.persons where id in ($1, $2)", [grandpa, me])).rows)
      .toEqual([{ n: 2 }]);
  });
});

// -----------------------------------------------------------------------------
describe("deleting people", () => {
  it("owners can delete an unclaimed person, which also removes their names and links", async () => {
    expect((await run(alice, "delete from public.persons where id = $1", [grandpa])).affectedRows).toBe(1);
    expect(await namesOf(grandpa)).toEqual([]);
    expect((await run("admin", "select count(*)::int as n from public.relationships")).rows).toEqual([{ n: 0 }]);
  });

  it("editors and viewers can't delete people, and nobody can delete a claimed person", async () => {
    expect((await run(bob, "delete from public.persons where id = $1", [grandpa])).affectedRows).toBe(0);
    expect((await run(cara, "delete from public.persons where id = $1", [grandpa])).affectedRows).toBe(0);
    expect((await run(alice, "delete from public.persons where id = $1", [erinP])).affectedRows).toBe(0);
  });
});
