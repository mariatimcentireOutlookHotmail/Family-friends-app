import { describe, expect, it } from "vitest";

import { groupPerson, namesFromSnapshots, summarize, type HistoryEntry, type HistoryGroup } from "./historySummary";

const names: Record<string, string> = { p1: "Mei Tan", p2: "Lan Tan" };
const nameOf = (id: string | null | undefined) => (id && names[id]) || "?";

let nextId = 1;
const entry = (e: Partial<HistoryEntry> & Pick<HistoryEntry, "table" | "op">): HistoryEntry => ({
  id: nextId++,
  personId: "p1",
  rowId: `r${nextId}`,
  before: null,
  after: null,
  ...e,
});
const group = (entries: HistoryEntry[]): HistoryGroup => ({
  txid: 1,
  at: "2026-11-20T10:00:00Z",
  actorId: null,
  actorName: null,
  undoneAt: null,
  undoOf: null,
  canUndo: true,
  entries,
});
const name = (full_display: string, is_primary = true, type = "birth") => ({ full_display, is_primary, type });

describe("summarize", () => {
  it("ignores names that a save put back unchanged", () => {
    const lines = summarize(
      group([
        entry({ table: "person_names", op: "delete", before: name("Mei Tan") }),
        entry({ table: "person_names", op: "insert", after: name("Mei Tan") }),
      ]),
      nameOf,
    );
    expect(lines).toEqual([]);
  });

  it("shows a changed main name as from → to, and other names as added/removed", () => {
    const lines = summarize(
      group([
        entry({ table: "person_names", op: "delete", before: name("Mei Tn") }),
        entry({ table: "person_names", op: "delete", before: name("Meimei", false, "nickname") }),
        entry({ table: "person_names", op: "insert", after: name("Mei Tan") }),
        entry({ table: "person_names", op: "insert", after: name("陈美玲", false, "aka") }),
      ]),
      nameOf,
    );
    expect(lines).toEqual([
      { key: "nameChanged", values: { from: "Mei Tn", to: "Mei Tan" } },
      { key: "nameAdded", values: { name: "陈美玲" } },
      { key: "nameRemoved", values: { name: "Meimei" } },
    ]);
  });

  it("a new person is one line, not one per name and date", () => {
    const lines = summarize(
      group([
        entry({ table: "persons", op: "insert", rowId: "p2", personId: "p2", after: { id: "p2" } }),
        entry({ table: "person_names", op: "insert", personId: "p2", after: name("Lan Tan") }),
        entry({ table: "events", op: "insert", personId: "p2", after: { type: "birth", year: 1958 } }),
        entry({ table: "relationships", op: "insert", personId: null, after: { type: "parent", person_a: "p2", person_b: "p1" } }),
      ]),
      nameOf,
    );
    expect(lines).toEqual([
      { key: "personAdded", values: { name: "Lan Tan" } },
      { key: "linkAddedParent", values: { a: "Lan Tan", b: "Mei Tan", kind: "parent" } },
    ]);
  });

  it("describes detail and date changes", () => {
    const lines = summarize(
      group([
        entry({ table: "persons", op: "update", rowId: "p1", before: { sex: "unknown", living_status: "living" }, after: { sex: "female", living_status: "living" } }),
        entry({ table: "events", op: "update", before: { type: "birth", year: 1984 }, after: { type: "birth", year: 1985 } }),
        entry({ table: "event_dates", op: "insert", after: { month: 3 } }),
        entry({ table: "person_contacts", op: "update", before: {}, after: {} }),
      ]),
      nameOf,
    );
    expect(lines.map((l) => l.key)).toEqual(["sexChanged", "dateChanged", "dayMonthChanged", "contactsChanged"]);
    expect(lines[1]!.values).toEqual({ event: "birth", from: "1984", to: "1985" });
  });

  it("names a deleted person from the snapshot", () => {
    const deleted = entry({
      table: "persons",
      op: "delete",
      rowId: "p9",
      personId: "p9",
      before: { id: "p9", names: [name("Gone Tan")] },
    });
    expect(summarize(group([deleted]), nameOf)).toEqual([{ key: "personDeleted", values: { name: "Gone Tan" } }]);
    expect(namesFromSnapshots([group([deleted])]).get("p9")).toBe("Gone Tan");
  });

  it("notices a claim", () => {
    const lines = summarize(
      group([entry({ table: "persons", op: "update", rowId: "p2", before: { claimed_by_user_id: null }, after: { claimed_by_user_id: "u1" } })]),
      nameOf,
    );
    expect(lines).toEqual([{ key: "claimed", values: { name: "Lan Tan" } }]);
  });
});

describe("groupPerson", () => {
  it("is the person most entries are about", () => {
    expect(
      groupPerson(group([entry({ table: "person_names", op: "insert", personId: "p2" }), entry({ table: "events", op: "insert", personId: "p2" }), entry({ table: "relationships", op: "insert", personId: null })])),
    ).toBe("p2");
  });
});

describe("linked trees in the history", () => {
  it("says which tree a person was linked with or unlinked from", () => {
    const linked = entry({ table: "tree_links", op: "insert", after: { otherTree: "Wong family", otherPerson: "Wong Budi" } });
    const unlinked = entry({ table: "tree_links", op: "delete", before: { otherTree: "Wong family", otherPerson: "Wong Budi" } });
    expect(summarize(group([linked]), nameOf)).toEqual([{ key: "treeLinked", values: { name: "Mei Tan", tree: "Wong family" } }]);
    expect(summarize(group([unlinked]), nameOf)[0]!.key).toBe("treeUnlinked");
  });
});

describe("stories and memorials in the history", () => {
  it("names the story by its title, or its first words", () => {
    const titled = entry({ table: "stories", op: "insert", after: { title: "How we met", body: "It was raining." } });
    const untitled = entry({ table: "stories", op: "delete", before: { title: null, body: "She made the best kueh lapis every Lunar New Year" } });
    expect(summarize(group([titled]), nameOf)[0]).toEqual({ key: "storyAdded", values: { name: "Mei Tan", title: "How we met" } });
    expect(summarize(group([untitled]), nameOf)[0]).toEqual({
      key: "storyRemoved",
      values: { name: "Mei Tan", title: "She made the best kueh lapis…" },
    });
  });

  it("notices a memorial being turned on", () => {
    expect(summarize(group([entry({ table: "memorials", op: "insert", after: {} })]), nameOf)[0]!.key).toBe("memorialOn");
  });
});
