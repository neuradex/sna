"use client";

export function TypingIndicator() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div
        style={{
          background: "var(--sna-surface)",
          border: "1px solid var(--sna-surface-border)",
          borderRadius: "var(--sna-radius-xl) var(--sna-radius-xl) var(--sna-radius-xl) var(--sna-radius-sm)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "var(--sna-radius-full)",
              background: "var(--sna-text-icon)",
              animation: `sna-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
