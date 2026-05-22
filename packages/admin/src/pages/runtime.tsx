import { FormEvent, useEffect, useMemo, useState } from "react";
import { Activity, Database, Plus, Save, ServerCog } from "lucide-react";
import { EmptyState, ErrorText, Panel, StatusBadge } from "../components/ui";
import { useAuthToken } from "../auth-token";
import {
  useAgentAuditQuery,
  useRegisteredRuntimesQuery,
  useRegisterRuntimeMutation,
  useRuntimeProfileMutation,
  useRuntimeProfilesQuery,
} from "../queries";
import type { ReasoningLevel, RegisteredRuntime, RuntimeProfile } from "../api";

const reasoningLevels = [0, 1, 2, 3, 4, 5] as const;
const permissionModes = ["", "default", "acceptEdits", "auto", "bypassPermissions", "dontAsk", "plan"] as const;

export function RuntimePage() {
  const { token } = useAuthToken();
  const profiles = useRuntimeProfilesQuery();
  const runtimes = useRegisteredRuntimesQuery();
  const audit = useAgentAuditQuery();
  const profileMutation = useRuntimeProfileMutation();
  const runtimeMutation = useRegisterRuntimeMutation();

  const activeSessions = audit.data?.sessions.filter((session) => session.alive).length ?? 0;
  const activeTokens = audit.data?.apps.reduce((sum, app) => sum + app.activeTokenCount, 0) ?? 0;

  return (
    <div className="grid gap-4">
      {!token ? <Panel title="Runtime Settings"><EmptyState>Enter an auth token to manage runtime settings.</EmptyState></Panel> : null}

      {token ? (
        <>
          <Panel
            title="Difficulty Profiles"
            action={<StatusBadge tone={profiles.isError ? "bad" : "neutral"}>{profiles.data?.profiles.length ?? 0} levels</StatusBadge>}
          >
            {profiles.isError ? <ErrorText error={profiles.error} /> : null}
            {profiles.isSuccess ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">
                      <th className="py-2 pr-3">Level</th>
                      <th className="px-3 py-2">Label</th>
                      <th className="px-3 py-2">Runtime</th>
                      <th className="px-3 py-2">Model</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Reasoning</th>
                      <th className="py-2 pl-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.data.profiles.map((profile) => (
                      <ProfileRow
                        key={profile.level}
                        profile={profile}
                        runtimes={runtimes.data?.runtimes ?? []}
                        busy={profileMutation.isPending && profileMutation.variables?.level === profile.level}
                        error={profileMutation.variables?.level === profile.level ? profileMutation.error : null}
                        onSave={(input) => profileMutation.mutate({ level: profile.level, input })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <Panel title="Register Runtime">
              <RegisterRuntimeForm
                busy={runtimeMutation.isPending}
                error={runtimeMutation.error}
                onSubmit={(id, input) => runtimeMutation.mutate({ id, input })}
              />
            </Panel>

            <Panel
              title="Registered Runtimes"
              action={<StatusBadge tone={runtimes.isError ? "bad" : "neutral"}>{runtimes.data?.runtimes.length ?? 0} runtimes</StatusBadge>}
            >
              {runtimes.isError ? <ErrorText error={runtimes.error} /> : null}
              {runtimes.isSuccess && !runtimes.data.runtimes.length ? <EmptyState>No registered runtimes</EmptyState> : null}
              {runtimes.isSuccess && runtimes.data.runtimes.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">
                        <th className="py-2 pr-3">ID</th>
                        <th className="px-3 py-2">Provider</th>
                        <th className="px-3 py-2">Model</th>
                        <th className="py-2 pl-3">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runtimes.data.runtimes.map((runtime) => (
                        <tr key={runtime.id} className="border-b border-[var(--border)] last:border-0">
                          <td className="py-3 pr-3">
                            <div className="font-semibold text-[var(--fg)]">{runtime.label}</div>
                            <div className="break-all font-mono text-[10px] text-[var(--fg-muted)]">{runtime.id}</div>
                          </td>
                          <td className="px-3 py-3 font-mono text-xs text-[var(--fg-soft)]">{runtime.provider}</td>
                          <td className="px-3 py-3 font-mono text-xs text-[var(--fg-soft)]">{runtime.defaultModel || runtime.config?.model || ""}</td>
                          <td className="py-3 pl-3"><StatusBadge tone={runtime.enabled ? "good" : "warn"}>{runtime.enabled ? "enabled" : "disabled"}</StatusBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Panel>
          </div>

          <Panel title="Audit">
            {audit.isError ? <ErrorText error={audit.error} /> : null}
            {audit.isSuccess ? (
              <div className="grid gap-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <AuditMetric icon={<ServerCog size={18} />} label="Registered runtimes" value={audit.data.runtimes.length} />
                  <AuditMetric icon={<Activity size={18} />} label="Active sessions" value={activeSessions} />
                  <AuditMetric icon={<Database size={18} />} label="Active app tokens" value={activeTokens} />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <AuditTable
                    title="Runtime Usage"
                    empty="No runtime usage"
                    headers={["Runtime", "Active", "Total"]}
                    rows={audit.data.runtimes.map((runtime) => [
                      `${runtime.label} (${runtime.id})`,
                      String(runtime.activeSessionCount),
                      String(runtime.sessionCount),
                    ])}
                  />
                  <AuditTable
                    title="Apps"
                    empty="No authorized apps"
                    headers={["Client", "Scopes", "Tokens"]}
                    rows={audit.data.apps.map((app) => [
                      app.displayName || app.clientId,
                      app.scopes.join(", ") || "none",
                      `${app.activeTokenCount}/${app.tokenCount}`,
                    ])}
                  />
                </div>

                <AuditTable
                  title="Sessions"
                  empty="No sessions"
                  headers={["Session", "Runtime", "Profile", "Model"]}
                  rows={audit.data.sessions.map((session) => [
                    `${session.label || session.id} (${session.state})`,
                    session.runtimeId || session.provider || "",
                    session.profileLevel ? `Level ${session.profileLevel}` : "",
                    session.model || "",
                  ])}
                />
              </div>
            ) : null}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function ProfileRow({
  profile,
  runtimes,
  busy,
  error,
  onSave,
}: {
  profile: RuntimeProfile;
  runtimes: RegisteredRuntime[];
  busy: boolean;
  error: unknown;
  onSave: (input: {
    label: string;
    runtimeId?: string;
    config: {
      model?: string;
      permissionMode?: string;
      reasoningLevel: ReasoningLevel;
    };
  }) => void;
}) {
  const [label, setLabel] = useState(profile.label);
  const [runtimeId, setRuntimeId] = useState(profile.runtimeId ?? "");
  const [model, setModel] = useState(profile.config.model ?? "");
  const [permissionMode, setPermissionMode] = useState(profile.config.permissionMode ?? "");
  const [reasoningLevel, setReasoningLevel] = useState(String(profile.config.reasoningLevel ?? profile.level));

  useEffect(() => {
    setLabel(profile.label);
    setRuntimeId(profile.runtimeId ?? "");
    setModel(profile.config.model ?? "");
    setPermissionMode(profile.config.permissionMode ?? "");
    setReasoningLevel(String(profile.config.reasoningLevel ?? profile.level));
  }, [profile]);

  return (
    <tr className="border-b border-[var(--border)] last:border-0 align-top">
      <td className="py-3 pr-3">
        <StatusBadge tone={profile.level >= 4 ? "warn" : "neutral"}>L{profile.level}</StatusBadge>
        <div className="mt-2 max-w-[150px] text-xs text-[var(--fg-muted)]">{profile.description}</div>
      </td>
      <td className="px-3 py-3">
        <input className="focus-ring h-9 w-36 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-2 text-sm text-[var(--fg)]" value={label} onChange={(event) => setLabel(event.target.value)} />
        {error ? <div className="mt-2 font-mono text-[10px] font-medium text-[var(--bad)]">{error instanceof Error ? error.message : String(error)}</div> : null}
      </td>
      <td className="px-3 py-3">
        <select className="focus-ring h-9 w-40 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-2 text-sm text-[var(--fg)]" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>
          <option value="">None</option>
          {runtimes.map((runtime) => (
            <option key={runtime.id} value={runtime.id}>{runtime.label}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-3">
        <input className="focus-ring h-9 w-44 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-2 font-mono text-xs text-[var(--fg)]" value={model} onChange={(event) => setModel(event.target.value)} />
      </td>
      <td className="px-3 py-3">
        <select className="focus-ring h-9 w-40 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-2 text-sm text-[var(--fg)]" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value)}>
          {permissionModes.map((mode) => <option key={mode || "empty"} value={mode}>{mode || "Default"}</option>)}
        </select>
      </td>
      <td className="px-3 py-3">
        <select className="focus-ring h-9 w-24 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-2 font-mono text-xs text-[var(--fg)]" value={reasoningLevel} onChange={(event) => setReasoningLevel(event.target.value)}>
          {reasoningLevels.map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
      </td>
      <td className="py-3 pl-3 text-right">
        <button
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
          type="button"
          disabled={busy || !label.trim()}
          onClick={() => onSave({
            label: label.trim(),
            ...(runtimeId ? { runtimeId } : {}),
            config: {
              ...(model.trim() ? { model: model.trim() } : {}),
              ...(permissionMode ? { permissionMode } : {}),
              reasoningLevel: Number(reasoningLevel) as ReasoningLevel,
            },
          })}
        >
          <Save size={15} />
          Save
        </button>
      </td>
    </tr>
  );
}

function RegisterRuntimeForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: unknown;
  onSubmit: (id: string, input: {
    provider: string;
    label?: string;
    enabled: boolean;
    modelProvider?: string;
    defaultModel?: string;
    cliPath?: string;
  }) => void;
}) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState("codex");
  const [modelProvider, setModelProvider] = useState("openai");
  const [defaultModel, setDefaultModel] = useState("");
  const [cliPath, setCliPath] = useState("");
  const [enabled, setEnabled] = useState(true);
  const canSubmit = id.trim() && provider.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(id.trim(), {
      provider: provider.trim(),
      label: label.trim() || undefined,
      enabled,
      modelProvider: modelProvider.trim() || undefined,
      defaultModel: defaultModel.trim() || undefined,
      cliPath: cliPath.trim() || undefined,
    });
  }

  return (
    <form className="grid gap-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ID" value={id} onChange={setId} placeholder="codex-main" />
        <Field label="Label" value={label} onChange={setLabel} placeholder="Codex Main" />
        <Field label="Provider" value={provider} onChange={setProvider} placeholder="codex" />
        <Field label="Model provider" value={modelProvider} onChange={setModelProvider} placeholder="openai" />
        <Field label="Default model" value={defaultModel} onChange={setDefaultModel} placeholder="gpt-5.4" />
        <Field label="CLI path" value={cliPath} onChange={setCliPath} placeholder="/usr/local/bin/codex" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 font-mono text-xs text-[var(--fg-muted)]">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          enabled
        </label>
        <button
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
          type="submit"
          disabled={busy || !canSubmit}
        >
          <Plus size={15} />
          Register
        </button>
      </div>
      {error ? <ErrorText error={error} /> : null}
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">{label}</span>
      <input
        className="focus-ring h-9 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-faint)]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function AuditMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[var(--accent)]">{icon}</div>
        <StatusBadge>{value}</StatusBadge>
      </div>
      <div className="text-sm font-semibold text-[var(--fg)]">{label}</div>
    </div>
  );
}

function AuditTable({
  title,
  headers,
  rows,
  empty,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  const widths = useMemo(() => headers.map((_, index) => index === 0 ? "py-2 pr-3" : "px-3 py-2"), [headers]);
  return (
    <div>
      <h3 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{title}</h3>
      {!rows.length ? <EmptyState>{empty}</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">
                {headers.map((header, index) => <th key={header} className={widths[index]}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${title}-${rowIndex}`} className="border-b border-[var(--border)] last:border-0">
                  {row.map((cell, index) => (
                    <td key={`${title}-${rowIndex}-${index}`} className={`${index === 0 ? "py-3 pr-3" : "px-3 py-3"} max-w-[320px] break-words font-mono text-xs text-[var(--fg-soft)]`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
