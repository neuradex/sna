import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { Edit3, Layers, Loader2, Plus, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "../components/button";
import { Dialog, DialogContent } from "../components/dialog";
import { Input } from "../components/input";
import { RuntimeIcon } from "../components/runtime-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select";
import { EmptyState, ErrorText, Panel, Skeleton, StatusBadge } from "../components/ui";
import {
  useDeleteModelPresetMutation,
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
  const deletePresetMutation = useDeleteModelPresetMutation();
  const profileMutation = useRuntimeProfileMutation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<ModelPreset | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<ModelPreset | null>(null);

  const presetRows = presets.data?.presets ?? [];
  const runtimeRows = runtimes.data?.runtimes ?? [];
  const catalogRows = catalog.data?.runtimes ?? [];
  const assignedLevels = profiles.data?.profiles.filter((profile) => profile.modelPresetId).length ?? 0;
  const presetsLoading = !presets.isError && !presets.data && (presets.isLoading || presets.isFetching);
  const runtimesLoading = !runtimes.isError && !runtimes.data && (runtimes.isLoading || runtimes.isFetching);
  const profilesLoading = !profiles.isError && !profiles.data && (profiles.isLoading || profiles.isFetching);
  const presetsUnavailable = (presets.isError && !presets.data) || (runtimes.isError && !runtimes.data);

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
              <HeroMetric label="Presets" value={presetsLoading ? <Skeleton className="ml-auto h-8 w-12" /> : presetRows.length} />
              <HeroMetric label="Assigned" value={profilesLoading ? <Skeleton className="ml-auto h-8 w-12" /> : assignedLevels} />
              <HeroMetric label="Runtimes" value={runtimesLoading ? <Skeleton className="ml-auto h-8 w-12" /> : runtimeRows.length} />
            </div>
            <Button
              type="button"
              className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
              onClick={() => openPresetDialog()}
            >
              <Plus size={16} />
              Add Model
            </Button>
          </div>
        </div>
      </section>

      <Panel
        title="Model Presets"
        action={<StatusBadge tone={presets.isError ? "bad" : "neutral"}>{presetsLoading || runtimesLoading ? "loading" : `${presetRows.length} presets`}</StatusBadge>}
      >
        {presets.isError ? <ErrorText error={presets.error} /> : null}
        {runtimes.isError ? <ErrorText error={runtimes.error} /> : null}
        {presetsLoading || runtimesLoading ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <ModelPresetCardSkeleton />
            <ModelPresetCardSkeleton />
          </div>
        ) : !presetsUnavailable && !runtimeRows.length ? <EmptyState>Register a runtime before adding model presets</EmptyState> : null}
        {!presetsLoading && !runtimesLoading && !presetsUnavailable && presetRows.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {presetRows.map((preset) => (
              <ModelPresetCard
                key={preset.id}
                preset={preset}
                runtime={runtimeRows.find((runtime) => runtime.id === preset.runtimeId)}
                catalogRuntime={catalogRows.find((runtime) => runtime.id === runtimeRows.find((candidate) => candidate.id === preset.runtimeId)?.provider)}
                deleting={deletePresetMutation.isPending && deletePresetMutation.variables?.id === preset.id}
                onEdit={() => openPresetDialog(preset)}
                onDelete={() => setDeleteTarget(preset)}
              />
            ))}
          </div>
        ) : !presetsLoading && !runtimesLoading && !presetsUnavailable && runtimeRows.length ? (
          <EmptyState>No model presets</EmptyState>
        ) : null}
      </Panel>

      <Panel
        title="Level Defaults"
        action={<StatusBadge tone={profiles.isError ? "bad" : "neutral"}>{profilesLoading ? "loading" : `${profiles.data?.profiles.length ?? 0} levels`}</StatusBadge>}
      >
        {profiles.isError ? <ErrorText error={profiles.error} /> : null}
        {profilesLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 5 }).map((_, index) => <LevelAssignmentSkeleton key={index} />)}
          </div>
        ) : profiles.isSuccess ? (
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
        runtimesLoading={runtimesLoading}
        runtimeCatalog={catalogRows}
        busy={presetMutation.isPending}
        error={presetMutation.error}
        onSubmit={(id, input) => presetMutation.mutate(
          { id, input },
          { onSuccess: () => setDialogOpen(false) },
        )}
      />
      <DeleteModelPresetDialog
        preset={deleteTarget}
        open={Boolean(deleteTarget)}
        busy={deletePresetMutation.isPending}
        error={deletePresetMutation.error}
        onOpenChange={(open) => {
          if (!open && !deletePresetMutation.isPending) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!deleteTarget) return;
          deletePresetMutation.mutate(
            { id: deleteTarget.id },
            { onSuccess: () => setDeleteTarget(null) },
          );
        }}
      />
    </div>
  );
}

function ModelPresetCard({
  preset,
  runtime,
  catalogRuntime,
  deleting,
  onEdit,
  onDelete,
}: {
  preset: ModelPreset;
  runtime?: RegisteredRuntime;
  catalogRuntime?: RuntimeCatalogEntry;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
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
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            className="focus-ring inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] px-3 font-mono text-[10px] font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
            onClick={onEdit}
          >
            <Edit3 size={14} />
            Edit
          </Button>
          <Button
            type="button"
            className="focus-ring inline-flex size-8 items-center justify-center rounded-lg border border-red-500/20 bg-[var(--bad-soft)] text-[var(--bad)] transition hover:border-red-500/40"
            title="Delete model preset"
            aria-label={`Delete ${preset.name}`}
            disabled={deleting}
            onClick={onDelete}
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </Button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <ModelFact label="Runtime" value={runtime?.label ?? preset.runtimeId} />
        <ModelFact label="Model" value={preset.model || "provider default"} />
        <ModelFact label="Effort" value={String(preset.reasoningLevel)} />
      </div>
    </article>
  );
}

function ModelPresetCardSkeleton() {
  return (
    <article role="status" aria-live="polite" aria-label="Loading model preset" className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-4">
      <span className="sr-only">Loading model preset</span>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Skeleton className="size-11 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
      </div>
    </article>
  );
}

function DeleteModelPresetDialog({
  preset,
  open,
  busy,
  error,
  onOpenChange,
  onConfirm,
}: {
  preset: ModelPreset | null;
  open: boolean;
  busy: boolean;
  error: unknown;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" title="Delete model preset" description="Remove this model preset.">
        {preset ? (
          <div className="grid gap-4">
            <div className="rounded-xl border border-red-500/20 bg-[var(--bad-soft)] p-3">
              <div className="font-semibold text-[var(--fg)]">{preset.name}</div>
              <div className="mt-1 font-mono text-xs text-[var(--fg-muted)]">{preset.id}</div>
              <p className="mt-3 text-sm leading-6 text-[var(--fg-soft)]">
                This clears level defaults that currently point to this preset.
              </p>
            </div>
            {error ? <ErrorText error={error} /> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                className="focus-ring inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] px-4 font-mono text-xs font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-[var(--bad-soft)] px-4 font-mono text-xs font-medium text-[var(--bad)] transition hover:border-red-500/50"
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Delete
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
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
        <Button
          type="button"
          disabled={busy}
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
          onClick={() => onSave(modelPresetId || null)}
        >
          <Save size={15} />
          Save
        </Button>
      </div>
      {error ? <div className="lg:col-span-3"><ErrorText error={error} /></div> : null}
    </div>
  );
}

function LevelAssignmentSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading level default" className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-3 lg:grid-cols-[180px_minmax(0,1fr)_auto] lg:items-center">
      <span className="sr-only">Loading level default</span>
      <div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-10" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="mt-2 h-3 w-full max-w-40" />
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(220px,0.45fr)_minmax(0,1fr)] sm:items-center">
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-9 w-20" />
      </div>
    </div>
  );
}

function ModelPresetDialog({
  open,
  onOpenChange,
  preset,
  runtimes,
  runtimesLoading,
  runtimeCatalog,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: ModelPreset;
  runtimes: RegisteredRuntime[];
  runtimesLoading: boolean;
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
  const modelsLoading = !models.isError && !models.data && models.isFetching;

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

          {runtimesLoading && !runtimes.length ? (
            <RuntimeSelectSkeleton />
          ) : (
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
          )}

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
          {modelsLoading ? <ModelOptionsSkeleton /> : null}

          <Field label="Custom Model ID" value={model} onChange={setModel} placeholder="provider default" />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {models.isFetching ? <StatusBadge tone="neutral"><Loader2 size={12} className="mr-1 animate-spin" />models</StatusBadge> : null}
              {models.data?.source ? <StatusBadge tone="neutral">{models.data.source}</StatusBadge> : null}
            </div>
            <Button
              type="submit"
              disabled={busy || !id.trim() || !runtimeId}
              className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
            >
              <Save size={15} />
              Save Preset
            </Button>
          </div>
          {models.isError ? <ErrorText error={models.error} /> : null}
          {models.data?.error ? <div className="font-mono text-[10px] font-medium text-[var(--warn)]">{models.data.error}</div> : null}
          {error ? <ErrorText error={error} /> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HeroMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-right backdrop-blur">
      <div className="field-label">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--fg)]">{value}</div>
    </div>
  );
}

function RuntimeSelectSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading runtimes" className="grid min-w-0 gap-1">
      <span className="sr-only">Loading runtimes</span>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-10 rounded-lg" />
    </div>
  );
}

function ModelOptionsSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading models" className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-3">
      <span className="sr-only">Loading models</span>
      <Skeleton className="h-3 w-20" />
      <div className="grid gap-2 sm:grid-cols-3">
        <Skeleton className="h-8 rounded-lg" />
        <Skeleton className="h-8 rounded-lg" />
        <Skeleton className="h-8 rounded-lg" />
      </div>
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
      <Input
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
