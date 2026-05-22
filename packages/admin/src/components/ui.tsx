import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

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

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton-shimmer rounded-md ${className}`} />;
}

export function TableSkeleton({ columns = 4, rows = 4 }: { columns?: number; rows?: number }) {
  const gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className="grid gap-2">
      <span className="sr-only">Loading</span>
      <div className="grid gap-3 border-b border-[var(--border)] pb-2" style={{ gridTemplateColumns }}>
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-3 w-2/3" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid gap-3 border-b border-[var(--border)] py-3 last:border-0"
          style={{ gridTemplateColumns }}
        >
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={columnIndex === columns - 1 ? "h-4 w-full" : "h-4 w-3/4"}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface ErrorDisplay {
  title: string;
  message: string;
  detail?: string;
  status?: number;
}

export function getErrorDisplay(error: unknown): ErrorDisplay {
  const status = getErrorStatus(error);
  const rawMessage = getErrorMessage(error);

  if (status === 401) {
    return {
      title: "Admin session required",
      message: "Open this console from the daemon /admin URL, then reload the page to refresh the local admin cookie.",
      detail: rawMessage,
      status,
    };
  }

  if (status === 403) {
    return {
      title: "Permission denied",
      message: "This browser session is connected, but it is not allowed to use this admin operation.",
      detail: rawMessage,
      status,
    };
  }

  if (rawMessage.toLowerCase().includes("failed to fetch")) {
    return {
      title: "Daemon unavailable",
      message: "Check that the local SNA daemon is running, then reload this page.",
      detail: rawMessage,
    };
  }

  return {
    title: "Request failed",
    message: rawMessage,
    status,
  };
}

export function ErrorText({ error }: { error: unknown }) {
  const display = getErrorDisplay(error);
  return (
    <div role="alert" className="rounded-xl border border-red-500/20 bg-[var(--bad-soft)] px-3 py-3 text-[var(--bad)]">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold text-sm text-[var(--bad)]">{display.title}</div>
          <div className="mt-1 text-sm leading-5 text-[var(--bad)]">{display.message}</div>
          {display.detail && display.detail !== display.message ? (
            <div className="mt-2 break-all font-mono text-[10px] font-medium opacity-75">
              {display.status ? `${display.status} ` : ""}{display.detail}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function InlineErrorText({ error }: { error: unknown }) {
  const display = getErrorDisplay(error);
  return (
    <span role="alert" className="font-mono text-[10px] font-medium text-[var(--bad)]">
      {display.title}: {display.detail ?? display.message}
    </span>
  );
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}
