/// <reference types="node" />
/**
 * Privacy-rule (Row-Level Security) tests for trees, tree members, persons and
 * person names. Each test runs inside a transaction that is rolled back, so
 * tests can't affect each other.
 *
 * Cast (all fake users):
 *   alice  owner of the Tan family tree
 *   bob    editor in the Tan tree
 *   cara   viewer in the Tan tree
 *   erin   viewer in the Tan tree who has claimed her own profile
 *   dan    not a member of the Tan tree
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
const grandpa = "20000000-0000-4000-8000-000000000001"; // unclaimed
const erinPerson = "20000000-0000-4000-8000-000000000002"; // claimed by erin

const RLS_ERROR = /row-level security/i;
const PERMISSION_ERROR = /permission denied/i;

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  // Seed as admin (bypasses the rules). Creating the tree with created_by =
  // alice makes her its owner through the trigger.
  await db.exec(`
    insert into auth.users (id, email) values
      ('${alice}', 'alice@example.com'), ('${bob}', 'bob@example.com'),
      ('${cara}', 'cara@example.com'), ('${dan}', 'dan@example.com'),
      ('${erin}', 'erin@example.com');

    insert into public.trees (id, name, created_by) values ('${tanTree}', 'Tan family', '${alice}');

    insert into public.tree_members (tree_id, user_id, role) values
      ('${tanTree}', '${bob}', 'editor'),
      ('${tanTree}', '${cara}', 'viewer'),
      ('${tanTree}', '${erin}', 'viewer');

    insert into public.persons (id, tree_id, sex, living_status, claimed_by_user_id) values
      ('${grandpa}', '${tanTree}', 'male', 'deceased', null),
      ('${erinPerson}', '${tanTree}', 'female', 'living', '${erin}');

    insert into public.person_names (person_id, given, family, full_display, script, lang, is_primary) values
      ('${grandpa}', '志明', '陈', '陈志明', 'Hans', 'zh', true),
      ('${grandpa}', 'Chee Beng', 'Tan', 'Tan Chee Beng', 'Latn', 'zh-Latn', false),
      ('${erinPerson}', 'Erin', 'Tan', 'Erin Tan', 'Latn', 'en', true);
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

/** Shorthand: rows returned by a query run as `actor`. */
async function rows<T = Record<string, unknown>>(
  actor: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return as(db, actor, async () => (await db.query<T>(sql, params)).rows);
}

/** Number of rows a write changed, run as `actor`. */
async function changed(actor: string, sql: string, params: unknown[] = []): Promise<number> {
  return as(db, actor, async () => (await db.query(sql, params)).affectedRows ?? 0);
}

// -----------------------------------------------------------------------------
describe("signed-out visitors", () => {
  it("can't read any table", async () => {
    for (const table of ["trees", "tree_members", "persons", "person_names"]) {
      await expect(rows("anon", `select * from public.${table}`)).rejects.toThrow(PERMISSION_ERROR);
    }
  });

  it("can't create a tree", async () => {
    await expect(
      rows("anon", "insert into public.trees (name) values ('Sneaky')"),
    ).rejects.toThrow(PERMISSION_ERROR);
  });
});

// -----------------------------------------------------------------------------
describe("trees", () => {
  it("a new tree's creator becomes its owner and can see it", async () => {
    const [tree] = await rows<{ id: string }>(
      dan,
      "insert into public.trees (name) values ('Wijaya family') returning id",
    );
    expect(tree?.id).toBeTruthy();

    const members = await rows(dan, "select user_id, role from public.tree_members where tree_id = $1", [tree!.id]);
    expect(members).toEqual([{ user_id: dan, role: "owner" }]);
  });

  it("can't be created on someone else's behalf", async () => {
    await expect(
      rows(dan, "insert into public.trees (name, created_by) values ('Fake', $1)", [alice]),
    ).rejects.toThrow(RLS_ERROR);
  });

  it("are visible only to members", async () => {
    expect(await rows(cara, "select id from public.trees")).toHaveLength(1);
    expect(await rows(dan, "select id from public.trees")).toHaveLength(0);
  });

  it("can be renamed and deleted only by owners", async () => {
    expect(await changed(bob, "update public.trees set name = 'Bob tree' where id = $1", [tanTree])).toBe(0);
    expect(await changed(bob, "delete from public.trees where id = $1", [tanTree])).toBe(0);
    expect(await changed(alice, "update public.trees set name = 'Tan clan' where id = $1", [tanTree])).toBe(1);
  });

  it("deleting a tree removes its members and people", async () => {
    expect(await changed(alice, "delete from public.trees where id = $1", [tanTree])).toBe(1);
    const left = await rows("admin", "select (select count(*) from public.tree_members)::int as m, (select count(*) from public.persons)::int as p");
    expect(left[0]).toEqual({ m: 0, p: 0 });
  });
});

// -----------------------------------------------------------------------------
describe("tree members", () => {
  it("members can see who else is in their tree; outsiders can't", async () => {
    expect(await rows(cara, "select user_id from public.tree_members where tree_id = $1", [tanTree])).toHaveLength(4);
    expect(await rows(dan, "select user_id from public.tree_members where tree_id = $1", [tanTree])).toHaveLength(0);
  });

  it("only owners can add members", async () => {
    await expect(
      rows(bob, "insert into public.tree_members (tree_id, user_id, role) values ($1, $2, 'viewer')", [tanTree, dan]),
    ).rejects.toThrow(RLS_ERROR);
    expect(
      await changed(alice, "insert into public.tree_members (tree_id, user_id, role) values ($1, $2, 'viewer')", [tanTree, dan]),
    ).toBe(1);
  });

  it("nobody can promote themselves", async () => {
    expect(
      await changed(bob, "update public.tree_members set role = 'owner' where tree_id = $1 and user_id = $2", [tanTree, bob]),
    ).toBe(0);
    await expect(
      rows(dan, "insert into public.tree_members (tree_id, user_id, role) values ($1, $2, 'owner')", [tanTree, dan]),
    ).rejects.toThrow(RLS_ERROR);
  });

  it("members can leave, but the last owner can't leave or be demoted", async () => {
    expect(await changed(cara, "delete from public.tree_members where tree_id = $1 and user_id = $2", [tanTree, cara])).toBe(1);
    await expect(
      rows(alice, "delete from public.tree_members where tree_id = $1 and user_id = $2", [tanTree, alice]),
    ).rejects.toThrow(/at least one owner/);
    await expect(
      rows(alice, "update public.tree_members set role = 'viewer' where tree_id = $1 and user_id = $2", [tanTree, alice]),
    ).rejects.toThrow(/at least one owner/);
  });
});

// -----------------------------------------------------------------------------
describe("persons", () => {
  it("are visible to every member and to nobody else", async () => {
    expect(await rows(cara, "select id from public.persons")).toHaveLength(2);
    expect(await rows(dan, "select id from public.persons")).toHaveLength(0);
  });

  it("can be added by owners and editors, not viewers or outsiders", async () => {
    const add = "insert into public.persons (tree_id, living_status) values ($1, 'living')";
    expect(await changed(bob, add, [tanTree])).toBe(1);
    expect(await changed(alice, add, [tanTree])).toBe(1);
    await expect(rows(cara, add, [tanTree])).rejects.toThrow(RLS_ERROR);
    await expect(rows(dan, add, [tanTree])).rejects.toThrow(RLS_ERROR);
  });

  it("can't be created already claimed", async () => {
    await expect(
      rows(bob, "insert into public.persons (tree_id, claimed_by_user_id) values ($1, $2)", [tanTree, bob]),
    ).rejects.toThrow(RLS_ERROR);
  });

  it("unclaimed people can be edited by owners and editors, not viewers", async () => {
    const edit = "update public.persons set birth_order = 2 where id = $1";
    expect(await changed(bob, edit, [grandpa])).toBe(1);
    expect(await changed(cara, edit, [grandpa])).toBe(0);
    expect(await changed(dan, edit, [grandpa])).toBe(0);
  });

  it("a claimed person can be edited only by the person who claimed it", async () => {
    const edit = "update public.persons set birth_order = 1 where id = $1";
    expect(await changed(alice, edit, [erinPerson])).toBe(0); // not even the owner
    expect(await changed(bob, edit, [erinPerson])).toBe(0);
    expect(await changed(erin, edit, [erinPerson])).toBe(1);
  });

  it("app users can't claim, unclaim or move a person", async () => {
    await expect(
      rows(bob, "update public.persons set claimed_by_user_id = $1 where id = $2", [bob, grandpa]),
    ).rejects.toThrow(/invite flow/);
    await expect(
      rows(erin, "update public.persons set claimed_by_user_id = null where id = $1", [erinPerson]),
    ).rejects.toThrow(/invite flow/);

    const [other] = await rows<{ id: string }>(dan, "insert into public.trees (name) values ('Other') returning id");
    await expect(
      rows("admin", "update public.persons set tree_id = $1 where id = $2", [other!.id, grandpa]),
    ).rejects.toThrow(/another tree/);
  });

  it("only owners can delete people, and never a claimed person", async () => {
    expect(await changed(bob, "delete from public.persons where id = $1", [grandpa])).toBe(0);
    expect(await changed(alice, "delete from public.persons where id = $1", [erinPerson])).toBe(0);
    expect(await changed(alice, "delete from public.persons where id = $1", [grandpa])).toBe(1);
  });
});

// -----------------------------------------------------------------------------
describe("person names", () => {
  it("are visible to members only, in every script", async () => {
    const names = await rows<{ full_display: string }>(
      cara,
      "select full_display from public.person_names where person_id = $1 order by is_primary desc",
      [grandpa],
    );
    expect(names.map((n) => n.full_display)).toEqual(["陈志明", "Tan Chee Beng"]);
    expect(await rows(dan, "select id from public.person_names")).toHaveLength(0);
  });

  it("follow the person's edit rules", async () => {
    const add = "insert into public.person_names (person_id, full_display, type) values ($1, $2, 'nickname')";
    expect(await changed(bob, add, [grandpa, 'Ah Beng'])).toBe(1);
    await expect(rows(cara, add, [grandpa, "Nope"])).rejects.toThrow(RLS_ERROR);
    // Claimed person: editors can't, the claimant can.
    await expect(rows(bob, add, [erinPerson, "Nope"])).rejects.toThrow(RLS_ERROR);
    expect(await changed(erin, add, [erinPerson, "Rin"])).toBe(1);
    expect(
      await changed(bob, "update public.person_names set full_display = 'X' where person_id = $1", [erinPerson]),
    ).toBe(0);
  });

  it("outsiders can't add names to people in other trees", async () => {
    await expect(
      rows(dan, "insert into public.person_names (person_id, full_display) values ($1, 'Intruder')", [grandpa]),
    ).rejects.toThrow(RLS_ERROR);
  });

  it("a person has at most one primary name", async () => {
    await expect(
      rows(bob, "insert into public.person_names (person_id, full_display, is_primary) values ($1, 'Second', true)", [grandpa]),
    ).rejects.toThrow(/duplicate key/);
  });

  it("a name can't be moved to another person", async () => {
    await expect(
      rows(
        "admin",
        "update public.person_names set person_id = $1 where person_id = $2 and is_primary",
        [erinPerson, grandpa],
      ),
    ).rejects.toThrow(/another person/);
  });
});
