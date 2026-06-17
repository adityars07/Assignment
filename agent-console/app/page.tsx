"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import type {
  ConnectionStatus,
  ServerMessage,
  TraceEvent,
  ChatEntry,
  ChatStreamSegment,
  ToolCallState,
  ContextSnapshot,
} from "../lib/protocol/types";
import { AgentConnectionManager } from "../lib/protocol/connection";
import ConnectionBadge from "../components/ConnectionBadge";
import ChatConsole from "../components/ChatConsole";
import TraceTimeline from "../components/TraceTimeline";
import ContextInspector from "../components/ContextInspector";

const WS_URL = "ws://localhost:4747/ws";

let chatIdCounter = 0;
function nextChatId(): string {
  return `chat_${++chatIdCounter}_${Date.now()}`;
}

export default function DashboardPage() {
  // ── Connection state ────────────────────────────────────
  // ── Connection state ────────────────────────────────────
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [lastSeq, setLastSeq] = useState(0);
  const [bufferStats, setBufferStats] = useState({
    totalReceived: 0,
    duplicatesDropped: 0,
    reorderedMessages: 0,
    pending: 0,
  });

  // ── Chat state ──────────────────────────────────────────
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);

  useEffect(() => {
    console.log(
      "[DEBUG] chatEntries changed. len:",
      chatEntries.length,
      chatEntries.map((e) => `${e.role}:${e.stream ? "hasStream" : "noStream"}`)
    );
  }, [chatEntries]);

  // ── Trace state ─────────────────────────────────────────
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);

  // ── Context state ───────────────────────────────────────
  const [contextSnapshots, setContextSnapshots] = useState<ContextSnapshot[]>([]);

  // ── Manager ref ─────────────────────────────────────────
  const managerRef = useRef<AgentConnectionManager | null>(null);

  // ── Handle ordered messages from the connection manager ─
  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case "TOKEN": {
        setChatEntries((prev) => {
          const lastEntry = prev[prev.length - 1];
          const hasActiveStream =
            lastEntry &&
            lastEntry.role === "agent" &&
            lastEntry.stream &&
            lastEntry.stream.streamId === message.stream_id &&
            !lastEntry.stream.isComplete;

          if (!hasActiveStream) {
            // Create a new agent entry for this stream
            const newSegment: ChatStreamSegment = {
              streamId: message.stream_id,
              tokens: [message.text],
              toolCalls: [],
              isComplete: false,
            };
            const newEntry: ChatEntry = {
              id: nextChatId(),
              role: "agent",
              content: "",
              stream: newSegment,
              timestamp: Date.now(),
            };
            return [...prev, newEntry];
          }

          // Append to existing stream
          const updatedSegment: ChatStreamSegment = {
            ...lastEntry.stream!,
            tokens: [...lastEntry.stream!.tokens, message.text],
          };

          return prev.map((entry, idx) =>
            idx === prev.length - 1
              ? { ...entry, stream: updatedSegment }
              : entry
          );
        });
        break;
      }

      case "TOOL_CALL": {
        const newToolCall: ToolCallState = {
          callId: message.call_id,
          toolName: message.tool_name,
          args: message.args,
          status: "pending_ack",
        };

        setChatEntries((prev) => {
          const lastEntry = prev[prev.length - 1];
          const hasActiveStream =
            lastEntry &&
            lastEntry.role === "agent" &&
            lastEntry.stream &&
            lastEntry.stream.streamId === message.stream_id &&
            !lastEntry.stream.isComplete;

          if (!hasActiveStream) {
            // Create a new agent entry with tool call
            const newSegment: ChatStreamSegment = {
              streamId: message.stream_id,
              tokens: [],
              toolCalls: [newToolCall],
              isComplete: false,
            };
            const newEntry: ChatEntry = {
              id: nextChatId(),
              role: "agent",
              content: "",
              stream: newSegment,
              timestamp: Date.now(),
            };
            return [...prev, newEntry];
          }

          const updatedSegment: ChatStreamSegment = {
            ...lastEntry.stream!,
            toolCalls: [...lastEntry.stream!.toolCalls, newToolCall],
          };

          return prev.map((entry, idx) =>
            idx === prev.length - 1
              ? { ...entry, stream: updatedSegment }
              : entry
          );
        });
        break;
      }

      case "TOOL_RESULT": {
        setChatEntries((prev) => {
          const lastEntry = prev[prev.length - 1];
          const hasActiveStream =
            lastEntry &&
            lastEntry.role === "agent" &&
            lastEntry.stream &&
            lastEntry.stream.streamId === message.stream_id &&
            !lastEntry.stream.isComplete;

          if (!hasActiveStream) return prev;

          const updatedToolCalls = lastEntry.stream!.toolCalls.map((tc) =>
            tc.callId === message.call_id
              ? { ...tc, status: "completed" as const, result: message.result }
              : tc
          );
          const updatedSegment: ChatStreamSegment = {
            ...lastEntry.stream!,
            toolCalls: updatedToolCalls,
          };

          return prev.map((entry, idx) =>
            idx === prev.length - 1
              ? { ...entry, stream: updatedSegment }
              : entry
          );
        });
        break;
      }

      case "CONTEXT_SNAPSHOT": {
        setContextSnapshots((prev) => [
          ...prev,
          {
            contextId: message.context_id,
            data: message.data,
            receivedAt: Date.now(),
            seq: message.seq,
          },
        ]);
        break;
      }

      case "STREAM_END": {
        setChatEntries((prev) => {
          const lastEntry = prev[prev.length - 1];
          const hasActiveStream =
            lastEntry &&
            lastEntry.role === "agent" &&
            lastEntry.stream &&
            lastEntry.stream.streamId === message.stream_id &&
            !lastEntry.stream.isComplete;

          if (!hasActiveStream) return prev;

          const updatedSegment: ChatStreamSegment = {
            ...lastEntry.stream!,
            isComplete: true,
          };

          return prev.map((entry, idx) =>
            idx === prev.length - 1
              ? { ...entry, stream: updatedSegment }
              : entry
          );
        });
        break;
      }

      case "PING":
        // Already handled by connection manager (immediate PONG)
        break;

      case "ERROR":
        // Errors are displayed in the trace timeline
        break;
    }

    // Update seq/buffer stats display
    if (managerRef.current) {
      setLastSeq(managerRef.current.lastProcessedSeq);
      setBufferStats(managerRef.current.bufferStats);
    }
  }, []);

  // ── Handle trace events ─────────────────────────────────
  const handleTrace = useCallback((event: TraceEvent) => {
    setTraceEvents((prev) => [...prev, event]);
  }, []);

  // ── Handle status changes ───────────────────────────────
  const handleStatusChange = useCallback((status: ConnectionStatus) => {
    setConnectionStatus(status);
  }, []);

  // ── Stable callback refs ─────────────────────────────────
  // Store callbacks in refs so the connection manager always
  // calls the latest versions without needing re-creation.
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;
  const handleTraceRef = useRef(handleTrace);
  handleTraceRef.current = handleTrace;
  const handleStatusChangeRef = useRef(handleStatusChange);
  handleStatusChangeRef.current = handleStatusChange;

  // ── Initialize connection manager ───────────────────────
  useEffect(() => {
    const manager = new AgentConnectionManager(WS_URL, {
      onStatusChange: (s) => handleStatusChangeRef.current(s),
      onMessage: (m) => handleMessageRef.current(m),
      onTrace: (e) => handleTraceRef.current(e),
    });

    managerRef.current = manager;

    // 50ms delay prevents connection spikes/loops during React StrictMode double-mount in dev
    const connectTimeout = setTimeout(() => {
      manager.connect();
    }, 50);

    return () => {
      clearTimeout(connectTimeout);
      manager.disconnect();
      managerRef.current = null;
    };
  }, []);

  // ── Send message handler ────────────────────────────────
  const handleSendMessage = useCallback((content: string) => {
    if (!managerRef.current) return;

    // Add user entry to chat
    const userEntry: ChatEntry = {
      id: nextChatId(),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    setChatEntries((prev) => [...prev, userEntry]);

    // Clear context snapshots for new conversation turn
    setContextSnapshots([]);

    managerRef.current.sendUserMessage(content);
  }, []);

  // ── Tool ACK handler ────────────────────────────────────
  const handleToolAck = useCallback((callId: string) => {
    if (!managerRef.current) return;
    managerRef.current.sendToolAck(callId);

    // Update tool call status to "executing"
    setChatEntries((prev) => {
      const lastEntry = prev[prev.length - 1];
      const hasActiveStream =
        lastEntry &&
        lastEntry.role === "agent" &&
        lastEntry.stream &&
        !lastEntry.stream.isComplete;

      if (!hasActiveStream) return prev;

      const updatedToolCalls = lastEntry.stream!.toolCalls.map((tc) =>
        tc.callId === callId ? { ...tc, status: "executing" as const } : tc
      );
      const updatedSegment: ChatStreamSegment = {
        ...lastEntry.stream!,
        toolCalls: updatedToolCalls,
      };

      return prev.map((entry, idx) =>
        idx === prev.length - 1
          ? { ...entry, stream: updatedSegment }
          : entry
      );
    });
  }, []);

  return (
    <div className="dashboard">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="dashboard__header">
        <div className="dashboard__logo">
          <span className="dashboard__logo-icon">◆</span>
          <span className="dashboard__logo-text">Agent Console</span>
        </div>
        <ConnectionBadge
          status={connectionStatus}
          lastSeq={lastSeq}
          bufferStats={bufferStats}
        />
      </header>

      {/* ── Body ────────────────────────────────────────────── */}
      <main className="dashboard__body">
        {/* Left panel: Context Inspector */}
        <div className="panel">
          <ContextInspector snapshots={contextSnapshots} />
        </div>

        {/* Center panel: Chat */}
        <div className="panel">
          <ChatConsole
            entries={chatEntries}
            connectionStatus={connectionStatus}
            onSendMessage={handleSendMessage}
            onToolAck={handleToolAck}
          />
        </div>

        {/* Right panel: Trace Timeline */}
        <div className="panel">
          <TraceTimeline events={traceEvents} />
        </div>
      </main>
    </div>
  );
}
