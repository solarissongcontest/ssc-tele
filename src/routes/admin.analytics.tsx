import { createFileRoute } from "@tanstack/react-router";
import {
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Download,
  Loader2,
  RefreshCcw,
  Trophy,
  Users,
} from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { AnalysisScopePicker } from "@/components/analysis-scope-picker";
import { CountryFlag } from "@/components/country-flag";
import { EntryAvatar } from "@/components/entry-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEntryKeyCatalog } from "@/hooks/use-entry-key-catalog";
import { useAllCountries } from "@/hooks/use-round-results";
import {
  getScopedAnalytics,
} from "@/lib/analysis-scope.functions";
import {
  DEFAULT_ANALYSIS_SCOPE,
  analysisScopeKey,
  type AnalysisScope,
} from "@/lib/analysis-scope";
import { downloadCSV, downloadExcel } from "@/lib/export";
import {
  entryMap,
  getEntryDisplayName,
} from "@/lib/round-entries";
import { cn } from "@/lib/utils";

type CountryRow = {
  code: string;
  name: string;
  flag: string;
  flag_url: string | null;
};

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({
    meta: [{ title: "Analytics — Solaris Admin" }],
  }),
  component: AnalyticsPage,
});

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function AnalyticsPage() {
  const scopedFn = useServerFn(getScopedAnalytics);
  const { data: countries = [] } = useAllCountries();

  const [scope, setScope] =
    useState<AnalysisScope>(DEFAULT_ANALYSIS_SCOPE);

  const scoped = useQuery({
    queryKey: ["scoped-analytics-v2", analysisScopeKey(scope)],
    queryFn: () =>
      scopedFn({
        data: { scope },
      }),
  });

  const submissions = scoped.data?.submissions ?? [];
  const entries = scoped.data?.entries ?? [];
  const rounds = scoped.data?.rounds ?? [];
  const editions = scoped.data?.editions ?? [];

  const eligibleSubmissions = useMemo(
    () =>
      submissions.filter(
        (submission) => submission.status !== "deleted",
      ),
    [submissions],
  );

  const eligibleIds = useMemo(
    () =>
      new Set(
        eligibleSubmissions.map((submission) => submission.id),
      ),
    [eligibleSubmissions],
  );

  const eligibleEntries = useMemo(
    () =>
      entries.filter((entry) =>
        eligibleIds.has(entry.submission_id),
      ),
    [entries, eligibleIds],
  );

  /*
   * Historical ballots are not guaranteed to store country identity in exactly
   * the same casing/format as the current countries table. Resolve both code
   * and country name, normalized, and only fall back to the raw stored value.
   * This prevents the wall of "Unknown Country" cards.
   */
  const countryLookup = useMemo(() => {
    const map = new Map<string, CountryRow>();

    for (const country of countries) {
      map.set(normalizeIdentity(country.code), country);
      map.set(normalizeIdentity(country.name), country);
    }

    return map;
  }, [countries]);

  const resolveCountry = (
    storedIdentity: string | null | undefined,
  ): CountryRow | null =>
    countryLookup.get(normalizeIdentity(storedIdentity)) ?? null;

  const countryLabel = (
    storedIdentity: string | null | undefined,
  ) => {
    const resolved = resolveCountry(storedIdentity);

    if (resolved) return resolved.name;

    const raw = (storedIdentity ?? "").trim();
    return raw || "Unresolved voter";
  };

  const targetKeys = useMemo(
    () =>
      Array.from(
        new Set(
          eligibleEntries
            .map((entry) => entry.target_entry_key)
            .filter(Boolean),
        ),
      ),
    [eligibleEntries],
  );

  const { data: resolvedEntries = [] } =
    useEntryKeyCatalog(targetKeys);

  const byEntryKey = useMemo(
    () => entryMap(resolvedEntries),
    [resolvedEntries],
  );

  const submissionMap = useMemo(
    () =>
      new Map(
        eligibleSubmissions.map((submission) => [
          submission.id,
          submission,
        ]),
      ),
    [eligibleSubmissions],
  );

  const entriesBySubmission = useMemo(() => {
    const map = new Map<
      string,
      typeof eligibleEntries
    >();

    for (const entry of eligibleEntries) {
      const current =
        map.get(entry.submission_id) ?? [];
      current.push(entry);
      map.set(entry.submission_id, current);
    }

    return map;
  }, [eligibleEntries]);

  const overview = useMemo(() => {
    const voterCountries = new Set(
      eligibleSubmissions
        .map((submission) =>
          normalizeIdentity(submission.country_code),
        )
        .filter(Boolean),
    );

    let totalBallotPoints = 0;
    let totalSupportedEntries = 0;

    for (const submission of eligibleSubmissions) {
      const ballotEntries =
        entriesBySubmission.get(submission.id) ?? [];

      totalBallotPoints += ballotEntries.reduce(
        (sum, entry) => sum + entry.points,
        0,
      );

      totalSupportedEntries += ballotEntries.filter(
        (entry) => entry.points > 0,
      ).length;
    }

    return {
      ballots: eligibleSubmissions.length,
      voterCountries: voterCountries.size,
      editions: editions.length,
      rounds: rounds.length,
      avgBallotPoints:
        eligibleSubmissions.length > 0
          ? totalBallotPoints / eligibleSubmissions.length
          : 0,
      avgSupported:
        eligibleSubmissions.length > 0
          ? totalSupportedEntries / eligibleSubmissions.length
          : 0,
    };
  }, [
    eligibleSubmissions,
    entriesBySubmission,
    editions.length,
    rounds.length,
  ]);

  const editionRows = useMemo(() => {
    const rows = new Map<
      string,
      {
        id: string;
        name: string;
        ballots: number;
        voterCountries: Set<string>;
        roundIds: Set<string>;
        points: number;
      }
    >();

    for (const edition of editions) {
      rows.set(edition.id, {
        id: edition.id,
        name: edition.name,
        ballots: 0,
        voterCountries: new Set(),
        roundIds: new Set(),
        points: 0,
      });
    }

    for (const submission of eligibleSubmissions) {
      const row = rows.get(submission.edition_id);

      if (!row) continue;

      row.ballots += 1;
      row.voterCountries.add(
        normalizeIdentity(submission.country_code),
      );
      row.roundIds.add(submission.round_id);

      for (const entry of
        entriesBySubmission.get(submission.id) ?? []) {
        row.points += entry.points;
      }
    }

    return Array.from(rows.values())
      .filter((row) => row.ballots > 0)
      .map((row) => ({
        id: row.id,
        name: row.name,
        ballots: row.ballots,
        voterCountries: row.voterCountries.size,
        rounds: row.roundIds.size,
        points: row.points,
        avgBallot:
          row.ballots > 0 ? row.points / row.ballots : 0,
      }));
  }, [
    editions,
    eligibleSubmissions,
    entriesBySubmission,
  ]);

  const delegationRows = useMemo(() => {
    const map = new Map<
      string,
      {
        rawIdentity: string;
        ballots: number;
        editions: Set<string>;
        rounds: Set<string>;
        totalPoints: number;
        supportedEntries: number;
        latest: string;
      }
    >();

    for (const submission of eligibleSubmissions) {
      const key =
        normalizeIdentity(submission.country_code) ||
        submission.country_code;

      const current =
        map.get(key) ?? {
          rawIdentity: submission.country_code,
          ballots: 0,
          editions: new Set<string>(),
          rounds: new Set<string>(),
          totalPoints: 0,
          supportedEntries: 0,
          latest: submission.created_at,
        };

      current.ballots += 1;
      current.editions.add(submission.edition_id);
      current.rounds.add(submission.round_id);

      const ballotEntries =
        entriesBySubmission.get(submission.id) ?? [];

      current.totalPoints += ballotEntries.reduce(
        (sum, entry) => sum + entry.points,
        0,
      );

      current.supportedEntries += ballotEntries.filter(
        (entry) => entry.points > 0,
      ).length;

      if (
        new Date(submission.created_at).getTime() >
        new Date(current.latest).getTime()
      ) {
        current.latest = submission.created_at;
      }

      map.set(key, current);
    }

    return Array.from(map.values())
      .map((row) => {
        const country =
          resolveCountry(row.rawIdentity);

        return {
          rawIdentity: row.rawIdentity,
          country,
          name:
            country?.name ??
            row.rawIdentity ??
            "Unresolved voter",
          ballots: row.ballots,
          editions: row.editions.size,
          rounds: row.rounds.size,
          avgBallot:
            row.ballots > 0
              ? row.totalPoints / row.ballots
              : 0,
          avgSupported:
            row.ballots > 0
              ? row.supportedEntries / row.ballots
              : 0,
          latest: row.latest,
        };
      })
      .sort(
        (a, b) =>
          b.ballots - a.ballots ||
          a.name.localeCompare(b.name),
      );
  }, [
    eligibleSubmissions,
    entriesBySubmission,
    countryLookup,
  ]);

  const targetRows = useMemo(() => {
    const map = new Map<
      string,
      {
        points: number;
        scores: number;
        maxScores: number;
        rounds: Set<string>;
      }
    >();

    for (const entry of eligibleEntries) {
      const current =
        map.get(entry.target_entry_key) ?? {
          points: 0,
          scores: 0,
          maxScores: 0,
          rounds: new Set<string>(),
        };

      current.points += entry.points;
      current.scores += 1;
      if (entry.points >= 10) current.maxScores += 1;
      current.rounds.add(entry.round_id);

      map.set(entry.target_entry_key, current);
    }

    return Array.from(map.entries())
      .map(([entryKey, value]) => {
        const entry = byEntryKey.get(entryKey);

        return {
          entryKey,
          entry,
          name: entry
            ? getEntryDisplayName(entry)
            : entryKey,
          points: value.points,
          scores: value.scores,
          maxScores: value.maxScores,
          rounds: value.rounds.size,
          average:
            value.scores > 0
              ? value.points / value.scores
              : 0,
        };
      })
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.average - a.average,
      );
  }, [eligibleEntries, byEntryKey]);

  const scoreDistribution = useMemo(() => {
    const bins = new Array(10).fill(0);

    for (const entry of eligibleEntries) {
      if (entry.points >= 1 && entry.points <= 10) {
        bins[entry.points - 1] += 1;
      }
    }

    return bins;
  }, [eligibleEntries]);

  const dailyActivity = useMemo(() => {
    const map = new Map<
      string,
      {
        date: Date;
        ballots: number;
        voterCountries: Set<string>;
      }
    >();

    for (const submission of eligibleSubmissions) {
      const date = new Date(submission.created_at);
      const key = `${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}-${String(date.getDate()).padStart(
        2,
        "0",
      )}`;

      const current =
        map.get(key) ?? {
          date: new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
          ),
          ballots: 0,
          voterCountries: new Set<string>(),
        };

      current.ballots += 1;
      current.voterCountries.add(
        normalizeIdentity(submission.country_code),
      );

      map.set(key, current);
    }

    return Array.from(map.entries())
      .map(([key, value]) => ({
        key,
        date: value.date,
        ballots: value.ballots,
        voterCountries: value.voterCountries.size,
      }))
      .sort(
        (a, b) =>
          a.date.getTime() - b.date.getTime(),
      );
  }, [eligibleSubmissions]);

  const exportRows = () =>
    eligibleSubmissions.map((submission) => {
      const ballotEntries =
        entriesBySubmission.get(submission.id) ?? [];

      return {
        edition: submission.edition_name,
        round: submission.round_name,
        username: submission.username,
        home_country: countryLabel(
          submission.country_code,
        ),
        stored_country_identity:
          submission.country_code,
        total_points: ballotEntries.reduce(
          (sum, entry) => sum + entry.points,
          0,
        ),
        supported_entries: ballotEntries.filter(
          (entry) => entry.points > 0,
        ).length,
        submitted_at: submission.created_at,
      };
    });

  return (
    <AdminShell title="Analytics">
      <div className="space-y-6 pb-8">
        <AnalysisScopePicker
          value={scope}
          onChange={setScope}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-primary">
              Voting overview
            </p>

            <p className="mt-1 text-sm text-muted-foreground">
              Useful participation and voting behaviour for the selected
              contest period. Integrity and friend-voting signals stay on
              their dedicated pages.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => scoped.refetch()}
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={eligibleSubmissions.length === 0}
              onClick={() =>
                downloadCSV(
                  `analytics-${analysisScopeKey(scope)}.csv`,
                  exportRows(),
                )
              }
            >
              <Download className="h-4 w-4" />
              CSV
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={eligibleSubmissions.length === 0}
              onClick={() =>
                downloadExcel(
                  `analytics-${analysisScopeKey(scope)}.xls`,
                  exportRows(),
                )
              }
            >
              <Download className="h-4 w-4" />
              Excel
            </Button>
          </div>
        </div>

        {scoped.isLoading ? (
          <Loading />
        ) : scoped.error ? (
          <Empty
            title="Analytics could not load"
            body={
              scoped.error instanceof Error
                ? scoped.error.message
                : "Unknown analytics error"
            }
          />
        ) : eligibleSubmissions.length === 0 ? (
          <Empty
            title="No votes in this scope"
            body="Choose a different edition, range, or round."
          />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <OverviewStat
                icon={Users}
                label="Eligible ballots"
                value={formatNumber(overview.ballots)}
              />
              <OverviewStat
                icon={Users}
                label="Voting countries"
                value={formatNumber(
                  overview.voterCountries,
                )}
              />
              <OverviewStat
                icon={CalendarDays}
                label="Editions"
                value={formatNumber(overview.editions)}
              />
              <OverviewStat
                icon={CalendarDays}
                label="Rounds"
                value={formatNumber(overview.rounds)}
              />
              <OverviewStat
                icon={BarChart3}
                label="Avg ballot total"
                value={overview.avgBallotPoints.toFixed(1)}
              />
              <OverviewStat
                icon={Activity}
                label="Avg targets scored"
                value={overview.avgSupported.toFixed(1)}
              />
            </section>

            {editionRows.length > 1 ? (
              <Panel
                title="Edition overview"
                subtitle="Compare participation volume without mixing every edition into one giant bar list."
                icon={CalendarDays}
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {editionRows.map((edition) => (
                    <div
                      key={edition.id}
                      className="rounded-2xl border border-border/60 bg-card/25 p-4"
                    >
                      <h4 className="font-semibold">
                        {edition.name}
                      </h4>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <MiniMetric
                          label="Ballots"
                          value={String(
                            edition.ballots,
                          )}
                        />
                        <MiniMetric
                          label="Voting countries"
                          value={String(
                            edition.voterCountries,
                          )}
                        />
                        <MiniMetric
                          label="Rounds"
                          value={String(
                            edition.rounds,
                          )}
                        />
                        <MiniMetric
                          label="Avg ballot"
                          value={edition.avgBallot.toFixed(
                            1,
                          )}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}

            <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <Panel
                title="Delegation activity"
                subtitle="Who actually voted, how often, and across how much of the selected period."
                icon={Users}
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="pb-2 text-left">
                          Delegation
                        </th>
                        <th className="pb-2 text-right">
                          Ballots
                        </th>
                        <th className="pb-2 text-right">
                          Editions
                        </th>
                        <th className="pb-2 text-right">
                          Rounds
                        </th>
                        <th className="pb-2 text-right">
                          Avg ballot
                        </th>
                        <th className="pb-2 text-right">
                          Avg targets
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {delegationRows.map((row) => (
                        <tr
                          key={
                            normalizeIdentity(
                              row.rawIdentity,
                            ) || row.rawIdentity
                          }
                          className="border-t border-border/50"
                        >
                          <td className="py-2.5 pr-3">
                            <span className="inline-flex items-center gap-2 font-medium">
                              <CountryFlag
                                country={row.country}
                                size={20}
                              />
                              {row.name}
                            </span>
                          </td>

                          <td className="py-2.5 text-right tabular-nums">
                            {row.ballots}
                          </td>

                          <td className="py-2.5 text-right tabular-nums">
                            {row.editions}
                          </td>

                          <td className="py-2.5 text-right tabular-nums">
                            {row.rounds}
                          </td>

                          <td className="py-2.5 text-right tabular-nums">
                            {row.avgBallot.toFixed(1)}
                          </td>

                          <td className="py-2.5 text-right tabular-nums">
                            {row.avgSupported.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel
                title="Daily activity"
                subtitle="Grouped by day instead of one nearly useless row for every individual submission minute."
                icon={Activity}
              >
                <DailyActivity rows={dailyActivity} />
              </Panel>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
              <Panel
                title="Top targets by total points"
                subtitle="Ranked by actual points received, not by an unrelated average."
                icon={Trophy}
              >
                <div className="space-y-2">
                  {targetRows.slice(0, 15).map(
                    (target, index) => (
                      <div
                        key={target.entryKey}
                        className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border/55 bg-card/20 px-3 py-2.5"
                      >
                        <span className="text-center text-xs font-semibold tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>

                        <div className="flex min-w-0 items-center gap-2">
                          <EntryAvatar
                            entry={target.entry}
                            size={24}
                          />

                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {target.name}
                            </p>

                            <p className="text-[11px] text-muted-foreground">
                              {target.scores} score
                              {target.scores === 1
                                ? ""
                                : "s"}{" "}
                              · avg{" "}
                              {target.average.toFixed(2)} ·{" "}
                              {target.maxScores} maximum
                              {target.maxScores === 1
                                ? ""
                                : "s"}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-lg font-semibold tabular-nums">
                            {target.points}
                          </div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            points
                          </div>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </Panel>

              <Panel
                title="Score distribution"
                subtitle="How often each score from 1 to 10 was awarded."
                icon={BarChart3}
              >
                <ScoreDistribution
                  bins={scoreDistribution}
                />
              </Panel>
            </section>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function OverviewStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="glass-strong rounded-2xl p-3.5">
      <div className="mb-2 flex items-center gap-2 text-primary">
        <Icon className="h-4 w-4" />
        <span className="text-[10px] uppercase tracking-widest">
          {label}
        </span>
      </div>

      <div className="text-2xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: typeof Users;
  children: ReactNode;
}) {
  return (
    <section className="glass-strong rounded-3xl p-4 sm:p-5">
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">
            {title}
          </h3>
        </div>

        {subtitle ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </header>

      {children}
    </section>
  );
}

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/10 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function DailyActivity({
  rows,
}: {
  rows: {
    key: string;
    date: Date;
    ballots: number;
    voterCountries: number;
  }[];
}) {
  const displayRows = rows.slice(-21);
  const max = Math.max(
    1,
    ...displayRows.map((row) => row.ballots),
  );

  return (
    <div className="space-y-2">
      {displayRows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[88px_minmax(0,1fr)_74px] items-center gap-3 text-xs"
        >
          <span className="text-muted-foreground">
            {row.date.toLocaleDateString([], {
              day: "numeric",
              month: "short",
            })}
          </span>

          <div className="h-2 overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.max(
                  4,
                  (row.ballots / max) * 100,
                )}%`,
              }}
            />
          </div>

          <div className="text-right">
            <span className="font-medium tabular-nums">
              {row.ballots}
            </span>
            <span className="ml-1 text-muted-foreground">
              vote{row.ballots === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ScoreDistribution({
  bins,
}: {
  bins: number[];
}) {
  const total = bins.reduce(
    (sum, value) => sum + value,
    0,
  );

  const max = Math.max(1, ...bins);

  return (
    <div className="space-y-2.5">
      {bins.map((value, index) => {
        const percentage =
          total > 0 ? (value / total) * 100 : 0;

        return (
          <div
            key={index}
            className="grid grid-cols-[24px_minmax(0,1fr)_72px] items-center gap-3 text-xs"
          >
            <span className="text-center font-semibold tabular-nums">
              {index + 1}
            </span>

            <div className="h-2.5 overflow-hidden rounded-full bg-muted/60">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.max(
                    value > 0 ? 3 : 0,
                    (value / max) * 100,
                  )}%`,
                }}
              />
            </div>

            <div className="text-right tabular-nums">
              <span className="font-medium">
                {value}
              </span>
              <span className="ml-1 text-muted-foreground">
                {percentage.toFixed(0)}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Loading() {
  return (
    <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
      Loading analytics…
    </div>
  );
}

function Empty({
  title,
  body,
}: {
  title?: string;
  body: string;
}) {
  return (
    <div className="glass rounded-2xl p-10 text-center">
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

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}
