/// <reference types="node" />
/**
 * Tests for stories and memorial profiles. Each test runs in a transaction
 * that is rolled back.
 *
 * Tan tree: alice owner, bob editor, cara viewer (claimed caraP), vic viewer,
 * dan outsider. People: mei (living, unclaimed), grandma (deceased), kid (a
 * child only close family may see).
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, createTestDb } from "./testDb";

const alice = "00000000-0000-4000-8000-00000000000a";
const bob = "00000000-0000-4000-8000-00000000000b";
const cara = "00000000-0000-4000-8000-00000000000c";
const dan = "00000000-0000-4000-8000-00000000000d";
const vic = "00000000-0000-4000-8000-00000000000e";

const tan = "10000000-0000-4000-8000-000000000001";
const mei = "20000000-0000-4000-8000-000000000001";
const grandma = "20000000-0000-4000-8000-000000000002";
const caraP = "20000000-0000-4000-8000-000000000003";
const kid = "20000000-0000-4000-8000-000000000004";

const thisYear = new Date().getUTCFullYear();
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${alice}', 'a@x.com'), ('${bob}', 'b@x.com'), ('${cara}', 'c@x.com'), ('${dan}', 'd@x.com'), ('${vic}', 'v@x.com');
    insert into public.trees (id, name, created_by) values ('${tan}', 'Tan family', '${alice}');
    insert into public.tree_members (tree_id, user_id, role) values
      ('${tan}', '${bob}', 'editor'), ('${tan}', '${cara}', 'viewer'), ('${tan}', '${vic}', 'viewer');
    insert into public.persons (id, tree_id, claimed_by_user_id, sex, living_status, country, created_by) values
      ('${mei}', '${tan}', null, 'female', 'living', null, '${alice}'),
      ('${grandma}', '${tan}', null, 'female', 'deceased', null, '${alice}'),
      ('${caraP}', '${tan}', '${cara}', 'female', 'living', null, '${alice}'),
      ('${kid}', '${tan}', null, 'female', 'living', 'ID', '${alice}');
    insert into public.person_names (person_id, full_display, is_primary)
      select id, 'P', true from public.persons;
    insert into public.events (person_id, type, year, has_full_date) values ('${kid}', 'birth', ${thisYear - 6}, false);
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

const write = async (actor: string, person: string, body = "A memory") =>
  (
    await run<{ id: string }>(
      actor,
      "insert into public.stories (person_id, tree_id, body, lang, author) values ($1, $2, $3, 'en', $4) returning id",
      [person, tan, body, actor],
    )
  ).rows[0]!.id;
const storiesOf = async (actor: string, person: string) =>
  (await run<{ body: string }>(actor, "select body from public.stories where person_id = $1", [person])).rows.map((r) => r.body);
const memorial = (actor: string, person: string, on: boolean, stewards: string[] = []) =>
  run(actor, "select public.set_memorial($1, $2, $3::uuid[])", [person, on, `{${stewards.join(",")}}`]);

async function hintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    return (e as { hint?: string }).hint ?? (e as Error).message;
  }
  throw new Error("Expected an error");
}

describe("writing stories", () => {
  it("owners, editors and the person themself can write; viewers can't (on ordinary profiles)", async () => {
    await write(alice, mei, "From alice");
    await write(bob, mei, "From bob");
    await write(cara, caraP, "About me");
    await expect(write(vic, mei)).rejects.toThrow();
    await expect(write(dan, mei)).rejects.toThrow();
    expect((await storiesOf(cara, mei)).sort()).toEqual(["From alice", "From bob"]);
  });

  it("outsiders can't read them; a hidden child's stories stay hidden", async () => {
    await write(alice, mei);
    await write(alice, kid, "About the child");
    expect(await storiesOf(dan, mei)).toEqual([]);
    expect(await storiesOf(cara, kid)).toEqual([]);
    expect(await storiesOf(alice, kid)).toEqual(["About the child"]);
    await expect(write(cara, kid)).rejects.toThrow();
  });

  it("only the author edits; author, the person and owners can delete", async () => {
    const s = await write(bob, caraP, "Typo");
    const edit = async (actor: string) =>
      (await run(actor, "update public.stories set body = 'Fixed' where id = $1 returning id", [s])).rows.length;
    expect(await edit(alice)).toBe(0);
    expect(await edit(bob)).toBe(1);
    const del = async (actor: string, id: string) =>
      (await run(actor, "delete from public.stories where id = $1 returning id", [id])).rows.length;
    expect(await del(vic, s)).toBe(0);
    expect(await del(cara, s)).toBe(1); // it's about her
    const s2 = await write(bob, mei);
    expect(await del(alice, s2)).toBe(1); // owner
  });

  it("a story can't be moved to someone else", async () => {
    const s = await write(bob, mei);
    await expect(run(bob, "update public.stories set person_id = $2 where id = $1", [s, caraP])).rejects.toThrow();
  });

  it("is in History, and a deleted story can be brought back", async () => {
    // Separate saves, as in the app (the tests run in one transaction).
    await db.query("select set_config('myorbit.change_group', '9001', true)");
    const s = await write(bob, mei, "Keep me");
    await db.query("select set_config('myorbit.change_group', '9002', true)");
    await run(alice, "delete from public.stories where id = $1", [s]);
    const h = (await run<{ h: { txid: number; entries: { table: string; op: string }[] }[] }>(alice, "select public.tree_history($1, $2) as h", [tan, mei])).rows[0]!.h;
    const del = h.find((g) => g.entries.some((e) => e.table === "stories" && e.op === "delete"))!;
    expect(del).toBeTruthy();
    await db.query("select set_config('myorbit.change_group', '9003', true)");
    await run(alice, "select public.undo_change($1, $2)", [tan, del.txid]);
    expect(await storiesOf(alice, mei)).toEqual(["Keep me"]);
  });
});

describe("memorial profiles", () => {
  it("only owners set them up, only for someone who has died", async () => {
    expect(await hintOf(memorial(bob, grandma, true))).toBe("memorial_not_allowed");
    expect(await hintOf(memorial(alice, mei, true))).toBe("memorial_not_deceased");
    await memorial(alice, grandma, true, [vic]);
    const m = await run(cara, "select person_id from public.memorials where person_id = $1", [grandma]);
    expect(m.rows).toHaveLength(1);
  });

  it("stewards must be members of the tree", async () => {
    expect(await hintOf(memorial(alice, grandma, true, [dan]))).toBe("memorial_bad_steward");
  });

  it("on a memorial, any member can share a story; stewards can tidy and remove them", async () => {
    await memorial(alice, grandma, true, [vic]);
    const s = await write(cara, grandma, "She made the best kueh"); // cara is only a viewer
    expect(await storiesOf(vic, grandma)).toEqual(["She made the best kueh"]);
    expect((await run(vic, "update public.stories set body = 'She made the best kueh lapis' where id = $1 returning id", [s])).rows).toHaveLength(1);
    expect((await run(bob, "update public.stories set body = 'x' where id = $1 returning id", [s])).rows).toHaveLength(0);
    expect((await run(vic, "delete from public.stories where id = $1 returning id", [s])).rows).toHaveLength(1);
    await expect(write(dan, grandma)).rejects.toThrow(); // still not outsiders
  });

  it("turning it off returns to the normal rules", async () => {
    await memorial(alice, grandma, true, [vic]);
    await memorial(alice, grandma, false);
    await expect(write(cara, grandma)).rejects.toThrow();
    const st = await run(alice, "select * from public.memorial_stewards where person_id = $1", [grandma]);
    expect(st.rows).toHaveLength(0);
  });

  it("the stewards list is for owners", async () => {
    const owner = await run(alice, "select * from public.tree_member_names($1)", [tan]);
    expect(owner.rows.length).toBe(4);
    const viewer = await run(cara, "select * from public.tree_member_names($1)", [tan]);
    expect(viewer.rows).toHaveLength(0);
  });

  it("nobody can write memorials or stewards directly", async () => {
    await expect(run(alice, "insert into public.memorials (person_id) values ($1)", [grandma])).rejects.toThrow();
  });
});
