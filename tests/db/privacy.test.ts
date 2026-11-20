/// <reference types="node" />
/**
 * Tests for privacy levels, contact details and minors.
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

const phoneOf = async (actor: string, person: string) =>
  (await run<{ phone: string }>(actor, "select phone from public.person_contacts where person_id = $1", [person])).rows[0]?.phone ?? null;

const namesOf = async (actor: string, person: string) =>
  (await run(actor, "select full_display from public.person_names where person_id = $1", [person])).rows.length;

const birthDayOf = async (actor: string, person: string) =>
  (await run<{ day: number }>(
    actor,
    "select d.day from public.event_dates d join public.events e on e.id = d.event_id where e.person_id = $1",
    [person],
  )).rows[0]?.day ?? null;

const setPrivacy = (actor: string, person: string, field: string, level: string | null) =>
  run(actor, "select public.set_privacy($1, $2::public.privacy_field, $3::public.privacy_level)", [person, field, level]);

// -----------------------------------------------------------------------------
describe("contact details", () => {
  it("are private by default: only the person themselves", async () => {
    expect(await phoneOf(alice, aliceP)).toBe("+62 811 000");
    expect(await phoneOf(bob, aliceP)).toBeNull(); // her brother
    expect(await phoneOf(cara, aliceP)).toBeNull();
  });

  it("of an unclaimed person are visible to tree owners only", async () => {
    expect(await phoneOf(alice, mum)).toBe("+62 812 000"); // owner
    expect(await phoneOf(bob, mum)).toBeNull(); // editor, even though he's her son
  });

  it("can be shared with immediate family or the whole tree, and back", async () => {
    await setPrivacy(alice, aliceP, "contact", "immediate");
    expect(await phoneOf(bob, aliceP)).toBe("+62 811 000");
    expect(await phoneOf(cara, aliceP)).toBeNull();
    await setPrivacy(alice, aliceP, "contact", "tree");
    expect(await phoneOf(cara, aliceP)).toBe("+62 811 000");
    expect(await phoneOf(erin, aliceP)).toBe("+62 811 000");
    expect(await phoneOf(dan, aliceP)).toBeNull(); // outsider
    await setPrivacy(alice, aliceP, "contact", null); // back to default
    expect(await phoneOf(cara, aliceP)).toBeNull();
  });

  it("can't be read or written directly, and not at all by signed-out visitors", async () => {
    await expect(run("anon", "select * from public.person_contacts")).rejects.toThrow(/permission denied/);
    await expect(
      run(alice, "insert into public.person_contacts (person_id, phone) values ($1, '1')", [caraP]),
    ).rejects.toThrow(/permission denied/);
  });

  it("are saved with save_person, and can't be wiped by someone who can't see them", async () => {
    const save = (actor: string, person: string, details: unknown) =>
      run(actor, "select public.save_person($1, $2::jsonb, 'unknown', 'living', null, null, $3::jsonb)", [
        person,
        JSON.stringify([{ full_display: "Mum" }]),
        JSON.stringify(details),
      ]);
    await save(alice, mum, { country: "ID", contacts: { phone: "+62 999", email: "", address: "Jakarta" } });
    expect((await run("admin", "select phone, email, address from public.person_contacts where person_id = $1", [mum])).rows)
      .toEqual([{ phone: "+62 999", email: null, address: "Jakarta" }]);
    // bob may edit mum (unclaimed) but can't see her contacts: they stay.
    await save(bob, mum, { country: "ID", contacts: { phone: "", email: "", address: "" } });
    expect((await run("admin", "select phone from public.person_contacts where person_id = $1", [mum])).rows)
      .toEqual([{ phone: "+62 999" }]);
  });
});

// -----------------------------------------------------------------------------
describe("who may change privacy settings", () => {
  it("the person themselves, or an owner for an unclaimed profile; nobody else", async () => {
    await expect(setPrivacy(alice, aliceP, "contact", "tree")).resolves.toBeDefined();
    await expect(setPrivacy(alice, mum, "contact", "tree")).resolves.toBeDefined(); // owner, unclaimed
    await expect(setPrivacy(bob, aliceP, "contact", "tree")).rejects.toThrow(/Only this person/);
    await expect(setPrivacy(bob, mum, "contact", "tree")).rejects.toThrow(/Only this person/); // editor
    await expect(setPrivacy(alice, bobP, "contact", "tree")).rejects.toThrow(/Only this person/); // claimed by bob
    await expect(setPrivacy(cara, caraP, "birth_date", "private")).resolves.toBeDefined(); // a viewer's own profile
  });
});

// -----------------------------------------------------------------------------
describe("birth date privacy levels", () => {
  it("default: the person and immediate family see the day and month", async () => {
    expect(await birthDayOf(bob, aliceP)).toBe(14);
    expect(await birthDayOf(cara, aliceP)).toBeNull();
  });

  it("can be made private, or shared with the whole tree; the year stays visible", async () => {
    await setPrivacy(alice, aliceP, "birth_date", "private");
    expect(await birthDayOf(bob, aliceP)).toBeNull();
    expect(await birthDayOf(alice, aliceP)).toBe(14);
    await setPrivacy(alice, aliceP, "birth_date", "tree");
    expect(await birthDayOf(cara, aliceP)).toBe(14);
    expect((await run(cara, "select year from public.events where person_id = $1", [aliceP])).rows).toEqual([{ year: 1985 }]);
  });
});

// -----------------------------------------------------------------------------
describe("minors", () => {
  it("others see a placeholder: the person exists, but no names or dates", async () => {
    expect((await run(cara, "select id from public.persons where id = $1", [kid])).rows).toHaveLength(1);
    expect(await namesOf(cara, kid)).toBe(0);
    expect((await run(cara, "select year from public.events where person_id = $1", [kid])).rows).toHaveLength(0);
    expect(await namesOf(erin, kid)).toBe(0);
    expect(await namesOf(bob, kid)).toBe(0); // uncle: not immediate family
  });

  it("their immediate family and whoever added them can see them", async () => {
    expect(await namesOf(alice, kid)).toBe(1); // parent (and added them)
    await run("admin", "update public.persons set created_by = $1 where id = $2", [bob, kid]);
    expect(await namesOf(bob, kid)).toBe(1); // bob added them
  });

  it("the age limit depends on the person's country", async () => {
    // teen is 16: an adult under China's limit (14) ...
    expect(await namesOf(cara, teen)).toBe(1);
    // ... but a minor under Indonesia's (18) or when the country isn't known.
    await run("admin", "update public.persons set country = 'ID' where id = $1", [teen]);
    expect(await namesOf(cara, teen)).toBe(0);
    await run("admin", "update public.persons set country = null where id = $1", [teen]);
    expect(await namesOf(cara, teen)).toBe(0);
  });

  it("with only a birth year, the youngest possible age is used", async () => {
    await run("admin", "delete from public.event_dates where event_id = '40000000-0000-4000-8000-000000000003'");
    await run("admin", "update public.events set year = $1 where person_id = $2", [thisYear - 15, teen]);
    await run("admin", "update public.persons set country = 'CN' where id = $1", [teen]);
    expect(await namesOf(cara, teen)).toBe(1); // at least 14 in CN
    await run("admin", "update public.events set year = $1 where person_id = $2", [thisYear - 14, teen]);
    expect(await namesOf(cara, teen)).toBe(0); // could still be 13
  });

  it("can't be edited by people who can't see them", async () => {
    await expect(
      run(bob, "select public.save_person($1, $2::jsonb, 'unknown', 'living')", [kid, JSON.stringify([{ full_display: "X" }])]),
    ).rejects.toThrow(/can't edit/);
  });

  it("are no longer protected once deceased or grown up", async () => {
    await run("admin", "update public.events set year = $1 where person_id = $2", [thisYear - 30, kid]);
    expect(await namesOf(cara, kid)).toBe(1);
  });
});

// -----------------------------------------------------------------------------
describe("my_access", () => {
  const access = async (actor: string, person: string) =>
    (await run<{ a: Record<string, unknown> | null }>(actor, "select public.my_access(p) as a from public.persons p where p.id = $1", [person])).rows[0]?.a ?? null;

  it("tells the app what the viewer may see and do", async () => {
    expect(await access(cara, kid)).toMatchObject({ hiddenMinor: true, isMinor: true, canChangePrivacy: false });
    expect(await access(alice, mum)).toMatchObject({
      hiddenMinor: false,
      canSeeContacts: true,
      canChangePrivacy: true,
      levels: { birth_date: "immediate", death_date: "tree", contact: "private" },
    });
    expect(await access(bob, mum)).toMatchObject({ canSeeContacts: false, canChangePrivacy: false });
    expect(await access(dan, mum)).toBeNull(); // outsider: the row isn't even visible
  });
});
