/**
 * Turns change-log groups (from tree_history) into readable lines. Pure: no
 * React, no i18n, so it's easy to test. Each line is a translation key under
 * "lines" in the history translations, plus its values.
 */

type Row = Record<string, unknown> | null;

export type HistoryEntry = {
  id: number;
  table:
    | "persons"
    | "person_names"
    | "events"
    | "event_dates"
    | "person_contacts"
    | "relationships"
    | "tree_links"
    | "stories"
    | "memorials";
  op: "insert" | "update" | "delete";
  personId: string | null;
  rowId: string;
  before: Row;
  after: Row;
};

export type HistoryGroup = {
  txid: number;
  at: string;
  actorId: string | null;
  actorName: string | null;
  undoneAt: string | null;
  undoOf: number | null;
  canUndo: boolean;
  entries: HistoryEntry[];
};

export type LineKey =
  | "personAdded"
  | "personDeleted"
  | "claimed"
  | "sexChanged"
  | "livingChanged"
  | "countryChanged"
  | "birthOrderChanged"
  | "nameChanged"
  | "nameAdded"
  | "nameRemoved"
  | "dateAdded"
  | "dateChanged"
  | "dateRemoved"
  | "dayMonthChanged"
  | "contactsChanged"
  | "linkAddedParent"
  | "linkAdded"
  | "linkRemoved"
  | "linkChanged"
  | "treeLinked"
  | "treeUnlinked"
  | "storyAdded"
  | "storyEdited"
  | "storyRemoved"
  | "memorialOn"
  | "memorialOff";

export type Line = { key: LineKey; values: Record<string, string> };

/** Names of people by id; for people who are gone, from the snapshots. */
export type NameOf = (personId: string | null | undefined) => string;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const nameKey = (r: Row) => `${str(r?.type)}|${str(r?.full_display)}|${str(r?.is_primary)}`;

/** Primary name from a deleted person's snapshot. */
export function snapshotName(before: Row): string | null {
  const names = (before?.names as Row[] | undefined) ?? [];
  const primary = names.find((n) => n?.is_primary) ?? names[0];
  return primary ? str(primary.full_display) || null : null;
}

/** Names of deleted people found in the loaded history, by id. */
export function namesFromSnapshots(groups: HistoryGroup[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of groups) {
    for (const e of g.entries) {
      if (e.table === "persons" && e.op === "delete") {
        const n = snapshotName(e.before);
        if (n) out.set(e.rowId, n);
      }
    }
  }
  return out;
}

function nameLines(entries: HistoryEntry[]): Line[] {
  // save_person replaces all names: drop the ones that came back unchanged.
  const removed = entries.filter((e) => e.op === "delete").map((e) => e.before);
  const added = entries.filter((e) => e.op === "insert").map((e) => e.after);
  for (let i = removed.length - 1; i >= 0; i--) {
    const j = added.findIndex((a) => nameKey(a) === nameKey(removed[i]!));
    if (j >= 0) {
      removed.splice(i, 1);
      added.splice(j, 1);
    }
  }
  const lines: Line[] = [];
  // A changed main name reads better as "from → to".
  const oldPrimary = removed.findIndex((r) => r?.is_primary);
  const newPrimary = added.findIndex((a) => a?.is_primary);
  if (oldPrimary >= 0 && newPrimary >= 0) {
    lines.push({
      key: "nameChanged",
      values: { from: str(removed[oldPrimary]?.full_display), to: str(added[newPrimary]?.full_display) },
    });
    removed.splice(oldPrimary, 1);
    added.splice(newPrimary, 1);
  }
  for (const a of added) lines.push({ key: "nameAdded", values: { name: str(a?.full_display) } });
  for (const r of removed) lines.push({ key: "nameRemoved", values: { name: str(r?.full_display) } });
  // Renaming in place (e.g. by an undo).
  for (const e of entries.filter((x) => x.op === "update")) {
    if (str(e.before?.full_display) !== str(e.after?.full_display)) {
      lines.push({ key: "nameChanged", values: { from: str(e.before?.full_display), to: str(e.after?.full_display) } });
    }
  }
  return lines;
}

function personLines(e: HistoryEntry, nameOf: NameOf): Line[] {
  if (e.op === "insert") return [{ key: "personAdded", values: { name: nameOf(e.rowId) } }];
  if (e.op === "delete") return [{ key: "personDeleted", values: { name: snapshotName(e.before) ?? nameOf(e.rowId) } }];
  const lines: Line[] = [];
  const b = e.before ?? {};
  const a = e.after ?? {};
  if (!b.claimed_by_user_id && a.claimed_by_user_id) lines.push({ key: "claimed", values: { name: nameOf(e.rowId) } });
  if (b.sex !== a.sex) lines.push({ key: "sexChanged", values: { from: str(b.sex), to: str(a.sex) } });
  if (b.living_status !== a.living_status) {
    lines.push({ key: "livingChanged", values: { from: str(b.living_status), to: str(a.living_status) } });
  }
  if (b.country !== a.country) lines.push({ key: "countryChanged", values: { from: str(b.country), to: str(a.country) } });
  if (b.birth_order !== a.birth_order) {
    lines.push({ key: "birthOrderChanged", values: { from: str(b.birth_order), to: str(a.birth_order) } });
  }
  return lines;
}

function eventLines(e: HistoryEntry): Line[] {
  const event = str((e.after ?? e.before)?.type);
  if (e.op === "insert") return [{ key: "dateAdded", values: { event, year: str(e.after?.year) } }];
  if (e.op === "delete") return [{ key: "dateRemoved", values: { event, year: str(e.before?.year) } }];
  if (e.before?.year !== e.after?.year || e.before?.qualifier !== e.after?.qualifier) {
    return [{ key: "dateChanged", values: { event, from: str(e.before?.year), to: str(e.after?.year) } }];
  }
  return [];
}

function linkLines(e: HistoryEntry, nameOf: NameOf): Line[] {
  const r = e.after ?? e.before ?? {};
  const values = { a: nameOf(str(r.person_a)), b: nameOf(str(r.person_b)), kind: str(r.type) };
  if (e.op === "insert") return [{ key: r.type === "parent" ? "linkAddedParent" : "linkAdded", values }];
  if (e.op === "delete") return [{ key: "linkRemoved", values }];
  return [{ key: "linkChanged", values }];
}

/** The readable lines for one group (one save). */
export function summarize(group: HistoryGroup, nameOf: NameOf): Line[] {
  const lines: Line[] = [];
  const names = group.entries.filter((e) => e.table === "person_names");
  let namesDone = false;
  let datesDone = false;
  let contactsDone = false;
  for (const e of group.entries) {
    switch (e.table) {
      case "persons":
        lines.push(...personLines(e, nameOf));
        break;
      case "person_names":
        if (!namesDone) {
          namesDone = true;
          // A brand-new person's names are part of "added X".
          const newPerson = group.entries.some((x) => x.table === "persons" && x.op === "insert" && x.rowId === e.personId);
          if (!newPerson) lines.push(...nameLines(names));
        }
        break;
      case "events": {
        const newPerson = group.entries.some((x) => x.table === "persons" && x.op === "insert" && x.rowId === e.personId);
        if (!newPerson) lines.push(...eventLines(e));
        break;
      }
      case "event_dates":
        if (!datesDone && !group.entries.some((x) => x.table === "persons" && x.op === "insert")) {
          datesDone = true;
          lines.push({ key: "dayMonthChanged", values: {} });
        }
        break;
      case "person_contacts":
        if (!contactsDone) {
          contactsDone = true;
          lines.push({ key: "contactsChanged", values: {} });
        }
        break;
      case "relationships":
        lines.push(...linkLines(e, nameOf));
        break;
      case "stories": {
        const x = e.after ?? e.before ?? {};
        const words = str(x.body).split(/\s+/).slice(0, 6).join(" ");
        const title = str(x.title) || (words.length < str(x.body).length ? `${words}…` : words);
        lines.push({
          key: e.op === "insert" ? "storyAdded" : e.op === "delete" ? "storyRemoved" : "storyEdited",
          values: { name: nameOf(e.personId), title },
        });
        break;
      }
      case "memorials":
        lines.push({ key: e.op === "delete" ? "memorialOff" : "memorialOn", values: { name: nameOf(e.personId) } });
        break;
      case "tree_links": {
        const x = e.after ?? e.before ?? {};
        lines.push({
          key: e.op === "insert" ? "treeLinked" : "treeUnlinked",
          values: { name: nameOf(e.personId), tree: str(x.otherTree) },
        });
        break;
      }
    }
  }
  return lines;
}

/** The person most changes in a group are about (for "about X" headings). */
export function groupPerson(group: HistoryGroup): string | null {
  const counts = new Map<string, number>();
  for (const e of group.entries) if (e.personId) counts.set(e.personId, (counts.get(e.personId) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, n] of counts) if (!best || n > (counts.get(best) ?? 0)) best = id;
  return best;
}
