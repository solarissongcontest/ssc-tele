import { createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Lock,
  Plus,
  Radio,
  RefreshCcw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { EntryAvatar } from "@/components/entry-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAllRounds } from "@/hooks/use-round-results";
import {
  SOURCE_INPUT_MODES,
  labelForInputMode,
} from "@/lib/combined-televote-math";
import {
  saveExternalSourceValues,
  syncParticipantsFromLinkedRounds,
} from "@/lib/combined-bulk.functions";
import {
  createAggregation,
  deleteAggregation,
  deleteSource,
  getAggregation,
  listAggregations,
  recalculateCombined,
  setAggregationParticipants,
  setAggregationStatus,
  updateAggregation,
  upsertSource,
} from "@/lib/combined.functions";
import {
  downloadCSV,
  downloadJSON,
} from "@/lib/export";
import {
  entryMap,
  entryNoun,
  getEntryDisplayName,
  type ResolvedEntry,
} from "@/lib/round-entries";

export const Route = createFileRoute("/admin/combined")({
  head: () => ({
    meta: [
      {
        title: "Combined Televote — Solaris Admin",
      },
    ],
  }),
  component: CombinedPage,
});

type SourceKind =
  | "round"
  | "instagram"
  | "external_televote"
  | "imported"
  | "activity"
  | "correction"
  | "other";

const SOURCE_TYPES: {
  value: SourceKind;
  label: string;
  hint: string;
}[] = [
  {
    value: "round",
    label: "Website voting round",
    hint: "Reads the selected website round automatically.",
  },
  {
    value: "instagram",
    label: "Instagram Stories",
    hint: "Enter all Instagram values in one bulk table.",
  },
  {
    value: "external_televote",
    label: "External televote",
    hint: "Enter the same contest entries in one bulk table.",
  },
  {
    value: "imported",
    label: "Imported results",
    hint: "Manual imported values or already-converted points.",
  },
  {
    value: "activity",
    label: "Activity points",
    hint: "Proportional activity or engagement values.",
  },
  {
    value: "correction",
    label: "Correction",
    hint: "Manual positive or negative adjustments.",
  },
  {
    value: "other",
    label: "Other",
    hint: "Another manual result source.",
  },
];

function num(value: number, digits = 2) {
  return Number.isFinite(Number(value))
    ? Number(value).toLocaleString(undefined, {
        maximumFractionDigits: digits,
      })
    : "—";
}

function CombinedPage() {
  const qc = useQueryClient();
  const { data: rounds = [] } = useAllRounds();

  const listFn = useServerFn(listAggregations);
  const detailFn = useServerFn(getAggregation);
  const createFn = useServerFn(createAggregation);
  const updateFn = useServerFn(updateAggregation);
  const participantsFn = useServerFn(setAggregationParticipants);
  const sourceFn = useServerFn(upsertSource);
  const syncParticipantsFn = useServerFn(
    syncParticipantsFromLinkedRounds,
  );
  const deleteSourceFn = useServerFn(deleteSource);
  const recalcFn = useServerFn(recalculateCombined);
  const statusFn = useServerFn(setAggregationStatus);
  const deleteAggFn = useServerFn(deleteAggregation);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [tab, setTab] = useState<
    "setup" | "sources" | "results" | "public"
  >("setup");

  const list = useQuery({
    queryKey: ["combined-aggregations-redesign"],
    queryFn: async () => (await listFn()) as any[],
  });

  const activeId =
    selectedId ?? list.data?.[0]?.id ?? null;

  const detail = useQuery({
    queryKey: ["combined-aggregation-redesign", activeId],
    queryFn: async () =>
      activeId
        ? await detailFn({
            data: {
              id: activeId,
            },
          })
        : null,
    enabled: Boolean(activeId),
  });

  const data = detail.data as any;
  const agg = data?.agg ?? null;
  const sources = data?.sources ?? [];
  const preview = data?.preview ?? null;
  const participants: string[] = data?.participants ?? [];
  const externalEntries = data?.entries ?? [];
  const entryCatalog =
    (data?.entryCatalog ?? []) as ResolvedEntry[];

  const byEntryKey = useMemo(
    () => entryMap(entryCatalog),
    [entryCatalog],
  );

  const [nameInput, setNameInput] = useState("");
  const [tInput, setTInput] = useState("");
  const [eInput, setEInput] = useState("");

  useEffect(() => {
    if (!agg) return;
    setNameInput(String(agg.name ?? ""));
    setTInput(String(agg.total_points_to_distribute ?? 0));
    setEInput(String(agg.rank_exponent ?? 1.33));
  }, [
    agg?.id,
    agg?.name,
    agg?.total_points_to_distribute,
    agg?.rank_exponent,
    agg?.calculation_version,
  ]);

  const refresh = () => {
    void qc.invalidateQueries({
      queryKey: ["combined-aggregation-redesign", activeId],
    });

    void qc.invalidateQueries({
      queryKey: ["combined-aggregations-redesign"],
    });
  };

  const createMut = useMutation({
    mutationFn: async () =>
      await createFn({
        data: {
          name: newName.trim(),
        },
      }),

    onSuccess: (result: any) => {
      setNewName("");
      if (result?.id) {
        setSelectedId(result.id);
      }
      refresh();
      toast.success("Combined televote created");
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Could not create combined televote"),
  });

  const updateMut = useMutation({
    mutationFn: async (patch: any) =>
      await updateFn({
        data: {
          id: activeId!,
          ...patch,
        },
      }),

    onSuccess: () => {
      refresh();
      toast.success("Saved");
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Could not save"),
  });

  const participantsMut = useMutation({
    mutationFn: async (entryKeys: string[]) =>
      await participantsFn({
        data: {
          id: activeId!,
          entryKeys,
        },
      }),

    onSuccess: () => {
      refresh();
      toast.success("Entries synced");
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Could not sync entries"),
  });

  const sourceMut = useMutation({
    mutationFn: async (patch: any) =>
      await sourceFn({
        data: {
          aggregationId: activeId!,
          ...patch,
        },
      }),

    onSuccess: async (_result, patch) => {
      if (
        patch?.sourceRoundId &&
        !patch?.id
      ) {
        try {
          const synced =
            await syncParticipantsFn({
              data: {
                aggregationId:
                  activeId!,
              },
            });

          toast.success(
            `Source saved · ${synced.count} entries synced automatically`,
          );
        } catch (error: any) {
          toast.warning(
            error?.message ??
              "Source saved, but entries could not be synced automatically",
          );
        }
      } else {
        toast.success("Source saved");
      }

      refresh();
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Could not save source"),
  });

  const deleteSourceMut = useMutation({
    mutationFn: async (id: string) =>
      await deleteSourceFn({
        data: { id },
      }),

    onSuccess: () => {
      refresh();
      toast.success("Source removed");
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Could not remove source"),
  });

  const recalcMut = useMutation({
    mutationFn: async () =>
      await recalcFn({
        data: {
          id: activeId!,
          confirm:
            agg?.status === "locked" ||
            agg?.status === "published",
        },
      }),

    onSuccess: (result: any) => {
      refresh();

      (result?.warnings ?? []).forEach((warning: string) =>
        toast.warning(warning),
      );

      toast.success(
        `Combined televote recalculated · v${result?.version ?? "?"}`,
      );
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Calculation failed"),
  });

  const statusMut = useMutation({
    mutationFn: async (status: "calculated" | "locked" | "published") =>
      await statusFn({
        data: {
          id: activeId!,
          status,
        },
      }),

    onSuccess: () => {
      refresh();
      toast.success("Status updated");
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Could not change status"),
  });

  const deleteAggMut = useMutation({
    mutationFn: async () =>
      await deleteAggFn({
        data: {
          id: activeId!,
        },
      }),

    onSuccess: () => {
      setSelectedId(null);
      refresh();
      toast.success("Combined televote deleted");
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Could not delete combined televote"),
  });

  const locked =
    agg?.status === "locked" ||
    agg?.status === "published";

  const enabledSources = sources.filter(
    (source: any) => source.enabled,
  );

  const weightTotal = Number(preview?.totalPercentage ?? 0);

  const weightsOkay =
    Math.abs(weightTotal - 100) < 0.000001;

  const participantSet = new Set(participants);

  const availableKeys = entryCatalog.map(
    (entry) => entry.entry_key,
  );

  const participantSyncNeeded =
    availableKeys.length > 0 &&
    (participants.length !== availableKeys.length ||
      availableKeys.some((key) => !participantSet.has(key)));

  const displayName = (entryKey: string) => {
    const entry = byEntryKey.get(entryKey);
    return entry ? getEntryDisplayName(entry) : entryKey;
  };

  const exportRows = () =>
    (preview?.rows ?? []).map((row: any) => ({
      rank: row.finalRank,
      entry: displayName(row.code),
      entry_key: row.code,
      voting_points: row.totalVotingPoints,
      activity_points: row.totalActivityPoints,
      correction: row.finalCorrection,
      final_points: row.finalCombinedPoints,
      ...Object.fromEntries(
        (preview?.pools ?? []).map((pool: any) => [
          pool.sourceName,
          row.componentResults.find(
            (component: any) =>
              component.sourceId === pool.sourceId,
          )?.finalAllocatedPoints ?? 0,
        ]),
      ),
    }));

  const resultTotal = (preview?.rows ?? []).reduce(
    (sum: number, row: any) =>
      sum + Number(row.finalCombinedPoints ?? 0),
    0,
  );

  return (
    <AdminShell title="Combined Televote">
      <div className="space-y-5 pb-10">
        <section className="glass-strong rounded-3xl p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-primary">
                Final televote builder
              </p>

              <h2 className="mt-1 text-xl font-semibold">
                Combine every televote source in one place
              </h2>

              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Website rounds are read automatically. External sources use the
                same entry list, so you enter all values in one table instead
                of selecting countries one by one.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => refresh()}
                disabled={!activeId}
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </Button>

              {agg ? (
                <Button
                  onClick={() => recalcMut.mutate()}
                  disabled={
                    recalcMut.isPending ||
                    participants.length === 0 ||
                    !weightsOkay
                  }
                >
                  Recalculate
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="glass rounded-3xl p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_minmax(240px,1fr)_auto]">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                Combined result
              </label>

              <select
                value={activeId ?? ""}
                onChange={(event) => {
                  setSelectedId(event.target.value || null);
                  setTab("setup");
                }}
                className="min-h-11 w-full rounded-xl border border-border bg-background/30 px-3 text-sm"
              >
                {(list.data ?? []).length === 0 ? (
                  <option value="">No combined results yet</option>
                ) : null}

                {(list.data ?? []).map((item: any) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {item.name} · {item.status}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                New combined result
              </label>

              <Input
                value={newName}
                placeholder="Grand Final Combined Televote"
                onChange={(event) =>
                  setNewName(event.target.value)
                }
              />
            </div>

            <Button
              className="self-end"
              disabled={
                newName.trim().length < 2 ||
                createMut.isPending
              }
              onClick={() => createMut.mutate()}
            >
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </div>
        </section>

        {!agg ? (
          <EmptyPanel text="Create or select a combined result to begin." />
        ) : detail.isLoading ? (
          <EmptyPanel text="Loading combined televote…" />
        ) : detail.error ? (
          <ErrorPanel
            text={
              detail.error instanceof Error
                ? detail.error.message
                : "Could not load combined televote"
            }
          />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <MetricCard
                label="Entries"
                value={String(participants.length)}
              />

              <MetricCard
                label="Enabled sources"
                value={String(enabledSources.length)}
              />

              <MetricCard
                label="Weights"
                value={`${num(weightTotal)}%`}
                tone={weightsOkay ? "ok" : "warn"}
              />

              <MetricCard
                label="Pool G"
                value={String(
                  agg.total_points_to_distribute ?? 0,
                )}
              />

              <MetricCard
                label="Final total"
                value={num(resultTotal, 0)}
              />

              <MetricCard
                label="Status"
                value={String(agg.status)}
                tone={
                  agg.status === "published"
                    ? "ok"
                    : agg.results_outdated
                      ? "warn"
                      : "normal"
                }
              />
            </section>

            {agg.results_outdated ? (
              <Callout tone="warn">
                The sources or settings changed after the last calculation.
                Recalculate before publishing.
              </Callout>
            ) : null}

            {!weightsOkay ? (
              <Callout tone="warn">
                Enabled source weights total {num(weightTotal)}%. They must equal
                exactly 100% before calculation.
              </Callout>
            ) : null}

            <nav className="glass flex gap-1 overflow-x-auto rounded-2xl p-1.5">
              <TabButton
                active={tab === "setup"}
                onClick={() => setTab("setup")}
              >
                Setup
              </TabButton>

              <TabButton
                active={tab === "sources"}
                onClick={() => setTab("sources")}
              >
                Sources
              </TabButton>

              <TabButton
                active={tab === "results"}
                onClick={() => setTab("results")}
              >
                Results
              </TabButton>

              <TabButton
                active={tab === "public"}
                onClick={() => setTab("public")}
              >
                Publish
              </TabButton>
            </nav>

            {tab === "setup" ? (
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <Panel
                  title="Combined settings"
                  subtitle="The small number of settings that actually control the final calculation."
                >
                  <div className="space-y-4">
                    <Field label="Name">
                      <div className="flex gap-2">
                        <Input
                          value={nameInput}
                          onChange={(event) =>
                            setNameInput(event.target.value)
                          }
                        />

                        <Button
                          variant="outline"
                          onClick={() =>
                            updateMut.mutate({
                              name: nameInput,
                            })
                          }
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                      </div>
                    </Field>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Final televote pool G">
                        <Input
                          inputMode="numeric"
                          value={tInput}
                          onChange={(event) =>
                            setTInput(
                              event.target.value.replace(
                                /[^0-9]/g,
                                "",
                              ),
                            )
                          }
                          onBlur={() => {
                            const value = Number(tInput);

                            if (
                              Number.isInteger(value) &&
                              value >= 0 &&
                              value !==
                                Number(
                                  agg.total_points_to_distribute,
                                )
                            ) {
                              updateMut.mutate({
                                totalPoints: value,
                              });
                            }
                          }}
                        />
                      </Field>

                      <Field label="Rank exponent">
                        <Input
                          inputMode="decimal"
                          value={eInput}
                          onChange={(event) =>
                            setEInput(event.target.value)
                          }
                          onBlur={() => {
                            const value = Number(eInput);

                            if (
                              Number.isFinite(value) &&
                              value > 0 &&
                              value <= 5 &&
                              value !==
                                Number(agg.rank_exponent)
                            ) {
                              updateMut.mutate({
                                rankExponent: value,
                              });
                            }
                          }}
                        />
                      </Field>
                    </div>

                    <p className="text-xs leading-relaxed text-muted-foreground">
                      G is divided between enabled sources by percentage. Raw
                      voting sources are rank-weighted inside their own pool.
                      Converted and activity sources are rescaled
                      proportionally.
                    </p>
                  </div>
                </Panel>

                <Panel
                  title="Entries"
                  subtitle="The combined result should normally use the exact same entries as its linked website voting round."
                >
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <MiniStat
                        label="Available from linked rounds"
                        value={String(entryCatalog.length)}
                      />
                      <MiniStat
                        label="Currently included"
                        value={String(participants.length)}
                      />
                      <MiniStat
                        label="Missing"
                        value={String(
                          Math.max(
                            0,
                            entryCatalog.length -
                              participants.length,
                          ),
                        )}
                      />
                    </div>

                    {entryCatalog.length === 0 ? (
                      <Callout tone="warn">
                        Add a website voting round in Sources first. Its
                        round_entries become the entry list for this combined
                        televote.
                      </Callout>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={() =>
                              participantsMut.mutate(
                                availableKeys,
                              )
                            }
                            disabled={
                              locked ||
                              participantsMut.isPending ||
                              !participantSyncNeeded
                            }
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {participantSyncNeeded
                              ? `Use all ${entryCatalog.length} linked entries`
                              : "Entries already synced"}
                          </Button>

                          <span className="self-center text-xs text-muted-foreground">
                            Website-round entries sync automatically. This button is only a manual resync.
                          </span>
                        </div>

                        <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto">
                          {entryCatalog.map((entry) => {
                            const included =
                              participantSet.has(
                                entry.entry_key,
                              );

                            return (
                              <span
                                key={entry.entry_key}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                                  included
                                    ? "border-primary/35 bg-primary/10"
                                    : "border-border/60 text-muted-foreground"
                                }`}
                              >
                                <EntryAvatar
                                  entry={entry}
                                  size={16}
                                />
                                {getEntryDisplayName(entry)}
                              </span>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </Panel>
              </div>
            ) : null}

            {tab === "sources" ? (
              <div className="space-y-5">
                <Panel
                  title="Source weights"
                  subtitle="Each source is one component of the final televote. Manual sources use one bulk value table."
                >
                  <div className="space-y-3">
                    {sources.length === 0 ? (
                      <EmptyPanel text="No sources yet." />
                    ) : (
                      sources.map((source: any) => (
                        <SourceCard
                          key={source.id}
                          source={source}
                          rounds={rounds}
                          participants={participants}
                          entryCatalog={entryCatalog}
                          externalEntries={externalEntries}
                          locked={locked}
                          onSourcePatch={(patch) =>
                            sourceMut.mutate({
                              id: source.id,
                              ...patch,
                            })
                          }
                          onDelete={() =>
                            deleteSourceMut.mutate(
                              source.id,
                            )
                          }
                          onSavedValues={refresh}
                        />
                      ))
                    )}
                  </div>
                </Panel>

                <AddSourcePanel
                  rounds={rounds}
                  disabled={!activeId || locked}
                  onAdd={(patch) =>
                    sourceMut.mutate(patch)
                  }
                />
              </div>
            ) : null}

            {tab === "results" ? (
              <div className="space-y-5">
                <Panel
                  title="Component pools"
                  subtitle="A quick audit of where the final points are coming from."
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {(preview?.pools ?? []).map((pool: any) => (
                      <div
                        key={pool.sourceId}
                        className="rounded-2xl border border-border/60 bg-card/20 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">
                            {pool.sourceName}
                          </p>
                          <span className="text-sm font-semibold tabular-nums">
                            {pool.finalPool}
                          </span>
                        </div>

                        <p className="mt-1 text-xs text-muted-foreground">
                          {num(pool.percentageWeight)}% ·{" "}
                          {String(pool.method).replace(
                            /_/g,
                            " ",
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </Panel>

                <Panel
                  title="Final combined result"
                  subtitle="Ranked final televote after every enabled component has been allocated."
                >
                  {(preview?.warnings ?? []).map(
                    (warning: string) => (
                      <Callout
                        key={warning}
                        tone="warn"
                      >
                        {warning}
                      </Callout>
                    ),
                  )}

                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="p-2 text-left">
                            #
                          </th>
                          <th className="p-2 text-left">
                            {entryNoun(entryCatalog, false)}
                          </th>

                          {(preview?.pools ?? []).map(
                            (pool: any) => (
                              <th
                                key={pool.sourceId}
                                className="p-2 text-right"
                              >
                                {pool.sourceName}
                              </th>
                            ),
                          )}

                          <th className="p-2 text-right">
                            Final
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {(preview?.rows ?? []).map(
                          (row: any) => {
                            const entry =
                              byEntryKey.get(row.code);

                            return (
                              <tr
                                key={row.code}
                                className="border-t border-border/50"
                              >
                                <td className="p-2 font-semibold tabular-nums">
                                  {row.finalRank}
                                </td>

                                <td className="p-2">
                                  <span className="inline-flex items-center gap-2 font-medium">
                                    <EntryAvatar
                                      entry={entry}
                                      size={22}
                                    />
                                    {displayName(row.code)}
                                  </span>
                                </td>

                                {(preview?.pools ?? []).map(
                                  (pool: any) => (
                                    <td
                                      key={pool.sourceId}
                                      className="p-2 text-right tabular-nums"
                                    >
                                      {row.componentResults.find(
                                        (component: any) =>
                                          component.sourceId ===
                                          pool.sourceId,
                                      )?.finalAllocatedPoints ?? 0}
                                    </td>
                                  ),
                                )}

                                <td className="p-2 text-right text-base font-semibold tabular-nums">
                                  {row.finalCombinedPoints}
                                </td>
                              </tr>
                            );
                          },
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        downloadCSV(
                          `${agg.name}-combined-televote.csv`,
                          exportRows(),
                        )
                      }
                    >
                      <Download className="h-4 w-4" />
                      CSV
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() =>
                        downloadJSON(
                          `${agg.name}-combined-audit.json`,
                          {
                            aggregation: agg,
                            participants,
                            entryCatalog,
                            sources,
                            preview,
                          },
                        )
                      }
                    >
                      Audit JSON
                    </Button>
                  </div>
                </Panel>
              </div>
            ) : null}

            {tab === "public" ? (
              <div className="grid gap-5 xl:grid-cols-2">
                <Panel
                  title="Result status"
                  subtitle="Lock once the math is final. Publish only after all source weights and entries are correct."
                >
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        status={String(agg.status)}
                      />

                      {agg.calculation_version > 0 ? (
                        <span className="rounded-full border border-border/60 px-2.5 py-1 text-xs">
                          v{agg.calculation_version}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() =>
                          recalcMut.mutate()
                        }
                        disabled={
                          recalcMut.isPending ||
                          !weightsOkay ||
                          participants.length === 0
                        }
                      >
                        <RefreshCcw className="h-4 w-4" />
                        Recalculate
                      </Button>

                      <Button
                        variant="outline"
                        onClick={() =>
                          statusMut.mutate("locked")
                        }
                        disabled={
                          !agg.calculation_version ||
                          statusMut.isPending
                        }
                      >
                        <Lock className="h-4 w-4" />
                        Lock
                      </Button>

                      <Button
                        variant="outline"
                        onClick={() =>
                          statusMut.mutate("published")
                        }
                        disabled={
                          !agg.calculation_version ||
                          statusMut.isPending
                        }
                      >
                        <Radio className="h-4 w-4" />
                        Publish
                      </Button>

                      {locked ? (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            statusMut.mutate("calculated")
                          }
                        >
                          Unlock
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Panel>

                <Panel
                  title="Public result columns"
                  subtitle="Choose what the public combined-result page is allowed to show."
                >
                  <div className="space-y-3">
                    {(
                      [
                        [
                          "sources",
                          "Individual source values",
                        ],
                        [
                          "combined_original",
                          "Combined original score",
                        ],
                        [
                          "converted",
                          "Converted points",
                        ],
                        [
                          "bonus",
                          "Activity / bonus points",
                        ],
                        [
                          "final",
                          "Final televote score",
                        ],
                      ] as const
                    ).map(([key, label]) => (
                      <label
                        key={key}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-border/60 px-3"
                      >
                        <span className="text-sm">
                          {label}
                        </span>

                        <Switch
                          checked={
                            key === "converted" ||
                            key === "bonus" ||
                            key === "final"
                              ? (agg.public_columns?.[
                                  key
                                ] ?? true) !== false
                              : Boolean(
                                  agg.public_columns?.[
                                    key
                                  ],
                                )
                          }
                          onCheckedChange={(value) =>
                            updateMut.mutate({
                              publicColumns: {
                                ...(agg.public_columns ??
                                  {}),
                                [key]: value,
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </Panel>

                <Panel
                  title="Danger zone"
                  subtitle="Deletion is blocked while the combined result is published."
                >
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete "${agg.name}"?`,
                        )
                      ) {
                        deleteAggMut.mutate();
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete combined result
                  </Button>
                </Panel>
              </div>
            ) : null}
          </>
        )}
      </div>
    </AdminShell>
  );
}

function SourceCard({
  source,
  rounds,
  participants,
  entryCatalog,
  externalEntries,
  locked,
  onSourcePatch,
  onDelete,
  onSavedValues,
}: {
  source: any;
  rounds: any[];
  participants: string[];
  entryCatalog: ResolvedEntry[];
  externalEntries: any[];
  locked: boolean;
  onSourcePatch: (patch: any) => void;
  onDelete: () => void;
  onSavedValues: () => void;
}) {
  const [openValues, setOpenValues] = useState(false);

  const linkedRound = rounds.find(
    (round) => round.id === source.source_round_id,
  );

  const manual = !source.source_round_id;

  return (
    <section className="rounded-3xl border border-border/60 bg-card/20 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Switch
          checked={Boolean(source.enabled)}
          onCheckedChange={(enabled) =>
            onSourcePatch({ enabled })
          }
          disabled={locked}
        />

        <div className="min-w-[180px] flex-1">
          <Input
            defaultValue={source.source_name}
            disabled={locked}
            onBlur={(event) => {
              const value = event.target.value.trim();

              if (
                value &&
                value !== source.source_name
              ) {
                onSourcePatch({
                  sourceName: value,
                });
              }
            }}
          />

          <p className="mt-1 text-xs text-muted-foreground">
            {linkedRound
              ? `Linked to ${linkedRound.edition_name ? `${linkedRound.edition_name} · ` : ""}${linkedRound.name}`
              : manual
                ? "Manual source · all entries edited together"
                : ""}
          </p>
        </div>

        <div className="w-24">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Weight %
          </label>

          <Input
            defaultValue={String(
              source.percentage_weight ?? 0,
            )}
            inputMode="decimal"
            disabled={locked}
            onBlur={(event) => {
              const value = Number(
                event.target.value,
              );

              if (
                Number.isFinite(value) &&
                value >= 0 &&
                value <= 100 &&
                value !==
                  Number(
                    source.percentage_weight,
                  )
              ) {
                onSourcePatch({
                  percentageWeight: value,
                });
              }
            }}
          />
        </div>

        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={onDelete}
          disabled={locked}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-border/60 px-2.5 py-1 text-[11px]">
          {SOURCE_TYPES.find(
            (type) =>
              type.value === source.source_type,
          )?.label ?? source.source_type}
        </span>

        <span className="rounded-full border border-border/60 px-2.5 py-1 text-[11px]">
          {labelForInputMode(
            source.input_mode ?? "raw_results",
          )}
        </span>

        <span className="rounded-full border border-border/60 px-2.5 py-1 text-[11px]">
          {source.calculation_stage ===
          "post_conversion"
            ? "After conversion"
            : "Before conversion"}
        </span>

        {manual ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setOpenValues((value) => !value)
            }
            disabled={
              participants.length === 0
            }
          >
            {openValues
              ? "Close values"
              : `Edit all ${participants.length} values`}
          </Button>
        ) : null}
      </div>

      <details className="mt-3 rounded-2xl border border-border/50 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Advanced source settings
        </summary>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Input mode">
            <select
              value={
                source.input_mode ??
                "raw_results"
              }
              disabled={locked}
              onChange={(event) =>
                onSourcePatch({
                  inputMode: event.target.value,
                })
              }
              className="min-h-11 w-full rounded-xl border border-border bg-background/30 px-3 text-sm"
            >
              {SOURCE_INPUT_MODES.map((mode) => (
                <option
                  key={mode.value}
                  value={mode.value}
                >
                  {mode.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Calculation stage">
            <select
              value={
                source.calculation_stage ??
                "pre_conversion"
              }
              disabled={locked}
              onChange={(event) =>
                onSourcePatch({
                  stage: event.target.value,
                })
              }
              className="min-h-11 w-full rounded-xl border border-border bg-background/30 px-3 text-sm"
            >
              <option value="pre_conversion">
                Before conversion
              </option>
              <option value="post_conversion">
                After conversion
              </option>
            </select>
          </Field>
        </div>
      </details>

      {openValues && manual ? (
        <ManualValuesEditor
          source={source}
          participants={participants}
          entryCatalog={entryCatalog}
          existingEntries={externalEntries.filter(
            (entry) =>
              entry.source_id === source.id,
          )}
          locked={locked}
          onSaved={onSavedValues}
        />
      ) : null}
    </section>
  );
}

function ManualValuesEditor({
  source,
  participants,
  entryCatalog,
  existingEntries,
  locked,
  onSaved,
}: {
  source: any;
  participants: string[];
  entryCatalog: ResolvedEntry[];
  existingEntries: any[];
  locked: boolean;
  onSaved: () => void;
}) {
  const bulkFn = useServerFn(
    saveExternalSourceValues,
  );

  const catalog = useMemo(
    () => entryMap(entryCatalog),
    [entryCatalog],
  );

  const existing = useMemo(
    () =>
      new Map(
        existingEntries.map((row) => [
          String(row.country_code),
          Number(row.value ?? 0),
        ]),
      ),
    [existingEntries],
  );

  const [values, setValues] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const next: Record<string, string> = {};

    for (const entryKey of participants) {
      next[entryKey] = String(
        existing.get(entryKey) ?? 0,
      );
    }

    setValues(next);
  }, [
    source.id,
    participants.join("|"),
    existingEntries
      .map(
        (row) =>
          `${row.country_code}:${row.value}`,
      )
      .join("|"),
  ]);

  const saveMut = useMutation({
    mutationFn: async () =>
      await bulkFn({
        data: {
          sourceId: source.id,
          values: participants.map(
            (entryKey) => ({
              entryKey,
              value: Number(
                values[entryKey] ?? 0,
              ),
            }),
          ),
        },
      }),

    onSuccess: (result: any) => {
      onSaved();

      toast.success(
        `Saved ${result?.saved ?? participants.length} values`,
      );
    },

    onError: (error: any) =>
      toast.error(
        error?.message ??
          "Could not save source values",
      ),
  });

  const total = participants.reduce(
    (sum, entryKey) =>
      sum +
      (Number(values[entryKey]) || 0),
    0,
  );

  return (
    <div className="mt-4 rounded-3xl border border-primary/25 bg-primary/[0.04] p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold">
            Bulk values
          </h4>

          <p className="mt-1 text-xs text-muted-foreground">
            The entry list comes from the linked website round. No selecting
            countries and no reason field for every value.
          </p>
        </div>

        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Raw total
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {num(total)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {participants.map((entryKey) => {
          const entry = catalog.get(entryKey);

          return (
            <label
              key={entryKey}
              className="grid grid-cols-[minmax(0,1fr)_92px] items-center gap-3 rounded-2xl border border-border/55 bg-background/15 p-2.5"
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <EntryAvatar
                  entry={entry}
                  size={20}
                />

                <span className="truncate text-sm font-medium">
                  {entry
                    ? getEntryDisplayName(entry)
                    : entryKey}
                </span>
              </span>

              <Input
                inputMode="decimal"
                value={
                  values[entryKey] ?? "0"
                }
                disabled={locked}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [entryKey]:
                      event.target.value,
                  }))
                }
              />
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => saveMut.mutate()}
          disabled={
            locked ||
            saveMut.isPending ||
            participants.some(
              (entryKey) =>
                !Number.isFinite(
                  Number(
                    values[entryKey] ?? 0,
                  ),
                ),
            )
          }
        >
          <Save className="h-4 w-4" />
          Save all values
        </Button>

        <Button
          variant="ghost"
          onClick={() =>
            setValues(
              Object.fromEntries(
                participants.map(
                  (entryKey) => [
                    entryKey,
                    "0",
                  ],
                ),
              ),
            )
          }
          disabled={locked}
        >
          Clear inputs
        </Button>
      </div>
    </div>
  );
}

function AddSourcePanel({
  rounds,
  disabled,
  onAdd,
}: {
  rounds: any[];
  disabled: boolean;
  onAdd: (patch: any) => void;
}) {
  const [type, setType] =
    useState<SourceKind>("round");
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("0");
  const [roundId, setRoundId] = useState("");

  const typeInfo = SOURCE_TYPES.find(
    (item) => item.value === type,
  )!;

  const defaultInputMode =
    type === "activity"
      ? "activity_points"
      : type === "correction"
        ? "correction"
        : "raw_results";

  const defaultStage =
    type === "activity" ||
    type === "correction"
      ? "post_conversion"
      : "pre_conversion";

  return (
    <Panel
      title="Add source"
      subtitle="Website rounds are automatic. External, Instagram and activity sources get one bulk editor after they are added."
    >
      <div className="grid gap-3 lg:grid-cols-[180px_minmax(220px,1fr)_110px_minmax(220px,1fr)_auto]">
        <Field label="Type">
          <select
            value={type}
            onChange={(event) => {
              const next =
                event.target.value as SourceKind;

              setType(next);

              if (next === "round") {
                setName("");
              }
            }}
            className="min-h-11 w-full rounded-xl border border-border bg-background/30 px-3 text-sm"
          >
            {SOURCE_TYPES.map((item) => (
              <option
                key={item.value}
                value={item.value}
              >
                {item.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Name">
          <Input
            value={name}
            placeholder={
              type === "external_televote"
                ? "External televote"
                : type === "instagram"
                  ? "Instagram Stories"
                  : "Source name"
            }
            onChange={(event) =>
              setName(event.target.value)
            }
          />
        </Field>

        <Field label="Weight %">
          <Input
            value={weight}
            inputMode="decimal"
            onChange={(event) =>
              setWeight(event.target.value)
            }
          />
        </Field>

        {type === "round" ? (
          <Field label="Website round">
            <select
              value={roundId}
              onChange={(event) => {
                const next = event.target.value;
                setRoundId(next);

                const round = rounds.find(
                  (item) => item.id === next,
                );

                if (round && !name.trim()) {
                  setName(round.name);
                }
              }}
              className="min-h-11 w-full rounded-xl border border-border bg-background/30 px-3 text-sm"
            >
              <option value="">
                Select round
              </option>

              {rounds.map((round) => (
                <option
                  key={round.id}
                  value={round.id}
                >
                  {round.edition_name
                    ? `${round.edition_name} · `
                    : ""}
                  {round.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="self-end text-xs text-muted-foreground">
            {typeInfo.hint}
          </div>
        )}

        <Button
          className="self-end"
          disabled={
            disabled ||
            !name.trim() ||
            !Number.isFinite(
              Number(weight),
            ) ||
            Number(weight) < 0 ||
            Number(weight) > 100 ||
            (type === "round" && !roundId)
          }
          onClick={() => {
            onAdd({
              sourceType: type,
              sourceName: name.trim(),
              sourceRoundId:
                type === "round"
                  ? roundId
                  : null,
              percentageWeight:
                Number(weight),
              inputMode:
                defaultInputMode,
              stage: defaultStage,
              enabled: true,
            });

            setName("");
            setWeight("0");
            setRoundId("");
          }}
        >
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
    </Panel>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="glass-strong rounded-3xl p-4 sm:p-5">
      <div>
        <h3 className="font-semibold">
          {title}
        </h3>

        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      </div>

      <div className="mt-4">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function MetricCard({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "ok" | "warn";
}) {
  return (
    <div
      className={`glass-strong rounded-2xl p-3 ${
        tone === "warn"
          ? "ring-1 ring-amber-400/25"
          : tone === "ok"
            ? "ring-1 ring-emerald-400/20"
            : ""
      }`}
    >
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>

      <p
        className={`mt-1 text-xl font-semibold ${
          tone === "warn"
            ? "text-amber-200"
            : tone === "ok"
              ? "text-emerald-200"
              : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/55 bg-card/20 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">
        {value}
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 shrink-0 rounded-xl px-3 text-sm font-medium ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function StatusPill({
  status,
}: {
  status: string;
}) {
  const tone =
    status === "published"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
      : status === "locked"
        ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
        : "border-border/60 bg-card/20";

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      {status}
    </span>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: "warn" | "ok";
  children: ReactNode;
}) {
  const warn = tone === "warn";

  return (
    <div
      className={`flex items-start gap-2 rounded-2xl border p-3 text-sm ${
        warn
          ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
          : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
      }`}
    >
      {warn ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      )}

      <div>{children}</div>
    </div>
  );
}

function EmptyPanel({
  text,
}: {
  text: string;
}) {
  return (
    <div className="glass rounded-3xl p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function ErrorPanel({
  text,
}: {
  text: string;
}) {
  return (
    <div className="glass rounded-3xl border border-red-400/30 p-8 text-center">
      <p className="font-semibold text-red-200">
        Combined televote could not load
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {text}
      </p>
    </div>
  );
}
