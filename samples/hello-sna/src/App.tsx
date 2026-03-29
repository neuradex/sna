import { useState } from "react";
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";
import { useSnaClient } from "@sna-sdk/react/hooks";
import { bindSkills } from "./sna-client.js";
import type { SkillEvent } from "@sna-sdk/react/hooks";

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  root: {
    minHeight: "100dvh",
    background: "#0a0a0f",
    color: "#e0e0f0",
    fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', Menlo, monospace",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "flex-start",
    padding: "48px 16px 80px",
  },
  container: {
    width: "100%",
    maxWidth: 640,
    display: "flex",
    flexDirection: "column" as const,
    gap: 32,
  },
  header: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: "-0.5px",
    color: "#f0f0ff",
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  subtitle: {
    fontSize: 13,
    color: "rgba(224,224,240,0.5)",
    margin: 0,
    lineHeight: 1.5,
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "rgba(224,224,240,0.4)",
  },
  dot: (connected: boolean) => ({
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: connected ? "#22c55e" : "#ef4444",
    flexShrink: 0,
  }),
  card: {
    background: "#111118",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 12,
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "rgba(224,224,240,0.35)",
  },
  inputRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  input: {
    flex: 1,
    background: "#0d0d14",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 14,
    color: "#e0e0f0",
    outline: "none",
    fontFamily: "inherit",
    transition: "border-color 0.15s",
  },
  button: (disabled: boolean) => ({
    padding: "10px 20px",
    borderRadius: 8,
    border: "none",
    background: disabled ? "rgba(124,58,237,0.35)" : "#7c3aed",
    color: disabled ? "rgba(255,255,255,0.4)" : "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    transition: "background 0.15s, transform 0.1s",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  }),
  clearButton: {
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "transparent",
    color: "rgba(224,224,240,0.4)",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  eventList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    maxHeight: 400,
    overflowY: "auto" as const,
  },
  emptyState: {
    textAlign: "center" as const,
    padding: "32px 0",
    color: "rgba(224,224,240,0.2)",
    fontSize: 13,
  },
  pipelineNote: {
    fontSize: 12,
    color: "rgba(224,224,240,0.25)",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    paddingTop: 14,
    lineHeight: 1.7,
  },
};

// ── Event type config ──────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  invoked:    { color: "#94a3b8", bg: "rgba(148,163,184,0.1)", label: "INVOKED" },
  start:      { color: "#60a5fa", bg: "rgba(96,165,250,0.1)",  label: "START" },
  progress:   { color: "#a78bfa", bg: "rgba(167,139,250,0.1)", label: "PROGRESS" },
  milestone:  { color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  label: "MILESTONE" },
  complete:   { color: "#22c55e", bg: "rgba(34,197,94,0.1)",   label: "COMPLETE" },
  error:      { color: "#ef4444", bg: "rgba(239,68,68,0.1)",   label: "ERROR" },
  called:     { color: "#38bdf8", bg: "rgba(56,189,248,0.1)",  label: "CALLED" },
};

function getEventConfig(type: string) {
  return EVENT_CONFIG[type] ?? { color: "#94a3b8", bg: "rgba(148,163,184,0.08)", label: type.toUpperCase() };
}

// ── EventCard ─────────────────────────────────────────────────────────────────

function EventCard({ event }: { event: SkillEvent }) {
  const cfg = getEventConfig(event.type);
  const ts = new Date(event.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.color}22`,
        borderRadius: 8,
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        animation: "fadeIn 0.2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: cfg.color,
            background: `${cfg.color}18`,
            border: `1px solid ${cfg.color}33`,
            borderRadius: 4,
            padding: "2px 6px",
            flexShrink: 0,
          }}
        >
          {cfg.label}
        </span>
        <span style={{ fontSize: 11, color: "rgba(224,224,240,0.35)", marginLeft: "auto" }}>
          {ts}
        </span>
      </div>
      {event.message && (
        <span style={{ fontSize: 13, color: "rgba(224,224,240,0.85)", lineHeight: 1.5 }}>
          {event.message}
        </span>
      )}
      {event.data && (
        <pre
          style={{
            margin: 0,
            fontSize: 11,
            color: "rgba(224,224,240,0.4)",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 4,
            padding: "4px 8px",
            overflow: "auto",
          }}
        >
          {JSON.stringify(event.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Inner component (needs SnaProvider context) ───────────────────────────────

function HelloApp() {
  const [name, setName] = useState("World");

  const { skills, events, connected, isRunning, clearEvents } = useSnaClient({
    bindSkills,
    skills: ["hello"],
  });

  const running = isRunning("hello");

  const handleSayHello = async () => {
    if (running || !name.trim()) return;
    try {
      await skills.hello({ name: name.trim() });
    } catch {
      // error event will appear in the stream
    }
  };

  return (
    <div style={styles.root}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        input:focus {
          border-color: rgba(124,58,237,0.6) !important;
        }
        button:hover:not(:disabled) {
          filter: brightness(1.1);
        }
      `}</style>

      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <h1 style={styles.title}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={28} height={28}>
              <rect width="512" height="512" rx="96" fill="#2d2548" />
              <polygon
                points="332,56 192,272 284,272 178,460 340,232 248,232"
                fill="url(#bolt)"
                stroke="url(#bolt)"
                strokeWidth="8"
                strokeLinejoin="round"
                paintOrder="stroke fill"
              />
              <defs>
                <linearGradient id="bolt" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fafafa" />
                  <stop offset="100%" stopColor="#c4b5fd" />
                </linearGradient>
              </defs>
            </svg>
            hello-sna
          </h1>
          <p style={styles.subtitle}>
            Minimal SNA sample. Invoke a skill, watch events flow from Claude Code to this UI in real time.
          </p>
          <div style={styles.statusRow}>
            <span style={styles.dot(connected)} />
            <span>{connected ? "Connected to SNA API" : "Connecting to SNA API..."}</span>
          </div>
        </div>

        {/* Invoke card */}
        <div style={styles.card}>
          <span style={styles.label}>Invoke skill</span>
          <div style={styles.inputRow}>
            <input
              style={styles.input}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSayHello()}
              placeholder="Enter a name..."
              disabled={running}
            />
            <button
              style={styles.button(running || !name.trim())}
              onClick={handleSayHello}
              disabled={running || !name.trim()}
            >
              {running ? "Running..." : "Say Hello"}
            </button>
          </div>
          <div style={styles.pipelineNote}>
            Calls <code style={{ color: "#c4b5fd" }}>skills.hello({"{ name }"})</code> →
            SDK spawns a Claude Code session →
            Claude reads <code style={{ color: "#c4b5fd" }}>.claude/skills/hello/SKILL.md</code> →
            emits events → SSE → this UI updates.
          </div>
        </div>

        {/* Event log */}
        <div style={styles.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={styles.label}>Event log</span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: "rgba(224,224,240,0.3)",
              }}
            >
              {events.length} event{events.length !== 1 ? "s" : ""}
            </span>
            {events.length > 0 && (
              <button style={styles.clearButton} onClick={clearEvents}>
                Clear
              </button>
            )}
          </div>

          <div style={styles.eventList}>
            {events.length === 0 ? (
              <div style={styles.emptyState}>
                No events yet. Click "Say Hello" to start the pipeline.
              </div>
            ) : (
              [...events].reverse().map((e) => (
                <EventCard key={e.id} event={e} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <SnaProvider dangerouslySkipPermissions>
      <HelloApp />
    </SnaProvider>
  );
}
