import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  Download,
  Loader2,
  RefreshCcw,
} from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { AnalysisScopePicker } from "@/components/analysis-scope-picker";
import { CountryFlag, UNKNOWN_COUNTRY_NAME } from "@/components/country-flag";
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

function AnalyticsPage() {
  const scopedFn = useServerFn(getScopedAnalytics);
  const { data: countries = [] } = useAllCountries();

  const [scope, setScope] =
    useState<AnalysisScope>(DEFAULT_ANALYSIS_SCOPE);

  const scoped = useQuery({
    queryKey: ["scoped-analytics", analysisScopeKey(scope)],
    queryFn: () =>
      scopedFn({
        data: { scope },
      }),
  });

  const submissions = scoped.data?.submissions ?? [];
  const entries = scoped.data?.entries ?? [];

  const activeSubmissions = useMemo(
    () =>
      submissions.filter(
        (submission) => submission.status !== "deleted",
      ),
    [submissions],
  );

  const activeSubmissionIds = useMemo(
    () => new Set(activeSubmissions.map((submission) => submission.id)),
    [activeSubmissions],
  );

  const activeEntries = useMemo(
    () =>
      entries.filter((entry) =>
        activeSubmissionIds.has(entry.submission_id),
      ),
    [entries, activeSubmissionIds],
  );

  const targetKeys = useMemo(
    () =>
      Array.from(
        new Set(
          activeEntries
            .map((entry) => entry.target_entry_key)
            .filter(Boolean),
        ),
      ),
    [activeEntries],
  );

  const { data: resolvedEntries = [] } =
    useEntryKeyCatalog(targetKeys);

  const byEntryKey = useMemo(
    () => entryMap(resolvedEntries),
    [resolvedEntries],
  );

  const byCountryCode = useMemo(() => {
    const map = new Map<string, CountryRow>();

    for (const country of countries) {
      map.set(country.code, country);
    }

    return map;
  }, [countries]);

  const submissionMap = useMemo(
    () =>
      new Map(
        activeSubmissions.map((submission) => [
          submission.id,
          submission,
        ]),
      ),
    [activeSubmissions],
  );

  const votersByHome = useMemo(() => {
    const totals = new Map<string, number>();

    for (const submission of activeSubmissions) {
      totals.set(
        submission.country_code,
        (totals.get(submission.country_code) ?? 0) + 1,
      );
    }

    return Array.from(totals.entries())
      .map(([code, count]) => ({
        code,
        name:
          byCountryCode.get(code)?.name ??
          UNKNOWN_COUNTRY_NAME,
        flag: byCountryCode.get(code)?.flag ?? "🏳️",
        country: byCountryCode.get(code) ?? null,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [activeSubmissions, byCountryCode]);

  const avgPerTarget = useMemo(() => {
    const totals = new Map<
      string,
      { sum: number; count: number }
    >();

    for (const voteEntry of activeEntries) {
      const entryKey = voteEntry.target_entry_key;
      const current =
        totals.get(entryKey) ?? { sum: 0, count: 0 };

      current.sum += voteEntry.points;
      current.count += 1;
      totals.set(entryKey, current);
    }

    return Array.from(totals.entries())
      .map(([entryKey, value]) => {
        const entry = byEntryKey.get(entryKey);

        return {
          entryKey,
          entry,
          name: entry
            ? getEntryDisplayName(entry)
            : entryKey,
          avg: value.sum / value.count,
          sum: value.sum,
          count: value.count,
        };
      })
      .sort((a, b) => b.avg - a.avg);
  }, [activeEntries, byEntryKey]);

  const blocs = useMemo(() => {
    const totals = new Map<string, Map<string, number>>();

    for (const voteEntry of activeEntries) {
      const submission = submissionMap.get(
        voteEntry.submission_id,
      );

      if (!submission) continue;

      const targetMap =
        totals.get(submission.country_code) ??
        new Map<string, number>();

      targetMap.set(
        voteEntry.target_entry_key,
        (targetMap.get(voteEntry.target_entry_key) ?? 0) +
          voteEntry.points,
      );

      totals.set(submission.country_code, targetMap);
    }

    return Array.from(totals.entries())
      .map(([fromCountryCode, targetMap]) => ({
        from: fromCountryCode,
        fromName:
          byCountryCode.get(fromCountryCode)?.name ??
          UNKNOWN_COUNTRY_NAME,
        fromCountry:
          byCountryCode.get(fromCountryCode) ?? null,
        top: Array.from(targetMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([entryKey, points]) => {
            const entry = byEntryKey.get(entryKey);

            return {
              entryKey,
              entry,
              name: entry
                ? getEntryDisplayName(entry)
                : entryKey,
              points,
            };
          }),
      }))
      .sort((a, b) => a.fromName.localeCompare(b.fromName));
  }, [
    activeEntries,
    submissionMap,
    byCountryCode,
    byEntryKey,
  ]);

  const histogram = useMemo(() => {
    const bins = new Array(10).fill(0);

    for (const voteEntry of activeEntries) {
      if (voteEntry.points >= 1 && voteEntry.points <= 10) {
        bins[voteEntry.points - 1] += 1;
      }
    }

    return bins;
  }, [activeEntries]);

  const timeline = useMemo(() => {
    const buckets = new Map<number, number>();

    for (const submission of activeSubmissions) {
      const minute =
        Math.floor(
          new Date(submission.created_at).getTime() / 60_000,
        ) * 60_000;

      buckets.set(minute, (buckets.get(minute) ?? 0) + 1);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, n]) => ({
        t,
        n,
        label: new Date(t).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      }));
  }, [activeSubmissions]);

  const statusCounts = useMemo(() => {
    const counts = {
      active: 0,
      suspicious: 0,
      verified: 0,
      deleted: 0,
    };

    for (const submission of submissions) {
      const key =
        (submission.status ?? "active") as keyof typeof counts;

      if (key in counts) counts[key] += 1;
    }

    return counts;
  }, [submissions]);

  const uniqueStats = useMemo(() => {
    const users = new Set<string>();
    const homeCountries = new Set<string>();

    let vpn = 0;
    let mismatch = 0;

    for (const submission of activeSubmissions) {
      users.add(submission.username_normalized);
      homeCountries.add(submission.country_code);

      if (submission.is_vpn) vpn += 1;

      if (
        submission.ip_country &&
        submission.ip_country.toUpperCase() !==
          submission.country_code.toUpperCase()
      ) {
        mismatch += 1;
      }
    }

    return {
      uniqueVoters: users.size,
      uniqueCountries: homeCountries.size,
      vpn,
      mismatch,
    };
  }, [activeSubmissions]);

  const riskDistribution = useMemo(() => {
    const bins = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const submission of activeSubmissions) {
      const risk = submission.risk_score ?? 0;

      if (risk >= 70) bins.critical += 1;
      else if (risk >= 40) bins.high += 1;
      else if (risk >= 20) bins.medium += 1;
      else bins.low += 1;
    }

    return bins;
  }, [activeSubmissions]);

  const exportRows = () =>
    activeSubmissions.map((submission) => {
      const ballotEntries = activeEntries.filter(
        (entry) => entry.submission_id === submission.id,
      );

      return {
        edition: submission.edition_name,
        round: submission.round_name,
        username: submission.username,
        home_country: submission.country_code,
        ip_country: submission.ip_country ?? "",
        is_vpn: submission.is_vpn ? "yes" : "no",
        risk_score: submission.risk_score ?? 0,
        status: submission.status ?? "active",
        total_points: ballotEntries.reduce(
          (sum, entry) => sum + entry.points,
          0,
        ),
        entries: ballotEntries
          .map((entry) => {
            const resolved = byEntryKey.get(
              entry.target_entry_key,
            );

            const name = resolved
              ? getEntryDisplayName(resolved)
              : entry.target_entry_key;

            return `${name} [${entry.target_entry_key}]:${entry.points}`;
          })
          .join("|"),
        submitted_at: submission.created_at,
      };
    });

  return (
    <AdminShell title="Analytics">
      <div className="space-y-6">
        <AnalysisScopePicker
          value={scope}
          onChange={setScope}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {scoped.data
              ? `${scoped.data.editions.length} edition${
                  scoped.data.editions.length === 1 ? "" : "s"
                } · ${scoped.data.rounds.length} round${
                  scoped.data.rounds.length === 1 ? "" : "s"
                }`
              : "Loading scope…"}
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
              disabled={activeSubmissions.length === 0}
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
              disabled={activeSubmissions.length === 0}
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
        ) : activeSubmissions.length === 0 ? (
          <Empty
            title="No votes in this scope"
            body="Choose a different edition, range, or round."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi
                label="Unique voters"
                value={uniqueStats.uniqueVoters}
              />
              <Kpi
                label="Home countries"
                value={uniqueStats.uniqueCountries}
              />
              <Kpi
                label="VPN / proxy"
                value={uniqueStats.vpn}
                tone={uniqueStats.vpn > 0 ? "warn" : "ok"}
              />
              <Kpi
                label="Country mismatch"
                value={uniqueStats.mismatch}
                tone={uniqueStats.mismatch > 0 ? "warn" : "ok"}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <Kpi label="Active" value={statusCounts.active} />
              <Kpi
                label="Suspicious"
                value={statusCounts.suspicious}
                tone={statusCounts.suspicious > 0 ? "warn" : "ok"}
              />
              <Kpi
                label="Verified"
                value={statusCounts.verified}
                tone="ok"
              />
              <Kpi
                label="Deleted"
                value={statusCounts.deleted}
                tone={statusCounts.deleted > 0 ? "warn" : "ok"}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card
                title="Voters by home country"
                subtitle={`${activeSubmissions.length} eligible ballots`}
              >
                <BarList
                  rows={votersByHome.map((row) => ({
                    label: `${row.flag} ${row.name}`,
                    value: row.count,
                  }))}
                />
              </Card>

              <Card
                title="Average points received"
                subtitle="across the selected scope"
              >
                <BarList
                  rows={avgPerTarget.slice(0, 15).map((row) => ({
                    label: row.name,
                    value: Number(row.avg.toFixed(2)),
                    caption: `${row.sum} pts · ${row.count} scores`,
                  }))}
                  max={10}
                />
              </Card>

              <Card
                title="Points distribution"
                subtitle="how voters spend points"
              >
                <Histogram bins={histogram} />
              </Card>

              <Card
                title="Submissions over time"
                subtitle="chronological selected-scope activity"
              >
                <Timeline data={timeline} />
              </Card>

              <Card
                title="Bloc behaviour"
                subtitle="Top 3 targets by voter country across the selected scope"
                className="lg:col-span-2"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {blocs.map((bloc) => (
                    <div
                      key={bloc.from}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3"
                    >
                      <CountryFlag
                        country={bloc.fromCountry}
                        size={22}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {bloc.fromName}
                        </div>

                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {bloc.top.map((target) => (
                            <Badge
                              key={target.entryKey}
                              variant="outline"
                              className="inline-flex max-w-full gap-1 text-[10px]"
                            >
                              <EntryAvatar
                                entry={target.entry}
                                size={14}
                              />
                              <span className="truncate">
                                {target.name}
                              </span>
                              <span className="font-semibold tabular-nums text-primary">
                                {target.points}
                              </span>
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card
                title="Risk distribution"
                subtitle="eligible ballots"
              >
                <BarList
                  rows={[
                    {
                      label: "Low (0–19)",
                      value: riskDistribution.low,
                    },
                    {
                      label: "Medium (20–39)",
                      value: riskDistribution.medium,
                    },
                    {
                      label: "High (40–69)",
                      value: riskDistribution.high,
                    },
                    {
                      label: "Critical (70+)",
                      value: riskDistribution.critical,
                    },
                  ]}
                />
              </Card>

              <Card
                title="Most-supported targets"
                subtitle="generic entry keys resolved across editions"
              >
                <div className="space-y-2">
                  {avgPerTarget.slice(0, 10).map((target) => (
                    <div
                      key={target.entryKey}
                      className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2"
                    >
                      <EntryAvatar
                        entry={target.entry}
                        size={24}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {target.name}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">
                        {target.sum}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Kpi({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "neutral";
}) {
  return (
    <div
      className={cn(
        "glass rounded-xl p-3",
        tone === "warn" && "ring-1 ring-amber-500/40",
      )}
    >
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>

      <div
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "warn" && "text-amber-400",
          tone === "ok" && "text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass rounded-2xl p-4", className)}>
      <header className="mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" />
          {title}
        </h3>
        {subtitle ? (
          <p className="text-xs text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function BarList({
  rows,
  max,
}: {
  rows: {
    label: string;
    value: number;
    caption?: string;
  }[];
  max?: number;
}) {
  const actualMax =
    max ?? Math.max(1, ...rows.map((row) => row.value));

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 tabular-nums">
              {row.value}
            </span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.max(
                  1,
                  Math.min(100, (row.value / actualMax) * 100),
                )}%`,
              }}
            />
          </div>

          {row.caption ? (
            <p className="text-[10px] text-muted-foreground">
              {row.caption}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Histogram({ bins }: { bins: number[] }) {
  const max = Math.max(1, ...bins);

  return (
    <div className="flex h-40 items-end gap-1">
      {bins.map((value, index) => (
        <div
          key={index}
          className="flex min-w-0 flex-1 flex-col items-center gap-1"
        >
          <div className="text-[9px] tabular-nums text-muted-foreground">
            {value}
          </div>
          <div className="flex h-28 w-full items-end rounded-md bg-muted/50">
            <div
              className="w-full rounded-md bg-primary"
              style={{
                height: `${Math.max(2, (value / max) * 100)}%`,
              }}
            />
          </div>
          <div className="text-[10px] tabular-nums">
            {index + 1}
          </div>
        </div>
      ))}
    </div>
  );
}

function Timeline({
  data,
}: {
  data: { t: number; label: string; n: number }[];
}) {
  const max = Math.max(1, ...data.map((item) => item.n));

  return (
    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
      {data.slice(-40).map((item) => (
        <div
          key={item.t}
          className="grid grid-cols-[110px_1fr_34px] items-center gap-2 text-xs"
        >
          <span className="truncate text-muted-foreground">
            {item.label}
          </span>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{
                width: `${Math.max(2, (item.n / max) * 100)}%`,
              }}
            />
          </div>
          <span className="text-right tabular-nums">
            {item.n}
          </span>
        </div>
      ))}
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
      {title ? <h3 className="font-semibold">{title}</h3> : null}
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
