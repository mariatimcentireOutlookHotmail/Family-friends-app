/// <reference types="node" />
/**
 * Tests for the change log (History) and undo.
 * Each test runs in a transaction that is rolled back; step() starts a new
 * change group, like a separate save in the app.
 *
 * Cast: alice owner, bob editor, cara viewer, erin viewer who claimed erinP,
 * dan outsider. People: grandpa, me (unclaimed), erinP (claimed by erin),
 * kid (a minor only close family may see).
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
const me = "20000000-0000-4000-8000-000000000003";
const erinP = "20000000-0000-4000-8000-000000000004";
const kid = "20000000-0000-4000-8000-000000000005";
const link1 = "30000000-0000-4000-8000-000000000001";

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
    insert into public.persons (id, tree_id, claimed_by_user_id, sex, living_status, created_by, country) values
      ('${grandpa}', '${tree}', null, 'male', 'living', '${alice}', null),
      ('${me}', '${tree}', null, 'unknown', 'living', '${alice}', null),
      ('${erinP}', '${tree}', '${erin}', 'female', 'living', '${alice}', null),
      ('${kid}', '${tree}', null, 'female', 'living', '${alice}', 'ID');
    insert into public.person_names (person_id, full_display, is_primary) values
      ('${grandpa}', 'Grandpa Tan', true), ('${me}', 'Me Tan', true),
      ('${erinP}', 'Erin Tan', true), ('${kid}', 'Kid Tan', true);
    insert into public.relationships (id, tree_id, person_a, person_b, type, subtype) values
      ('${link1}', '${tree}', '${grandpa}', '${me}', 'parent', 'biological');
    insert into public.events (person_id, type, year, has_full_date) values
      ('${kid}', 'birth', ${thisYear - 8}, false);
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

let group = 1000;
beforeEach(async () => {
  await db.exec("begin");
});

afterEach(async () => {
  await db.exec("rollback");
});

async function run<T = Record<string, unknown>>(actor: string, sql: string, params: unknown[] = []) {
  return as(db, actor, async () => db.query<T>(sql, params));
}

/** Start a new change group (in the app, every save is its own transaction). */
async function step() {
  group += 1;
  await db.query("select set_config('myorbit.change_group', $1, true)", [String(group)]);
  return group;
}

type Group = {
  txid: number;
  actorId: string | null;
  actorName: string | null;
  undoneAt: string | null;
  undoOf: number | null;
  canUndo: boolean;
  entries: { table: string; op: string; personId: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
};

async function history(actor: string, person: string | null = null): Promise<Group[]> {
  const { rows } = await run<{ h: Group[] }>(actor, "select public.tree_history($1, $2) as h", [tree, person]);
  return rows[0]!.h;
}

const SAVE = "select public.save_person($1, $2::jsonb, $3::public.sex, $4::public.living_status, $5::jsonb, null, $6::jsonb)";

function save(actor: string, person: string, name: string, opts: { sex?: string; birth?: unknown; details?: unknown } = {}) {
  return run(actor, SAVE, [
    person,
    JSON.stringify([{ full_display: name }]),
    opts.sex ?? "male",
    "living",
    opts.birth === undefined ? null : JSON.stringify(opts.birth),
    opts.details === undefined ? null : JSON.stringify(opts.details),
  ]);
}

const undo = (actor: string, txid: number) => run(actor, "select public.undo_change($1, $2)", [tree, txid]);

async function hintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    return (e as { hint?: string }).hint ?? (e as Error).message;
  }
  throw new Error("Expected an error");
}

const primaryName = async (person: string) =>
  (await run<{ n: string }>("admin", "select full_display as n from public.person_names where person_id = $1 and is_primary", [person]))
    .rows[0]?.n ?? null;

// -----------------------------------------------------------------------------
describe("recording changes", () => {
  it("one save is one group, with who did it", async () => {
    const g = await step();
    await save(bob, grandpa, "Grandpa Tan Sr.", { sex: "male" });
    const [latest] = await history(alice, grandpa);
    expect(latest!.txid).toBe(g);
    expect(latest!.actorId).toBe(bob);
    const tables = latest!.entries.map((e) => `${e.table}:${e.op}`);
    expect(tables).toContain("person_names:insert");
    expect(tables).toContain("person_names:delete");
    // sex didn't change, so the person row isn't in the log.
    expect(tables).not.toContain("persons:update");
  });

  it("names the actor by their claimed profile in the tree", async () => {
    await step();
    await save(erin, erinP, "Erin Tan-Lee", { sex: "female" });
    const [latest] = await history(alice, erinP);
    expect(latest!.actorName).toBe("Erin Tan-Lee"); // their name now
  });

  it("logs links, and filters by person", async () => {
    await step();
    await run(alice, "update public.relationships set certainty = 'probable' where id = $1", [link1]);
    expect((await history(alice, me))[0]!.entries[0]!.table).toBe("relationships");
    expect((await history(alice, grandpa))[0]!.entries[0]!.table).toBe("relationships");
    expect((await history(alice, erinP)).some((g) => g.entries.some((e) => e.table === "relationships"))).toBe(false);
  });

  it("members can read it; outsiders can't; nobody reads the table directly", async () => {
    await step();
    await save(bob, grandpa, "Grandpa");
    expect((await history(cara)).length).toBeGreaterThan(0);
    await expect(history(dan)).rejects.toThrow();
    await expect(run(alice, "select * from public.change_log")).rejects.toThrow();
  });
});

describe("privacy in the history", () => {
  it("contact changes are only shown to those who may see the contacts", async () => {
    await step();
    await save(alice, me, "Me Tan", { sex: "unknown", details: { contacts: { phone: "+62 811 000" } } });
    const has = async (actor: string) =>
      (await history(actor, me)).some((g) => g.entries.some((e) => e.table === "person_contacts"));
    expect(await has(alice)).toBe(true); // owner of an unclaimed profile
    expect(await has(bob)).toBe(false);
    expect(await has(cara)).toBe(false);
  });

  it("day and month changes follow the birth-date privacy level", async () => {
    await step();
    await save(alice, me, "Me Tan", { sex: "unknown", birth: { year: 1990, month: 5, day: 4 } });
    const dates = async (actor: string) =>
      (await history(actor, me)).some((g) => g.entries.some((e) => e.table === "event_dates"));
    const years = async (actor: string) =>
      (await history(actor, me)).some((g) => g.entries.some((e) => e.table === "events"));
    expect(await years(cara)).toBe(true); // the year is visible to the whole tree
    expect(await dates(cara)).toBe(false); // the day and month aren't (yet)
    await run(alice, "select public.set_privacy($1, 'birth_date', 'tree')", [me]);
    expect(await dates(cara)).toBe(true);
  });

  it("hides everything about a minor from those who may not see them", async () => {
    await step();
    await run("admin", "update public.person_names set full_display = 'Kid T.' where person_id = $1", [kid]);
    expect((await history(cara, kid)).length).toBe(0);
    expect((await history(alice, kid)).length).toBeGreaterThan(0); // she added the child
  });
});

describe("undo", () => {
  it("puts an edit back", async () => {
    const g = await step();
    await save(bob, grandpa, "Typo Name");
    expect(await primaryName(grandpa)).toBe("Typo Name");
    await step();
    await undo(alice, g);
    expect(await primaryName(grandpa)).toBe("Grandpa Tan");
    const groups = await history(alice, grandpa);
    expect(groups.find((x) => x.txid === g)!.undoneAt).not.toBeNull();
    expect(groups[0]!.undoOf).toBe(g); // the undo is itself in the history
  });

  it("an undo can be undone", async () => {
    const g = await step();
    await save(bob, grandpa, "New Name");
    const u = await step();
    await undo(alice, g);
    await step();
    await undo(alice, u);
    expect(await primaryName(grandpa)).toBe("New Name");
  });

  it("brings back a deleted person with names, dates, contacts and links", async () => {
    await step();
    await save(alice, grandpa, "Grandpa Tan", {
      birth: { year: 1930, month: 2, day: 1 },
      details: { contacts: { email: "gp@x.com" } },
    });
    const g = await step();
    await run(alice, "delete from public.persons where id = $1", [grandpa]);
    expect((await run("admin", "select 1 from public.persons where id = $1", [grandpa])).rows).toHaveLength(0);

    await step();
    await undo(alice, g);
    expect(await primaryName(grandpa)).toBe("Grandpa Tan");
    const back = await run<{ year: number; month: number; email: string; links: number }>(
      "admin",
      `select e.year, d.month, c.email,
              (select count(*)::int from public.relationships r where r.id = $2) as links
       from public.persons p
       join public.events e on e.person_id = p.id and e.type = 'birth'
       join public.event_dates d on d.event_id = e.id
       join public.person_contacts c on c.person_id = p.id
       where p.id = $1`,
      [grandpa, link1],
    );
    expect(back.rows[0]).toEqual({ year: 1930, month: 2, email: "gp@x.com", links: 1 });
  });

  it("the deleted person's contacts and day/month aren't shown in the history", async () => {
    await step();
    await save(alice, grandpa, "Grandpa Tan", { birth: { year: 1930, month: 2, day: 1 }, details: { contacts: { email: "gp@x.com" } } });
    await step();
    await run(alice, "delete from public.persons where id = $1", [grandpa]);
    const del = (await history(alice))[0]!.entries[0]!;
    expect(del.op).toBe("delete");
    expect(del.before).not.toHaveProperty("contacts");
    expect(JSON.stringify(del.before)).not.toContain('"month"');
    expect(JSON.stringify(del.before)).toContain("Grandpa Tan");
  });

  it("removes a person who was added by mistake", async () => {
    const g = await step();
    const { rows } = await run<{ id: string }>(
      bob,
      "select public.add_relative($1, 'child', 'biological', $2::jsonb, 'female', 'living', 'confirmed', null) as id",
      [me, JSON.stringify([{ full_display: "Oops" }])],
    );
    await step();
    await undo(alice, g);
    expect((await run("admin", "select 1 from public.persons where id = $1", [rows[0]!.id])).rows).toHaveLength(0);
  });

  it("refuses when things changed since, instead of overwriting newer work", async () => {
    const g = await step();
    await save(bob, grandpa, "First");
    await step();
    await save(bob, grandpa, "Second");
    expect(await hintOf(undo(alice, g))).toBe("history_conflict");
    expect(await primaryName(grandpa)).toBe("Second");
  });

  it("is for owners only", async () => {
    const g = await step();
    await save(bob, grandpa, "Typo");
    expect(await hintOf(undo(bob, g))).toBe("history_not_allowed");
    expect(await hintOf(undo(cara, g))).toBe("history_not_allowed");
    expect(await hintOf(undo(dan, g))).toBe("history_not_allowed");
    expect((await history(bob, grandpa))[0]!.canUndo).toBe(false);
    expect((await history(alice, grandpa))[0]!.canUndo).toBe(true);
  });

  it("can't change a profile claimed by someone else", async () => {
    const g = await step();
    await save(erin, erinP, "Erin T.", { sex: "female" });
    expect(await hintOf(undo(alice, g))).toBe("history_claimed");
  });

  it("can't undo twice", async () => {
    const g = await step();
    await save(bob, grandpa, "Typo");
    await step();
    await undo(alice, g);
    await step();
    expect(await hintOf(undo(alice, g))).toBe("history_already_undone");
  });
});

describe("deleting a whole tree", () => {
  it("still works (the log goes with it)", async () => {
    await step();
    await save(bob, grandpa, "Something");
    await run(alice, "delete from public.trees where id = $1", [tree]);
    expect((await run("admin", "select count(*)::int as n from public.change_log where tree_id = $1", [tree])).rows[0]).toEqual({ n: 0 });
  });
});
