/// <reference types="node" />
/**
 * Tests for my_birthdays(). Each test runs in a transaction that is rolled back.
 *
 * Tan tree: alice owner (claimed aliceP), cara viewer, dan outsider.
 * People: mei (alice's daughter), grandpa (deceased), kid (a child only close
 * family may see), aliceP.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, createTestDb } from "./testDb";

const alice = "00000000-0000-4000-8000-00000000000a";
const cara = "00000000-0000-4000-8000-00000000000c";
const dan = "00000000-0000-4000-8000-00000000000d";
const tan = "10000000-0000-4000-8000-000000000001";
const aliceP = "20000000-0000-4000-8000-000000000001";
const mei = "20000000-0000-4000-8000-000000000002";
const grandpa = "20000000-0000-4000-8000-000000000003";
const kid = "20000000-0000-4000-8000-000000000004";
const thisYear = new Date().getUTCFullYear();

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${alice}', 'a@x.com'), ('${cara}', 'c@x.com'), ('${dan}', 'd@x.com');
    insert into public.trees (id, name, created_by) values ('${tan}', 'Tan family', '${alice}');
    insert into public.tree_members (tree_id, user_id, role) values ('${tan}', '${cara}', 'viewer');
    insert into public.persons (id, tree_id, claimed_by_user_id, sex, living_status, country, created_by) values
      ('${aliceP}', '${tan}', '${alice}', 'female', 'living', null, '${alice}'),
      ('${mei}', '${tan}', null, 'female', 'living', null, '${alice}'),
      ('${grandpa}', '${tan}', null, 'male', 'deceased', null, '${alice}'),
      ('${kid}', '${tan}', null, 'female', 'living', 'ID', '${alice}');
    insert into public.person_names (person_id, full_display, is_primary) select id, 'P', true from public.persons;
    insert into public.relationships (tree_id, person_a, person_b, type, subtype) values
      ('${tan}', '${aliceP}', '${mei}', 'parent', 'biological'),
      ('${tan}', '${aliceP}', '${kid}', 'parent', 'biological');
    insert into public.events (id, person_id, type, year, has_full_date) values
      ('30000000-0000-4000-8000-000000000001', '${mei}', 'birth', 1990, true),
      ('30000000-0000-4000-8000-000000000002', '${grandpa}', 'birth', 1930, true),
      ('30000000-0000-4000-8000-000000000003', '${kid}', 'birth', ${thisYear - 8}, true);
    insert into public.event_dates (event_id, month, day) values
      ('30000000-0000-4000-8000-000000000001', 3, 14),
      ('30000000-0000-4000-8000-000000000002', 7, 1),
      ('30000000-0000-4000-8000-000000000003', 12, 25);
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

const birthdays = async (actor: string) =>
  (
    await as(db, actor, async () =>
      db.query<{ person_id: string; month: number; day: number; year: number }>("select * from public.my_birthdays()"),
    )
  ).rows;

describe("my_birthdays", () => {
  it("close family sees living people's birthdays, not the deceased", async () => {
    const ids = (await birthdays(alice)).map((b) => b.person_id).sort();
    expect(ids).toEqual([mei, kid].sort());
    expect((await birthdays(alice)).find((b) => b.person_id === mei)).toMatchObject({ month: 3, day: 14, year: 1990 });
  });

  it("others only see birthdays that are shared with them", async () => {
    expect(await birthdays(cara)).toEqual([]); // birth dates are close-family only by default
    await as(db, alice, async () => db.query("select public.set_privacy($1, 'birth_date', 'tree')", [mei]));
    expect((await birthdays(cara)).map((b) => b.person_id)).toEqual([mei]);
  });

  it("outsiders see nothing", async () => {
    expect(await birthdays(dan)).toEqual([]);
  });
});
