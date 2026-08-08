import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  Loader2,
  RefreshCcw,
  Trophy,
} from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { CountryFlag, countryName } from "@/components/country-flag";
import { EntryAvatar } from "@/components/entry-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAllCountries,
  useAllRounds,
  useRoundEntries,
  useRoundResults,
} from "@/hooks/use-round-results";
import {
  downloadCSV,
  downloadExcel,
  downloadJSON,
} from "@/lib/export";
import {
  entryMap,
  entryNoun,
  getEntryDisplayName,
  type ResolvedEntry,
} from "@/lib/round-entries";
import { cn } from "@/lib/utils";

type CountryRow = {
  code: string;
  name: string;
  flag: string;
  flag_url: string | null;
};

export const Route = createFileRoute("/admin/results")({
  head: () => ({
    meta: [{ title: "Results — Solaris Admin" }],
  }),
  component: ResultsPage,
});

function ResultsPage() {
  const qc = useQueryClient();

  const {
    data: rounds,
    isLoading: roundsLoading,
  } = useAllRounds();

  const { data: countries } = useAllCountries();

  const [roundId, setRoundId] =
    useState<string | null>(null);

  const [includeDeleted, setIncludeDeleted] =
    useState(false);

  const effective =
    roundId ??
    rounds?.find(
      (round) => round.status === "open",
    )?.id ??
    rounds?.[0]?.id ??
    null;

  const { subs, entries } = useRoundResults(
    effective,
    includeDeleted,
  );

  const { data: roundEntries = [] } =
    useRoundEntries(effective);

  const byEntryKey = useMemo(
    () => entryMap(roundEntries),
    [roundEntries],
  );

  const byCountryCode = useMemo(() => {
    const map = new Map<string, CountryRow>();

    for (const country of countries ?? []) {
      map.set(country.code, country);
    }

    return map;
  }, [countries]);

  const round =
    rounds?.find(
      (item) => item.id === effective,
    ) ?? null;

  const participantPlural =
    entryNoun(roundEntries, true);

  const scoreboard = useMemo(() => {
    const totals = new Map<
      string,
      {
        points: number;
        voters: Set<string>;
      }
    >();

    const submissionMap = new Map(
      (subs.data ?? []).map((submission) => [
        submission.id,
        submission,
      ]),
    );

    for (const voteEntry of entries.data ?? []) {
      const entryKey =
        voteEntry.target_country_code;

      const current =
        totals.get(entryKey) ?? {
          points: 0,
          voters: new Set<string>(),
        };

      current.points += voteEntry.points;

      const submission =
        submissionMap.get(
          voteEntry.submission_id,
        );

      if (submission) {
        current.voters.add(
          submission.username_normalized,
        );
      }

      totals.set(entryKey, current);
    }

    return Array.from(totals.entries())
      .map(([entryKey, value]) => {
        const entry =
          byEntryKey.get(entryKey);

        return {
          entryKey,
          entry,
          name: entry
            ? getEntryDisplayName(entry)
            : entryKey,
          points: value.points,
          voters: value.voters.size,
        };
      })
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.voters - a.voters ||
          a.name.localeCompare(b.name),
      );
  }, [
    entries.data,
    subs.data,
    byEntryKey,
  ]);

  const entriesBySubmission = useMemo(() => {
    const map = new Map<
      string,
      {
        entryKey: string;
        entry: ResolvedEntry | undefined;
        name: string;
        points: number;
      }[]
    >();

    for (const voteEntry of
      entries.data ?? []) {
      const current =
        map.get(
          voteEntry.submission_id,
        ) ?? [];

      const entryKey =
        voteEntry.target_country_code;

      const entry =
        byEntryKey.get(entryKey);

      current.push({
        entryKey,
        entry,
        name: entry
          ? getEntryDisplayName(entry)
          : entryKey,
        points: voteEntry.points,
      });

      map.set(
        voteEntry.submission_id,
        current,
      );
    }

    for (const values of map.values()) {
      values.sort(
        (a, b) =>
          b.points - a.points ||
          a.name.localeCompare(b.name),
      );
    }

    return map;
  }, [entries.data, byEntryKey]);

  const refresh = () => {
    void qc.invalidateQueries({
      queryKey: [
        "round-results",
        effective,
      ],
    });

    void qc.invalidateQueries({
      queryKey: [
        "round-entries-resolved",
        effective,
      ],
    });
  };

  const exportOverallCSV = () => {
    downloadCSV(
      `solaris-${slug(
        round?.name,
      )}-scoreboard.csv`,
      scoreboard.map((row, index) => ({
        rank: index + 1,
        entry_key: row.entryKey,
        entry: row.name,
        points: row.points,
        voters: row.voters,
      })),
    );
  };

  const exportDetailedCSV = () => {
    const rows: Record<
      string,
      unknown
    >[] = [];

    for (const submission of
      subs.data ?? []) {
      const home =
        byCountryCode.get(
          submission.country_code,
        );

      const breakdown =
        entriesBySubmission.get(
          submission.id,
        ) ?? [];

      for (const item of breakdown) {
        rows.push({
          submission_id: submission.id,
          username: submission.username,
          home_country:
            home?.name ??
            submission.country_code,
          home_code:
            submission.country_code,
          submitted_at:
            submission.created_at,
          target_entry: item.name,
          target_entry_key:
            item.entryKey,
          points: item.points,
        });
      }
    }

    downloadCSV(
      `solaris-${slug(
        round?.name,
      )}-detailed.csv`,
      rows,
    );
  };

  const exportExcel = () => {
    downloadExcel(
      `solaris-${slug(
        round?.name,
      )}-scoreboard.xls`,
      scoreboard.map((row, index) => ({
        Rank: index + 1,
        Entry: row.name,
        EntryKey: row.entryKey,
        Points: row.points,
        Voters: row.voters,
      })),
    );
  };

  const exportJSONFile = () => {
    downloadJSON(
      `solaris-${slug(
        round?.name,
      )}-results.json`,
      {
        round: round
          ? {
              id: round.id,
              name: round.name,
              status: round.status,
              edition:
                round.edition_name,
              participant_mode:
                round.participant_mode,
            }
          : null,

        scoreboard,

        submissions: (
          subs.data ?? []
        ).map((submission) => ({
          ...submission,
          breakdown:
            entriesBySubmission.get(
              submission.id,
            ) ?? [],
        })),
      },
    );
  };

  const totalVotes =
    subs.data?.length ?? 0;

  const totalPoints =
    scoreboard.reduce(
      (sum, row) =>
        sum + row.points,
      0,
    );

  return (
    <AdminShell title="Results">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-primary">
              Round
            </p>

            <Select
              value={
                effective ?? undefined
              }
              onValueChange={(value) =>
                setRoundId(value)
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
                        ? `${item.edition_name} · `
                        : ""}
                      {item.name}
                      {item.status === "open"
                        ? " · Open"
                        : ""}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant={
                includeDeleted
                  ? "default"
                  : "outline"
              }
              size="sm"
              onClick={() =>
                setIncludeDeleted(
                  (value) => !value,
                )
              }
              title="When on, deleted ballots are included in totals"
            >
              {includeDeleted
                ? "Including deleted"
                : "Excluding deleted"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger
                asChild
              >
                <Button
                  size="sm"
                  className="bg-hero text-primary-foreground"
                >
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={
                    exportOverallCSV
                  }
                >
                  <Download className="h-4 w-4" />
                  CSV · overall
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={
                    exportDetailedCSV
                  }
                >
                  <Download className="h-4 w-4" />
                  CSV · detailed
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={exportExcel}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel / Sheets
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={
                    exportJSONFile
                  }
                >
                  <FileJson className="h-4 w-4" />
                  JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Submissions"
            value={totalVotes}
          />

          <Stat
            label="Points cast"
            value={totalPoints}
          />

          <Stat
            label={`${
              participantPlural[0]?.toUpperCase() ??
              ""
            }${participantPlural.slice(
              1,
            )} scored`}
            value={scoreboard.length}
          />

          <Stat
            label="Round status"
            value={
              round?.status ?? "—"
            }
            valueClass={
              round?.status === "open"
                ? "text-primary"
                : ""
            }
          />
        </div>

        {roundsLoading ||
        subs.isLoading ? (
          <Loading />
        ) : !effective ? (
          <Empty
            title="No rounds yet"
            body="Create a round to see results here."
          />
        ) : (
          <>
            <section className="glass-strong overflow-hidden rounded-2xl">
              <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">
                    Scoreboard
                  </h3>
                </div>

                <Badge
                  variant="outline"
                  className="tabular-nums"
                >
                  {scoreboard.length}{" "}
                  {participantPlural}
                </Badge>
              </header>

              {scoreboard.length ===
              0 ? (
                <Empty
                  body="No votes yet. The scoreboard will update as votes come in."
                  plain
                />
              ) : (
                <ol className="divide-y divide-border">
                  {scoreboard.map(
                    (row, index) => {
                      const rank =
                        index + 1;

                      return (
                        <li
                          key={
                            row.entryKey
                          }
                          className={cn(
                            "flex items-center gap-3 px-4 py-3 sm:px-5",
                            rank <= 3 &&
                              "bg-primary/5",
                          )}
                        >
                          <span
                            className={cn(
                              "w-7 text-center font-bold tabular-nums",
                              rank === 1 &&
                                "text-lg text-primary",
                              rank === 2 &&
                                "text-foreground",
                              rank === 3 &&
                                "text-foreground/80",
                              rank > 3 &&
                                "text-muted-foreground",
                            )}
                          >
                            {rank}
                          </span>

                          <EntryAvatar
                            entry={
                              row.entry
                            }
                            size={32}
                          />

                          <span className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {row.name}
                            </div>

                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {row.voters}{" "}
                              {row.voters === 1
                                ? "voter"
                                : "voters"}
                            </div>
                          </span>

                          <span className="text-lg font-bold tabular-nums text-primary">
                            {row.points}
                          </span>
                        </li>
                      );
                    },
                  )}
                </ol>
              )}
            </section>

            <section className="glass-strong overflow-hidden rounded-2xl">
              <header className="border-b border-border px-4 py-3 sm:px-5">
                <h3 className="font-semibold">
                  Voter breakdown
                </h3>

                <p className="text-xs text-muted-foreground">
                  Tap a row to expand a voter's full point distribution.
                </p>
              </header>

              {(subs.data ?? [])
                .length === 0 ? (
                <Empty
                  body="No submissions yet."
                  plain
                />
              ) : (
                <ul className="divide-y divide-border">
                  {(subs.data ?? []).map(
                    (submission) => {
                      const home =
                        byCountryCode.get(
                          submission.country_code,
                        );

                      const breakdown =
                        entriesBySubmission.get(
                          submission.id,
                        ) ?? [];

                      return (
                        <li
                          key={
                            submission.id
                          }
                        >
                          <Collapsible>
                            <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-card/40 sm:px-5">
                              <CountryFlag
                                country={
                                  home
                                }
                                size={24}
                              />

                              <span className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">
                                  {
                                    submission.username
                                  }
                                </div>

                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                  {countryName(
                                    home,
                                  )}{" "}
                                  ·{" "}
                                  {new Date(
                                    submission.created_at,
                                  ).toLocaleString()}
                                </div>
                              </span>

                              <Badge
                                variant="outline"
                                className="tabular-nums"
                              >
                                {
                                  breakdown.length
                                }{" "}
                                picks
                              </Badge>

                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            </CollapsibleTrigger>

                            <CollapsibleContent>
                              <div className="grid grid-cols-2 gap-1.5 px-4 pb-3 sm:grid-cols-3 sm:px-5">
                                {breakdown.map(
                                  (item) => (
                                    <div
                                      key={
                                        item.entryKey
                                      }
                                      className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2 py-1.5"
                                    >
                                      <EntryAvatar
                                        entry={
                                          item.entry
                                        }
                                        size={
                                          20
                                        }
                                      />

                                      <span className="min-w-0 flex-1 truncate text-xs">
                                        {
                                          item.name
                                        }
                                      </span>

                                      <span className="text-xs font-bold tabular-nums text-primary">
                                        {
                                          item.points
                                        }
                                      </span>
                                    </div>
                                  ),
                                )}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        </li>
                      );
                    },
                  )}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string | number;
  valueClass?: string;
}) {
  return (
    <div className="glass rounded-xl p-3 sm:p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>

      <div
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          valueClass,
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
      Loading results…
    </div>
  );
}

function Empty({
  title,
  body,
  plain,
}: {
  title?: string;
  body: string;
  plain?: boolean;
}) {
  return (
    <div
      className={cn(
        "space-y-1 p-10 text-center",
        !plain &&
          "glass-strong rounded-2xl",
      )}
    >
      {title ? (
        <h3 className="font-semibold">
          {title}
        </h3>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function slug(value?: string | null) {
  return (
    value ?? "round"
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
