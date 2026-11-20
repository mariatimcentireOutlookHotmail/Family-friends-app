/// <reference types="node" />
/**
 * Tests for create_tree_with_me (create a tree with yourself in it).
 * Each test runs in a transaction that is rolled back.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, createTestDb } from "./testDb";

const mei = "00000000-0000-4000-8000-0000000000a1";
const dan = "00000000-0000-4000-8000-0000000000d1";

const CALL = "select public.create_tree_with_me($1, $2, $3::jsonb, $4::public.sex) as id";

const meiNames = [
  { given: "美玲", family: "陈", full_display: "陈美玲", script: "Hani", lang: "zh" },
  { given: "Mei Ling", family: "Tan", full_display: "Mei Ling Tan", script: "Latn", type: "birth" },
];

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${mei}', 'mei@example.com'), ('${dan}', 'dan@example.com');
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

async function create(actor: string, name: string, locale: string, names: unknown, sex = "female") {
  return as(db, actor, async () => {
    const { rows } = await db.query<{ id: string }>(CALL, [name, locale, JSON.stringify(names), sex]);
    return rows[0]!.id;
  });
}

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return as(db, "admin", async () => (await db.query<T>(sql, params)).rows);
}

describe("create_tree_with_me", () => {
  it("creates the tree, makes you owner, and adds you as a claimed, living person", async () => {
    const treeId = await create(mei, "  Tan family  ", "zh-Hans", meiNames);

    expect(await admin("select name, default_locale, created_by from public.trees where id = $1", [treeId]))
      .toEqual([{ name: "Tan family", default_locale: "zh-Hans", created_by: mei }]);
    expect(await admin("select user_id, role from public.tree_members where tree_id = $1", [treeId]))
      .toEqual([{ user_id: mei, role: "owner" }]);
    expect(
      await admin("select claimed_by_user_id, sex, living_status from public.persons where tree_id = $1", [treeId]),
    ).toEqual([{ claimed_by_user_id: mei, sex: "female", living_status: "living" }]);
  });

  it("saves every name, with the first one as the main name", async () => {
    const treeId = await create(mei, "Tan family", "en", meiNames);
    const names = await admin(
      `select n.full_display, n.given, n.family, n.script, n.lang, n.type, n.is_primary
       from public.person_names n join public.persons p on p.id = n.person_id
       where p.tree_id = $1 order by n.is_primary desc, n.full_display`,
      [treeId],
    );
    expect(names).toEqual([
      { full_display: "陈美玲", given: "美玲", family: "陈", script: "Hani", lang: "zh", type: "birth", is_primary: true },
      { full_display: "Mei Ling Tan", given: "Mei Ling", family: "Tan", script: "Latn", lang: null, type: "birth", is_primary: false },
    ]);
  });

  it("the new tree and person are visible to you through the normal rules, not to others", async () => {
    await create(mei, "Tan family", "en", meiNames);
    const mine = await as(db, mei, async () =>
      (await db.query("select t.name, count(p.id)::int as people from public.trees t join public.persons p on p.tree_id = t.id group by t.name")).rows,
    );
    expect(mine).toEqual([{ name: "Tan family", people: 1 }]);
    const theirs = await as(db, dan, async () => (await db.query("select id from public.trees")).rows);
    expect(theirs).toHaveLength(0);
  });

  it("a single name with no family name works (e.g. Indonesian mononyms)", async () => {
    const treeId = await create(mei, "Keluarga Sukarno", "id", [{ given: "Sukarno", full_display: "Sukarno", script: "Latn" }]);
    expect(await admin("select family, full_display from public.person_names n join public.persons p on p.id = n.person_id where p.tree_id = $1", [treeId]))
      .toEqual([{ family: null, full_display: "Sukarno" }]);
  });

  it("signed-out visitors can't use it", async () => {
    await expect(create("anon", "Sneaky", "en", meiNames)).rejects.toThrow(/permission denied/);
  });

  it("rejects missing names, blank names, blank tree names and unknown languages", async () => {
    await expect(create(mei, "Tan family", "en", [])).rejects.toThrow(/At least one name/);
    await expect(create(mei, "Tan family", "en", { not: "an array" })).rejects.toThrow(/At least one name/);
    await expect(create(mei, "Tan family", "en", [{ full_display: "   " }])).rejects.toThrow(/check constraint/);
    await expect(create(mei, "   ", "en", meiNames)).rejects.toThrow(/check constraint/);
    await expect(create(mei, "Tan family", "fr", meiNames)).rejects.toThrow(/check constraint/);
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ full_display: `Name ${i}` }));
    await expect(create(mei, "Tan family", "en", tooMany)).rejects.toThrow(/At most 10/);
  });

  it("is all or nothing: a bad name leaves no tree behind", async () => {
    await expect(
      create(mei, "Half-made", "en", [{ full_display: "OK" }, { full_display: "Bad", script: "not-a-script" }]),
    ).rejects.toThrow(/check constraint/);
    expect(await admin("select id from public.trees where name = 'Half-made'")).toHaveLength(0);
  });

  it("can't be used to claim someone else (it always uses your own account)", async () => {
    // There is no parameter for whose profile it is; check the result.
    await create(dan, "Dan family", "en", [{ full_display: "Dan" }]);
    expect(await admin("select claimed_by_user_id from public.persons")).toEqual([{ claimed_by_user_id: dan }]);
  });
});
