import { FormEvent, useEffect, useMemo, useState, type ComponentType, type CSSProperties } from "react";
import ClaudeCode from "@lobehub/icons/es/ClaudeCode";
import Codex from "@lobehub/icons/es/Codex";
import Cursor from "@lobehub/icons/es/Cursor";
import Grok from "@lobehub/icons/es/Grok";
import OpenCode from "@lobehub/icons/es/OpenCode";
import { Activity, AlertTriangle, CheckCircle2, Database, Loader2, Plus, RefreshCw, Save, ServerCog, SlidersHorizontal } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select";
import { EmptyState, ErrorText, Panel, StatusBadge } from "../components/ui";
import {
  useAgentAuditQuery,
  useRegisteredRuntimesQuery,
  useRegisterRuntimeMutation,
  useRuntimeCatalogQuery,
  useRuntimeModelsQuery,
  useRuntimeProfileMutation,
  useRuntimeProfilesQuery,
} from "../queries";
import type { ReasoningLevel, RegisteredRuntime, RuntimeCatalogEntry, RuntimeModelInfo, RuntimeProfile } from "../api";
import { useTheme } from "../theme";

const reasoningLevels = [0, 1, 2, 3, 4, 5] as const;
const permissionModes = ["", "default", "acceptEdits", "auto", "bypassPermissions", "dontAsk", "plan"] as const;
const noRuntimeValue = "__sna_no_runtime__";
const defaultPermissionValue = "__sna_default_permission__";
const providerDefaultModelValue = "__sna_provider_default_model__";

type LobeIconComponent = ComponentType<{
  className?: string;
  size?: number | string;
  style?: CSSProperties;
}>;

interface RuntimeIconSpec {
  dark: LobeIconComponent;
  light: LobeIconComponent;
}

const runtimeIconSpecs: Record<string, RuntimeIconSpec> = {
  "claude-code": { light: ClaudeCode.Color, dark: ClaudeCode },
  codex: { light: Codex.Color, dark: Codex },
  cursor: { light: Cursor, dark: Cursor },
  grok: { light: Grok, dark: Grok },
  opencode: { light: OpenCode, dark: OpenCode },
};
const runtimeDescriptions: Record<string, string> = {
  "claude-code": "Stateless Claude Code sessions.",
  codex: "Pooled Codex app-server runtime.",
  opencode: "OpenCode daemon runtime.",
  grok: "Grok Build ACP runtime.",
  cursor: "Cursor ACP runtime.",
};

export function RuntimePage() {
  const profiles = useRuntimeProfilesQuery();
  const runtimes = useRegisteredRuntimesQuery();
  const runtimeCatalog = useRuntimeCatalogQuery();
  const audit = useAgentAuditQuery();
  const profileMutation = useRuntimeProfileMutation();
  const runtimeMutation = useRegisterRuntimeMutation();

  const activeSessions = audit.data?.sessions.filter((session) => session.alive).length ?? 0;
  const activeTokens = audit.data?.apps.reduce((sum, app) => sum + app.activeTokenCount, 0) ?? 0;

  return (
    <div className="grid gap-4">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[linear-gradient(135deg,var(--panel),var(--panel-subtle))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.10)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--accent)]">
              <SlidersHorizontal size={13} />
              Runtime Control
            </div>
            <h2 className="text-2xl font-semibold tracking-normal text-[var(--fg)]">Runtime and model registry</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">
              Detected CLIs, daemon registrations, model defaults, and difficulty slots stay separate.
            </p>
          </div>
          <div className="grid gap-2 sm:min-w-[360px] sm:grid-cols-3">
            <HeroMetric label="Detected" value={runtimeCatalog.data?.runtimes.filter((runtime) => runtime.detection.detected).length ?? 0} />
            <HeroMetric label="Registered" value={runtimes.data?.runtimes.length ?? 0} />
            <HeroMetric label="Active" value={activeSessions} />
          </div>
        </div>
      </section>

      <RuntimeSettingsPanel
        runtimeCatalog={runtimeCatalog.data?.runtimes ?? []}
        registeredRuntimes={runtimes.data?.runtimes ?? []}
        catalogError={runtimeCatalog.error}
        catalogFetching={runtimeCatalog.isFetching}
        busy={runtimeMutation.isPending}
        error={runtimeMutation.error}
        onDetect={() => void runtimeCatalog.refetch()}
        onSubmit={(id, input) => runtimeMutation.mutate({ id, input })}
      />

      <ModelSettingsPanel
        runtimes={runtimes.data?.runtimes ?? []}
        runtimeCatalog={runtimeCatalog.data?.runtimes ?? []}
        busy={runtimeMutation.isPending}
        error={runtimeMutation.error}
        onSubmit={(id, input) => runtimeMutation.mutate({ id, input })}
      />

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
        <Select value={runtimeId || noRuntimeValue} onValueChange={(value) => setRuntimeId(value === noRuntimeValue ? "" : value)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noRuntimeValue}>None</SelectItem>
            {runtimes.map((runtime) => (
              <SelectItem key={runtime.id} value={runtime.id}>{runtime.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-3">
        <input className="focus-ring h-9 w-44 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-2 font-mono text-xs text-[var(--fg)]" value={model} onChange={(event) => setModel(event.target.value)} />
      </td>
      <td className="px-3 py-3">
        <Select
          value={permissionMode || defaultPermissionValue}
          onValueChange={(value) => setPermissionMode(value === defaultPermissionValue ? "" : value)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {permissionModes.map((mode) => (
              <SelectItem key={mode || "empty"} value={mode || defaultPermissionValue}>
                {mode || "Default"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-3">
        <Select value={reasoningLevel} onValueChange={setReasoningLevel}>
          <SelectTrigger className="w-24 font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {reasoningLevels.map((level) => <SelectItem key={level} value={String(level)}>{level}</SelectItem>)}
          </SelectContent>
        </Select>
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

function RuntimeSettingsPanel({
  runtimeCatalog,
  registeredRuntimes,
  catalogError,
  catalogFetching,
  busy,
  error,
  onDetect,
  onSubmit,
}: {
  runtimeCatalog: RuntimeCatalogEntry[];
  registeredRuntimes: RegisteredRuntime[];
  catalogError: unknown;
  catalogFetching: boolean;
  busy: boolean;
  error: unknown;
  onDetect: () => void;
  onSubmit: (id: string, input: {
    provider: string;
    label?: string;
    enabled: boolean;
    modelProvider?: string;
    defaultModel?: string;
    cliPath?: string;
    models?: RegisteredRuntime["models"];
  }) => void;
}) {
  const [id, setId] = useState("codex-main");
  const [label, setLabel] = useState("Codex Main");
  const [provider, setProvider] = useState("codex");
  const [cliPath, setCliPath] = useState("");
  const [enabled, setEnabled] = useState(true);
  const selectedRuntime = runtimeCatalog.find((runtime) => runtime.id === provider);
  const canSubmit = Boolean(id.trim() && selectedRuntime);

  useEffect(() => {
    if (!runtimeCatalog.length) return;
    const catalogRuntime = runtimeCatalog.find((runtime) => runtime.id === provider);
    if (catalogRuntime) {
      setLabel((current) => current.trim() ? current : `${catalogRuntime.label} Main`);
      setId((current) => current.trim() ? current : `${catalogRuntime.id}-main`);
      setCliPath((current) => current.trim() ? current : detectedPath(catalogRuntime));
      return;
    }
    const nextRuntime = runtimeCatalog.find((runtime) => runtime.detection.detected) ?? runtimeCatalog[0];
    setProvider(nextRuntime.id);
    setId(`${nextRuntime.id}-main`);
    setLabel(`${nextRuntime.label} Main`);
    setCliPath(detectedPath(nextRuntime));
  }, [provider, runtimeCatalog]);

  function changeProvider(nextProvider: string) {
    const previousDefaultId = `${provider}-main`;
    const previousDefaultLabel = selectedRuntime ? `${selectedRuntime.label} Main` : "";
    const nextRuntime = runtimeCatalog.find((runtime) => runtime.id === nextProvider);
    const nextDefaultId = `${nextProvider}-main`;
    const nextDefaultLabel = `${nextRuntime?.label ?? nextProvider} Main`;
    setProvider(nextProvider);
    setId((current) => !current.trim() || current === previousDefaultId ? nextDefaultId : current);
    setLabel((current) => !current.trim() || current === previousDefaultLabel ? nextDefaultLabel : current);
    setCliPath(detectedPath(nextRuntime));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(id.trim(), {
      provider: provider.trim(),
      label: label.trim() || undefined,
      enabled,
      cliPath: cliPath.trim() || undefined,
    });
  }

  return (
    <Panel
      title="Runtime Settings"
      action={
        <button
          className="focus-ring inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] px-3 font-mono text-[10px] font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg-soft)]"
          type="button"
          onClick={onDetect}
          disabled={catalogFetching}
        >
          {catalogFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Detect
        </button>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {runtimeCatalog.map((runtime) => (
            <RuntimeChoiceCard
              key={runtime.id}
              runtime={runtime}
              selected={runtime.id === provider}
              registered={registeredRuntimes.some((candidate) => candidate.provider === runtime.id)}
              onSelect={() => changeProvider(runtime.id)}
            />
          ))}
          {!runtimeCatalog.length ? <EmptyState>No supported runtimes loaded</EmptyState> : null}
        </div>

        <form className="grid min-w-0 gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-4" onSubmit={submit}>
          {selectedRuntime ? (
            <div className="flex min-w-0 items-start gap-3">
              <RuntimeIcon runtime={selectedRuntime} className="size-11 rounded-xl border border-[var(--border)] p-2" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-[var(--fg)]">{selectedRuntime.label}</h3>
                  <StatusBadge tone={selectedRuntime.detection.detected ? "good" : "warn"}>
                    {selectedRuntime.detection.detected ? "detected" : "missing"}
                  </StatusBadge>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-[var(--fg-muted)]">
                  {selectedRuntime.detection.version || selectedRuntime.detection.message || selectedRuntime.detection.source}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ID" value={id} onChange={setId} placeholder="codex-main" />
            <Field label="Label" value={label} onChange={setLabel} placeholder="Codex Main" />
            <Field className="sm:col-span-2" label="CLI path" value={cliPath} onChange={setCliPath} placeholder={selectedRuntime?.detection.path || "/usr/local/bin/codex"} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedRuntime ? (
              <>
                <StatusBadge tone={selectedRuntime.supportsRuntimePooling ? "good" : "neutral"}>{selectedRuntime.supportsRuntimePooling ? "pooled" : "per session"}</StatusBadge>
                <StatusBadge tone={selectedRuntime.supportsCwdPerThread ? "good" : "neutral"}>{selectedRuntime.supportsCwdPerThread ? "cwd/thread" : "cwd/process"}</StatusBadge>
                <StatusBadge tone="neutral">{selectedRuntime.detection.source}</StatusBadge>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
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

          {catalogError ? <ErrorText error={catalogError} /> : null}
          {error ? <ErrorText error={error} /> : null}
        </form>
      </div>
    </Panel>
  );
}

function ModelSettingsPanel({
  runtimes,
  runtimeCatalog,
  busy,
  error,
  onSubmit,
}: {
  runtimes: RegisteredRuntime[];
  runtimeCatalog: RuntimeCatalogEntry[];
  busy: boolean;
  error: unknown;
  onSubmit: (id: string, input: {
    provider: string;
    label?: string;
    enabled: boolean;
    modelProvider?: string;
    defaultModel?: string;
    cliPath?: string;
    models?: RegisteredRuntime["models"];
  }) => void;
}) {
  const [runtimeId, setRuntimeId] = useState("");
  const selectedRuntime = runtimes.find((runtime) => runtime.id === runtimeId) ?? runtimes[0];
  const catalogRuntime = selectedRuntime ? runtimeCatalog.find((runtime) => runtime.id === selectedRuntime.provider) : undefined;
  const models = useRuntimeModelsQuery(selectedRuntime?.provider ?? "", selectedRuntime?.cliPath ?? "", Boolean(selectedRuntime));
  const modelOptions = models.data?.models ?? [];
  const [defaultModel, setDefaultModel] = useState("");
  const selectedModel = modelOptions.find((model) => model.id === defaultModel);

  useEffect(() => {
    if (!runtimeId && runtimes[0]) setRuntimeId(runtimes[0].id);
  }, [runtimeId, runtimes]);

  useEffect(() => {
    setDefaultModel(selectedRuntime?.defaultModel ?? "");
  }, [selectedRuntime?.id, selectedRuntime?.defaultModel]);

  useEffect(() => {
    if (!defaultModel || !modelOptions.length) return;
    if (!modelOptions.some((model) => model.id === defaultModel)) setDefaultModel("");
  }, [defaultModel, modelOptions]);

  function saveModelSettings() {
    if (!selectedRuntime) return;
    const registeredModels = selectedModel
      ? [{ id: selectedModel.id, label: selectedModel.label, provider: selectedModel.provider }]
      : [];
    onSubmit(selectedRuntime.id, {
      provider: selectedRuntime.provider,
      label: selectedRuntime.label,
      enabled: selectedRuntime.enabled,
      cliPath: selectedRuntime.cliPath,
      defaultModel,
      modelProvider: selectedModel?.provider ?? "",
      models: registeredModels,
    });
  }

  return (
    <Panel
      title="Model Settings"
      action={<StatusBadge tone={models.isError ? "bad" : "neutral"}>{modelOptions.length} models</StatusBadge>}
    >
      {!runtimes.length ? <EmptyState>No registered runtimes</EmptyState> : null}
      {runtimes.length ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.42fr)_minmax(0,1fr)]">
          <div className="grid gap-2">
            {runtimes.map((runtime) => (
              <button
                key={runtime.id}
                type="button"
                onClick={() => setRuntimeId(runtime.id)}
                className={`focus-ring flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition ${
                  selectedRuntime?.id === runtime.id
                    ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] bg-[var(--panel-subtle)] hover:border-[var(--border-strong)]"
                }`}
              >
                {runtimeCatalog.find((candidate) => candidate.id === runtime.provider) ? (
                  <RuntimeIcon runtime={runtimeCatalog.find((candidate) => candidate.id === runtime.provider)!} className="size-9 rounded-lg border border-[var(--border)] p-2" />
                ) : null}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[var(--fg)]">{runtime.label}</span>
                  <span className="block truncate font-mono text-[10px] text-[var(--fg-muted)]">{runtime.id}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="grid min-w-0 gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-[var(--fg)]">{selectedRuntime?.label}</h3>
                <p className="truncate font-mono text-[11px] text-[var(--fg-muted)]">
                  {catalogRuntime?.label ?? selectedRuntime?.provider} - {selectedRuntime?.cliPath || "provider path"}
                </p>
              </div>
              {models.isFetching ? <StatusBadge tone="neutral">loading</StatusBadge> : null}
            </div>

            <label className="grid min-w-0 gap-1">
              <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">Default model</span>
              <Select
                value={defaultModel || providerDefaultModelValue}
                onValueChange={(value) => setDefaultModel(value === providerDefaultModelValue ? "" : value)}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={providerDefaultModelValue}>Provider default</SelectItem>
                  {modelOptions.map((model) => (
                    <SelectItem key={`${model.provider}:${model.id}`} value={model.id}>
                      {formatModelOption(model)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <div className="grid gap-2 sm:grid-cols-3">
              <ModelStat label="Source" value={models.data?.source ?? "pending"} />
              <ModelStat label="Provider" value={selectedModel?.provider ?? selectedRuntime?.modelProvider ?? "default"} />
              <ModelStat label="Selected" value={defaultModel || "default"} />
            </div>

            {models.isError ? <ErrorText error={models.error} /> : null}
            {models.data?.error ? <div className="font-mono text-[10px] font-medium text-[var(--warn)]">{models.data.error}</div> : null}
            {error ? <ErrorText error={error} /> : null}

            <div className="flex justify-end">
              <button
                className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
                type="button"
                disabled={busy || !selectedRuntime}
                onClick={saveModelSettings}
              >
                <Save size={15} />
                Save Models
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function formatModelOption(model: RuntimeModelInfo): string {
  const label = model.label && model.label !== model.id ? `${model.label} (${model.id})` : model.id;
  return `${label} - ${model.provider}`;
}

function HeroMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-right backdrop-blur">
      <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--fg)]">{value}</div>
    </div>
  );
}

function RuntimeChoiceCard({
  runtime,
  selected,
  registered,
  onSelect,
}: {
  runtime: RuntimeCatalogEntry;
  selected: boolean;
  registered: boolean;
  onSelect: () => void;
}) {
  const detected = runtime.detection.detected;
  const description = runtimeDescriptions[runtime.id] ?? "Agent runtime.";
  const path = detectedPath(runtime) || runtime.detection.message || "No CLI detected";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`focus-ring flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition ${
        selected
          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] shadow-[0_14px_38px_rgba(109,75,208,0.13)]"
          : "border-[var(--border)] bg-[var(--panel-subtle)] hover:border-[var(--border-strong)] hover:bg-[var(--panel)]"
      }`}
    >
      <RuntimeIcon runtime={runtime} className="size-11 shrink-0 rounded-xl border border-[var(--border)] p-2" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-[var(--fg)]">{runtime.label}</span>
          {detected ? <CheckCircle2 size={15} className="shrink-0 text-[var(--good)]" /> : <AlertTriangle size={15} className="shrink-0 text-[var(--warn)]" />}
        </span>
        <span className="mt-1 block text-xs leading-5 text-[var(--fg-muted)]">{description}</span>
        <span className="mt-2 block truncate font-mono text-[10px] text-[var(--fg-faint)]">{path}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2">
        <StatusBadge tone={detected ? "good" : "warn"}>{detected ? "detected" : "missing"}</StatusBadge>
        {registered ? <span className="font-mono text-[10px] font-medium text-[var(--accent)]">registered</span> : null}
      </span>
    </button>
  );
}

function RuntimeIcon({ runtime, className = "" }: { runtime: RuntimeCatalogEntry; className?: string }) {
  const { theme } = useTheme();
  const spec = runtimeIconSpecs[runtime.id] ?? runtimeIconSpecs.opencode;
  const Icon = theme === "dark" ? spec.dark : spec.light;
  return (
    <span aria-hidden="true" className={`runtime-icon-frame ${className}`}>
      <Icon className="runtime-icon-glyph" size="100%" />
    </span>
  );
}

function ModelStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-3 py-2">
      <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-[var(--fg)]">{value}</div>
    </div>
  );
}

function detectedPath(runtime?: RuntimeCatalogEntry): string {
  if (!runtime?.detection.detected) return "";
  return runtime.detection.path;
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
      <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">{label}</span>
      <input
        className="focus-ring h-9 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-faint)]"
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
