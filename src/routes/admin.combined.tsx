import { createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  Layers,
  Loader2,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAllRounds } from "@/hooks/use-round-results";
import {
  getEntryCode,
  getEntryDisplayName,
  entryMap,
  entryNoun,
  type ResolvedEntry,
} from "@/lib/round-entries";
import {
  SOURCE_INPUT_MODES,
} from "@/lib/combined-televote-math";
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
  upsertExternalEntry,
  upsertSource,
} from "@/lib/combined.functions";
import {
  downloadCSV,
  downloadJSON,
} from "@/lib/export";

export const Route = createFileRoute("/admin/combined")({
  head: () => ({
    meta: [
      {
        title: "Combined Televote — Solaris Admin",
      },
      {
        name: "description",
        content:
          "Combine multiple Solaris voting rounds, imported results and activity points into one final televote result.",
      },
    ],
  }),
  component: CombinedPage,
});

const SOURCE_TYPES = [
  {
    value: "round",
    label: "Website voting round",
  },
  {
    value: "instagram",
    label: "Instagram Stories",
  },
  {
    value: "external_televote",
    label: "External televote",
  },
  {
    value: "imported",
    label: "Imported results",
  },
  {
    value: "activity",
    label: "Activity points",
  },
  {
    value: "correction",
    label: "Correction / adjustment",
  },
  {
    value: "other",
    label: "Other",
  },
];

const num = (
  value: number,
  digits = 3,
) =>
  Number.isFinite(Number(value))
    ? Number(value).toLocaleString(
        undefined,
        {
          maximumFractionDigits:
            digits,
        },
      )
    : "—";

function CombinedPage() {
  const qc = useQueryClient();

  const { data: rounds } =
    useAllRounds();

  const [
    selectedId,
    setSelectedId,
  ] = useState<string | null>(
    null,
  );

  const [
    newName,
    setNewName,
  ] = useState("");

  const [
    expanded,
    setExpanded,
  ] = useState<string | null>(
    null,
  );

  const [
    entryDialog,
    setEntryDialog,
  ] = useState<{
    sourceId: string;
  } | null>(null);

  const listFn =
    useServerFn(
      listAggregations,
    );

  const createFn =
    useServerFn(
      createAggregation,
    );

  const removeFn =
    useServerFn(
      deleteAggregation,
    );

  const detailFn =
    useServerFn(
      getAggregation,
    );

  const updateFn =
    useServerFn(
      updateAggregation,
    );

  const participantsFn =
    useServerFn(
      setAggregationParticipants,
    );

  const sourceFn =
    useServerFn(
      upsertSource,
    );

  const deleteSourceFn =
    useServerFn(
      deleteSource,
    );

  const entryFn =
    useServerFn(
      upsertExternalEntry,
    );

  const recalcFn =
    useServerFn(
      recalculateCombined,
    );

  const statusFn =
    useServerFn(
      setAggregationStatus,
    );

  const list = useQuery({
    queryKey: [
      "combined-aggregations",
    ],
    queryFn: async () =>
      (await listFn()) as any[],
    refetchInterval: 15_000,
  });

  const activeId =
    selectedId ??
    list.data?.[0]?.id ??
    null;

  const detail = useQuery({
    queryKey: [
      "combined-aggregation",
      activeId,
    ],
    queryFn: async () =>
      activeId
        ? await detailFn({
            data: {
              id: activeId,
            },
          })
        : null,
    enabled:
      Boolean(activeId),
    refetchInterval: 10_000,
  });

  const agg =
    detail.data?.agg ?? null;

  const preview =
    detail.data?.preview ??
    null;

  const sources =
    detail.data?.sources ?? [];

  const participants =
    detail.data?.participants ??
    [];

  const externalEntries =
    detail.data?.entries ?? [];

  const log =
    detail.data?.log ?? [];

  const entryCatalog =
    (detail.data?.entryCatalog ??
      []) as ResolvedEntry[];

  const byEntryKey =
    useMemo(
      () =>
        entryMap(
          entryCatalog,
        ),
      [entryCatalog],
    );

  const participantPlural =
    entryNoun(
      entryCatalog,
      true,
    );

  const [
    tInput,
    setTInput,
  ] = useState("");

  const [
    eInput,
    setEInput,
  ] = useState("");

  const [
    nameInput,
    setNameInput,
  ] = useState("");

  useEffect(() => {
    if (!agg) return;

    setTInput(
      String(
        agg.total_points_to_distribute,
      ),
    );

    setEInput(
      String(
        agg.rank_exponent,
      ),
    );

    setNameInput(
      agg.name,
    );
  }, [
    agg?.id,
    agg?.calculation_version,
    agg?.total_points_to_distribute,
    agg?.rank_exponent,
    agg?.name,
  ]);

  const refresh = () => {
    void qc.invalidateQueries({
      queryKey: [
        "combined-aggregation",
        activeId,
      ],
    });

    void qc.invalidateQueries({
      queryKey: [
        "combined-aggregations",
      ],
    });
  };

  const createMut =
    useMutation({
      mutationFn: async (
        name: string,
      ) =>
        await createFn({
          data: {
            name,
          },
        }),

      onSuccess: (
        result: any,
      ) => {
        toast.success(
          "Combined result created",
        );

        if (result?.id) {
          setSelectedId(
            result.id,
          );
        }

        refresh();
      },

      onError: (
        error: any,
      ) =>
        toast.error(
          error?.message ??
            "Something went wrong",
        ),
    });

  const updateMut =
    useMutation({
      mutationFn: async (
        patch: any,
      ) =>
        await updateFn({
          data: {
            id: activeId!,
            ...patch,
          },
        }),

      onSuccess: () => {
        toast.success("Saved");
        refresh();
      },

      onError: (
        error: any,
      ) =>
        toast.error(
          error?.message ??
            "Something went wrong",
        ),
    });

  const participantsMut =
    useMutation({
      mutationFn: async (
        entryKeys: string[],
      ) =>
        await participantsFn({
          data: {
            id: activeId!,
            entryKeys,
          },
        }),

      onSuccess: () => {
        toast.success(
          "Entries updated",
        );
        refresh();
      },

      onError: (
        error: any,
      ) =>
        toast.error(
          error?.message ??
            "Could not save entries",
        ),
    });

  const sourceMut =
    useMutation({
      mutationFn: async (
        patch: any,
      ) =>
        await sourceFn({
          data: {
            aggregationId:
              activeId!,
            ...patch,
          },
        }),

      onSuccess: () => {
        toast.success(
          "Source saved",
        );
        refresh();
      },

      onError: (
        error: any,
      ) =>
        toast.error(
          error?.message ??
            "Could not save source",
        ),
    });

  const sourceDeleteMut =
    useMutation({
      mutationFn: async (
        id: string,
      ) =>
        await deleteSourceFn({
          data: { id },
        }),

      onSuccess: () => {
        toast.success(
          "Source removed",
        );
        refresh();
      },

      onError: (
        error: any,
      ) =>
        toast.error(
          error?.message ??
            "Could not remove source",
        ),
    });

  const entryMut =
    useMutation({
      mutationFn: async (
        payload: any,
      ) =>
        await entryFn({
          data: payload,
        }),

      onSuccess: () => {
        toast.success(
          "Value saved",
        );
        refresh();
      },

      onError: (
        error: any,
      ) =>
        toast.error(
          error?.message ??
            "Could not save value",
        ),
    });

  const recalcMut =
    useMutation({
      mutationFn: async (
        confirm: boolean,
      ) =>
        await recalcFn({
          data: {
            id: activeId!,
            confirm,
          },
        }),

      onSuccess: (
        result: any,
      ) => {
        toast.success(
          `Recalculated · v${result.version} · ${result.allocatedTotal} component points allocated`,
        );

        (
          result.warnings ?? []
        ).forEach(
          (warning: string) =>
            toast.warning(
              warning,
            ),
        );

        refresh();
      },

      onError: (
        error: any,
      ) =>
        toast.error(
          error?.message ??
            "Calculation failed",
        ),
    });

  const statusMut =
    useMutation({
      mutationFn: async (
        status: any,
      ) =>
        await statusFn({
          data: {
            id: activeId!,
            status,
          },
        }),

      onSuccess: () => {
        toast.success(
          "Status updated",
        );
        refresh();
      },

      onError: (
        error: any,
      ) =>
        toast.error(
          error?.message ??
            "Could not update status",
        ),
    });

  const deleteMut =
    useMutation({
      mutationFn: async (
        id: string,
      ) =>
        await removeFn({
          data: { id },
        }),

      onSuccess: () => {
        toast.success(
          "Combined result deleted",
        );
        setSelectedId(
          null,
        );
        refresh();
      },

      onError: (
        error: any,
      ) =>
        toast.error(
          error?.message ??
            "Could not delete result",
        ),
    });

  const locked =
    agg?.status ===
      "locked" ||
    agg?.status ===
      "published";

  const displayNameForKey = (
    entryKey: string,
  ) => {
    const entry =
      byEntryKey.get(
        entryKey,
      );

    return entry
      ? getEntryDisplayName(
          entry,
        )
      : entryKey;
  };

  const exportRows = () =>
    (
      preview?.rows ?? []
    ).map((row: any) => ({
      rank: row.finalRank,
      entry:
        displayNameForKey(
          row.code,
        ),
      entry_key: row.code,
      voting_points:
        row.totalVotingPoints,
      activity_points:
        row.totalActivityPoints,
      correction:
        row.finalCorrection,
      final:
        row.finalCombinedPoints,
      ...Object.fromEntries(
        (
          preview?.pools ??
          []
        ).map((pool: any) => [
          `pool_${pool.sourceName}`,
          row.componentResults.find(
            (
              component: any,
            ) =>
              component.sourceId ===
              pool.sourceId,
          )
            ?.finalAllocatedPoints ??
            0,
        ]),
      ),
    }));

  return (
    <AdminShell title="Combined Televote">
      <div className="space-y-6">
        <section className="glass space-y-4 rounded-3xl p-5">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />

            <h2 className="text-lg font-semibold">
              Combined results
            </h2>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="e.g. Grand Final Combined Televote"
              value={newName}
              onChange={(
                event,
              ) =>
                setNewName(
                  event.target.value,
                )
              }
            />

            <Button
              onClick={() => {
                createMut.mutate(
                  newName.trim(),
                );
                setNewName("");
              }}
              disabled={
                newName.trim()
                  .length < 2 ||
                createMut.isPending
              }
            >
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {(list.data ?? []).map(
              (
                item: any,
              ) => (
                <button
                  key={
                    item.id
                  }
                  onClick={() =>
                    setSelectedId(
                      item.id,
                    )
                  }
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    item.id ===
                    activeId
                      ? "border-primary/60 text-foreground"
                      : "border-white/10 text-muted-foreground"
                  }`}
                >
                  {item.name}

                  <Badge
                    variant="outline"
                    className="ml-2 text-[10px]"
                  >
                    {
                      item.status
                    }
                  </Badge>
                </button>
              ),
            )}

            {!list.isLoading &&
            (list.data ?? [])
              .length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No combined
                results yet.
              </p>
            ) : null}
          </div>
        </section>

        {agg ? (
          <>
            <section className="glass space-y-5 rounded-3xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold">
                  Configuration
                </h3>

                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {agg.status}
                  </Badge>

                  {agg.calculation_version >
                  0 ? (
                    <Badge variant="outline">
                      v
                      {
                        agg.calculation_version
                      }
                    </Badge>
                  ) : null}

                  {agg.results_outdated ? (
                    <Badge className="bg-amber-500/20 text-amber-200">
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      Outdated
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>
                    Name
                  </Label>

                  <div className="flex gap-2">
                    <Input
                      value={
                        nameInput
                      }
                      onChange={(
                        event,
                      ) =>
                        setNameInput(
                          event
                            .target
                            .value,
                        )
                      }
                    />

                    <Button
                      variant="secondary"
                      onClick={() =>
                        updateMut.mutate(
                          {
                            name: nameInput,
                          },
                        )
                      }
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    Component weights
                  </Label>

                  <div className="rounded-2xl border border-white/10 px-3 py-2 text-sm">
                    {preview ? (
                      <span
                        className={
                          Math.abs(
                            preview.totalPercentage -
                              100,
                          ) < 1e-6
                            ? "text-foreground"
                            : "text-amber-300"
                        }
                      >
                        Enabled
                        components
                        total{" "}
                        {num(
                          preview.totalPercentage,
                        )}
                        % · must be
                        exactly 100%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Loading…
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    Total televote
                    points (T)
                  </Label>

                  <div className="flex gap-2">
                    <Input
                      inputMode="numeric"
                      value={
                        tInput
                      }
                      onChange={(
                        event,
                      ) =>
                        setTInput(
                          event
                            .target
                            .value,
                        )
                      }
                    />

                    <Button
                      variant="secondary"
                      onClick={() =>
                        updateMut.mutate(
                          {
                            totalPoints:
                              Number(
                                tInput,
                              ),
                          },
                        )
                      }
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    Rank exponent
                  </Label>

                  <div className="flex gap-2">
                    <Input
                      value={
                        eInput
                      }
                      onChange={(
                        event,
                      ) =>
                        setEInput(
                          event
                            .target
                            .value,
                        )
                      }
                    />

                    <Button
                      variant="secondary"
                      onClick={() =>
                        updateMut.mutate(
                          {
                            rankExponent:
                              Number(
                                eInput,
                              ),
                          },
                        )
                      }
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Each enabled
                component receives
                its percentage of T.
                Normal voting
                sources are
                rank-weighted inside
                their own pool;
                activity and already
                converted sources are
                allocated
                proportionally.
                Participant
                identities are
                stable entry keys.
              </p>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    recalcMut.mutate(
                      locked,
                    )
                  }
                  disabled={
                    recalcMut.isPending
                  }
                >
                  {recalcMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                  Recalculate
                </Button>

                <Button
                  variant="secondary"
                  onClick={() =>
                    statusMut.mutate(
                      "locked",
                    )
                  }
                >
                  <Lock className="h-4 w-4" />
                  Lock
                </Button>

                <Button
                  variant="secondary"
                  onClick={() =>
                    statusMut.mutate(
                      "published",
                    )
                  }
                >
                  <Radio className="h-4 w-4" />
                  Publish
                </Button>

                {locked ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      statusMut.mutate(
                        "calculated",
                      )
                    }
                  >
                    Unlock /
                    unpublish
                  </Button>
                ) : null}

                <Button
                  variant="ghost"
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
                  variant="ghost"
                  onClick={() =>
                    downloadJSON(
                      `${agg.name}-combined-audit.json`,
                      {
                        aggregation:
                          agg,
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

                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() =>
                    deleteMut.mutate(
                      agg.id,
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>

              <div className="grid gap-2 border-t border-white/10 pt-2 sm:grid-cols-3">
                {(
                  [
                    [
                      "sources",
                      "Show individual source values publicly",
                    ],
                    [
                      "combined_original",
                      "Show combined original score publicly",
                    ],
                    [
                      "converted",
                      "Show converted points publicly",
                    ],
                    [
                      "bonus",
                      "Show bonus / activity points publicly",
                    ],
                    [
                      "final",
                      "Show final televote score publicly",
                    ],
                  ] as const
                ).map(
                  ([
                    key,
                    label,
                  ]) => (
                    <label
                      key={
                        key
                      }
                      className="flex items-center gap-2 text-xs"
                    >
                      <Switch
                        checked={
                          key ===
                            "converted" ||
                          key ===
                            "bonus" ||
                          key ===
                            "final"
                            ? (agg
                                .public_columns?.[
                                key
                              ] ??
                                true) !==
                              false
                            : Boolean(
                                agg
                                  .public_columns?.[
                                  key
                                ],
                              )
                        }
                        onCheckedChange={(
                          value,
                        ) =>
                          updateMut.mutate(
                            {
                              publicColumns:
                                {
                                  ...(agg.public_columns ??
                                    {}),
                                  [key]:
                                    value,
                                },
                            },
                          )
                        }
                      />

                      {label}
                    </label>
                  ),
                )}
              </div>
            </section>

            <ParticipantsSection
              entries={
                entryCatalog
              }
              participants={
                participants
              }
              onSave={(
                entryKeys,
              ) =>
                participantsMut.mutate(
                  entryKeys,
                )
              }
            />

            <section className="glass space-y-4 rounded-3xl p-5">
              <div>
                <h3 className="text-base font-semibold">
                  Sources
                </h3>

                <p className="mt-1 text-xs text-muted-foreground">
                  Add a website
                  round first to
                  make its
                  round_entries
                  available in the
                  participant
                  selector. Manual
                  sources then use
                  those exact
                  entry_key values.
                </p>
              </div>

              <div className="space-y-3">
                {sources.map(
                  (
                    source: any,
                  ) => (
                    <div
                      key={
                        source.id
                      }
                      className="space-y-3 rounded-2xl border border-white/10 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Switch
                          checked={
                            source.enabled
                          }
                          onCheckedChange={(
                            value,
                          ) =>
                            sourceMut.mutate(
                              {
                                id: source.id,
                                enabled:
                                  value,
                              },
                            )
                          }
                        />

                        <Input
                          className="max-w-[220px]"
                          defaultValue={
                            source.source_name
                          }
                          onBlur={(
                            event,
                          ) => {
                            if (
                              event
                                .target
                                .value !==
                              source.source_name
                            ) {
                              sourceMut.mutate(
                                {
                                  id: source.id,
                                  sourceName:
                                    event
                                      .target
                                      .value,
                                },
                              );
                            }
                          }}
                        />

                        <Select
                          value={
                            source.calculation_stage
                          }
                          onValueChange={(
                            value,
                          ) =>
                            sourceMut.mutate(
                              {
                                id: source.id,
                                stage:
                                  value,
                              },
                            )
                          }
                        >
                          <SelectTrigger className="w-[190px]">
                            <SelectValue />
                          </SelectTrigger>

                          <SelectContent>
                            <SelectItem value="pre_conversion">
                              Before
                              conversion
                            </SelectItem>

                            <SelectItem value="post_conversion">
                              After
                              conversion
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        <Select
                          value={
                            source.input_mode ??
                            "raw_results"
                          }
                          onValueChange={(
                            value,
                          ) =>
                            sourceMut.mutate(
                              {
                                id: source.id,
                                inputMode:
                                  value,
                              },
                            )
                          }
                        >
                          <SelectTrigger className="w-[190px]">
                            <SelectValue />
                          </SelectTrigger>

                          <SelectContent>
                            {SOURCE_INPUT_MODES.map(
                              (
                                mode,
                              ) => (
                                <SelectItem
                                  key={
                                    mode.value
                                  }
                                  value={
                                    mode.value
                                  }
                                >
                                  {
                                    mode.label
                                  }
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>

                        <div className="flex items-center gap-1">
                          <Label className="text-xs">
                            Weight %
                          </Label>

                          <Input
                            className="w-24"
                            defaultValue={String(
                              source.percentage_weight ??
                                0,
                            )}
                            onBlur={(
                              event,
                            ) => {
                              const next =
                                Number(
                                  event
                                    .target
                                    .value,
                                );

                              if (
                                next !==
                                Number(
                                  source.percentage_weight,
                                )
                              ) {
                                sourceMut.mutate(
                                  {
                                    id: source.id,
                                    percentageWeight:
                                      next,
                                  },
                                );
                              }
                            }}
                          />
                        </div>

                        <Badge
                          variant="outline"
                          className="text-[10px]"
                        >
                          {SOURCE_TYPES.find(
                            (
                              type,
                            ) =>
                              type.value ===
                              source.source_type,
                          )?.label ??
                            source.source_type}
                        </Badge>

                        {!source.source_round_id ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setEntryDialog(
                                {
                                  sourceId:
                                    source.id,
                                },
                              )
                            }
                            disabled={
                              participants.length ===
                              0
                            }
                          >
                            <Plus className="h-3 w-3" />
                            Values
                          </Button>
                        ) : null}

                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto text-destructive"
                          onClick={() =>
                            sourceDeleteMut.mutate(
                              source.id,
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {!source.source_round_id ? (
                        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          {externalEntries
                            .filter(
                              (
                                item: any,
                              ) =>
                                item.source_id ===
                                source.id,
                            )
                            .map(
                              (
                                item: any,
                              ) => {
                                const entryKey =
                                  item.country_code;

                                return (
                                  <span
                                    key={
                                      item.id
                                    }
                                    className="rounded-full border border-white/10 px-2 py-1"
                                  >
                                    {displayNameForKey(
                                      entryKey,
                                    )}
                                    :{" "}
                                    <span className="text-foreground">
                                      {Number(
                                        item.value,
                                      )}
                                    </span>
                                  </span>
                                );
                              },
                            )}
                        </div>
                      ) : null}
                    </div>
                  ),
                )}
              </div>

              <AddSourceForm
                rounds={
                  rounds ?? []
                }
                onAdd={(
                  patch,
                ) =>
                  sourceMut.mutate(
                    patch,
                  )
                }
              />
            </section>

            <section className="glass space-y-3 rounded-3xl p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold">
                  Combined result
                  preview
                </h3>

                {preview ? (
                  <p className="text-xs text-muted-foreground">
                    Allocated{" "}
                    {
                      preview.allocatedTotal
                    }{" "}
                    / G{" "}
                    {
                      preview.totalPoints
                    }{" "}
                    · Final total{" "}
                    {num(
                      preview.finalTotal,
                    )}
                  </p>
                ) : null}
              </div>

              {(preview?.warnings ??
                []).map(
                (
                  warning: string,
                ) => (
                  <p
                    key={
                      warning
                    }
                    className="text-xs text-amber-300"
                  >
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    {warning}
                  </p>
                ),
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">
                        #
                      </th>

                      <th className="py-2 pr-3">
                        {entryNoun(
                          entryCatalog,
                          false,
                        )}
                      </th>

                      {(preview?.pools ??
                        []).map(
                        (
                          pool: any,
                        ) => (
                          <th
                            key={
                              pool.sourceId
                            }
                            className="py-2 pr-3 text-right"
                          >
                            {
                              pool.sourceName
                            }

                            <span className="block text-[10px] normal-case text-muted-foreground">
                              {num(
                                pool.percentageWeight,
                              )}
                              % ·{" "}
                              {
                                pool.finalPool
                              }{" "}
                              pts
                            </span>
                          </th>
                        ),
                      )}

                      <th className="py-2 pr-3 text-right">
                        Voting
                      </th>

                      <th className="py-2 pr-3 text-right">
                        Activity
                      </th>

                      <th className="py-2 pr-3 text-right">
                        Correction
                      </th>

                      <th className="py-2 pr-3 text-right">
                        Final
                      </th>

                      <th />
                    </tr>
                  </thead>

                  <tbody>
                    {(preview?.rows ??
                      []).map(
                      (
                        row: any,
                      ) => {
                        const entry =
                          byEntryKey.get(
                            row.code,
                          );

                        const open =
                          expanded ===
                          row.code;

                        const componentFor =
                          (
                            sourceId: string,
                          ) =>
                            row.componentResults.find(
                              (
                                component: any,
                              ) =>
                                component.sourceId ===
                                sourceId,
                            );

                        return (
                          <>
                            <tr
                              key={
                                row.code
                              }
                              className="border-t border-white/5"
                            >
                              <td className="py-2 pr-3 tabular-nums">
                                {
                                  row.finalRank
                                }
                              </td>

                              <td className="py-2 pr-3">
                                <span className="flex items-center gap-2">
                                  <EntryAvatar
                                    entry={
                                      entry
                                    }
                                    size={
                                      18
                                    }
                                  />

                                  {displayNameForKey(
                                    row.code,
                                  )}
                                </span>
                              </td>

                              {(preview?.pools ??
                                []).map(
                                (
                                  pool: any,
                                ) => {
                                  const component =
                                    componentFor(
                                      pool.sourceId,
                                    );

                                  return (
                                    <td
                                      key={
                                        pool.sourceId
                                      }
                                      className="py-2 pr-3 text-right tabular-nums"
                                    >
                                      {component ? (
                                        <>
                                          <span className="font-medium">
                                            {
                                              component.finalAllocatedPoints
                                            }
                                          </span>

                                          <span className="block text-[10px] text-muted-foreground">
                                            raw{" "}
                                            {num(
                                              component.rawScore,
                                            )}
                                            {component.rawRank
                                              ? ` · #${component.rawRank}`
                                              : ""}
                                          </span>
                                        </>
                                      ) : (
                                        <span className="text-muted-foreground">
                                          0*
                                        </span>
                                      )}
                                    </td>
                                  );
                                },
                              )}

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {
                                  row.totalVotingPoints
                                }
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {
                                  row.totalActivityPoints
                                }
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {num(
                                  row.finalCorrection,
                                )}
                              </td>

                              <td className="py-2 pr-3 text-right text-base font-semibold tabular-nums">
                                {
                                  row.finalCombinedPoints
                                }
                              </td>

                              <td>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpanded(
                                      open
                                        ? null
                                        : row.code,
                                    )
                                  }
                                  className="text-muted-foreground"
                                >
                                  <ChevronDown
                                    className={`h-4 w-4 transition ${
                                      open
                                        ? "rotate-180"
                                        : ""
                                    }`}
                                  />
                                </button>
                              </td>
                            </tr>

                            {open ? (
                              <tr
                                key={`${row.code}-details`}
                                className="bg-white/[0.03]"
                              >
                                <td
                                  colSpan={
                                    7 +
                                    (preview?.pools ??
                                      [])
                                      .length
                                  }
                                  className="space-y-2 p-3 text-xs"
                                >
                                  {row.componentResults.map(
                                    (
                                      component: any,
                                    ) => (
                                      <div
                                        key={
                                          component.sourceId
                                        }
                                        className="space-y-0.5"
                                      >
                                        <p className="font-medium text-foreground">
                                          {
                                            component.sourceName
                                          }{" "}
                                          ·{" "}
                                          {
                                            component.method
                                          }{" "}
                                          · pool{" "}
                                          {(
                                            preview?.pools ??
                                            []
                                          ).find(
                                            (
                                              pool: any,
                                            ) =>
                                              pool.sourceId ===
                                              component.sourceId,
                                          )
                                            ?.finalPool ??
                                            0}
                                        </p>

                                        {component.method ===
                                        "rank_weighted" ? (
                                          <p>
                                            Rank #
                                            {
                                              component.rawRank
                                            }{" "}
                                            · factor{" "}
                                            {num(
                                              component.rankFactor,
                                              4,
                                            )}{" "}
                                            · weighted{" "}
                                            {num(
                                              component.weightedScore,
                                              4,
                                            )}{" "}
                                            /{" "}
                                            {num(
                                              component.sourceWeightedTotal,
                                              4,
                                            )}
                                          </p>
                                        ) : (
                                          <p>
                                            Raw
                                            value{" "}
                                            {num(
                                              component.rawScore,
                                            )}
                                          </p>
                                        )}

                                        <p>
                                          Exact{" "}
                                          {num(
                                            component.exactAllocation,
                                            6,
                                          )}{" "}
                                          → floored{" "}
                                          {
                                            component.flooredAllocation
                                          }{" "}
                                          + remainder
                                          bonus{" "}
                                          {
                                            component.remainderBonus
                                          }{" "}
                                          ={" "}
                                          {
                                            component.finalAllocatedPoints
                                          }
                                        </p>
                                      </div>
                                    ),
                                  )}

                                  <p className="border-t border-white/10 pt-2">
                                    Final =
                                    voting{" "}
                                    {
                                      row.totalVotingPoints
                                    }{" "}
                                    + activity{" "}
                                    {
                                      row.totalActivityPoints
                                    }{" "}
                                    +
                                    correction{" "}
                                    {num(
                                      row.finalCorrection,
                                    )}{" "}
                                    ={" "}
                                    {
                                      row.finalCombinedPoints
                                    }
                                  </p>
                                </td>
                              </tr>
                            ) : null}
                          </>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-muted-foreground">
                0* means the
                entry has no value
                in that source and
                is counted as zero.
              </p>
            </section>

            {log.length > 0 ? (
              <section className="glass space-y-2 rounded-3xl p-5">
                <h3 className="text-base font-semibold">
                  Manual change
                  history
                </h3>

                <div className="max-h-64 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {log.map(
                    (
                      item: any,
                    ) => {
                      const entryKey =
                        item.country_code;

                      return (
                        <div
                          key={
                            item.id
                          }
                        >
                          {new Date(
                            item.created_at,
                          ).toLocaleString()}{" "}
                          ·{" "}
                          <span className="text-foreground">
                            {
                              item.actor_username
                            }
                          </span>{" "}
                          ·{" "}
                          {displayNameForKey(
                            entryKey,
                          )}
                          :{" "}
                          {Number(
                            item.previous_value,
                          )}{" "}
                          →{" "}
                          {Number(
                            item.new_value,
                          )}{" "}
                          (
                          {Number(
                            item.delta,
                          ) >= 0
                            ? "+"
                            : ""}
                          {Number(
                            item.delta,
                          )}
                          ) ·{" "}
                          {
                            item.entry_type
                          }{" "}
                          ·{" "}
                          {
                            item.reason
                          }
                        </div>
                      );
                    },
                  )}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      <ManualEntryDialog
        open={
          Boolean(
            entryDialog,
          )
        }
        onOpenChange={(
          open,
        ) => {
          if (!open) {
            setEntryDialog(
              null,
            );
          }
        }}
        entries={entryCatalog.filter(
          (entry) =>
            participants.includes(
              entry.entry_key,
            ),
        )}
        onSave={(
          payload,
        ) => {
          if (
            !entryDialog
          ) {
            return;
          }

          entryMut.mutate({
            ...payload,
            sourceId:
              entryDialog.sourceId,
          });
        }}
      />
    </AdminShell>
  );
}

function ParticipantsSection({
  entries,
  participants,
  onSave,
}: {
  entries: ResolvedEntry[];
  participants: string[];
  onSave: (
    entryKeys: string[],
  ) => void;
}) {
  const [
    selected,
    setSelected,
  ] = useState<string[]>(
    participants,
  );

  const [
    search,
    setSearch,
  ] = useState("");

  useEffect(() => {
    setSelected(
      participants,
    );
  }, [
    participants.join("|"),
  ]);

  const filtered =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return entries;
      }

      return entries.filter(
        (entry) => {
          const name =
            getEntryDisplayName(
              entry,
            ).toLowerCase();

          const code =
            getEntryCode(
              entry,
            ).toLowerCase();

          return (
            name.includes(
              query,
            ) ||
            code.includes(
              query,
            ) ||
            entry.entry_key
              .toLowerCase()
              .includes(query) ||
            (
              entry.subtitle ??
              ""
            )
              .toLowerCase()
              .includes(query)
          );
        },
      );
    }, [entries, search]);

  return (
    <section className="glass space-y-3 rounded-3xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            Eligible entries{" "}
            <span className="text-sm text-muted-foreground">
              (
              {
                selected.length
              }
              )
            </span>
          </h3>

          <p className="mt-1 text-xs text-muted-foreground">
            Entries come from
            round_entries in the
            linked voting round
            sources. Identical
            display names are not
            treated as the same
            participant.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() =>
            onSave(
              selected,
            )
          }
        >
          Save entries
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-muted-foreground">
          No round entries are
          available yet. Add a
          website voting round as
          a source first.
        </div>
      ) : (
        <>
          <Input
            placeholder="Search entries…"
            value={search}
            onChange={(
              event,
            ) =>
              setSearch(
                event.target
                  .value,
              )
            }
          />

          <ScrollArea className="h-64 rounded-2xl border border-white/10 p-2">
            <div className="grid gap-1 sm:grid-cols-2">
              {filtered.map(
                (entry) => {
                  const checked =
                    selected.includes(
                      entry.entry_key,
                    );

                  return (
                    <label
                      key={
                        entry.entry_key
                      }
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.03]"
                    >
                      <Checkbox
                        checked={
                          checked
                        }
                        onCheckedChange={(
                          value,
                        ) =>
                          setSelected(
                            (
                              previous,
                            ) =>
                              value
                                ? previous.includes(
                                    entry.entry_key,
                                  )
                                  ? previous
                                  : [
                                      ...previous,
                                      entry.entry_key,
                                    ]
                                : previous.filter(
                                    (
                                      key,
                                    ) =>
                                      key !==
                                      entry.entry_key,
                                  ),
                          )
                        }
                      />

                      <EntryAvatar
                        entry={
                          entry
                        }
                        size={20}
                      />

                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {getEntryDisplayName(
                            entry,
                          )}
                        </span>

                        <span className="block truncate text-[10px] text-muted-foreground">
                          {getEntryCode(
                            entry,
                          )}
                          {entry.subtitle
                            ? ` · ${entry.subtitle}`
                            : ""}
                        </span>
                      </span>
                    </label>
                  );
                },
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </section>
  );
}

function AddSourceForm({
  rounds,
  onAdd,
}: {
  rounds: any[];
  onAdd: (
    patch: any,
  ) => void;
}) {
  const [
    type,
    setType,
  ] = useState("round");

  const [
    roundId,
    setRoundId,
  ] = useState("");

  const [
    name,
    setName,
  ] = useState("");

  const [
    stage,
    setStage,
  ] = useState(
    "pre_conversion",
  );

  const [
    mode,
    setMode,
  ] = useState(
    "raw_results",
  );

  const [
    weight,
    setWeight,
  ] = useState("0");

  return (
    <div className="grid items-end gap-2 rounded-2xl border border-dashed border-white/15 p-3 sm:grid-cols-6">
      <div className="space-y-1">
        <Label className="text-xs">
          Type
        </Label>

        <Select
          value={type}
          onValueChange={(
            value,
          ) => {
            setType(
              value,
            );

            if (
              value !==
              "round"
            ) {
              setRoundId(
                "",
              );
            }

            if (
              value ===
              "activity"
            ) {
              setStage(
                "post_conversion",
              );
              setMode(
                "activity_points",
              );
            }

            if (
              value ===
              "correction"
            ) {
              setMode(
                "correction",
              );
            }
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            {SOURCE_TYPES.map(
              (item) => (
                <SelectItem
                  key={
                    item.value
                  }
                  value={
                    item.value
                  }
                >
                  {
                    item.label
                  }
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      {type === "round" ? (
        <div className="space-y-1">
          <Label className="text-xs">
            Voting round
          </Label>

          <Select
            value={
              roundId
            }
            onValueChange={(
              value,
            ) => {
              setRoundId(
                value,
              );

              const round =
                rounds.find(
                  (item) =>
                    item.id ===
                    value,
                );

              if (
                round &&
                !name
              ) {
                setName(
                  round.name,
                );
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select round" />
            </SelectTrigger>

            <SelectContent>
              {rounds.map(
                (
                  round,
                ) => (
                  <SelectItem
                    key={
                      round.id
                    }
                    value={
                      round.id
                    }
                  >
                    {round.edition_name
                      ? `${round.edition_name} — `
                      : ""}
                    {
                      round.name
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs">
            Source name
          </Label>

          <Input
            value={
              name
            }
            onChange={(
              event,
            ) =>
              setName(
                event.target
                  .value,
              )
            }
          />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">
          Input mode
        </Label>

        <Select
          value={mode}
          onValueChange={
            setMode
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            {SOURCE_INPUT_MODES.map(
              (
                item,
              ) => (
                <SelectItem
                  key={
                    item.value
                  }
                  value={
                    item.value
                  }
                >
                  {
                    item.label
                  }
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Stage
        </Label>

        <Select
          value={
            stage
          }
          onValueChange={
            setStage
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="pre_conversion">
              Before conversion
            </SelectItem>

            <SelectItem value="post_conversion">
              After conversion
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Weight %
        </Label>

        <Input
          inputMode="decimal"
          value={
            weight
          }
          onChange={(
            event,
          ) =>
            setWeight(
              event.target.value,
            )
          }
        />
      </div>

      <Button
        onClick={() => {
          const finalName =
            name.trim() ||
            rounds.find(
              (round) =>
                round.id ===
                roundId,
            )?.name ||
            SOURCE_TYPES.find(
              (item) =>
                item.value ===
                type,
            )?.label ||
            "Source";

          if (
            type ===
              "round" &&
            !roundId
          ) {
            toast.error(
              "Select a voting round",
            );
            return;
          }

          onAdd({
            sourceType:
              type,
            inputMode:
              mode,
            sourceRoundId:
              type ===
              "round"
                ? roundId
                : null,
            sourceName:
              finalName,
            stage,
            percentageWeight:
              Number(
                weight,
              ) || 0,
          });

          setName("");
          setRoundId("");
        }}
      >
        <Plus className="h-4 w-4" />
        Add source
      </Button>
    </div>
  );
}

function ManualEntryDialog({
  open,
  onOpenChange,
  entries,
  onSave,
}: {
  open: boolean;
  onOpenChange: (
    open: boolean,
  ) => void;
  entries: ResolvedEntry[];
  onSave: (
    payload: any,
  ) => void;
}) {
  const [
    entryKey,
    setEntryKey,
  ] = useState("");

  const [
    value,
    setValue,
  ] = useState("");

  const [
    entryType,
    setEntryType,
  ] = useState(
    "external_televote",
  );

  const [
    reason,
    setReason,
  ] = useState("");

  const negative =
    Number(value) < 0;

  const [
    confirmNegative,
    setConfirmNegative,
  ] = useState(false);

  useEffect(() => {
    if (!open) return;

    setEntryKey("");
    setValue("");
    setReason("");
    setConfirmNegative(
      false,
    );
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={
        onOpenChange
      }
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Add or update a value
          </DialogTitle>

          <DialogDescription>
            Values are attached to
            the participant's
            stable entry_key. The
            display name is only
            presentation metadata.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>
              Entry
            </Label>

            <Select
              value={
                entryKey
              }
              onValueChange={
                setEntryKey
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select entry" />
              </SelectTrigger>

              <SelectContent>
                {entries.map(
                  (
                    entry,
                  ) => (
                    <SelectItem
                      key={
                        entry.entry_key
                      }
                      value={
                        entry.entry_key
                      }
                    >
                      {getEntryDisplayName(
                        entry,
                      )}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>
              Value
            </Label>

            <Input
              value={
                value
              }
              onChange={(
                event,
              ) =>
                setValue(
                  event.target
                    .value,
                )
              }
            />
          </div>

          <div className="space-y-1">
            <Label>
              Entry type
            </Label>

            <Select
              value={
                entryType
              }
              onValueChange={
                setEntryType
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="external_televote">
                  External televote
                </SelectItem>

                <SelectItem value="instagram">
                  Instagram result
                </SelectItem>

                <SelectItem value="activity">
                  Activity bonus
                </SelectItem>

                <SelectItem value="correction">
                  Correction
                </SelectItem>

                <SelectItem value="other">
                  Other
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>
              Reason / note
            </Label>

            <Textarea
              value={
                reason
              }
              onChange={(
                event,
              ) =>
                setReason(
                  event.target
                    .value,
                )
              }
            />
          </div>

          {negative ? (
            <label className="flex items-start gap-2 rounded-2xl border border-amber-400/30 p-3 text-xs text-amber-200">
              <Checkbox
                checked={
                  confirmNegative
                }
                onCheckedChange={(
                  checked,
                ) =>
                  setConfirmNegative(
                    Boolean(
                      checked,
                    ),
                  )
                }
              />

              This is a negative
              adjustment. Confirm
              that you intend to
              subtract points.
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              onSave({
                entryKey,
                value:
                  Number(
                    value,
                  ),
                entryType,
                reason,
                confirmNegative,
              });

              onOpenChange(
                false,
              );
            }}
            disabled={
              !entryKey ||
              !reason.trim() ||
              (negative &&
                !confirmNegative)
            }
          >
            Save value
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
