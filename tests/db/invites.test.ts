/// <reference types="node" />
/**
 * Tests for invite-and-claim. Each test runs in a transaction that is rolled back.
 *
 * Tan family: alice = owner, bob = editor, cara = viewer.
 * Unclaimed profiles: mei (adult), kid (11, Indonesia), grandpa (deceased).
 * Outsiders: dan (no account in the tree), erin (another outsider).
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, createTestDb } from "./testDb";

const alice = "00000000-0000-4000-8000-00000000000a";
const bob = "00000000-0000-4000-8000-00000000000b";
const cara = "00000000-0000-4000-8000-00000000000c";
const dan = "00000000-0000-4000-8000-00000000000d";
const erin = "00000000-0000-4000-8000-00000000000e";

const tree = "10000000-0000-4000-8000-000000000001";
const aliceP = "20000000-0000-4000-8000-000000000001";
const mei = "20000000-0000-4000-8000-000000000002";
const kid = "20000000-0000-4000-8000-000000000003";
const grandpa = "20000000-0000-4000-8000-000000000004";
const caraP = "20000000-0000-4000-8000-000000000005";

const thisYear = new Date().getUTCFullYear();

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${alice}', 'a@x.com'), ('${bob}', 'b@x.com'), ('${cara}', 'c@x.com'),
      ('${dan}', 'd@x.com'), ('${erin}', 'e@x.com');
    insert into public.trees (id, name, created_by) values ('${tree}', 'Tan family', '${alice}');
    insert into public.tree_members (tree_id, user_id, role) values
      ('${tree}', '${bob}', 'editor'), ('${tree}', '${cara}', 'viewer');
    insert into public.persons (id, tree_id, claimed_by_user_id, living_status, created_by, country) values
      ('${aliceP}', '${tree}', '${alice}', 'living', '${alice}', null),
      ('${mei}', '${tree}', null, 'living', '${alice}', null),
      ('${kid}', '${tree}', null, 'living', '${alice}', 'ID'),
      ('${grandpa}', '${tree}', null, 'deceased', '${alice}', null),
      ('${caraP}', '${tree}', '${cara}', 'living', '${alice}', null);
    insert into public.person_names (person_id, full_display, is_primary) values
      ('${aliceP}', 'Alice Tan', true), ('${mei}', 'Mei Tan', true), ('${kid}', 'Kid Tan', true),
      ('${grandpa}', 'Grandpa Tan', true), ('${caraP}', 'Cara Tan', true);
    insert into public.relationships (tree_id, person_a, person_b, type, subtype) values
      ('${tree}', '${aliceP}', '${kid}', 'parent', 'biological');
    insert into public.events (person_id, type, year, has_full_date) values
      ('${kid}', 'birth', ${thisYear - 11}, false);
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

const invite = async (actor: string, person: string, lang = "en") =>
  (await run<{ code: string }>(actor, "select public.create_invite($1, $2) as code", [person, lang])).rows[0]!.code;

const preview = async (actor: string, code: string) =>
  (await run<{ p: Record<string, unknown> }>(actor, "select public.invite_preview($1) as p", [code])).rows[0]!.p;

const accept = async (actor: string, code: string) =>
  (await run<{ id: string | null }>(actor, "select public.accept_invite($1) as id", [code])).rows[0]!.id;

/** The hint of the error a call raises (our machine-readable error key). */
async function hintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    return (e as { hint?: string }).hint ?? (e as Error).message;
  }
  throw new Error("Expected an error");
}

const roleOf = async (user: string) =>
  (await run<{ role: string }>("admin", "select role from public.tree_members where tree_id = $1 and user_id = $2", [tree, user]))
    .rows[0]?.role ?? null;

const claimerOf = async (person: string) =>
  (await run<{ c: string | null }>("admin", "select claimed_by_user_id as c from public.persons where id = $1", [person]))
    .rows[0]!.c;

// -----------------------------------------------------------------------------
describe("creating an invite", () => {
  it("gives owners and editors a 12-character code, stored only as a hash", async () => {
    const code = await invite(alice, mei);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    const stored = await run<{ token_hash: string }>("admin", "select token_hash from public.invites where person_id = $1", [mei]);
    expect(stored.rows[0]!.token_hash).toHaveLength(64);
    expect(stored.rows[0]!.token_hash).not.toContain(code.replace(/-/g, ""));

    expect(await invite(bob, mei)).toMatch(/^.{4}-.{4}-.{4}$/);
  });

  it("is not allowed for viewers or outsiders", async () => {
    expect(await hintOf(invite(cara, mei))).toBe("invite_not_allowed");
    expect(await hintOf(invite(dan, mei))).toBe("invite_not_allowed");
  });

  it("is blocked for claimed, deceased and under-age people", async () => {
    expect(await hintOf(invite(alice, caraP))).toBe("invite_blocked_claimed");
    expect(await hintOf(invite(alice, grandpa))).toBe("invite_blocked_deceased");
    expect(await hintOf(invite(alice, kid))).toBe("invite_blocked_minor");
  });

  it("cancels the person's earlier open invite", async () => {
    const first = await invite(alice, mei);
    await invite(alice, mei);
    expect(await hintOf(accept(dan, first))).toBe("invite_revoked");
  });

  it("codes are different every time", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) codes.add(await invite(alice, mei));
    expect(codes.size).toBe(20);
  });
});

describe("who can see invites", () => {
  it("owners and editors see their tree's invites; viewers and outsiders don't", async () => {
    await invite(alice, mei);
    const count = async (actor: string) => (await run(actor, "select id from public.invites")).rows.length;
    expect(await count(alice)).toBe(1);
    expect(await count(bob)).toBe(1);
    expect(await count(cara)).toBe(0);
    expect(await count(dan)).toBe(0);
  });

  it("nobody can write invites directly", async () => {
    await expect(
      run(alice, "insert into public.invites (tree_id, person_id, token_hash) values ($1, $2, 'x')", [tree, mei]),
    ).rejects.toThrow();
    await invite(alice, mei);
    await expect(run(alice, "update public.invites set expires_at = now() + interval '1 year'")).rejects.toThrow();
    await expect(run(alice, "delete from public.invites")).rejects.toThrow();
  });
});

describe("previewing an invite", () => {
  it("shows the tree, the person and who sent it", async () => {
    const code = await invite(alice, mei);
    const p = await preview(dan, code.toLowerCase().replace(/-/g, " ")); // typed sloppily
    expect(p).toMatchObject({ status: "ok", treeName: "Tan family", personName: "Mei Tan", inviterName: "Alice Tan", alreadyInTree: false });
  });

  it("says a wrong code is invalid, without an error", async () => {
    expect(await preview(dan, "AAAA-BBBB-CCCC")).toEqual({ status: "invalid" });
  });

  it("needs a signed-in user", async () => {
    const code = await invite(alice, mei);
    await expect(run("anon", "select public.invite_preview($1)", [code])).rejects.toThrow();
  });
});

describe("accepting an invite", () => {
  it("claims the profile and makes the newcomer an editor", async () => {
    const code = await invite(alice, mei);
    expect(await accept(dan, code)).toBe(mei);
    expect(await claimerOf(mei)).toBe(dan);
    expect(await roleOf(dan)).toBe("editor");

    // Now dan sees the tree and can edit his own profile...
    const names = await run(dan, "select full_display from public.person_names where person_id = $1", [mei]);
    expect(names.rows).toHaveLength(1);
    // ...and the claim lock applies: alice (owner) can no longer edit it.
    const edited = await run(alice, "update public.person_names set full_display = 'X' where person_id = $1 returning 1", [mei]);
    expect(edited.rows).toHaveLength(0);
  });

  it("works only once", async () => {
    const code = await invite(alice, mei);
    await accept(dan, code);
    expect(await hintOf(accept(erin, code))).toBe("invite_used");
  });

  it("stops after it expires", async () => {
    const code = await invite(alice, mei);
    await run("admin", "update public.invites set expires_at = now() - interval '1 minute'");
    expect(await hintOf(accept(dan, code))).toBe("invite_expired");
    expect(await claimerOf(mei)).toBeNull();
  });

  it("stops after it is cancelled", async () => {
    const code = await invite(alice, mei);
    const { rows } = await run<{ id: string }>(bob, "select id from public.invites");
    await run(bob, "select public.revoke_invite($1)", [rows[0]!.id]);
    expect(await hintOf(accept(dan, code))).toBe("invite_revoked");
  });

  it("viewers and outsiders can't cancel invites", async () => {
    await invite(alice, mei);
    const { rows } = await run<{ id: string }>("admin", "select id from public.invites");
    await expect(run(cara, "select public.revoke_invite($1)", [rows[0]!.id])).rejects.toThrow();
    await expect(run(dan, "select public.revoke_invite($1)", [rows[0]!.id])).rejects.toThrow();
  });

  it("refuses someone who already has a profile in the tree", async () => {
    const code = await invite(alice, mei);
    expect(await hintOf(accept(cara, code))).toBe("invite_already_in_tree");
  });

  it("an owner keeps their role; a viewer becomes an editor", async () => {
    // Bob is an editor without a profile of his own here; give him one via the invite.
    const code = await invite(alice, mei);
    await run("admin", "update public.tree_members set role = 'viewer' where user_id = $1", [bob]);
    await accept(bob, code);
    expect(await roleOf(bob)).toBe("editor");
  });

  it("re-checks the person: someone who died since can't be claimed", async () => {
    const code = await invite(alice, mei);
    await run("admin", "update public.persons set living_status = 'deceased' where id = $1", [mei]);
    expect(await hintOf(accept(dan, code))).toBe("invite_blocked_deceased");
  });

  it("returns null for a wrong code and stops after 10 wrong tries in an hour", async () => {
    for (let i = 0; i < 10; i++) expect(await accept(dan, `WRONG-CODE-${i}`)).toBeNull();
    const code = await invite(alice, mei);
    expect(await hintOf(accept(dan, code))).toBe("invite_too_many_tries");
    // Other people aren't affected.
    expect(await accept(erin, code)).toBe(mei);
  });

  it("app users can't set claimed_by_user_id themselves", async () => {
    await expect(
      run(alice, "update public.persons set claimed_by_user_id = $1 where id = $2", [dan, mei]),
    ).rejects.toThrow();
  });
});
