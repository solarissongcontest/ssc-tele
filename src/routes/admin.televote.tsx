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
  Calculator,
  CheckCircle2,
  Download,
  FileJson,
  Loader2,
  Lock,
  Radio,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { EntryAvatar } from "@/components/entry-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  useAllRounds,
  useRoundEntries,
} from "@/hooks/use-round-results";
import {
  downloadCSV,
  downloadJSON,
} from "@/lib/export";
import {
  entryMap,
  entryNoun,
  getEntryDisplayName,
} from "@/lib/round-entries";
import {
  convertRound,
  DEFAULT_RANK_EXPONENT,
  formulaPreview,
  type ConversionRow,
} from "@/lib/televote-math";
import {
  checkPublicationReadiness,
  getTelevoteConversion,
  recalculateConversion,
  setResultsStatus,
  updateConversionConfig,
} from "@/lib/televote.functions";

export const Route =
  createFileRoute("/admin/televote")({
    head: () => ({
      meta: [
        {
          title:
            "Televote Conversion — Solaris Admin",
        },
        {
          name: "description",
          content:
            "Convert original Solaris televote totals into a fixed pool of whole-number televote points with a full audit trail.",
        },
      ],
    }),
    component: TelevotePage,
  });

const num = (
  value: number,
  digits = 4,
) =>
  Number.isFinite(value)
    ? value.toLocaleString(
        undefined,
        {
          maximumFractionDigits:
            digits,
        },
      )
    : "—";

function TelevotePage() {
  const qc = useQueryClient();

  const { data: rounds } =
    useAllRounds();

  const [roundId, setRoundId] =
    useState<string | null>(null);

  const [tInput, setTInput] =
    useState("");

  const [eInput, setEInput] =
    useState("");

  const [
    confirmOpen,
    setConfirmOpen,
  ] = useState(false);

  const [mode, setMode] =
    useState<
      "original" |
        "converted" |
        "side"
    >("side");

  const effective =
    roundId ??
    rounds?.[0]?.id ??
    null;

  const {
    data: roundEntries = [],
  } = useRoundEntries(effective);

  const byEntryKey = useMemo(
    () => entryMap(roundEntries),
    [roundEntries],
  );

  const participantSingle =
    entryNoun(roundEntries, false);

  const participantPlural =
    entryNoun(roundEntries, true);

  const fetchConversion =
    useServerFn(
      getTelevoteConversion,
    );

  const saveConfig =
    useServerFn(
      updateConversionConfig,
    );

  const recalc =
    useServerFn(
      recalculateConversion,
    );

  const setStatus =
    useServerFn(
      setResultsStatus,
    );

  const checkReady =
    useServerFn(
      checkPublicationReadiness,
    );

  const conv = useQuery({
    queryKey: [
      "televote-conversion",
      effective,
    ],

    queryFn: async () =>
      effective
        ? await fetchConversion({
            data: {
              roundId:
                effective,
            },
          })
        : null,

    enabled: Boolean(effective),

    refetchInterval: 10_000,
  });

  const round =
    conv.data?.round ?? null;

  useEffect(() => {
    if (!round) return;

    setTInput(
      String(
        round.total_points_to_distribute,
      ),
    );

    setEInput(
      String(
        round.rank_exponent,
      ),
    );
  }, [
    round?.id,
    round?.calculation_version,
  ]);

  const participants =
    conv.data?.participants ?? [];

  const n =
    participants.length;

  const parsedT =
    Number(tInput);

  const parsedE =
    Number(eInput);

  const validT =
    Number.isInteger(parsedT) &&
    parsedT >= 0;

  const validE =
    Number.isFinite(parsedE) &&
    parsedE > 0 &&
    parsedE <= 5;

  const preview = useMemo(() => {
    if (!conv.data) return null;

    return convertRound(
      conv.data.originals,
      validT
        ? parsedT
        : round?.total_points_to_distribute ??
            0,
      validE
        ? parsedE
        : Number(
            round?.rank_exponent ??
              DEFAULT_RANK_EXPONENT,
          ),
    );
  }, [
    conv.data,
    parsedT,
    parsedE,
    validT,
    validE,
    round,
  ]);

  const storedRows: ConversionRow[] =
    useMemo(() => {
      const rows = (
        conv.data?.stored ?? []
      ).map((row: any) => ({
        // country_code is the legacy result column name.
        // The value is the generic stable entry_key.
        code:
          row.entry_key ??
          row.country_code,

        originalVotes:
          row.original_votes,

        originalVoters:
          row.original_voters,

        originalRank:
          row.original_rank,

        originalShare: 0,

        participantCount:
          row.participant_count,

        rankBase:
          row.rank_base,

        rankExponent:
          Number(
            row.rank_exponent,
          ),

        rankFactor:
          Number(
            row.rank_factor,
          ),

        weightedScore:
          Number(
            row.weighted_score,
          ),

        exactPoints:
          Number(
            row.exact_points,
          ),

        flooredPoints:
          row.floored_points,

        decimalRemainder:
          Number(
            row.decimal_remainder,
          ),

        remainderBonus:
          row.remainder_bonus,

        finalPoints:
          row.final_points,
      }));

      const totalOriginal =
        rows.reduce(
          (sum, row) =>
            sum +
            row.originalVotes,
          0,
        );

      rows.forEach((row) => {
        row.originalShare =
          totalOriginal > 0
            ? row.originalVotes /
              totalOriginal
            : 0;
      });

      return rows.sort(
        (a, b) =>
          b.finalPoints -
            a.finalPoints ||
          a.originalRank -
            b.originalRank,
      );
    }, [conv.data]);

  const hasStored =
    storedRows.length > 0;

  const displayRows =
    hasStored
      ? storedRows
      : preview?.rows ?? [];

  const showingPreview =
    !hasStored ||
    Boolean(
      round?.results_outdated,
    );

  const invalidate = () => {
    void qc.invalidateQueries({
      queryKey: [
        "televote-conversion",
        effective,
      ],
    });

    void qc.invalidateQueries({
      queryKey: ["all-rounds"],
    });

    void qc.invalidateQueries({
      queryKey: [
        "round-entries-resolved",
        effective,
      ],
    });
  };

  const configM = useMutation({
    mutationFn: async (
      payload: Record<
        string,
        unknown
      >,
    ) =>
      await saveConfig({
        data: {
          roundId: effective!,
          ...payload,
        } as any,
      }),

    onSuccess: (result: any) => {
      invalidate();

      toast.success(
        result?.outdated
          ? "Saved. Result marked as needing recalculation."
          : "Settings saved",
      );
    },

    onError: (error: any) =>
      toast.error(error.message),
  });

  const recalcM = useMutation({
    mutationFn: async (
      confirm: boolean,
    ) =>
      await recalc({
        data: {
          roundId: effective!,
          confirm,
        },
      }),

    onSuccess: (result: any) => {
      invalidate();
      setConfirmOpen(false);

      if (result?.zeroWeight) {
        toast.warning(
          "All original totals are zero. No voting weight exists, so every converted value is 0.",
        );
      } else {
        toast.success(
          `Calculated v${result.version}: ${result.distributedTotal} points across ${result.participantCount} ${participantPlural}`,
        );
      }
    },

    onError: (error: any) =>
      toast.error(error.message),
  });

  const statusM = useMutation({
    mutationFn: async (
      status:
        | "calculated"
        | "locked"
        | "published",
    ) =>
      await setStatus({
        data: {
          roundId: effective!,
          status,
        },
      }),

    onSuccess: () => {
      invalidate();
      toast.success(
        "Result status updated",
      );
    },

    onError: (error: any) =>
      toast.error(error.message),
  });

  const readiness = useQuery({
    queryKey: [
      "televote-readiness",
      effective,
      round?.calculation_version,
      round?.results_outdated,
    ],

    queryFn: async () =>
      effective
        ? await checkReady({
            data: {
              roundId:
                effective,
            },
          })
        : null,

    enabled:
      Boolean(effective) &&
      Boolean(round) &&
      (round?.calculation_version ??
        0) > 0,
  });

  const needsRecalc =
    Boolean(
      round?.results_outdated,
    );

  const isLocked =
    round?.results_status ===
      "locked" ||
    round?.results_status ===
      "published";

  const nameForKey = (
    entryKey: string,
  ) => {
    const entry =
      byEntryKey.get(entryKey);

    return entry
      ? getEntryDisplayName(entry)
      : entryKey;
  };

  const exportAudit = () =>
    downloadCSV(
      `solaris-${
        round?.name ?? "round"
      }-conversion-audit.csv`
        .replace(/\s+/g, "-")
        .toLowerCase(),

      displayRows.map((row) => ({
        original_rank:
          row.originalRank,

        entry:
          nameForKey(row.code),

        entry_key: row.code,

        original_votes:
          row.originalVotes,

        original_share:
          (
            row.originalShare *
            100
          ).toFixed(4) + "%",

        rank_factor:
          row.rankFactor,

        weighted_score:
          row.weightedScore,

        exact_converted_quota:
          row.exactPoints,

        floored_points:
          row.flooredPoints,

        decimal_remainder:
          row.decimalRemainder,

        remainder_bonus:
          row.remainderBonus,

        final_converted_points:
          row.finalPoints,
      })),
    );

  const exportJson = () =>
    downloadJSON(
      `solaris-conversion-${
        round?.id ?? "round"
      }.json`,
      {
        round,
        participants,
        entries: roundEntries,
        rows: displayRows,
        source: hasStored
          ? "official-stored"
          : "browser-preview",
      },
    );

  const statusBadge = () => {
    const status =
      round?.results_status ??
      "draft";

    const tone =
      status === "published"
        ? "bg-emerald-500/20 text-emerald-300"
        : status === "locked"
          ? "bg-amber-500/20 text-amber-200"
          : status ===
              "calculated"
            ? "bg-sky-500/20 text-sky-200"
            : "bg-muted/30 text-muted-foreground";

    return (
      <Badge className={tone}>
        {status}
      </Badge>
    );
  };

  return (
    <AdminShell title="Televote Conversion">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-primary">
              Round
            </p>

            <Select
              value={
                effective ?? undefined
              }
              onValueChange={
                setRoundId
              }
            >
              <SelectTrigger className="w-[320px] max-w-full">
                <SelectValue placeholder="Select round" />
              </SelectTrigger>

              <SelectContent>
                {(rounds ?? []).map(
                  (item) => (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                    >
                      {item.edition_name
                        ? `${item.edition_name} — `
                        : ""}
                      {item.name} (
                      {item.status})
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            {statusBadge()}

            {needsRecalc ? (
              <Badge className="bg-destructive/25 text-destructive-foreground">
                needs recalculation
              </Badge>
            ) : null}
          </div>

          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportAudit}
            >
              <Download className="mr-2 h-4 w-4" />
              Audit CSV
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={exportJson}
            >
              <FileJson className="mr-2 h-4 w-4" />
              JSON
            </Button>
          </div>
        </div>

        <section className="glass space-y-5 rounded-3xl p-5">
          <header className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />

            <h2 className="text-sm uppercase tracking-widest text-primary">
              Conversion settings
            </h2>
          </header>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="tval">
                Total points to
                distribute (T)
              </Label>

              <Input
                id="tval"
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
                  if (
                    validT &&
                    parsedT !==
                      round?.total_points_to_distribute
                  ) {
                    configM.mutate({
                      totalPoints:
                        parsedT,
                    });
                  }
                }}
              />

              {!validT ? (
                <p className="text-xs text-destructive">
                  T must be a
                  non-negative whole
                  number.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="eval">
                Rank exponent (e)
              </Label>

              <Input
                id="eval"
                inputMode="decimal"
                value={eInput}
                onChange={(event) =>
                  setEInput(
                    event.target.value,
                  )
                }
                onBlur={() => {
                  if (
                    validE &&
                    parsedE !==
                      Number(
                        round?.rank_exponent,
                      )
                  ) {
                    configM.mutate({
                      rankExponent:
                        parsedE,
                    });
                  }
                }}
              />

              <p className="text-xs text-muted-foreground">
                Default 1.33
              </p>
            </div>

            <div className="space-y-2">
              <Label>
                Eligible participants
                (n)
              </Label>

              <div className="rounded-2xl border border-white/10 px-4 py-2 text-lg font-semibold">
                {n}
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                Rank base (n + 2)
              </Label>

              <div className="rounded-2xl border border-white/10 px-4 py-2 text-lg font-semibold">
                {n + 2}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 px-4 py-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Live formula preview
            </p>

            <p className="mt-1 font-mono text-lg">
              {formulaPreview(
                n,
                validE
                  ? parsedE
                  : Number(
                      round?.rank_exponent ??
                        DEFAULT_RANK_EXPONENT,
                    ),
              )}
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              exact_i = weighted_i ÷
              Σweighted ×{" "}
              {validT
                ? parsedT
                : round?.total_points_to_distribute ??
                  0}
              , then floor +
              largest-remainder
              allocation.
            </p>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <InfoCard
              label="Calculation status"
              value={
                round?.calculation_version
                  ? needsRecalc
                    ? "Outdated — recalculate"
                    : "Up to date"
                  : "Never calculated"
              }
            />

            <InfoCard
              label="Last calculated"
              value={
                round?.calculated_at
                  ? `${new Date(
                      round.calculated_at,
                    ).toLocaleString()}${
                      round.calculated_by_username
                        ? ` · ${round.calculated_by_username}`
                        : ""
                    }`
                  : "—"
              }
            />

            <InfoCard
              label="Result version"
              value={`v${
                round?.calculation_version ??
                0
              }`}
            />
          </div>

          {preview?.zeroWeight ? (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />

              <p>
                All original totals
                are zero.
                Proportional
                conversion cannot
                distribute T without
                voting weight, so
                every {participantSingle} receives 0
                points. No result is
                fabricated.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() =>
                isLocked
                  ? setConfirmOpen(
                      true,
                    )
                  : recalcM.mutate(
                      false,
                    )
              }
              disabled={
                !effective ||
                recalcM.isPending
              }
            >
              {recalcM.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-4 w-4" />
              )}

              Recalculate
            </Button>

            <Button
              variant="outline"
              onClick={() =>
                statusM.mutate(
                  "locked",
                )
              }
              disabled={
                !round?.calculation_version ||
                statusM.isPending
              }
            >
              <Lock className="mr-2 h-4 w-4" />
              Lock result
            </Button>

            <Button
              variant="outline"
              onClick={() =>
                statusM.mutate(
                  "published",
                )
              }
              disabled={
                !round?.calculation_version ||
                statusM.isPending
              }
            >
              <Radio className="mr-2 h-4 w-4" />
              Publish result
            </Button>

            {round?.results_status !==
            "draft" ? (
              <Button
                variant="ghost"
                onClick={() =>
                  statusM.mutate(
                    "calculated",
                  )
                }
                disabled={
                  statusM.isPending
                }
              >
                Unlock / unpublish
              </Button>
            ) : null}
          </div>

          {readiness.data ? (
            <div className="text-sm">
              {readiness.data
                .problems.length ===
              0 ? (
                <p className="flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  All publication
                  checks pass.
                </p>
              ) : (
                <ul className="space-y-1 text-amber-200">
                  {readiness.data.problems.map(
                    (problem: string) => (
                      <li
                        key={
                          problem
                        }
                        className="flex items-start gap-2"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4" />
                        {problem}
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3">
              <span className="text-sm">
                Public advanced
                transparency view

                <span className="block text-xs text-muted-foreground">
                  Expose weighted
                  calculation details
                  on the public result
                  page.
                </span>
              </span>

              <Switch
                checked={Boolean(
                  round?.public_advanced_transparency,
                )}
                onCheckedChange={(
                  value,
                ) =>
                  configM.mutate({
                    advancedTransparency:
                      value,
                  })
                }
              />
            </label>

            <div className="space-y-2 rounded-2xl border border-white/10 px-4 py-3">
              <Label>
                Broadcast graphics
                display mode
              </Label>

              <Select
                value={
                  round?.broadcast_display_mode ??
                  "converted"
                }
                onValueChange={(
                  value,
                ) =>
                  configM.mutate({
                    broadcastMode:
                      value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="original">
                    Original televote
                    totals
                  </SelectItem>

                  <SelectItem value="converted">
                    Converted televote
                    points
                  </SelectItem>

                  <SelectItem value="combined">
                    Combined contest
                    total
                  </SelectItem>
                </SelectContent>
              </Select>

              <p className="text-xs text-muted-foreground">
                Display only. Stored
                data is never altered.
              </p>
            </div>
          </div>
        </section>

        <section className="glass space-y-4 rounded-3xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm uppercase tracking-widest text-primary">
              {showingPreview
                ? "Unofficial preview"
                : `Official result · v${round?.calculation_version}`}
            </h2>

            <Tabs
              value={mode}
              onValueChange={(value) =>
                setMode(
                  value as typeof mode,
                )
              }
            >
              <TabsList>
                <TabsTrigger value="original">
                  Original
                </TabsTrigger>
                <TabsTrigger value="converted">
                  Converted
                </TabsTrigger>
                <TabsTrigger value="side">
                  Side-by-side
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {showingPreview ? (
            <p className="text-xs text-amber-200">
              These figures are a
              browser preview only.
              Press Recalculate to
              generate and store the
              official backend
              result.
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">
                    Orig. rank
                  </th>

                  <th className="py-2 pr-3">
                    {participantSingle}
                  </th>

                  {mode !==
                  "converted" ? (
                    <>
                      <th className="py-2 pr-3 text-right">
                        Original votes
                      </th>

                      <th className="py-2 pr-3 text-right">
                        Share
                      </th>
                    </>
                  ) : null}

                  {mode === "side" ? (
                    <>
                      <th className="py-2 pr-3 text-right">
                        Rank factor
                      </th>
                      <th className="py-2 pr-3 text-right">
                        Weighted
                      </th>
                      <th className="py-2 pr-3 text-right">
                        Exact quota
                      </th>
                      <th className="py-2 pr-3 text-right">
                        Floored
                      </th>
                      <th className="py-2 pr-3 text-right">
                        Remainder
                      </th>
                      <th className="py-2 pr-3 text-right">
                        Bonus
                      </th>
                    </>
                  ) : null}

                  {mode !==
                  "original" ? (
                    <th className="py-2 pr-3 text-right">
                      Converted points
                    </th>
                  ) : null}
                </tr>
              </thead>

              <tbody>
                {displayRows.map(
                  (row) => {
                    const entry =
                      byEntryKey.get(
                        row.code,
                      );

                    return (
                      <tr
                        key={row.code}
                        className="border-t border-white/5"
                      >
                        <td className="py-2 pr-3 tabular-nums">
                          {
                            row.originalRank
                          }
                        </td>

                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-2">
                            <EntryAvatar
                              entry={
                                entry
                              }
                              size={20}
                            />

                            <span>
                              {entry
                                ? getEntryDisplayName(
                                    entry,
                                  )
                                : row.code}
                            </span>
                          </span>
                        </td>

                        {mode !==
                        "converted" ? (
                          <>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {
                                row.originalVotes
                              }
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {(
                                row.originalShare *
                                100
                              ).toFixed(
                                2,
                              )}
                              %
                            </td>
                          </>
                        ) : null}

                        {mode ===
                        "side" ? (
                          <>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {num(
                                row.rankFactor,
                                3,
                              )}
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {num(
                                row.weightedScore,
                                2,
                              )}
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {num(
                                row.exactPoints,
                                4,
                              )}
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {
                                row.flooredPoints
                              }
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {num(
                                row.decimalRemainder,
                                4,
                              )}
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {
                                row.remainderBonus
                              }
                            </td>
                          </>
                        ) : null}

                        {mode !==
                        "original" ? (
                          <td className="py-2 pr-3 text-right text-base font-semibold tabular-nums">
                            {
                              row.finalPoints
                            }
                          </td>
                        ) : null}
                      </tr>
                    );
                  },
                )}

                {displayRows.length ===
                0 ? (
                  <tr>
                    <td
                      colSpan={12}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No eligible
                      participants
                      configured for
                      this round yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>

              {displayRows.length >
              0 ? (
                <tfoot>
                  <tr className="border-t border-white/15 font-semibold">
                    <td
                      className="py-2 pr-3"
                      colSpan={2}
                    >
                      Total
                    </td>

                    {mode !==
                    "converted" ? (
                      <>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {displayRows.reduce(
                            (
                              sum,
                              row,
                            ) =>
                              sum +
                              row.originalVotes,
                            0,
                          )}
                        </td>

                        <td />
                      </>
                    ) : null}

                    {mode ===
                    "side" ? (
                      <>
                        <td />
                        <td />
                        <td />
                        <td />
                        <td />
                        <td />
                      </>
                    ) : null}

                    {mode !==
                    "original" ? (
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {displayRows.reduce(
                          (
                            sum,
                            row,
                          ) =>
                            sum +
                            row.finalPoints,
                          0,
                        )}
                      </td>
                    ) : null}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={
          setConfirmOpen
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Recalculate a protected
              result?
            </AlertDialogTitle>

            <AlertDialogDescription>
              This result is currently{" "}
              {round?.results_status}.
              Recalculation will replace
              the stored conversion rows
              and create a new result
              version.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={() =>
                recalcM.mutate(true)
              }
            >
              Recalculate anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {label}
      </p>

      <p className="mt-1 font-medium">
        {value}
      </p>
    </div>
  );
}
