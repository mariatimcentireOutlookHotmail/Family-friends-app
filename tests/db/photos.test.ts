/// <reference types="node" />
/**
 * Tests for photos: the media table and the file rules in storage.objects.
 * Each test runs in a transaction that is rolled back.
 *
 * Tan tree: alice owner, bob editor, cara viewer who claimed caraP, dan
 * outsider. People: mei (unclaimed adult), caraP (claimed by cara), kid (a
 * child only close family may see).
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, createTestDb } from "./testDb";

const alice = "00000000-0000-4000-8000-00000000000a";
const bob = "00000000-0000-4000-8000-00000000000b";
const cara = "00000000-0000-4000-8000-00000000000c";
const dan = "00000000-0000-4000-8000-00000000000d";

const tan = "10000000-0000-4000-8000-000000000001";
const mei = "20000000-0000-4000-8000-000000000001";
const caraP = "20000000-0000-4000-8000-000000000002";
const kid = "20000000-0000-4000-8000-000000000003";

const thisYear = new Date().getUTCFullYear();

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${alice}', 'a@x.com'), ('${bob}', 'b@x.com'), ('${cara}', 'c@x.com'), ('${dan}', 'd@x.com');
    insert into public.trees (id, name, created_by) values ('${tan}', 'Tan family', '${alice}');
    insert into public.tree_members (tree_id, user_id, role) values
      ('${tan}', '${bob}', 'editor'), ('${tan}', '${cara}', 'viewer');
    insert into public.persons (id, tree_id, claimed_by_user_id, sex, living_status, country, created_by) values
      ('${mei}', '${tan}', null, 'female', 'living', null, '${alice}'),
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

let n = 0;
const newId = () => `30000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const paths = (person: string, id: string) => ({
  path: `${tan}/${person}/${id}.jpg`,
  thumb: `${tan}/${person}/${id}_thumb.jpg`,
});

/** Upload both files and add the row, as the app does. Returns the photo id. */
async function addPhoto(actor: string, person: string) {
  const id = newId();
  const { path, thumb } = paths(person, id);
  await run(actor, "insert into storage.objects (bucket_id, name) values ('media', $1), ('media', $2)", [path, thumb]);
  await run(actor, "insert into public.media (id, person_id, tree_id, path, thumb_path, uploaded_by) values ($1, $2, $3, $4, $5, $6)", [
    id, person, tan, path, thumb, actor,
  ]);
  return id;
}

const photoCount = async (actor: string, person: string) =>
  (await run(actor, "select id from public.media where person_id = $1", [person])).rows.length;
const fileCount = async (actor: string, person: string) =>
  (await run(actor, "select name from storage.objects where name like $1", [`${tan}/${person}/%`])).rows.length;

describe("adding photos", () => {
  it("owners, editors and the person themself can add photos", async () => {
    await addPhoto(alice, mei);
    await addPhoto(bob, mei);
    await addPhoto(cara, caraP); // her own profile
    expect(await photoCount(alice, mei)).toBe(2);
    expect(await photoCount(alice, caraP)).toBe(1);
  });

  it("viewers (other than for themselves) and outsiders can't", async () => {
    await expect(addPhoto(cara, mei)).rejects.toThrow();
    await expect(addPhoto(dan, mei)).rejects.toThrow();
  });

  it("files must go in the person's own folder, with the expected names", async () => {
    const id = newId();
    await expect(
      run(bob, "insert into storage.objects (bucket_id, name) values ('media', $1)", [`${tan}/${mei}/../${id}.jpg`]),
    ).rejects.toThrow();
    await expect(
      run(bob, "insert into storage.objects (bucket_id, name) values ('media', $1)", [`${tan}/${mei}/${id}.png`]),
    ).rejects.toThrow();
    const otherTree = "10000000-0000-4000-8000-000000000099";
    await expect(
      run(bob, "insert into storage.objects (bucket_id, name) values ('media', $1)", [`${otherTree}/${mei}/${id}.jpg`]),
    ).rejects.toThrow();
    // A row must point at its own folder too.
    await expect(
      run(bob, "insert into public.media (id, person_id, tree_id, path, thumb_path, uploaded_by) values ($1, $2, $3, 'x.jpg', 'y.jpg', $4)", [
        id, mei, tan, bob,
      ]),
    ).rejects.toThrow();
  });
});

describe("seeing photos", () => {
  it("every tree member who can see the person sees the photos and files; outsiders don't", async () => {
    await addPhoto(bob, mei);
    expect(await photoCount(cara, mei)).toBe(1);
    expect(await fileCount(cara, mei)).toBe(2);
    expect(await photoCount(dan, mei)).toBe(0);
    expect(await fileCount(dan, mei)).toBe(0);
  });

  it("a child's photos are only for those who may see the child", async () => {
    await addPhoto(alice, kid); // alice may see the child: she added her
    expect(await photoCount(alice, kid)).toBe(1);
    expect(await photoCount(cara, kid)).toBe(0);
    expect(await fileCount(cara, kid)).toBe(0);
    await expect(addPhoto(cara, kid)).rejects.toThrow();
  });
});

describe("changing and deleting photos", () => {
  it("the uploader, the person and owners can delete; others can't", async () => {
    const p1 = await addPhoto(bob, caraP);
    const del = async (actor: string, id: string) =>
      (await run(actor, "delete from public.media where id = $1 returning id", [id])).rows.length;
    expect(await del(dan, p1)).toBe(0);
    expect(await del(cara, p1)).toBe(1); // her own profile

    const p2 = await addPhoto(bob, mei);
    expect(await del(cara, p2)).toBe(0); // a viewer, not hers
    expect(await del(alice, p2)).toBe(1); // owner
  });

  it("files can be deleted by those who may delete the photo", async () => {
    const id = await addPhoto(bob, mei);
    const { path } = paths(mei, id);
    const delFile = async (actor: string) =>
      (await run(actor, "delete from storage.objects where name = $1 returning name", [path])).rows.length;
    expect(await delFile(cara)).toBe(0);
    expect(await delFile(bob)).toBe(1);
  });

  it("one profile photo per person; set_profile_photo moves it", async () => {
    const a = await addPhoto(bob, mei);
    const b = await addPhoto(bob, mei);
    await run(bob, "select public.set_profile_photo($1)", [a]);
    await run(bob, "select public.set_profile_photo($1)", [b]);
    const profiles = await run<{ id: string }>(alice, "select id from public.media where person_id = $1 and is_profile", [mei]);
    expect(profiles.rows.map((r) => r.id)).toEqual([b]);
  });

  it("only the caption and profile flag can change", async () => {
    const id = await addPhoto(bob, mei);
    await run(bob, "update public.media set caption = 'At the beach, 1990' where id = $1", [id]);
    await expect(run(bob, "update public.media set person_id = $2 where id = $1", [id, caraP])).rejects.toThrow();
  });

  it("the first photo becomes the profile photo, even if the app says otherwise", async () => {
    const a = await addPhoto(bob, mei); // addPhoto inserts with is_profile false
    const profiles = await run<{ id: string }>(alice, "select id from public.media where person_id = $1 and is_profile", [mei]);
    expect(profiles.rows.map((r) => r.id)).toEqual([a]);
  });

  it("deleting the profile photo makes the newest remaining photo the profile", async () => {
    const first = await addPhoto(bob, mei);
    await run("admin", "update public.media set created_at = now() - interval '1 day' where id = $1", [first]);
    const second = await addPhoto(bob, mei);
    const third = await addPhoto(bob, mei);
    await run("admin", "update public.media set created_at = now() - interval '2 days' where id = $1", [third]);
    await run(alice, "delete from public.media where id = $1", [first]);
    const profiles = await run<{ id: string }>(alice, "select id from public.media where person_id = $1 and is_profile", [mei]);
    expect(profiles.rows.map((r) => r.id)).toEqual([second]);
  });
});
