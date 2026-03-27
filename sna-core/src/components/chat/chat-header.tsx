"use client";

interface ChatHeaderProps {
  onClose: () => void;
  onClear: () => void;
  isRunning: boolean;
}

export function ChatHeader({ onClose, onClear, isRunning }: ChatHeaderProps) {
  return (
    <div
      style={{
        borderBottom: "1px solid var(--sna-chat-border)",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: "var(--sna-radius-sm)",
            background: "var(--sna-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={14}
            height={14}
          >
            <polygon
              points="332,56 192,272 284,272 178,460 340,232 248,232"
              fill="white"
              stroke="white"
              strokeWidth="8"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span
          style={{
            color: "var(--sna-text-muted)",
            fontSize: 14,
            fontWeight: 500,
            fontFamily: "var(--sna-font-sans)",
          }}
        >
          SNA Agent
        </span>
        {isRunning && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "var(--sna-radius-full)",
              background: "var(--sna-success)",
              animation: "sna-pulse 2s ease-in-out infinite",
            }}
          />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={onClear}
          style={{
            color: "var(--sna-text-icon)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
          }}
          aria-label="Clear chat"
          title="Clear chat"
        >
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
            <path
              d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          onClick={onClose}
          style={{
            color: "var(--sna-text-icon)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
          }}
          aria-label="Close chat"
        >
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
