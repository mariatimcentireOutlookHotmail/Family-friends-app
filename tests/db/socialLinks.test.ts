/// <reference types="node" />
/**
 * Tests for social links (stored with contact details, same privacy).
 * Each test runs in a transaction that is rolled back.
 *
 *              mum (unclaimed)
 *             /       \
 *   aliceP [alice]   bobP [bob]          caraP [cara] (not linked: a distant cousin)
 *        |
 *       kid  (Indonesia, ~11 years old, added by alice)
 *
 * alice = owner, bob = editor, cara = viewer, erin = viewer without a profile.
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
const mum = "20000000-0000-4000-8000-000000000001";
const aliceP = "20000000-0000-4000-8000-000000000002";
const bobP = "20000000-0000-4000-8000-000000000003";
const caraP = "20000000-0000-4000-8000-000000000004";
const kid = "20000000-0000-4000-8000-000000000005";
const teen = "20000000-0000-4000-8000-000000000006";

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
      ('${tree}', '${bob}', 'editor'), ('${tree}', '${cara}', 'viewer'), ('${tree}', '${erin}', 'viewer');
    insert into public.persons (id, tree_id, claimed_by_user_id, living_status, created_by, country) values
      ('${mum}', '${tree}', null, 'living', '${alice}', null),
      ('${aliceP}', '${tree}', '${alice}', 'living', '${alice}', null),
      ('${bobP}', '${tree}', '${bob}', 'living', '${alice}', null),
      ('${caraP}', '${tree}', '${cara}', 'living', '${alice}', null),
      ('${kid}', '${tree}', null, 'living', '${alice}', 'ID'),
      ('${teen}', '${tree}', null, 'living', '${alice}', 'CN');
    insert into public.person_names (person_id, full_display, is_primary)
      select id, 'Name of ' || id, true from public.persons;
    insert into public.relationships (tree_id, person_a, person_b, type, subtype) values
      ('${tree}', '${mum}', '${aliceP}', 'parent', 'biological'),
      ('${tree}', '${mum}', '${bobP}', 'parent', 'biological'),
      ('${tree}', '${aliceP}', '${kid}', 'parent', 'biological');
    insert into public.events (id, person_id, type, year, has_full_date) values
      ('40000000-0000-4000-8000-000000000001', '${aliceP}', 'birth', 1985, true),
      ('40000000-0000-4000-8000-000000000002', '${kid}', 'birth', ${thisYear - 11}, true),
      ('40000000-0000-4000-8000-000000000003', '${teen}', 'birth', ${thisYear - 16}, true);
    insert into public.event_dates (event_id, month, day) values
      ('40000000-0000-4000-8000-000000000001', 3, 14),
      ('40000000-0000-4000-8000-000000000002', 1, 1),
      ('40000000-0000-4000-8000-000000000003', 1, 1);
    insert into public.person_contacts (person_id, phone, email) values
      ('${aliceP}', '+62 811 000', 'alice@x.com'),
      ('${mum}', '+62 812 000', null);
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

const setPrivacy = (actor: string, person: string, field: string, level: string | null) =>
  run(actor, "select public.set_privacy($1, $2::public.privacy_field, $3::public.privacy_level)", [person, field, level]);

const save = (actor: string, person: string, contacts: unknown) =>
  run(actor, "select public.save_person($1, $2::jsonb, 'unknown', 'living', null, null, $3::jsonb)", [
    person,
    JSON.stringify([{ full_display: "Alice" }]),
    JSON.stringify({ contacts }),
  ]);

const socialOf = async (actor: string, person: string) =>
  (await run<{ social: Record<string, string> }>(actor, "select social from public.person_contacts where person_id = $1", [person]))
    .rows[0]?.social ?? null;

describe("social links", () => {
  it("are saved with the contact details; empty ones are dropped and values trimmed", async () => {
    await save(alice, aliceP, { phone: "+62 811 000", social: { instagram: " alicetan ", wechat: "alice_wx", linkedin: "" } });
    expect(await socialOf(alice, aliceP)).toEqual({ instagram: "alicetan", wechat: "alice_wx" });
  });

  it("follow the contact privacy level", async () => {
    await save(alice, aliceP, { social: { instagram: "alicetan" } });
    expect(await socialOf(bob, aliceP)).toBeNull(); // private by default
    await setPrivacy(alice, aliceP, "contact", "immediate");
    expect(await socialOf(bob, aliceP)).toEqual({ instagram: "alicetan" });
    expect(await socialOf(cara, aliceP)).toBeNull();
  });

  it("alone keep the contact row; removing everything removes it", async () => {
    await save(alice, aliceP, { social: { line: "alice.line" } });
    expect(await socialOf(alice, aliceP)).toEqual({ line: "alice.line" });
    await save(alice, aliceP, { social: {} });
    expect(await socialOf(alice, aliceP)).toBeNull();
  });

  it("reject unknown platforms and overly long values", async () => {
    await expect(save(alice, aliceP, { social: { myspace: "alice" } })).rejects.toThrow();
    await expect(save(alice, aliceP, { social: { instagram: "x".repeat(201) } })).rejects.toThrow();
    // Non-text values are ignored.
    await save(alice, aliceP, { social: { instagram: 42 } });
    expect(await socialOf(alice, aliceP)).toBeNull();
  });

  it("can't be written directly, only through save_person", async () => {
    await expect(
      run(alice, "update public.person_contacts set social = '{\"x\": \"y\"}' where person_id = $1", [aliceP]),
    ).rejects.toThrow();
  });
});
