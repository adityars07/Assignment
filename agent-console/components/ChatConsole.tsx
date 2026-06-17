"use client";

import React, { useRef, useEffect, useCallback } from "react";
import type { ChatEntry, ToolCallState, ConnectionStatus } from "../lib/protocol/types";

// ── Preset trigger messages ──────────────────────────────────
const PRESETS: { label: string; message: string; icon: string }[] = [
  { label: "Greeting", message: "hello", icon: "👋" },
  { label: "Report Summary", message: "Generate a Q3 report summary", icon: "📊" },
  { label: "Multi-Tool", message: "Analyze and compare the latest metrics", icon: "🔧" },
  { label: "Lookup", message: "Search the knowledge base for API docs", icon: "🔍" },
  { label: "Large Context", message: "Show me the database schema", icon: "🗄️" },
  { label: "Long Response", message: "Write a detailed document about the architecture", icon: "📝" },
];

interface ChatConsoleProps {
  entries: ReadonlyArray<ChatEntry>;
  connectionStatus: ConnectionStatus;
  onSendMessage: (content: string) => void;
  onToolAck: (callId: string) => void;
}

export default function ChatConsole({
  entries,
  connectionStatus,
  onSendMessage,
  onToolAck,
}: ChatConsoleProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const input = inputRef.current;
      if (!input || !input.value.trim()) return;
      onSendMessage(input.value.trim());
      input.value = "";
    },
    [onSendMessage]
  );

  const isDisabled = connectionStatus !== "connected";

  return (
    <div className="chat-console">
      {/* ── Preset buttons ──────────────────────────────────── */}
      <div className="chat__presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="chat__preset-btn"
            onClick={() => onSendMessage(preset.message)}
            disabled={isDisabled}
            title={preset.message}
          >
            <span className="preset-icon">{preset.icon}</span>
            <span className="preset-label">{preset.label}</span>
          </button>
        ))}
      </div>

      {/* ── Message list ────────────────────────────────────── */}
      <div className="chat__messages">
        {entries.length === 0 && (
          <div className="chat__empty">
            <div className="chat__empty-icon">◆</div>
            <p>Send a message to start the agent conversation.</p>
            <p className="chat__empty-hint">
              Use the preset buttons above to trigger different server scripts.
            </p>
          </div>
        )}

        {entries.map((entry) => (
          <div key={entry.id} className={`chat__entry chat__entry--${entry.role}`}>
            <div className="chat__entry-header">
              <span className="chat__role-tag">{entry.role === "user" ? "You" : "Agent"}</span>
              <span className="chat__timestamp">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
            </div>

            {/* User message */}
            {entry.role === "user" && (
              <div className="chat__bubble chat__bubble--user">{entry.content}</div>
            )}

            {/* Agent streaming response */}
            {entry.role === "agent" && entry.stream && (
              <div className="chat__bubble chat__bubble--agent">
                <AgentStream stream={entry.stream} onToolAck={onToolAck} />
              </div>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ───────────────────────────────────────────── */}
      <form className="chat__input-bar" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="chat__input"
          placeholder={isDisabled ? "Connecting to server..." : "Type a message..."}
          disabled={isDisabled}
          autoFocus
        />
        <button type="submit" className="chat__send-btn" disabled={isDisabled}>
          Send
        </button>
      </form>
    </div>
  );
}

// ── Streaming agent response renderer ────────────────────────

interface AgentStreamProps {
  stream: ChatEntry["stream"];
  onToolAck: (callId: string) => void;
}

function AgentStream({ stream, onToolAck }: AgentStreamProps) {
  if (!stream) return null;

  // Interleave tokens and tool calls in order.
  // We render all accumulated tokens as text, with tool call cards inserted
  // at the appropriate positions.
  const elements: React.ReactNode[] = [];
  let tokenIndex = 0;

  // We accumulate all tokens as a single text blob
  const fullText = stream.tokens.join("");

  if (fullText) {
    elements.push(
      <span key="tokens" className="chat__stream-text">
        {fullText}
        {!stream.isComplete && stream.toolCalls.length === 0 && (
          <span className="chat__cursor">▊</span>
        )}
      </span>
    );
    tokenIndex++;
  }

  // Render tool call cards
  for (const tc of stream.toolCalls) {
    elements.push(
      <ToolCallCard key={tc.callId} toolCall={tc} onAck={onToolAck} />
    );
  }

  // If there are tokens after tool calls (resumed streaming)
  if (!stream.isComplete && stream.toolCalls.length > 0) {
    // The cursor goes at the end
    if (tokenIndex > 0) {
      // Already rendered tokens above with cursor
    }
  }

  if (stream.isComplete) {
    elements.push(
      <div key="complete" className="chat__stream-complete">
        ✓ Stream complete
      </div>
    );
  }

  return <>{elements}</>;
}

// ── Tool Call Card ───────────────────────────────────────────

interface ToolCallCardProps {
  toolCall: ToolCallState;
  onAck: (callId: string) => void;
}

function ToolCallCard({ toolCall, onAck }: ToolCallCardProps) {
  const ackSentRef = useRef(false);

  // Send TOOL_ACK when the card mounts (renders)
  useEffect(() => {
    if (toolCall.status === "pending_ack" && !ackSentRef.current) {
      ackSentRef.current = true;
      onAck(toolCall.callId);
    }
  }, [toolCall.callId, toolCall.status, onAck]);

  const statusLabel: Record<ToolCallState["status"], string> = {
    pending_ack: "Acknowledging...",
    executing: "Executing...",
    completed: "Completed",
    error: "Error",
  };

  return (
    <div className={`tool-card tool-card--${toolCall.status}`}>
      <div className="tool-card__header">
        <span className="tool-card__icon">⚡</span>
        <span className="tool-card__name">{toolCall.toolName}</span>
        <span className={`tool-card__status tool-card__status--${toolCall.status}`}>
          {toolCall.status === "executing" && <span className="tool-card__spinner" />}
          {statusLabel[toolCall.status]}
        </span>
      </div>

      {/* Arguments */}
      <details className="tool-card__details">
        <summary className="tool-card__summary">Arguments</summary>
        <pre className="tool-card__json">
          {JSON.stringify(toolCall.args, null, 2)}
        </pre>
      </details>

      {/* Result */}
      {toolCall.status === "completed" && toolCall.result && (
        <details className="tool-card__details" open>
          <summary className="tool-card__summary">Result</summary>
          <pre className="tool-card__json">
            {JSON.stringify(toolCall.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
