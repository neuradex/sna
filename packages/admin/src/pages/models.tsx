import { FormEvent, useEffect, useMemo, useState } from "react";
import { Edit3, Layers, Loader2, Plus, Save, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent } from "../components/dialog";
import { RuntimeIcon } from "../components/runtime-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select";
import { EmptyState, ErrorText, Panel, StatusBadge } from "../components/ui";
import {
  useModelPresetMutation,
  useModelPresetsQuery,
  useRegisteredRuntimesQuery,
  useRuntimeCatalogQuery,
  useRuntimeModelsQuery,
  useRuntimeProfileMutation,
  useRuntimeProfilesQuery,
} from "../queries";
import type { DifficultyLevel, ModelPreset, RegisteredRuntime, RuntimeCatalogEntry, RuntimeProfile } from "../api";

const noPresetValue = "__sna_no_model_preset__";
const providerDefaultModelValue = "__sna_provider_default_model__";
const reasoningLevels = [0, 1, 2, 3, 4, 5] as const;

export function ModelsPage() {
  const presets = useModelPresetsQuery();
  const runtimes = useRegisteredRuntimesQuery();
  const catalog = useRuntimeCatalogQuery();
  const profiles = useRuntimeProfilesQuery();
  const presetMutation = useModelPresetMutation();
  const profileMutation = useRuntimeProfileMutation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<ModelPreset | undefined>();

  const presetRows = presets.data?.presets ?? [];
  const runtimeRows = runtimes.data?.runtimes ?? [];
  const catalogRows = catalog.data?.runtimes ?? [];
  const assignedLevels = profiles.data?.profiles.filter((profile) => profile.modelPresetId).length ?? 0;

  function openPresetDialog(preset?: ModelPreset) {
    setEditingPreset(preset);
    setDialogOpen(true);
  }

  return (
    <div className="grid gap-4">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[linear-gradient(135deg,var(--panel),var(--panel-subtle))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.10)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--accent)]">
              <SlidersHorizontal size={13} />
              Model Defaults
            </div>
            <h2 className="text-2xl font-semibold tracking-normal text-[var(--fg)]">Models</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">
              Named model presets and level defaults.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid gap-2 sm:min-w-[360px] sm:grid-cols-3">
              <HeroMetric label="Presets" value={presetRows.length} />
              <HeroMetric label="Assigned" value={assignedLevels} />
              <HeroMetric label="Runtimes" value={runtimeRows.length} />
            </div>
            <button
              type="button"
              className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
              onClick={() => openPresetDialog()}
            >
              <Plus size={16} />
              Add Model
            </button>
          </div>
        </div>
      </section>

      <Panel
        title="Model Presets"
        action={<StatusBadge tone={presets.isError ? "bad" : "neutral"}>{presetRows.length} presets</StatusBadge>}
      >
        {presets.isError ? <ErrorText error={presets.error} /> : null}
        {!runtimeRows.length ? <EmptyState>Register a runtime before adding model presets</EmptyState> : null}
        {presetRows.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {presetRows.map((preset) => (
              <ModelPresetCard
                key={preset.id}
                preset={preset}
                runtime={runtimeRows.find((runtime) => runtime.id === preset.runtimeId)}
                catalogRuntime={catalogRows.find((runtime) => runtime.id === runtimeRows.find((candidate) => candidate.id === preset.runtimeId)?.provider)}
                onEdit={() => openPresetDialog(preset)}
              />
            ))}
          </div>
        ) : runtimeRows.length ? (
          <EmptyState>No model presets</EmptyState>
        ) : null}
      </Panel>

      <Panel
        title="Level Defaults"
        action={<StatusBadge tone={profiles.isError ? "bad" : "neutral"}>{profiles.data?.profiles.length ?? 0} levels</StatusBadge>}
      >
        {profiles.isError ? <ErrorText error={profiles.error} /> : null}
        {profiles.isSuccess ? (
          <div className="grid gap-3">
            {profiles.data.profiles.map((profile) => (
              <LevelAssignmentRow
                key={profile.level}
                profile={profile}
                presets={presetRows}
                busy={profileMutation.isPending}
                error={profileMutation.error}
                onSave={(modelPresetId) => profileMutation.mutate({
                  level: profile.level as DifficultyLevel,
                  input: {
                    runtimeId: null,
                    modelPresetId,
                  },
                })}
              />
            ))}
          </div>
        ) : null}
      </Panel>

      <ModelPresetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        preset={editingPreset}
        runtimes={runtimeRows}
        runtimeCatalog={catalogRows}
        busy={presetMutation.isPending}
        error={presetMutation.error}
        onSubmit={(id, input) => presetMutation.mutate(
          { id, input },
          { onSuccess: () => setDialogOpen(false) },
        )}
      />
    </div>
  );
}

function ModelPresetCard({
  preset,
  runtime,
  catalogRuntime,
  onEdit,
}: {
  preset: ModelPreset;
  runtime?: RegisteredRuntime;
  catalogRuntime?: RuntimeCatalogEntry;
  onEdit: () => void;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {catalogRuntime ? (
            <RuntimeIcon runtime={catalogRuntime} className="size-11 shrink-0 rounded-xl border border-[var(--border)] p-2" />
          ) : (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] text-[var(--accent)]">
              <Layers size={18} />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[var(--fg)]">{preset.name}</h3>
            <p className="mt-1 truncate font-mono text-[11px] text-[var(--fg-muted)]">{preset.id}</p>
          </div>
        </div>
        <button
          type="button"
          className="focus-ring inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] px-3 font-mono text-[10px] font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
          onClick={onEdit}
        >
          <Edit3 size={14} />
          Edit
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <ModelFact label="Runtime" value={runtime?.label ?? preset.runtimeId} />
        <ModelFact label="Model" value={preset.model || "provider default"} />
        <ModelFact label="Effort" value={String(preset.reasoningLevel)} />
      </div>
    </article>
  );
}

function LevelAssignmentRow({
  profile,
  presets,
  busy,
  error,
  onSave,
}: {
  profile: RuntimeProfile;
  presets: ModelPreset[];
  busy: boolean;
  error: unknown;
  onSave: (modelPresetId: string | null) => void;
}) {
  const [modelPresetId, setModelPresetId] = useState(profile.modelPresetId ?? "");

  useEffect(() => {
    setModelPresetId(profile.modelPresetId ?? "");
  }, [profile.modelPresetId]);

  const selectedPreset = presets.find((preset) => preset.id === modelPresetId);

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-3 lg:grid-cols-[180px_minmax(0,1fr)_auto] lg:items-center">
      <div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={profile.level >= 4 ? "warn" : "neutral"}>L{profile.level}</StatusBadge>
          <span className="font-semibold text-[var(--fg)]">{profile.label}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">{profile.description}</p>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(220px,0.45fr)_minmax(0,1fr)] sm:items-center">
        <Select
          value={modelPresetId || noPresetValue}
          onValueChange={(value) => setModelPresetId(value === noPresetValue ? "" : value)}
        >
          <SelectTrigger className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noPresetValue}>No preset</SelectItem>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-3 py-2">
          <div className="field-label">Default</div>
          <div className="mt-1 truncate text-sm text-[var(--fg)]">
            {selectedPreset ? `${selectedPreset.model || "provider default"} · effort ${selectedPreset.reasoningLevel}` : "unassigned"}
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
          onClick={() => onSave(modelPresetId || null)}
        >
          <Save size={15} />
          Save
        </button>
      </div>
      {error ? <div className="lg:col-span-3"><ErrorText error={error} /></div> : null}
    </div>
  );
}

function ModelPresetDialog({
  open,
  onOpenChange,
  preset,
  runtimes,
  runtimeCatalog,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: ModelPreset;
  runtimes: RegisteredRuntime[];
  runtimeCatalog: RuntimeCatalogEntry[];
  busy: boolean;
  error: unknown;
  onSubmit: (id: string, input: {
    name?: string;
    runtimeId: string;
    model?: string;
    modelProvider?: string;
    reasoningLevel: number;
  }) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [runtimeId, setRuntimeId] = useState("");
  const [model, setModel] = useState("");
  const [modelProvider, setModelProvider] = useState("");
  const [reasoningLevel, setReasoningLevel] = useState("3");
  const selectedRuntime = runtimes.find((runtime) => runtime.id === runtimeId);
  const catalogRuntime = selectedRuntime
    ? runtimeCatalog.find((runtime) => runtime.id === selectedRuntime.provider)
    : undefined;
  const models = useRuntimeModelsQuery(selectedRuntime?.provider ?? "", selectedRuntime?.cliPath ?? "", open && Boolean(selectedRuntime));
  const modelOptions = models.data?.models ?? [];
  const selectedModel = modelOptions.find((candidate) => candidate.id === model);

  useEffect(() => {
    if (!open) return;
    const fallbackRuntime = runtimes[0];
    setId(preset?.id ?? "");
    setName(preset?.name ?? "");
    setRuntimeId(preset?.runtimeId ?? fallbackRuntime?.id ?? "");
    setModel(preset?.model ?? "");
    setModelProvider(preset?.modelProvider ?? "");
    setReasoningLevel(String(preset?.reasoningLevel ?? 3));
  }, [open, preset, runtimes]);

  function changeName(nextName: string) {
    setName(nextName);
    if (!preset && (!id.trim() || id === slugify(name))) {
      setId(slugify(nextName));
    }
  }

  function changeRuntime(nextRuntimeId: string) {
    setRuntimeId(nextRuntimeId);
    setModel("");
    setModelProvider("");
  }

  function changeModel(nextModel: string) {
    if (nextModel === providerDefaultModelValue) {
      setModel("");
      setModelProvider("");
      return;
    }
    setModel(nextModel);
    const option = modelOptions.find((candidate) => candidate.id === nextModel);
    setModelProvider(option?.provider ?? "");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id.trim() || !runtimeId) return;
    onSubmit(id.trim(), {
      name: name.trim() || id.trim(),
      runtimeId,
      model: model.trim() || undefined,
      modelProvider: (modelProvider || selectedModel?.provider || "").trim() || undefined,
      reasoningLevel: Number(reasoningLevel),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={preset ? "Edit model preset" : "Add model preset"} description="Choose runtime, model, and effort.">
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ID" value={id} onChange={setId} placeholder="fast-codex" disabled={Boolean(preset)} />
            <Field label="Name" value={name} onChange={changeName} placeholder="Fast Codex" />
          </div>

          <label className="grid min-w-0 gap-1">
            <span className="field-label">Runtime</span>
            <Select value={runtimeId} onValueChange={changeRuntime} disabled={!runtimes.length}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select runtime" />
              </SelectTrigger>
              <SelectContent>
                {runtimes.map((runtime) => (
                  <SelectItem key={runtime.id} value={runtime.id}>{runtime.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {selectedRuntime ? (
            <div className="flex min-w-0 items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-3">
              {catalogRuntime ? <RuntimeIcon runtime={catalogRuntime} className="size-11 shrink-0 rounded-xl border border-[var(--border)] p-2" /> : null}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[var(--fg)]">{selectedRuntime.label}</span>
                  <StatusBadge tone={selectedRuntime.enabled ? "good" : "warn"}>{selectedRuntime.enabled ? "enabled" : "disabled"}</StatusBadge>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-[var(--fg-muted)]">
                  {selectedRuntime.cliPath || "provider path"}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <label className="grid min-w-0 gap-1">
              <span className="field-label">Model</span>
              <Select value={model || providerDefaultModelValue} onValueChange={changeModel} disabled={!selectedRuntime}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={providerDefaultModelValue}>Provider default</SelectItem>
                  {modelOptions.map((option) => (
                    <SelectItem key={`${option.provider}:${option.id}`} value={option.id}>
                      {option.label || option.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid min-w-0 gap-1">
              <span className="field-label">Effort</span>
              <Select value={reasoningLevel} onValueChange={setReasoningLevel}>
                <SelectTrigger className="h-10 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reasoningLevels.map((level) => <SelectItem key={level} value={String(level)}>{level}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>

          <Field label="Custom Model ID" value={model} onChange={setModel} placeholder="provider default" />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {models.isFetching ? <StatusBadge tone="neutral"><Loader2 size={12} className="mr-1 animate-spin" />models</StatusBadge> : null}
              {models.data?.source ? <StatusBadge tone="neutral">{models.data.source}</StatusBadge> : null}
            </div>
            <button
              type="submit"
              disabled={busy || !id.trim() || !runtimeId}
              className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
            >
              <Save size={15} />
              Save Preset
            </button>
          </div>
          {models.isError ? <ErrorText error={models.error} /> : null}
          {models.data?.error ? <div className="font-mono text-[10px] font-medium text-[var(--warn)]">{models.data.error}</div> : null}
          {error ? <ErrorText error={error} /> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HeroMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-right backdrop-blur">
      <div className="field-label">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--fg)]">{value}</div>
    </div>
  );
}

function ModelFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-3 py-2">
      <div className="field-label">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-[var(--fg)]">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="field-label">{label}</span>
      <input
        className="focus-ring h-10 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-3 text-sm text-[var(--fg)] placeholder:text-[var(--fg-faint)] disabled:cursor-not-allowed disabled:opacity-60"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
