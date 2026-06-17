"use client";

import React from "react";
import type { ConnectionStatus } from "../lib/protocol/types";

interface ConnectionBadgeProps {
  status: ConnectionStatus;
  lastSeq: number;
  bufferStats: {
    totalReceived: number;
    duplicatesDropped: number;
    reorderedMessages: number;
    pending: number;
  };
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; className: string; icon: string }> = {
  connected: { label: "Connected", className: "badge--connected", icon: "●" },
  connecting: { label: "Connecting...", className: "badge--connecting", icon: "◌" },
  reconnecting: { label: "Reconnecting...", className: "badge--reconnecting", icon: "↻" },
  disconnected: { label: "Disconnected", className: "badge--disconnected", icon: "○" },
};

export default function ConnectionBadge({ status, lastSeq, bufferStats }: ConnectionBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div className={`connection-badge ${config.className}`}>
      <div className="badge__status">
        <span className="badge__icon">{config.icon}</span>
        <span className="badge__label">{config.label}</span>
      </div>
      <div className="badge__stats">
        <span className="badge__stat" title="Last processed sequence">
          seq: {lastSeq}
        </span>
        {bufferStats.pending > 0 && (
          <span className="badge__stat badge__stat--warn" title="Messages buffered awaiting reorder">
            buf: {bufferStats.pending}
          </span>
        )}
        {bufferStats.duplicatesDropped > 0 && (
          <span className="badge__stat" title="Duplicate messages dropped">
            dup: {bufferStats.duplicatesDropped}
          </span>
        )}
        {bufferStats.reorderedMessages > 0 && (
          <span className="badge__stat" title="Messages received out-of-order">
            ooo: {bufferStats.reorderedMessages}
          </span>
        )}
      </div>
    </div>
  );
}
