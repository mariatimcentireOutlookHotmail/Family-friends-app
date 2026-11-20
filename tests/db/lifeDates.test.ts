/// <reference types="node" />
/**
 * Tests for birth/death dates and who may see the day and month.
 * Each test runs in a transaction that is rolled back.
 *
 * The Tan tree (claimed profiles in brackets):
 *
 *            grandpa (deceased)
 *              /          \
 *           mum          uncle
 *          /    \           \
 *   aliceP [alice]  bobP [bob]   caraP [cara]
 *      |
 *   husband (partner of aliceP)
 *
 * alice = owner, bob = editor, cara = viewer (cousin of alice),
 * erin = viewer with no profile of her own, dan = outsider.
 * Note aliceP and bobP are siblings only through their shared parent (mum).
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
const grandpa = "20000000-0000-4000-8000-000000000001";
const mum = "20000000-0000-4000-8000-000000000002";
const uncle = "20000000-0000-4000-8000-000000000003";
const aliceP = "20000000-0000-4000-8000-000000000004";
const bobP = "20000000-0000-4000-8000-000000000005";
const caraP = "20000000-0000-4000-8000-000000000006";
const husband = "20000000-0000-4000-8000-000000000007";

const ev = (n: number) => `40000000-0000-4000-8000-00000000000${n}`;

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
    insert into public.persons (id, tree_id, claimed_by_user_id, living_status) values
      ('${grandpa}', '${tree}', null, 'deceased'),
      ('${mum}', '${tree}', null, 'living'),
      ('${uncle}', '${tree}', null, 'living'),
      ('${aliceP}', '${tree}', '${alice}', 'living'),
      ('${bobP}', '${tree}', '${bob}', 'living'),
      ('${caraP}', '${tree}', '${cara}', 'living'),
      ('${husband}', '${tree}', null, 'living');
    insert into public.person_names (person_id, full_display, is_primary)
      select id, 'P', true from public.persons;
    insert into public.relationships (tree_id, person_a, person_b, type, subtype) values
      ('${tree}', '${grandpa}', '${mum}', 'parent', 'biological'),
      ('${tree}', '${grandpa}', '${uncle}', 'parent', 'biological'),
      ('${tree}', '${mum}', '${aliceP}', 'parent', 'biological'),
      ('${tree}', '${mum}', '${bobP}', 'parent', 'biological'),
      ('${tree}', '${uncle}', '${caraP}', 'parent', 'biological'),
      ('${tree}', least('${aliceP}'::uuid, '${husband}'::uuid), greatest('${aliceP}'::uuid, '${husband}'::uuid), 'partner', 'married');
    -- Birth dates with day and month (seeded directly as admin).
    insert into public.events (id, person_id, type, year, has_full_date) values
      ('${ev(1)}', '${aliceP}', 'birth', 1985, true),
      ('${ev(2)}', '${husband}', 'birth', 1983, true),
      ('${ev(3)}', '${mum}', 'birth', 1958, true),
      ('${ev(4)}', '${grandpa}', 'birth', 1930, true),
      ('${ev(5)}', '${uncle}', 'birth', 1955, true);
    insert into public.event_dates (event_id, month, day) values
      ('${ev(1)}', 3, 14), ('${ev(2)}', 7, 2), ('${ev(3)}', 11, 30), ('${ev(4)}', 1, 5), ('${ev(5)}', 6, 9);
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

/** The day/month the actor can see for a person's birth, or null. */
async function fullDate(actor: string, person: string) {
  const { rows } = await run<{ month: number; day: number }>(
    actor,
    `select d.month, d.day from public.event_dates d join public.events e on e.id = d.event_id
     where e.person_id = $1 and e.type = 'birth'`,
    [person],
  );
  return rows[0] ?? null;
}

async function birthYear(actor: string, person: string) {
  const { rows } = await run<{ year: number; has_full_date: boolean }>(
    actor,
    "select year, has_full_date from public.events where person_id = $1 and type = 'birth'",
    [person],
  );
  return rows[0] ?? null;
}

// -----------------------------------------------------------------------------
describe("who sees what", () => {
  it("every member sees birth years; outsiders and signed-out visitors don't", async () => {
    expect(await birthYear(cara, aliceP)).toEqual({ year: 1985, has_full_date: true });
    expect(await birthYear(erin, aliceP)).toEqual({ year: 1985, has_full_date: true });
    expect(await birthYear(dan, aliceP)).toBeNull();
    await expect(run("anon", "select * from public.events")).rejects.toThrow(/permission denied/);
    await expect(run("anon", "select * from public.event_dates")).rejects.toThrow(/permission denied/);
  });

  it("you see your own full birthday", async () => {
    expect(await fullDate(alice, aliceP)).toEqual({ month: 3, day: 14 });
  });

  it("immediate family sees it: parent, partner, and a sibling through a shared parent", async () => {
    expect(await fullDate(alice, mum)).toEqual({ month: 11, day: 30 }); // her parent
    expect(await fullDate(alice, husband)).toEqual({ month: 7, day: 2 }); // her partner
    expect(await fullDate(bob, aliceP)).toEqual({ month: 3, day: 14 }); // his sister (via mum)
  });

  it("other relatives, members without a profile, and outsiders don't", async () => {
    expect(await fullDate(cara, aliceP)).toBeNull(); // cousin
    expect(await fullDate(alice, uncle)).toBeNull(); // uncle is not immediate family
    expect(await fullDate(erin, aliceP)).toBeNull(); // no profile in the tree
    expect(await fullDate(dan, aliceP)).toBeNull(); // outsider
  });

  it("once someone has died, everyone in the tree sees their full dates", async () => {
    expect(await fullDate(cara, grandpa)).toEqual({ month: 1, day: 5 });
    expect(await fullDate(erin, grandpa)).toEqual({ month: 1, day: 5 });
    expect(await fullDate(dan, grandpa)).toBeNull();
  });

  it("dates can't be written directly, only through the saving functions", async () => {
    await expect(
      run(bob, "insert into public.events (person_id, type, year) values ($1, 'death', 2000)", [grandpa]),
    ).rejects.toThrow(/permission denied/);
    await expect(run(bob, "update public.event_dates set day = 1")).rejects.toThrow(/permission denied/);
  });
});

// -----------------------------------------------------------------------------
const CREATE = "select public.create_tree_with_me($1, 'en', $2::jsonb, 'female', $3::jsonb) as id";
const ADD = `select public.add_relative($1, $2, 'biological', $3::jsonb, 'male', $4::public.living_status,
               'confirmed', null, $5::jsonb, $6::jsonb) as id`;
const SAVE = `select public.save_person($1, $2::jsonb, 'unknown', $3::public.living_status, $4::jsonb, $5::jsonb)`;
const NAME = JSON.stringify([{ full_display: "Someone" }]);

async function stored(person: string, type = "birth") {
  const { rows } = await run(
    "admin",
    `select e.year, e.qualifier, e.has_full_date, d.month, d.day
     from public.events e left join public.event_dates d on d.event_id = e.id
     where e.person_id = $1 and e.type = $2`,
    [person, type],
  );
  return rows[0] ?? null;
}

describe("saving dates", () => {
  it("create_tree_with_me saves your birthday", async () => {
    const { rows } = await run<{ id: string }>(dan, CREATE, ["Dan family", NAME, JSON.stringify({ year: 1990, month: 2, day: 28 })]);
    const me = (await run<{ id: string }>("admin", "select id from public.persons where tree_id = $1", [rows[0]!.id])).rows[0]!.id;
    expect(await stored(me)).toEqual({ year: 1990, qualifier: "exact", has_full_date: true, month: 2, day: 28 });
  });

  it("add_relative saves birth and death dates, including 'about' years", async () => {
    const { rows } = await run<{ id: string }>(bob, ADD, [
      grandpa, "parent", NAME, "deceased",
      JSON.stringify({ year: 1900, qualifier: "about" }),
      JSON.stringify({ year: 1970, month: 8 }),
    ]);
    const id = rows[0]!.id;
    expect(await stored(id, "birth")).toEqual({ year: 1900, qualifier: "about", has_full_date: false, month: null, day: null });
    expect(await stored(id, "death")).toEqual({ year: 1970, qualifier: "exact", has_full_date: true, month: 8, day: null });
  });

  it("save_person changes and removes dates", async () => {
    await run(bob, SAVE, [mum, NAME, "living", JSON.stringify({ year: 1959, month: 1, day: 2 }), null]);
    expect(await stored(mum)).toEqual({ year: 1959, qualifier: "exact", has_full_date: true, month: 1, day: 2 });
    await run(bob, SAVE, [mum, NAME, "living", null, null]);
    expect(await stored(mum)).toBeNull();
  });

  it("editing without seeing the day/month keeps the hidden day/month", async () => {
    // bob is an editor but not the uncle's immediate family: he sees only 1955.
    expect(await fullDate(bob, uncle)).toBeNull();
    await run(bob, SAVE, [uncle, NAME, "living", JSON.stringify({ year: 1956 }), null]);
    expect(await stored(uncle)).toEqual({ year: 1956, qualifier: "exact", has_full_date: true, month: 6, day: 9 });
  });

  it("only those allowed to edit the person can set dates", async () => {
    // aliceP is claimed by alice: bob (editor) can't change her details.
    await expect(run(bob, SAVE, [aliceP, NAME, "living", JSON.stringify({ year: 1900 }), null])).rejects.toThrow(/can't edit/);
    await expect(
      run(cara, ADD, [grandpa, "child", NAME, "living", JSON.stringify({ year: 1960 }), null]),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects impossible or incomplete dates", async () => {
    const bad = (date: unknown) => run(bob, SAVE, [mum, NAME, "living", JSON.stringify(date), null]);
    await expect(bad({ year: 1959, month: 2, day: 30 })).rejects.toThrow(/doesn't exist/);
    await expect(bad({ year: 1959, day: 3 })).rejects.toThrow(/needs a month/);
    await expect(bad({ month: 3 })).rejects.toThrow(/needs a year, or a month and a day/);
    await expect(bad({ year: 1959, month: 13 })).rejects.toThrow(/check constraint/);
  });

  it("allows a birthday without a year, including 29 February", async () => {
    await run(bob, SAVE, [mum, NAME, "living", JSON.stringify({ month: 2, day: 29 }), null]);
    expect(await stored(mum)).toEqual({ year: null, qualifier: "exact", has_full_date: true, month: 2, day: 29 });
  });

  it("a death can't be before the birth", async () => {
    await expect(
      run(bob, SAVE, [mum, NAME, "deceased", JSON.stringify({ year: 1958 }), JSON.stringify({ year: 1950 })]),
    ).rejects.toThrow(/before the birth/);
  });
});
