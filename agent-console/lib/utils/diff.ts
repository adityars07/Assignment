// ─────────────────────────────────────────────────────────────
// JSON Deep Diff Engine
//
// Compares two arbitrary JSON-compatible values and returns
// a structured diff tree. Optimised for large (500KB+) context
// snapshots by using iterative comparison where possible.
// ─────────────────────────────────────────────────────────────

export type DiffKind = "added" | "deleted" | "modified" | "unchanged";

export interface DiffLeaf {
  readonly kind: DiffKind;
  readonly path: string;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

export interface DiffNode {
  readonly kind: DiffKind;
  readonly path: string;
  readonly children: ReadonlyArray<DiffNode | DiffLeaf>;
}

export type DiffEntry = DiffNode | DiffLeaf;

/**
 * Returns true if the entry has children (is a DiffNode).
 */
export function isDiffNode(entry: DiffEntry): entry is DiffNode {
  return "children" in entry;
}

/**
 * Compute a structured diff between two JSON-compatible values.
 *
 * @param oldVal  The previous snapshot value (or undefined for new keys)
 * @param newVal  The new snapshot value (or undefined for deleted keys)
 * @param path    Dot-separated path for display (default "root")
 * @returns       A DiffEntry tree describing all differences
 */
export function computeDiff(
  oldVal: unknown,
  newVal: unknown,
  path: string = "root"
): DiffEntry {
  // Both undefined/null and equal
  if (oldVal === newVal) {
    return { kind: "unchanged", path, oldValue: oldVal, newValue: newVal };
  }

  // Added
  if (oldVal === undefined || oldVal === null) {
    if (isObject(newVal) || isArray(newVal)) {
      return {
        kind: "added",
        path,
        children: enumerateAll(newVal, path, "added"),
      };
    }
    return { kind: "added", path, newValue: newVal };
  }

  // Deleted
  if (newVal === undefined || newVal === null) {
    if (isObject(oldVal) || isArray(oldVal)) {
      return {
        kind: "deleted",
        path,
        children: enumerateAll(oldVal, path, "deleted"),
      };
    }
    return { kind: "deleted", path, oldValue: oldVal };
  }

  // Type mismatch
  if (typeof oldVal !== typeof newVal || isArray(oldVal) !== isArray(newVal)) {
    return { kind: "modified", path, oldValue: oldVal, newValue: newVal };
  }

  // Both arrays
  if (isArray(oldVal) && isArray(newVal)) {
    return diffArrays(oldVal, newVal, path);
  }

  // Both objects
  if (isObject(oldVal) && isObject(newVal)) {
    return diffObjects(oldVal, newVal, path);
  }

  // Primitives
  if (oldVal === newVal) {
    return { kind: "unchanged", path, oldValue: oldVal, newValue: newVal };
  }
  return { kind: "modified", path, oldValue: oldVal, newValue: newVal };
}

// ── Object diffing ──────────────────────────────────────────

function diffObjects(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  path: string
): DiffEntry {
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const children: DiffEntry[] = [];
  let hasChanges = false;

  for (const key of allKeys) {
    const childPath = `${path}.${key}`;
    const child = computeDiff(oldObj[key], newObj[key], childPath);
    children.push(child);
    if (child.kind !== "unchanged") {
      hasChanges = true;
    }
  }

  return {
    kind: hasChanges ? "modified" : "unchanged",
    path,
    children,
  };
}

// ── Array diffing ───────────────────────────────────────────

function diffArrays(
  oldArr: unknown[],
  newArr: unknown[],
  path: string
): DiffEntry {
  const maxLen = Math.max(oldArr.length, newArr.length);
  const children: DiffEntry[] = [];
  let hasChanges = false;

  for (let i = 0; i < maxLen; i++) {
    const childPath = `${path}[${i}]`;
    const child = computeDiff(
      i < oldArr.length ? oldArr[i] : undefined,
      i < newArr.length ? newArr[i] : undefined,
      childPath
    );
    children.push(child);
    if (child.kind !== "unchanged") {
      hasChanges = true;
    }
  }

  return {
    kind: hasChanges ? "modified" : "unchanged",
    path,
    children,
  };
}

// ── Enumerate all children of a value (for added/deleted trees) ──

function enumerateAll(
  val: unknown,
  path: string,
  kind: "added" | "deleted"
): DiffEntry[] {
  if (isArray(val)) {
    return val.map((item, i) => {
      const childPath = `${path}[${i}]`;
      if (isObject(item) || isArray(item)) {
        return {
          kind,
          path: childPath,
          children: enumerateAll(item, childPath, kind),
        } as DiffNode;
      }
      return {
        kind,
        path: childPath,
        ...(kind === "added" ? { newValue: item } : { oldValue: item }),
      } as DiffLeaf;
    });
  }

  if (isObject(val)) {
    return Object.entries(val).map(([key, item]) => {
      const childPath = `${path}.${key}`;
      if (isObject(item) || isArray(item)) {
        return {
          kind,
          path: childPath,
          children: enumerateAll(item, childPath, kind),
        } as DiffNode;
      }
      return {
        kind,
        path: childPath,
        ...(kind === "added" ? { newValue: item } : { oldValue: item }),
      } as DiffLeaf;
    });
  }

  return [];
}

// ── Type guards ─────────────────────────────────────────────

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isArray(val: unknown): val is unknown[] {
  return Array.isArray(val);
}

// ── Summary helpers ─────────────────────────────────────────

export interface DiffSummary {
  added: number;
  deleted: number;
  modified: number;
  unchanged: number;
}

/**
 * Count leaf-level changes in a diff tree.
 */
export function summarizeDiff(entry: DiffEntry): DiffSummary {
  const summary: DiffSummary = { added: 0, deleted: 0, modified: 0, unchanged: 0 };

  function walk(e: DiffEntry): void {
    if (isDiffNode(e)) {
      for (const child of e.children) {
        walk(child);
      }
    } else {
      summary[e.kind]++;
    }
  }

  walk(entry);
  return summary;
}
