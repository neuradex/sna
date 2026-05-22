import type { ReactNode } from "react";

export function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] backdrop-blur">
      <div className="mb-3 flex min-h-8 min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const className = {
    neutral: "border-[var(--border)] bg-[var(--panel-subtle)] text-[var(--fg-muted)]",
    good: "border-emerald-500/20 bg-[var(--good-soft)] text-[var(--good)]",
    warn: "border-amber-500/20 bg-[var(--warn-soft)] text-[var(--warn)]",
    bad: "border-red-500/20 bg-[var(--bad-soft)] text-[var(--bad)]",
  }[tone];
  return (
    <span className={`inline-flex h-7 items-center rounded-md border px-2 font-mono text-[10px] font-medium ${className}`}>
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel-subtle)] px-3 py-5 text-sm text-[var(--fg-muted)]">
      {children}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return <div className="rounded-lg border border-red-500/20 bg-[var(--bad-soft)] px-3 py-2 font-mono text-xs font-medium text-[var(--bad)]">{message}</div>;
}
