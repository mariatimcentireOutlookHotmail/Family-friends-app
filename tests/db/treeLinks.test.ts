/// <reference types="node" />
/**
 * Tests for linked trees. Each test runs in a transaction that is rolled back.
 *
 * Tan tree: alice owner, bob editor, cara viewer. People: budiT (Budi as the
 * Tan family entered him), meiT (his wife).
 * Wong tree: wendy owner, will editor. People: budiW (Budi in his own family's
 * tree), his parents wpa and wma, his sister wsis, and wkid (his 8-year-old).
 * dan: no trees.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, createTestDb } from "./testDb";

const alice = "00000000-0000-4000-8000-00000000000a";
const bob = "00000000-0000-4000-8000-00000000000b";
const cara = "00000000-0000-4000-8000-00000000000c";
const dan = "00000000-0000-4000-8000-00000000000d";
const wendy = "00000000-0000-4000-8000-0000000000a1";
const will = "00000000-0000-4000-8000-0000000000a2";

const tan = "10000000-0000-4000-8000-000000000001";
const wong = "10000000-0000-4000-8000-000000000002";
const budiT = "20000000-0000-4000-8000-000000000001";
const meiT = "20000000-0000-4000-8000-000000000002";
const budiW = "20000000-0000-4000-8000-000000000011";
const wpa = "20000000-0000-4000-8000-000000000012";
const wma = "20000000-0000-4000-8000-000000000013";
const wsis = "20000000-0000-4000-8000-000000000014";
const wkid = "20000000-0000-4000-8000-000000000015";

const thisYear = new Date().getUTCFullYear();

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${alice}', 'a@x.com'), ('${bob}', 'b@x.com'), ('${cara}', 'c@x.com'), ('${dan}', 'd@x.com'),
      ('${wendy}', 'w@x.com'), ('${will}', 'wi@x.com');
    insert into public.trees (id, name, created_by) values
      ('${tan}', 'Tan family', '${alice}'), ('${wong}', 'Wong family', '${wendy}');
    insert into public.tree_members (tree_id, user_id, role) values
      ('${tan}', '${bob}', 'editor'), ('${tan}', '${cara}', 'viewer'), ('${wong}', '${will}', 'editor');
    insert into public.persons (id, tree_id, sex, living_status, created_by, country) values
      ('${budiT}', '${tan}', 'male', 'living', '${alice}', null),
      ('${meiT}', '${tan}', 'female', 'living', '${alice}', null),
      ('${budiW}', '${wong}', 'male', 'living', '${wendy}', null),
      ('${wpa}', '${wong}', 'male', 'deceased', '${wendy}', null),
      ('${wma}', '${wong}', 'female', 'living', '${wendy}', null),
      ('${wsis}', '${wong}', 'female', 'living', '${wendy}', null),
      ('${wkid}', '${wong}', 'female', 'living', '${wendy}', 'ID');
    insert into public.person_names (person_id, full_display, is_primary, type) values
      ('${budiT}', 'Budi Wong', true, 'birth'), ('${meiT}', 'Mei Tan', true, 'birth'),
      ('${budiW}', 'Wong Budi', true, 'birth'), ('${budiW}', 'Bud', false, 'nickname'),
      ('${wpa}', 'Wong Senior', true, 'birth'), ('${wma}', 'Lily Wong', true, 'birth'),
      ('${wsis}', 'Sari Wong', true, 'birth'), ('${wkid}', 'Kid Wong', true, 'birth');
    insert into public.relationships (tree_id, person_a, person_b, type, subtype) values
      ('${tan}', '${budiT}', '${meiT}', 'partner', 'married'),
      ('${wong}', '${wpa}', '${budiW}', 'parent', 'biological'),
      ('${wong}', '${wma}', '${budiW}', 'parent', 'biological'),
      ('${wong}', '${wpa}', '${wsis}', 'parent', 'biological'),
      ('${wong}', '${budiW}', '${wkid}', 'parent', 'biological');
    insert into public.events (person_id, type, year, has_full_date) values
      ('${budiW}', 'birth', 1983, true), ('${wpa}', 'birth', 1950, false), ('${wpa}', 'death', 2015, false),
      ('${wkid}', 'birth', ${thisYear - 8}, false);
    insert into public.person_contacts (person_id, phone) values ('${budiW}', '+62 800');
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

async function hintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    return (e as { hint?: string }).hint ?? (e as Error).message;
  }
  throw new Error("Expected an error");
}

const linkCode = async (actor: string, person: string) =>
  (await run<{ c: string }>(actor, "select public.create_link_code($1, 'en') as c", [person])).rows[0]!.c;
const preview = async (actor: string, code: string) =>
  (await run<{ p: Record<string, unknown> }>(actor, "select public.code_preview($1) as p", [code])).rows[0]!.p;
const accept = async (actor: string, code: string, person: string) =>
  (await run<{ id: string | null }>(actor, "select public.accept_link($1, $2) as id", [code, person])).rows[0]!.id;
type Link = {
  linkId: string;
  treeName: string;
  person: Record<string, unknown>;
  family: Record<string, unknown>[];
  canUnlink: boolean;
};
const links = async (actor: string, person: string) =>
  (await run<{ l: Link[] }>(actor, "select public.person_links($1) as l", [person])).rows[0]!.l;

async function linkBudi() {
  const code = await linkCode(alice, budiT);
  return (await accept(wendy, code, budiW))!;
}

// -----------------------------------------------------------------------------
describe("making a link code", () => {
  it("is for tree owners only", async () => {
    expect(await linkCode(alice, budiT)).toMatch(/^.{4}-.{4}-.{4}$/);
    expect(await hintOf(linkCode(bob, budiT))).toBe("link_not_allowed");
    expect(await hintOf(linkCode(wendy, budiT))).toBe("link_not_allowed");
  });

  it("isn't possible for children below the age limit", async () => {
    expect(await hintOf(linkCode(wendy, wkid))).toBe("link_minor");
  });
});

describe("previewing a code", () => {
  it("tells an invite from a link request", async () => {
    const code = await linkCode(alice, budiT);
    const p = await preview(wendy, code);
    expect(p).toMatchObject({ kind: "link", treeName: "Tan family" });
    expect((p.person as Record<string, unknown>).name).toBe("Budi Wong");
    // Only trees wendy owns, never the requesting tree.
    expect(p.myTrees).toEqual([{ id: wong, name: "Wong family" }]);

    const invite = (await run<{ c: string }>(alice, "select public.create_invite($1) as c", [meiT])).rows[0]!.c;
    expect(await preview(dan, invite)).toMatchObject({ kind: "invite", status: "ok", personName: "Mei Tan" });
  });

  it("says invalid for a wrong code", async () => {
    expect(await preview(dan, "AAAA-BBBB-CCCC")).toMatchObject({ kind: "invalid" });
  });
});

describe("accepting a link", () => {
  it("needs an owner of the other tree, and someone in a different tree", async () => {
    const code = await linkCode(alice, budiT);
    expect(await hintOf(accept(will, code, budiW))).toBe("link_not_allowed"); // editor
    expect(await hintOf(accept(dan, code, budiW))).toBe("link_not_allowed");
    expect(await hintOf(accept(alice, code, meiT))).toBe("link_same_tree");
    expect(await accept(wendy, code, budiW)).toMatch(/[0-9a-f-]{36}/);
  });

  it("works once, and a person is linked to another tree only once", async () => {
    const code = await linkCode(alice, budiT);
    await accept(wendy, code, budiW);
    expect(await hintOf(accept(wendy, code, budiW))).toBe("invite_used");
    const again = await linkCode(alice, budiT);
    expect(await hintOf(accept(wendy, again, wsis))).toBe("link_exists");
  });

  it("refuses a child below the age limit", async () => {
    const code = await linkCode(alice, budiT);
    expect(await hintOf(accept(wendy, code, wkid))).toBe("link_minor");
  });
});

describe("what each family sees", () => {
  it("the Tan family sees the Wong family's Budi and his close family, names and years only", async () => {
    await linkBudi();
    const [l] = await links(cara, budiT); // cara is only a viewer in the Tan tree
    expect(l!.treeName).toBe("Wong family");
    expect(l!.person).toMatchObject({ name: "Wong Budi", nickname: "Bud", birthYear: 1983 });
    const fam = l!.family.map((f) => `${f.relation}:${f.name}`).sort();
    expect(fam).toEqual(["parent:Lily Wong", "parent:Wong Senior", "sibling:Sari Wong"]);
    // No contacts, no full dates, and not the 8-year-old.
    expect(JSON.stringify(l)).not.toContain("+62 800");
    expect(JSON.stringify(l)).not.toContain("Kid Wong");
    expect(l!.family.find((f) => f.name === "Wong Senior")).toMatchObject({ birthYear: 1950, deathYear: 2015 });
  });

  it("works both ways", async () => {
    await linkBudi();
    const [l] = await links(will, budiW);
    expect(l!.treeName).toBe("Tan family");
    expect(l!.family.map((f) => f.name)).toEqual(["Mei Tan"]);
  });

  it("nobody else sees it, and the link tables can't be read directly", async () => {
    await linkBudi();
    expect(await links(dan, budiT)).toEqual([]);
    await expect(run(alice, "select * from public.tree_links")).rejects.toThrow();
    await expect(run(alice, "select * from public.link_requests")).rejects.toThrow();
  });
});

describe("unlinking", () => {
  it("an owner of either tree can unlink; editors and viewers can't", async () => {
    const link = await linkBudi();
    expect((await links(alice, budiT))[0]!.canUnlink).toBe(true);
    expect((await links(bob, budiT))[0]!.canUnlink).toBe(false);
    expect(await hintOf(run(bob, "select public.unlink_trees($1)", [link]))).toBe("link_not_allowed");
    await run(wendy, "select public.unlink_trees($1)", [link]);
    expect(await links(alice, budiT)).toEqual([]);
  });

  it("linking and unlinking show in both trees' History, and can't be undone there", async () => {
    await linkBudi();
    const tanHistory = (await run<{ h: { txid: number; canUndo: boolean; entries: { table: string; after: Record<string, string> }[] }[] }>(
      alice,
      "select public.tree_history($1, $2) as h",
      [tan, budiT],
    )).rows[0]!.h;
    const entry = tanHistory[0]!;
    expect(entry.entries[0]!.table).toBe("tree_links");
    expect(entry.entries[0]!.after).toEqual({ otherTree: "Wong family", otherPerson: "Wong Budi" });
    expect(entry.canUndo).toBe(false);
    expect(await hintOf(run(alice, "select public.undo_change($1, $2)", [tan, entry.txid]))).toBe("history_not_undoable");

    const wongHistory = (await run<{ h: { entries: { table: string }[] }[] }>(wendy, "select public.tree_history($1) as h", [wong])).rows[0]!.h;
    expect(wongHistory[0]!.entries[0]!.table).toBe("tree_links");
  });

  it("deleting either person removes the link", async () => {
    await linkBudi();
    await run(alice, "delete from public.persons where id = $1", [budiT]);
    expect(await links(wendy, budiW)).toEqual([]);
  });
});
