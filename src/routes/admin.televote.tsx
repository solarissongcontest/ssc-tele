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
  Radio,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { EntryAvatar } from "@/components/entry-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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

export const Route = createFileRoute("/admin/televote")({
  head: () => ({
    meta: [
      {
        title: "Televote Conversion — Solaris Admin",
      },
    ],
  }),
  component: TelevotePage,
});

function num(value: number, digits = 2) {
  return Number.isFinite(Number(value))
    ? Number(value).toLocaleString(undefined, {
        maximumFractionDigits: digits,
      })
    : "—";
}

function TelevotePage() {
  const qc = useQueryClient();
  const { data: rounds = [] } = useAllRounds();

  const fetchConversion = useServerFn(
    getTelevoteConversion,
  );
  const saveConfig = useServerFn(
    updateConversionConfig,
  );
  const recalc = useServerFn(
    recalculateConversion,
  );
  const setStatus = useServerFn(
    setResultsStatus,
  );
  const checkReady = useServerFn(
    checkPublicationReadiness,
  );

  const [roundId, setRoundId] = useState<
    string | null
  >(null);

  const [tab, setTab] = useState<
    "overview" | "audit" | "publish"
  >("overview");

  const effective =
    roundId ?? rounds?.[0]?.id ?? null;

  const { data: roundEntries = [] } =
    useRoundEntries(effective);

  const byEntryKey = useMemo(
    () => entryMap(roundEntries),
    [roundEntries],
  );

  const conv = useQuery({
    queryKey: [
      "televote-conversion-redesign",
      effective,
    ],

    queryFn: async () =>
      effective
        ? await fetchConversion({
            data: {
              roundId: effective,
            },
          })
        : null,

    enabled: Boolean(effective),
  });

  const round = conv.data?.round ?? null;
  const participants =
    conv.data?.participants ?? [];

  const [tInput, setTInput] = useState("");
  const [eInput, setEInput] = useState("");

  useEffect(() => {
    if (!round) return;

    setTInput(
      String(
        round.total_points_to_distribute ??
          0,
      ),
    );

    setEInput(
      String(
        round.rank_exponent ??
          DEFAULT_RANK_EXPONENT,
      ),
    );
  }, [
    round?.id,
    round?.total_points_to_distribute,
    round?.rank_exponent,
    round?.calculation_version,
  ]);

  const parsedT = Number(tInput);
  const parsedE = Number(eInput);

  const validT =
    Number.isInteger(parsedT) &&
    parsedT >= 0;

  const validE =
    Number.isFinite(parsedE) &&
    parsedE > 0 &&
    parsedE <= 5;

  const browserPreview = useMemo(() => {
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
          Number(row.rank_exponent),

        rankFactor:
          Number(row.rank_factor),

        weightedScore:
          Number(row.weighted_score),

        exactPoints:
          Number(row.exact_points),

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
            sum + row.originalVotes,
          0,
        );

      for (const row of rows) {
        row.originalShare =
          totalOriginal > 0
            ? row.originalVotes /
              totalOriginal
            : 0;
      }

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

  const showingPreview =
    !hasStored ||
    Boolean(
      round?.results_outdated,
    );

  const displayRows =
    showingPreview
      ? browserPreview?.rows ?? []
      : storedRows;

  const totalOriginal =
    (conv.data?.originals ?? []).reduce(
      (sum: number, row: any) =>
        sum +
        Number(row.originalVotes ?? 0),
      0,
    );

  const distributed =
    displayRows.reduce(
      (sum, row) =>
        sum +
        Number(row.finalPoints ?? 0),
      0,
    );

  const status =
    round?.results_status ?? "draft";

  const needsRecalc = Boolean(
    round?.results_outdated,
  );

  const locked =
    status === "locked" ||
    status === "published";

  const refresh = () => {
    void qc.invalidateQueries({
      queryKey: [
        "televote-conversion-redesign",
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

    void qc.invalidateQueries({
      queryKey: [
        "televote-readiness-redesign",
        effective,
      ],
    });
  };

  const configMut = useMutation({
    mutationFn: async (
      patch: Record<string, unknown>,
    ) =>
      await saveConfig({
        data: {
          roundId: effective!,
          ...patch,
        } as any,
      }),

    onSuccess: (result: any) => {
      refresh();

      toast.success(
        result?.outdated
          ? "Saved · result now needs recalculation"
          : "Settings saved",
      );
    },

    onError: (error: any) =>
      toast.error(
        error?.message ??
          "Could not save conversion settings",
      ),
  });

  const recalcMut = useMutation({
    mutationFn: async () =>
      await recalc({
        data: {
          roundId: effective!,
          confirm: locked,
        },
      }),

    onSuccess: (result: any) => {
      refresh();

      if (result?.zeroWeight) {
        toast.warning(
          "No voting weight exists. Every converted value is 0.",
        );
      } else {
        toast.success(
          `Calculated v${result.version} · ${result.distributedTotal} points distributed`,
        );
      }
    },

    onError: (error: any) =>
      toast.error(
        error?.message ??
          "Conversion failed",
      ),
  });

  const statusMut = useMutation({
    mutationFn: async (
      next:
        | "calculated"
        | "locked"
        | "published",
    ) =>
      await setStatus({
        data: {
          roundId: effective!,
          status: next,
        },
      }),

    onSuccess: () => {
      refresh();
      toast.success("Result status updated");
    },

    onError: (error: any) =>
      toast.error(
        error?.message ??
          "Could not change result status",
      ),
  });

  const readiness = useQuery({
    queryKey: [
      "televote-readiness-redesign",
      effective,
      round?.calculation_version,
      round?.results_outdated,
      round?.status,
    ],

    queryFn: async () =>
      effective
        ? await checkReady({
            data: {
              roundId: effective,
            },
          })
        : null,

    enabled:
      Boolean(effective) &&
      Boolean(round) &&
      (round?.calculation_version ??
        0) > 0,
  });

  const displayName = (
    entryKey: string,
  ) => {
    const entry =
      byEntryKey.get(entryKey);

    return entry
      ? getEntryDisplayName(entry)
      : entryKey;
  };

  const exportRows = () =>
    displayRows.map((row) => ({
      original_rank:
        row.originalRank,
      converted_rank:
        displayRows.findIndex(
          (item) =>
            item.code === row.code,
        ) + 1,
      entry:
        displayName(row.code),
      entry_key: row.code,
      original_votes:
        row.originalVotes,
      original_share:
        `${(
          row.originalShare * 100
        ).toFixed(4)}%`,
      rank_factor:
        row.rankFactor,
      weighted_score:
        row.weightedScore,
      exact_quota:
        row.exactPoints,
      floored_points:
        row.flooredPoints,
      remainder:
        row.decimalRemainder,
      remainder_bonus:
        row.remainderBonus,
      converted_points:
        row.finalPoints,
    }));

  return (
    <AdminShell title="Televote Conversion">
      <div className="space-y-5 pb-10">
        <section className="glass-strong rounded-3xl p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-primary">
                Televote conversion
              </p>

              <h2 className="mt-1 text-xl font-semibold">
                Original votes → final televote points
              </h2>

              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Pick a round, set the final point pool, preview the conversion,
                then calculate and publish. The audit math stays available
                without dominating the whole page.
              </p>
            </div>

            <Button
              onClick={() =>
                recalcMut.mutate()
              }
              disabled={
                !effective ||
                recalcMut.isPending
              }
            >
              <RefreshCcw className="h-4 w-4" />
              Recalculate
            </Button>
          </div>
        </section>

        <section className="glass rounded-3xl p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_auto]">
            <label>
              <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                Voting round
              </span>

              <select
                value={effective ?? ""}
                onChange={(event) => {
                  setRoundId(
                    event.target.value ||
                      null,
                  );
                  setTab("overview");
                }}
                className="min-h-11 w-full rounded-xl border border-border bg-background/30 px-3 text-sm"
              >
                {rounds.map(
                  (item: any) => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.edition_name
                        ? `${item.edition_name} · `
                        : ""}
                      {item.name}
                    </option>
                  ),
                )}
              </select>
            </label>

            <div className="flex flex-wrap items-end gap-2">
              <StatusPill
                status={status}
              />

              {needsRecalc ? (
                <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
                  needs recalculation
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {conv.isLoading ? (
          <EmptyPanel text="Loading televote conversion…" />
        ) : conv.error ? (
          <ErrorPanel
            text={
              conv.error instanceof Error
                ? conv.error.message
                : "Could not load conversion"
            }
          />
        ) : !round ? (
          <EmptyPanel text="Select a voting round." />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <MetricCard
                label="Entries"
                value={String(
                  participants.length,
                )}
              />

              <MetricCard
                label="Original points"
                value={num(
                  totalOriginal,
                  0,
                )}
              />

              <MetricCard
                label="Pool T"
                value={String(
                  validT
                    ? parsedT
                    : round.total_points_to_distribute,
                )}
              />

              <MetricCard
                label="Distributed"
                value={num(
                  distributed,
                  0,
                )}
                tone={
                  browserPreview?.zeroWeight
                    ? "warn"
                    : distributed ===
                        Number(
                          validT
                            ? parsedT
                            : round.total_points_to_distribute,
                        )
                      ? "ok"
                      : "warn"
                }
              />

              <MetricCard
                label="Version"
                value={`v${
                  round.calculation_version ??
                  0
                }`}
              />

              <MetricCard
                label="Status"
                value={status}
                tone={
                  status ===
                  "published"
                    ? "ok"
                    : needsRecalc
                      ? "warn"
                      : "normal"
                }
              />
            </section>

            {showingPreview ? (
              <Callout tone="warn">
                You are viewing a live preview. Press Recalculate to store an
                official backend result.
              </Callout>
            ) : (
              <Callout tone="ok">
                Official stored result v{round.calculation_version} is being
                shown.
              </Callout>
            )}

            <nav className="glass flex gap-1 overflow-x-auto rounded-2xl p-1.5">
              <TabButton
                active={tab === "overview"}
                onClick={() =>
                  setTab("overview")
                }
              >
                Overview
              </TabButton>

              <TabButton
                active={tab === "audit"}
                onClick={() =>
                  setTab("audit")
                }
              >
                Audit math
              </TabButton>

              <TabButton
                active={tab === "publish"}
                onClick={() =>
                  setTab("publish")
                }
              >
                Publish
              </TabButton>
            </nav>

            {tab === "overview" ? (
              <div className="grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
                <Panel
                  title="Conversion settings"
                  subtitle="Only two numbers control the conversion."
                >
                  <div className="space-y-4">
                    <Field label="Total points to distribute (T)">
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
                          if (
                            validT &&
                            parsedT !==
                              round.total_points_to_distribute
                          ) {
                            configMut.mutate({
                              totalPoints:
                                parsedT,
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
                          setEInput(
                            event.target.value,
                          )
                        }
                        onBlur={() => {
                          if (
                            validE &&
                            parsedE !==
                              Number(
                                round.rank_exponent,
                              )
                          ) {
                            configMut.mutate({
                              rankExponent:
                                parsedE,
                            });
                          }
                        }}
                      />

                      <p className="mt-1 text-xs text-muted-foreground">
                        Default 1.33 · allowed range 0–5
                      </p>
                    </Field>

                    <div className="rounded-2xl border border-border/60 bg-card/20 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Formula
                      </p>

                      <p className="mt-1 break-words font-mono text-sm">
                        {formulaPreview(
                          participants.length,
                          validE
                            ? parsedE
                            : Number(
                                round.rank_exponent ??
                                  DEFAULT_RANK_EXPONENT,
                              ),
                        )}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat
                        label="Rank base"
                        value={String(
                          participants.length +
                            2,
                        )}
                      />

                      <MiniStat
                        label="Exponent"
                        value={String(
                          validE
                            ? parsedE
                            : round.rank_exponent,
                        )}
                      />
                    </div>
                  </div>
                </Panel>

                <Panel
                  title="Converted leaderboard"
                  subtitle="Original vote strength and converted points together, without making you switch views."
                >
                  <div className="space-y-2">
                    {displayRows.map(
                      (
                        row,
                        index,
                      ) => {
                        const entry =
                          byEntryKey.get(
                            row.code,
                          );

                        const rankChange =
                          row.originalRank -
                          (index + 1);

                        return (
                          <div
                            key={row.code}
                            className="grid grid-cols-[28px_minmax(0,1fr)_86px_78px] items-center gap-2 rounded-2xl border border-border/55 bg-card/20 p-2.5"
                          >
                            <span className="text-center text-xs font-semibold tabular-nums text-muted-foreground">
                              {index + 1}
                            </span>

                            <div className="flex min-w-0 items-center gap-2">
                              <EntryAvatar
                                entry={entry}
                                size={22}
                              />

                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {displayName(
                                    row.code,
                                  )}
                                </p>

                                <p className="text-[10px] text-muted-foreground">
                                  original #
                                  {row.originalRank}
                                  {rankChange !==
                                  0
                                    ? ` · ${
                                        rankChange >
                                        0
                                          ? "▲"
                                          : "▼"
                                      }${Math.abs(
                                        rankChange,
                                      )}`
                                    : ""}
                                </p>
                              </div>
                            </div>

                            <div className="text-right">
                              <p className="text-sm font-medium tabular-nums">
                                {row.originalVotes}
                              </p>
                              <p className="text-[9px] uppercase text-muted-foreground">
                                original
                              </p>
                            </div>

                            <div className="text-right">
                              <p className="text-lg font-semibold tabular-nums">
                                {row.finalPoints}
                              </p>
                              <p className="text-[9px] uppercase text-muted-foreground">
                                converted
                              </p>
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                </Panel>
              </div>
            ) : null}

            {tab === "audit" ? (
              <div className="space-y-5">
                <Panel
                  title="Calculation audit"
                  subtitle="The full conversion math is here when you need to verify it, not permanently taking over the main page."
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[960px] text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="p-2 text-left">
                            Original #
                          </th>
                          <th className="p-2 text-left">
                            Entry
                          </th>
                          <th className="p-2 text-right">
                            Original
                          </th>
                          <th className="p-2 text-right">
                            Share
                          </th>
                          <th className="p-2 text-right">
                            Rank factor
                          </th>
                          <th className="p-2 text-right">
                            Weighted
                          </th>
                          <th className="p-2 text-right">
                            Exact quota
                          </th>
                          <th className="p-2 text-right">
                            Floor
                          </th>
                          <th className="p-2 text-right">
                            Remainder
                          </th>
                          <th className="p-2 text-right">
                            Bonus
                          </th>
                          <th className="p-2 text-right">
                            Final
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {displayRows.map(
                          (row) => (
                            <tr
                              key={
                                row.code
                              }
                              className="border-t border-border/50"
                            >
                              <td className="p-2 tabular-nums">
                                {
                                  row.originalRank
                                }
                              </td>

                              <td className="p-2 font-medium">
                                {displayName(
                                  row.code,
                                )}
                              </td>

                              <td className="p-2 text-right tabular-nums">
                                {
                                  row.originalVotes
                                }
                              </td>

                              <td className="p-2 text-right tabular-nums">
                                {(
                                  row.originalShare *
                                  100
                                ).toFixed(
                                  2,
                                )}
                                %
                              </td>

                              <td className="p-2 text-right tabular-nums">
                                {num(
                                  row.rankFactor,
                                  4,
                                )}
                              </td>

                              <td className="p-2 text-right tabular-nums">
                                {num(
                                  row.weightedScore,
                                  4,
                                )}
                              </td>

                              <td className="p-2 text-right tabular-nums">
                                {num(
                                  row.exactPoints,
                                  4,
                                )}
                              </td>

                              <td className="p-2 text-right tabular-nums">
                                {
                                  row.flooredPoints
                                }
                              </td>

                              <td className="p-2 text-right tabular-nums">
                                {num(
                                  row.decimalRemainder,
                                  4,
                                )}
                              </td>

                              <td className="p-2 text-right tabular-nums">
                                {
                                  row.remainderBonus
                                }
                              </td>

                              <td className="p-2 text-right text-base font-semibold tabular-nums">
                                {
                                  row.finalPoints
                                }
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        downloadCSV(
                          `solaris-${round.name}-conversion-audit.csv`
                            .replace(
                              /\s+/g,
                              "-",
                            )
                            .toLowerCase(),
                          exportRows(),
                        )
                      }
                    >
                      <Download className="h-4 w-4" />
                      Audit CSV
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() =>
                        downloadJSON(
                          `solaris-conversion-${round.id}.json`,
                          {
                            round,
                            participants,
                            entries:
                              roundEntries,
                            rows:
                              displayRows,
                            source:
                              showingPreview
                                ? "browser-preview"
                                : "official-stored",
                          },
                        )
                      }
                    >
                      JSON
                    </Button>
                  </div>
                </Panel>
              </div>
            ) : null}

            {tab === "publish" ? (
              <div className="grid gap-5 xl:grid-cols-2">
                <Panel
                  title="Publication readiness"
                  subtitle="The backend must pass every integrity check before publishing."
                >
                  {readiness.isLoading ? (
                    <p className="text-sm text-muted-foreground">
                      Checking…
                    </p>
                  ) : readiness.data?.problems
                      ?.length ? (
                    <div className="space-y-2">
                      {readiness.data.problems.map(
                        (
                          problem: string,
                        ) => (
                          <Callout
                            key={
                              problem
                            }
                            tone="warn"
                          >
                            {
                              problem
                            }
                          </Callout>
                        ),
                      )}
                    </div>
                  ) : (
                    <Callout tone="ok">
                      All publication checks pass.
                    </Callout>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        recalcMut.mutate()
                      }
                      disabled={
                        recalcMut.isPending
                      }
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Recalculate
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() =>
                        statusMut.mutate(
                          "locked",
                        )
                      }
                      disabled={
                        !round.calculation_version
                      }
                    >
                      <Lock className="h-4 w-4" />
                      Lock
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() =>
                        statusMut.mutate(
                          "published",
                        )
                      }
                      disabled={
                        !round.calculation_version
                      }
                    >
                      <Radio className="h-4 w-4" />
                      Publish
                    </Button>

                    {round.results_status !==
                    "draft" ? (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          statusMut.mutate(
                            "calculated",
                          )
                        }
                      >
                        Unlock / unpublish
                      </Button>
                    ) : null}
                  </div>
                </Panel>

                <Panel
                  title="Display settings"
                  subtitle="These affect presentation only. They never alter the stored votes."
                >
                  <div className="space-y-4">
                    <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-border/60 px-3">
                      <span>
                        <span className="block text-sm font-medium">
                          Advanced transparency
                        </span>

                        <span className="block text-xs text-muted-foreground">
                          Show weighted calculation details publicly.
                        </span>
                      </span>

                      <Switch
                        checked={Boolean(
                          round.public_advanced_transparency,
                        )}
                        onCheckedChange={(
                          value,
                        ) =>
                          configMut.mutate({
                            advancedTransparency:
                              value,
                          })
                        }
                      />
                    </label>

                    <Field label="Broadcast graphics mode">
                      <select
                        value={
                          round.broadcast_display_mode ??
                          "converted"
                        }
                        onChange={(event) =>
                          configMut.mutate({
                            broadcastMode:
                              event.target
                                .value,
                          })
                        }
                        className="min-h-11 w-full rounded-xl border border-border bg-background/30 px-3 text-sm"
                      >
                        <option value="original">
                          Original televote totals
                        </option>
                        <option value="converted">
                          Converted televote points
                        </option>
                        <option value="combined">
                          Combined contest total
                        </option>
                      </select>
                    </Field>

                    <MiniStat
                      label="Last calculated"
                      value={
                        round.calculated_at
                          ? new Date(
                              round.calculated_at,
                            ).toLocaleString()
                          : "Never"
                      }
                    />

                    <MiniStat
                      label="Calculated by"
                      value={
                        round.calculated_by_username ??
                        "—"
                      }
                    />
                  </div>
                </Panel>
              </div>
            ) : null}
          </>
        )}
      </div>
    </AdminShell>
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
      <h3 className="font-semibold">
        {title}
      </h3>

      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {subtitle}
      </p>

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
      <p className="mt-1 text-sm font-semibold">
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
        : status === "calculated"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border/60 bg-card/20 text-muted-foreground";

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
  const warn =
    tone === "warn";

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
        Televote conversion could not load
      </p>

      <p className="mt-2 text-sm text-muted-foreground">
        {text}
      </p>
    </div>
  );
}
