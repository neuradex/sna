import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, CheckCircle2, Database, Loader2, Plus, RefreshCw, Save, ServerCog, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "../components/dialog";
import { RuntimeIcon, detectedPath } from "../components/runtime-icon";
import { EmptyState, ErrorText, Panel, StatusBadge } from "../components/ui";
import {
  useAgentAuditQuery,
  useDeleteRuntimeMutation,
  useRegisteredRuntimesQuery,
  useRegisterRuntimeMutation,
  useRuntimeCatalogQuery,
} from "../queries";
import type { RegisteredRuntime, RuntimeCatalogEntry } from "../api";

export function RuntimePage() {
  const catalog = useRuntimeCatalogQuery();
  const runtimes = useRegisteredRuntimesQuery();
  const audit = useAgentAuditQuery();
  const runtimeMutation = useRegisterRuntimeMutation();
  const deleteRuntimeMutation = useDeleteRuntimeMutation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialProvider, setInitialProvider] = useState<string | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<RegisteredRuntime | null>(null);

  const catalogEntries = catalog.data?.runtimes ?? [];
  const registeredRuntimes = runtimes.data?.runtimes ?? [];
  const catalogById = useMemo(() => new Map(catalogEntries.map((runtime) => [runtime.id, runtime])), [catalogEntries]);
  const activeSessions = audit.data?.sessions.filter((session) => session.alive).length ?? 0;

  function openAddRuntime(provider?: string) {
    setInitialProvider(provider);
    setDialogOpen(true);
  }

  return (
    <div className="grid gap-4">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[linear-gradient(135deg,var(--panel),var(--panel-subtle))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.10)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--accent)]">
              <ServerCog size={13} />
              Runtime Registry
            </div>
            <h2 className="text-2xl font-semibold tracking-normal text-[var(--fg)]">Runtimes</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">
              Registered CLIs and daemon runtimes.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid gap-2 sm:min-w-[240px] sm:grid-cols-2">
              <HeroMetric label="Registered" value={registeredRuntimes.length} />
              <HeroMetric label="Active" value={activeSessions} />
            </div>
            <button
              type="button"
              className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
              onClick={() => openAddRuntime()}
            >
              <Plus size={16} />
              Add Runtime
            </button>
          </div>
        </div>
      </section>

      <Panel
        title="Registered Runtimes"
        action={<StatusBadge tone={runtimes.isError ? "bad" : "neutral"}>{registeredRuntimes.length} runtimes</StatusBadge>}
      >
        {runtimes.isError ? <ErrorText error={runtimes.error} /> : null}
        {registeredRuntimes.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {registeredRuntimes.map((runtime) => (
              <RegisteredRuntimeCard
                key={runtime.id}
                runtime={runtime}
                catalogRuntime={catalogById.get(runtime.provider)}
                deleting={deleteRuntimeMutation.isPending && deleteRuntimeMutation.variables?.id === runtime.id}
                onDelete={() => setDeleteTarget(runtime)}
              />
            ))}
          </div>
        ) : (
          <EmptyState>No registered runtimes</EmptyState>
        )}
      </Panel>

      <Panel
        title="Runtime Audit"
        action={<StatusBadge tone={audit.isError ? "bad" : "neutral"}>{audit.data?.runtimes.length ?? 0} tracked</StatusBadge>}
      >
        {audit.isError ? <ErrorText error={audit.error} /> : null}
        {audit.isSuccess ? (
          <div className="grid gap-3 md:grid-cols-3">
            <AuditMetric icon={<ServerCog size={18} />} label="Registered" value={audit.data.runtimes.length} />
            <AuditMetric icon={<Activity size={18} />} label="Active Sessions" value={activeSessions} />
            <AuditMetric icon={<Database size={18} />} label="Client Apps" value={audit.data.apps.length} />
          </div>
        ) : null}
      </Panel>

      <AddRuntimeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        runtimeCatalog={catalogEntries}
        registeredRuntimes={registeredRuntimes}
        catalogLoading={catalog.isFetching}
        catalogError={catalog.error}
        onRefreshCatalog={() => void catalog.refetch()}
        initialProvider={initialProvider}
        busy={runtimeMutation.isPending}
        error={runtimeMutation.error}
        onSubmit={(id, input) => runtimeMutation.mutate(
          { id, input },
          { onSuccess: () => setDialogOpen(false) },
        )}
      />
      <DeleteRuntimeDialog
        runtime={deleteTarget}
        open={Boolean(deleteTarget)}
        busy={deleteRuntimeMutation.isPending}
        error={deleteRuntimeMutation.error}
        onOpenChange={(open) => {
          if (!open && !deleteRuntimeMutation.isPending) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteRuntimeMutation.mutate(
            { id: deleteTarget.id },
            { onSuccess: () => setDeleteTarget(null) },
          );
        }}
      />
    </div>
  );
}

function RegisteredRuntimeCard({
  runtime,
  catalogRuntime,
  deleting,
  onDelete,
}: {
  runtime: RegisteredRuntime;
  catalogRuntime?: RuntimeCatalogEntry;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {catalogRuntime ? (
            <RuntimeIcon runtime={catalogRuntime} className="size-11 shrink-0 rounded-xl border border-[var(--border)] p-2" />
          ) : (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] text-[var(--fg-muted)]">
              <ServerCog size={18} />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-[var(--fg)]">{runtime.label}</h3>
              <StatusBadge tone={runtime.enabled ? "good" : "warn"}>{runtime.enabled ? "enabled" : "disabled"}</StatusBadge>
            </div>
            <p className="mt-1 truncate font-mono text-[11px] text-[var(--fg-muted)]">{runtime.id}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge tone="neutral">{runtime.provider}</StatusBadge>
          <button
            type="button"
            className="focus-ring inline-flex size-8 items-center justify-center rounded-lg border border-red-500/20 bg-[var(--bad-soft)] text-[var(--bad)] transition hover:border-red-500/40"
            title="Delete runtime"
            aria-label={`Delete ${runtime.label}`}
            disabled={deleting}
            onClick={onDelete}
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <RuntimeFact label="CLI Path" value={runtime.cliPath || catalogRuntime?.detection.path || "provider default"} />
        <RuntimeFact label="Model Default" value={runtime.defaultModel || "provider default"} />
      </div>
    </article>
  );
}

function DeleteRuntimeDialog({
  runtime,
  open,
  busy,
  error,
  onOpenChange,
  onConfirm,
}: {
  runtime: RegisteredRuntime | null;
  open: boolean;
  busy: boolean;
  error: unknown;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" title="Delete runtime" description="Remove this runtime registration.">
        {runtime ? (
          <div className="grid gap-4">
            <div className="rounded-xl border border-red-500/20 bg-[var(--bad-soft)] p-3">
              <div className="font-semibold text-[var(--fg)]">{runtime.label}</div>
              <div className="mt-1 font-mono text-xs text-[var(--fg-muted)]">{runtime.id}</div>
              <p className="mt-3 text-sm leading-6 text-[var(--fg-soft)]">
                This also removes model presets tied to this runtime and clears profile assignments that reference them.
              </p>
            </div>
            {error ? <ErrorText error={error} /> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="focus-ring inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] px-4 font-mono text-xs font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-[var(--bad-soft)] px-4 font-mono text-xs font-medium text-[var(--bad)] transition hover:border-red-500/50"
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Delete
              </button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CatalogRuntimeOption({
  runtime,
  registered,
  selected,
  onSelect,
}: {
  runtime: RuntimeCatalogEntry;
  registered: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const detected = runtime.detection.detected;
  const path = detectedPath(runtime) || runtime.detection.message || "No CLI detected";

  return (
    <button
      type="button"
      className={`focus-ring flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${selected ? "border-[var(--accent-border)] bg-[var(--accent-soft)] shadow-[0_0_0_1px_var(--accent-border)]" : "border-[var(--border)] bg-[var(--panel-subtle)] hover:border-[var(--border-strong)] hover:bg-[var(--panel-solid)]"}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <RuntimeIcon runtime={runtime} className="size-8 shrink-0 rounded-lg border border-[var(--border)] p-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-[var(--fg)]">{runtime.label}</span>
          {detected ? <CheckCircle2 size={14} className="shrink-0 text-[var(--good)]" /> : <AlertTriangle size={14} className="shrink-0 text-[var(--warn)]" />}
        </div>
        <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--fg-faint)]">{path}</p>
      </div>
      <div className="hidden shrink-0 gap-1.5 sm:flex">
        <StatusBadge tone={detected ? "good" : "warn"}>{detected ? runtime.detection.source : "missing"}</StatusBadge>
        {registered ? <StatusBadge tone="neutral">registered</StatusBadge> : null}
      </div>
    </button>
  );
}

function AddRuntimeDialog({
  open,
  onOpenChange,
  runtimeCatalog,
  registeredRuntimes,
  catalogLoading,
  catalogError,
  onRefreshCatalog,
  initialProvider,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtimeCatalog: RuntimeCatalogEntry[];
  registeredRuntimes: RegisteredRuntime[];
  catalogLoading: boolean;
  catalogError: unknown;
  onRefreshCatalog: () => void;
  initialProvider?: string;
  busy: boolean;
  error: unknown;
  onSubmit: (id: string, input: {
    provider: string;
    label?: string;
    enabled: boolean;
    cliPath?: string;
  }) => void;
}) {
  const [provider, setProvider] = useState("");
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [cliPath, setCliPath] = useState("");
  const [enabled, setEnabled] = useState(true);
  const selectedRuntime = runtimeCatalog.find((runtime) => runtime.id === provider);

  useEffect(() => {
    if (!open || !runtimeCatalog.length) return;
    const nextRuntime = runtimeCatalog.find((runtime) => runtime.id === initialProvider)
      ?? runtimeCatalog.find((runtime) => runtime.detection.detected)
      ?? runtimeCatalog[0];
    applyRuntime(nextRuntime);
  }, [open, initialProvider, runtimeCatalog]);

  function applyRuntime(runtime: RuntimeCatalogEntry) {
    setProvider(runtime.id);
    setId(`${runtime.id}-main`);
    setLabel(`${runtime.label} Main`);
    setCliPath(detectedPath(runtime));
    setEnabled(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id.trim() || !provider) return;
    onSubmit(id.trim(), {
      provider,
      label: label.trim() || undefined,
      enabled,
      cliPath: cliPath.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" title="Add runtime" description="Register a local agent runtime.">
        <form className="grid gap-3" onSubmit={submit}>
          <section className="grid gap-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div>
                <div className="field-label">Runtime Catalog</div>
                <p className="mt-1 text-xs text-[var(--fg-muted)]">Detected local CLIs and supported providers.</p>
              </div>
              <button
                type="button"
                className="focus-ring inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] px-3 font-mono text-[10px] font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg-soft)]"
                onClick={onRefreshCatalog}
                disabled={catalogLoading}
              >
                {catalogLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Detect
              </button>
            </div>
            {catalogError ? <ErrorText error={catalogError} /> : null}
            {runtimeCatalog.length ? (
              <div className="grid gap-2">
                {runtimeCatalog.map((runtime) => (
                  <CatalogRuntimeOption
                    key={runtime.id}
                    runtime={runtime}
                    selected={runtime.id === provider}
                    registered={registeredRuntimes.some((candidate) => candidate.provider === runtime.id)}
                    onSelect={() => applyRuntime(runtime)}
                  />
                ))}
              </div>
            ) : catalogLoading ? (
              <EmptyState>Detecting runtimes...</EmptyState>
            ) : (
              <EmptyState>No supported runtimes loaded</EmptyState>
            )}
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ID" value={id} onChange={setId} placeholder="codex-main" />
            <Field label="Label" value={label} onChange={setLabel} placeholder="Codex Main" />
            <Field className="sm:col-span-2" label="CLI Path" value={cliPath} onChange={setCliPath} placeholder={selectedRuntime?.detection.path || "/usr/local/bin/codex"} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 font-mono text-xs text-[var(--fg-muted)]">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              enabled
            </label>
            <button
              type="submit"
              disabled={busy || !id.trim() || !provider}
              className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
            >
              <Save size={15} />
              Register
            </button>
          </div>
          {error ? <ErrorText error={error} /> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HeroMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-right backdrop-blur">
      <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--fg)]">{value}</div>
    </div>
  );
}

function RuntimeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-3 py-2">
      <div className="field-label">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-[var(--fg)]">{value}</div>
    </div>
  );
}

function AuditMetric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-3">
      <div className="flex size-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] text-[var(--accent)]">{icon}</div>
      <div>
        <div className="field-label">{label}</div>
        <div className="text-xl font-semibold text-[var(--fg)]">{value}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`grid min-w-0 gap-1 ${className}`}>
      <span className="field-label">{label}</span>
      <input
        className="focus-ring h-10 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-3 text-sm text-[var(--fg)] placeholder:text-[var(--fg-faint)]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
