/// <reference types="node" />
/**
 * Tests for relationships and add_relative(). Each test runs in a transaction
 * that is rolled back.
 *
 * Cast: alice owner, bob editor, cara viewer, erin viewer who claimed her own
 * profile, dan outsider (owner of his own tree).
 * People in the Tan tree: grandpa, dad, me, erinP (claimed by erin).
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
const danTree = "10000000-0000-4000-8000-000000000002";
const grandpa = "20000000-0000-4000-8000-000000000001";
const dad = "20000000-0000-4000-8000-000000000002";
const me = "20000000-0000-4000-8000-000000000003";
const erinP = "20000000-0000-4000-8000-000000000004";
const danP = "20000000-0000-4000-8000-000000000009";

const RLS_ERROR = /row-level security/i;

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${alice}', 'a@x.com'), ('${bob}', 'b@x.com'), ('${cara}', 'c@x.com'),
      ('${dan}', 'd@x.com'), ('${erin}', 'e@x.com');
    insert into public.trees (id, name, created_by) values
      ('${tanTree}', 'Tan family', '${alice}'), ('${danTree}', 'Dan family', '${dan}');
    insert into public.tree_members (tree_id, user_id, role) values
      ('${tanTree}', '${bob}', 'editor'), ('${tanTree}', '${cara}', 'viewer'), ('${tanTree}', '${erin}', 'viewer');
    insert into public.persons (id, tree_id, claimed_by_user_id) values
      ('${grandpa}', '${tanTree}', null), ('${dad}', '${tanTree}', null),
      ('${me}', '${tanTree}', null), ('${erinP}', '${tanTree}', '${erin}'),
      ('${danP}', '${danTree}', null);
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

const LINK = `insert into public.relationships (tree_id, person_a, person_b, type, subtype)
              values ($1, $2, $3, $4::public.relationship_type, $5::public.relationship_subtype)`;

function link(actor: string, a: string, b: string, type: string, subtype: string | null, tree = tanTree) {
  return run(actor, LINK, [tree, a, b, type, subtype]);
}

/** Two-way links must be stored in order; this puts them in order. */
function ordered(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

// -----------------------------------------------------------------------------
describe("who can see and change links", () => {
  it("editors and owners can add links; all members can see them; outsiders can't", async () => {
    await link(bob, grandpa, dad, "parent", "biological");
    await link(alice, dad, me, "parent", "biological");
    expect((await run(cara, "select id from public.relationships")).rows).toHaveLength(2);
    expect((await run(dan, "select id from public.relationships")).rows).toHaveLength(0);
  });

  it("viewers and outsiders can't add links; signed-out visitors can't read them", async () => {
    await expect(link(cara, grandpa, dad, "parent", "biological")).rejects.toThrow(RLS_ERROR);
    await expect(link(dan, grandpa, dad, "parent", "biological")).rejects.toThrow(RLS_ERROR);
    await expect(run("anon", "select * from public.relationships")).rejects.toThrow(/permission denied/);
  });

  it("editors can add links to a claimed person", async () => {
    const [a, b] = ordered(me, erinP);
    await expect(link(bob, a, b, "sibling", "full")).resolves.toBeDefined();
  });

  it("only certainty and subtype can change, not who is linked", async () => {
    await link(bob, grandpa, dad, "parent", "biological");
    const ok = await run(bob, "update public.relationships set certainty = 'probable' where person_a = $1", [grandpa]);
    expect(ok.affectedRows).toBe(1);
    await expect(
      run(bob, "update public.relationships set person_b = $1 where person_a = $2", [me, grandpa]),
    ).rejects.toThrow(/can't be changed/);
    const viewer = await run(cara, "update public.relationships set certainty = 'uncertain' where person_a = $1", [grandpa]);
    expect(viewer.affectedRows).toBe(0);
  });

  it("removing a person removes their links", async () => {
    await link(bob, grandpa, dad, "parent", "biological");
    await run(alice, "delete from public.persons where id = $1", [grandpa]);
    expect((await run("admin", "select id from public.relationships")).rows).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
describe("link rules", () => {
  it("nobody can be linked to themselves", async () => {
    await expect(link(bob, me, me, "parent", "biological")).rejects.toThrow(/relationships_not_self/);
  });

  it("both people must be in the link's tree", async () => {
    await expect(link("admin", me, danP, "parent", "biological")).rejects.toThrow(/same tree/);
  });

  it("subtypes must fit the type", async () => {
    await expect(link(bob, grandpa, dad, "parent", "married")).rejects.toThrow(/subtype_fits_type/);
    await expect(link(bob, grandpa, dad, "parent", null)).rejects.toThrow(/subtype_fits_type/);
    const [a, b] = ordered(me, dad);
    await expect(link(bob, a, b, "friend", "full")).rejects.toThrow(/subtype_fits_type/);
    await expect(link(bob, a, b, "friend", null)).resolves.toBeDefined();
  });

  it("two-way links are stored once, so duplicates are rejected", async () => {
    const [a, b] = ordered(me, erinP);
    await link(bob, a, b, "partner", "married");
    await expect(link(bob, b, a, "partner", "married")).rejects.toThrow(/two_way_ordered/);
    await expect(link(bob, a, b, "partner", "divorced")).rejects.toThrow(/duplicate key/);
  });

  it("nobody can become their own ancestor", async () => {
    await link(bob, grandpa, dad, "parent", "biological");
    await link(bob, dad, me, "parent", "biological");
    await expect(link(bob, me, grandpa, "parent", "biological")).rejects.toThrow(/own ancestor/);
    await expect(link(bob, dad, grandpa, "parent", "adoptive")).rejects.toThrow(/own ancestor/);
  });

  it("at most two biological parents, but adoptive and step parents are fine", async () => {
    await link(bob, grandpa, me, "parent", "biological");
    await link(bob, dad, me, "parent", "biological");
    await expect(link(bob, erinP, me, "parent", "biological")).rejects.toThrow(/two biological parents/);
    await expect(link(bob, erinP, me, "parent", "step")).resolves.toBeDefined();
  });
});

// -----------------------------------------------------------------------------
const ADD = `select public.add_relative($1, $2, $3::public.relationship_subtype, $4::jsonb,
               $5::public.sex, $6::public.living_status, $7::public.certainty, $8) as id`;

async function addRelative(
  actor: string,
  anchor: string,
  relation: string,
  subtype: string | null,
  names: unknown,
  opts: { sex?: string; living?: string; certainty?: string; otherParent?: string | null } = {},
) {
  const { rows } = await run<{ id: string }>(actor, ADD, [
    anchor,
    relation,
    subtype,
    JSON.stringify(names),
    opts.sex ?? "unknown",
    opts.living ?? "living",
    opts.certainty ?? "confirmed",
    opts.otherParent ?? null,
  ]);
  return rows[0]!.id;
}

describe("add_relative", () => {
  it("adds a parent: new person, names, and the link pointing the right way", async () => {
    const id = await addRelative(bob, me, "parent", "biological", [{ full_display: "陈大明", script: "Hani" }], {
      sex: "male",
      living: "deceased",
    });
    expect((await run("admin", "select tree_id, sex, living_status, claimed_by_user_id from public.persons where id = $1", [id])).rows)
      .toEqual([{ tree_id: tanTree, sex: "male", living_status: "deceased", claimed_by_user_id: null }]);
    expect((await run("admin", "select full_display, is_primary from public.person_names where person_id = $1", [id])).rows)
      .toEqual([{ full_display: "陈大明", is_primary: true }]);
    expect((await run("admin", "select person_a, person_b, type, subtype from public.relationships")).rows)
      .toEqual([{ person_a: id, person_b: me, type: "parent", subtype: "biological" }]);
  });

  it("adds a child with a second parent at the same time", async () => {
    const [a, b] = ordered(me, erinP);
    await link(bob, a, b, "partner", "married");
    const kid = await addRelative(bob, me, "child", "biological", [{ full_display: "Ana" }], { otherParent: erinP });
    const links = (await run<{ person_a: string }>("admin", "select person_a from public.relationships where person_b = $1 and type = 'parent' order by person_a", [kid])).rows;
    expect(links.map((l) => l.person_a).sort()).toEqual([me, erinP].sort());
  });

  it("adds partners, siblings and friends as ordered two-way links", async () => {
    const p = await addRelative(bob, me, "partner", "unmarried", [{ full_display: "Sam" }]);
    const f = await addRelative(bob, me, "friend", "full", [{ full_display: "Rina" }]); // subtype ignored for friends
    const rows = (await run("admin", "select person_a, person_b, type, subtype from public.relationships order by type")).rows;
    expect(rows).toEqual([
      { ...pair(me, p), type: "partner", subtype: "unmarried" },
      { ...pair(me, f), type: "friend", subtype: null },
    ]);
  });

  it("saves 'also known as' names (e.g. an English name)", async () => {
    const id = await addRelative(bob, me, "sibling", "full", [
      { full_display: "陈美玲", script: "Hani", type: "birth" },
      { full_display: "Michelle Tan", script: "Latn", type: "aka" },
    ]);
    expect((await run("admin", "select full_display, type, is_primary from public.person_names where person_id = $1 order by is_primary desc", [id])).rows)
      .toEqual([
        { full_display: "陈美玲", type: "birth", is_primary: true },
        { full_display: "Michelle Tan", type: "aka", is_primary: false },
      ]);
  });

  it("viewers can't add relatives, and nothing is left behind", async () => {
    await expect(addRelative(cara, me, "child", "biological", [{ full_display: "Nope" }])).rejects.toThrow(RLS_ERROR);
    expect((await run("admin", "select count(*)::int as n from public.persons")).rows).toEqual([{ n: 5 }]);
  });

  it("outsiders can't even find the person", async () => {
    await expect(addRelative(dan, me, "child", "biological", [{ full_display: "Nope" }])).rejects.toThrow(/not found/);
  });

  it("rejects unknown relations, missing names and a second parent for non-children", async () => {
    await expect(addRelative(bob, me, "cousin", null, [{ full_display: "X" }])).rejects.toThrow(/Unknown relation/);
    await expect(addRelative(bob, me, "parent", "biological", [])).rejects.toThrow(/At least one name/);
    await expect(
      addRelative(bob, me, "parent", "biological", [{ full_display: "X" }], { otherParent: dad }),
    ).rejects.toThrow(/second parent/);
  });

  it("follows the link rules (e.g. a third biological parent is refused, all or nothing)", async () => {
    await addRelative(bob, me, "parent", "biological", [{ full_display: "P1" }]);
    await addRelative(bob, me, "parent", "biological", [{ full_display: "P2" }]);
    await expect(addRelative(bob, me, "parent", "biological", [{ full_display: "P3" }])).rejects.toThrow(/two biological/);
    expect((await run("admin", "select count(*)::int as n from public.person_names where full_display = 'P3'")).rows).toEqual([{ n: 0 }]);
  });
});

function pair(x: string, y: string) {
  const [person_a, person_b] = ordered(x, y);
  return { person_a, person_b };
}
