"use client";

import React, { useState, useMemo } from "react";
import type { ContextSnapshot } from "../lib/protocol/types";
import {
  computeDiff,
  summarizeDiff,
  isDiffNode,
  type DiffEntry,
  type DiffSummary,
} from "../lib/utils/diff";

interface ContextInspectorProps {
  snapshots: ReadonlyArray<ContextSnapshot>;
}

export default function ContextInspector({ snapshots }: ContextInspectorProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  // Auto-select latest snapshot
  const activeIndex = selectedIndex === -1 ? snapshots.length - 1 : selectedIndex;
  const currentSnapshot = snapshots[activeIndex] ?? null;
  const previousSnapshot = activeIndex > 0 ? snapshots[activeIndex - 1] : null;

  const diff = useMemo(() => {
    if (!currentSnapshot) return null;
    return computeDiff(
      previousSnapshot?.data ?? undefined,
      currentSnapshot.data,
      "context"
    );
  }, [currentSnapshot, previousSnapshot]);

  const summary = useMemo(() => {
    if (!diff) return null;
    return summarizeDiff(diff);
  }, [diff]);

  if (snapshots.length === 0) {
    return (
      <div className="context-inspector">
        <div className="context__header">
          <h3 className="context__title">Context Inspector</h3>
        </div>
        <div className="context__empty">
          <div className="context__empty-icon">📋</div>
          <p>No context snapshots received yet.</p>
          <p className="context__empty-hint">
            Send a message with keywords like &quot;report&quot;, &quot;schema&quot;, or &quot;database&quot; to trigger context updates.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="context-inspector">
      <div className="context__header">
        <h3 className="context__title">Context Inspector</h3>
        <span className="context__count">{snapshots.length} snapshots</span>
      </div>

      {/* ── Snapshot selector ──────────────────────────────── */}
      <div className="context__selector">
        {snapshots.map((snap, idx) => (
          <button
            key={`${snap.contextId}-${snap.seq}`}
            className={`context__snap-btn ${idx === activeIndex ? "context__snap-btn--active" : ""}`}
            onClick={() => setSelectedIndex(idx)}
          >
            <span className="snap-id">{snap.contextId}</span>
            <span className="snap-seq">seq {snap.seq}</span>
          </button>
        ))}
      </div>

      {/* ── Diff summary ─────────────────────────────────── */}
      {summary && (
        <DiffSummaryBar summary={summary} hasPrevious={!!previousSnapshot} />
      )}

      {/* ── Diff tree ────────────────────────────────────── */}
      <div className="context__diff-tree">
        {diff && <DiffTreeNode entry={diff} depth={0} />}
      </div>
    </div>
  );
}

// ── Diff Summary Bar ─────────────────────────────────────────

function DiffSummaryBar({ summary, hasPrevious }: { summary: DiffSummary; hasPrevious: boolean }) {
  if (!hasPrevious) {
    return (
      <div className="context__diff-summary context__diff-summary--new">
        <span className="diff-badge diff-badge--added">Initial snapshot</span>
        <span className="diff-stat">
          {summary.added + summary.unchanged} fields
        </span>
      </div>
    );
  }

  return (
    <div className="context__diff-summary">
      {summary.added > 0 && (
        <span className="diff-badge diff-badge--added">+{summary.added} added</span>
      )}
      {summary.deleted > 0 && (
        <span className="diff-badge diff-badge--deleted">−{summary.deleted} deleted</span>
      )}
      {summary.modified > 0 && (
        <span className="diff-badge diff-badge--modified">~{summary.modified} modified</span>
      )}
      <span className="diff-stat">{summary.unchanged} unchanged</span>
    </div>
  );
}

// ── Recursive Diff Tree ──────────────────────────────────────

const MAX_DEPTH = 12;

function DiffTreeNode({ entry, depth }: { entry: DiffEntry; depth: number }) {
  const [expanded, setExpanded] = useState(
    depth < 2 || entry.kind !== "unchanged"
  );

  // Extract the last path segment as the key name
  const pathParts = entry.path.split(".");
  const keyName = pathParts[pathParts.length - 1];

  if (depth > MAX_DEPTH) {
    return (
      <div className="diff-node diff-node--truncated">
        <span className="diff-key">{keyName}</span>
        <span className="diff-truncated">…(max depth)</span>
      </div>
    );
  }

  if (isDiffNode(entry)) {
    const childCount = entry.children.length;
    const changedCount = entry.children.filter((c) => c.kind !== "unchanged").length;

    return (
      <div className={`diff-node diff-node--${entry.kind}`}>
        <div
          className="diff-node__header"
          onClick={() => setExpanded(!expanded)}
        >
          <span className={`diff-node__toggle ${expanded ? "diff-node__toggle--open" : ""}`}>
            ▸
          </span>
          <span className="diff-key">{keyName}</span>
          <span className="diff-meta">
            {childCount} fields
            {changedCount > 0 && (
              <span className="diff-meta--changes"> ({changedCount} changed)</span>
            )}
          </span>
        </div>
        {expanded && (
          <div className="diff-node__children">
            {entry.children.map((child, i) => (
              <DiffTreeNode key={`${child.path}-${i}`} entry={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Leaf node
  return (
    <div className={`diff-leaf diff-leaf--${entry.kind}`}>
      <span className="diff-kind-indicator">
        {entry.kind === "added" && "+"}
        {entry.kind === "deleted" && "−"}
        {entry.kind === "modified" && "~"}
        {entry.kind === "unchanged" && " "}
      </span>
      <span className="diff-key">{keyName}</span>
      <span className="diff-colon">:</span>
      {entry.kind === "modified" && (
        <>
          <span className="diff-value diff-value--old">
            {formatValue(entry.oldValue)}
          </span>
          <span className="diff-arrow">→</span>
          <span className="diff-value diff-value--new">
            {formatValue(entry.newValue)}
          </span>
        </>
      )}
      {entry.kind === "added" && (
        <span className="diff-value diff-value--new">
          {formatValue(entry.newValue)}
        </span>
      )}
      {entry.kind === "deleted" && (
        <span className="diff-value diff-value--old">
          {formatValue(entry.oldValue)}
        </span>
      )}
      {entry.kind === "unchanged" && (
        <span className="diff-value diff-value--unchanged">
          {formatValue(entry.newValue)}
        </span>
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") {
    const truncated = value.length > 80 ? value.slice(0, 77) + "…" : value;
    return `"${truncated}"`;
  }
  if (typeof value === "object") {
    const str = JSON.stringify(value);
    return str.length > 80 ? str.slice(0, 77) + "…" : str;
  }
  return String(value);
}
