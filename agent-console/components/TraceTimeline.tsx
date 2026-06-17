"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import type { TraceEvent, TraceCategory } from "../lib/protocol/types";

const MAX_VISIBLE_EVENTS = 500;

const CATEGORY_CONFIG: Record<TraceCategory, { label: string; color: string; icon: string }> = {
  connection: { label: "Connection", color: "var(--trace-connection)", icon: "🔗" },
  stream: { label: "Stream", color: "var(--trace-stream)", icon: "📡" },
  tool: { label: "Tool", color: "var(--trace-tool)", icon: "⚡" },
  ping: { label: "Ping", color: "var(--trace-ping)", icon: "💓" },
  context: { label: "Context", color: "var(--trace-context)", icon: "📋" },
  error: { label: "Error", color: "var(--trace-error)", icon: "❌" },
  reorder: { label: "Reorder", color: "var(--trace-reorder)", icon: "🔀" },
};

const ALL_CATEGORIES: TraceCategory[] = [
  "connection", "stream", "tool", "ping", "context", "error", "reorder",
];

interface TraceTimelineProps {
  events: ReadonlyArray<TraceEvent>;
}

export default function TraceTimeline({ events }: TraceTimelineProps) {
  const [activeFilters, setActiveFilters] = useState<Set<TraceCategory>>(
    new Set(ALL_CATEGORIES)
  );
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const toggleFilter = useCallback((cat: TraceCategory) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const filtered = events
    .filter((e) => activeFilters.has(e.category))
    .slice(-MAX_VISIBLE_EVENTS);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  }, []);

  return (
    <div className="trace-timeline">
      <div className="trace__header">
        <h3 className="trace__title">Agent Trace</h3>
        <span className="trace__count">{events.length} events</span>
      </div>

      {/* ── Filters ──────────────────────────────────────────── */}
      <div className="trace__filters">
        {ALL_CATEGORIES.map((cat) => {
          const cfg = CATEGORY_CONFIG[cat];
          const isActive = activeFilters.has(cat);
          return (
            <button
              key={cat}
              className={`trace__filter-btn ${isActive ? "trace__filter-btn--active" : ""}`}
              style={{
                borderColor: isActive ? cfg.color : "transparent",
                color: isActive ? cfg.color : "var(--text-muted)",
              }}
              onClick={() => toggleFilter(cat)}
              title={cfg.label}
            >
              {cfg.icon}
            </button>
          );
        })}
      </div>

      {/* ── Event list ───────────────────────────────────────── */}
      <div className="trace__list" ref={listRef} onScroll={handleScroll}>
        {filtered.length === 0 && (
          <div className="trace__empty">No trace events yet</div>
        )}
        {filtered.map((event) => {
          const cfg = CATEGORY_CONFIG[event.category];
          return (
            <div key={event.id} className="trace__event" style={{ borderLeftColor: cfg.color }}>
              <div className="trace__event-header">
                <span className="trace__event-icon">{cfg.icon}</span>
                <span className="trace__event-label" style={{ color: cfg.color }}>
                  {event.label}
                </span>
                {event.seq !== undefined && (
                  <span className="trace__event-seq">#{event.seq}</span>
                )}
                <span className="trace__event-time">
                  {new Date(event.timestamp).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    fractionalSecondDigits: 3,
                  })}
                </span>
              </div>
              <div className="trace__event-detail">{event.detail}</div>
            </div>
          );
        })}
      </div>

      {!autoScroll && (
        <button
          className="trace__scroll-btn"
          onClick={() => {
            setAutoScroll(true);
            if (listRef.current) {
              listRef.current.scrollTop = listRef.current.scrollHeight;
            }
          }}
        >
          ↓ Scroll to latest
        </button>
      )}
    </div>
  );
}
