import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BarChart3,
  Download,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { AdminShell } from "@/components/admin-shell";
import { CountryFlag, UNKNOWN_COUNTRY_NAME } from "@/components/country-flag";
import { EntryAvatar } from "@/components/entry-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRoundEntryCatalog } from "@/hooks/use-entry-key-catalog";
import {
  useAllCountries,
  useAllRounds,
  useRoundResults,
} from "@/hooks/use-round-results";
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
  const qc = useQueryClient();

  const { data: rounds } = useAllRounds();
  const { data: countries } = useAllCountries();

  const [roundId, setRoundId] = useState<string | null>(null);

  const effective =
    roundId ??
    rounds?.find((round) => round.status === "open")?.id ??
    rounds?.[0]?.id ??
    null;

  const { subs, entries } = useRoundResults(effective);
  const { data: roundEntries = [] } = useRoundEntryCatalog(effective);

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

  const round = rounds?.find((item) => item.id === effective);

  const subList = subs.data ?? [];
  const entryList = entries.data ?? [];

  const subMap = useMemo(
    () => new Map(subList.map((submission) => [submission.id, submission])),
    [subList],
  );

  /*
   * VOTER identity remains a Solaris country.
   */
  const votersByHome = useMemo(() => {
    const totals = new Map<string, number>();

    for (const submission of subList) {
      totals.set(
        submission.country_code,
        (totals.get(submission.country_code) ?? 0) + 1,
      );
    }

    return Array.from(totals.entries())
      .map(([code, count]) => ({
        code,
        name: byCountryCode.get(code)?.name ?? UNKNOWN_COUNTRY_NAME,
        flag: byCountryCode.get(code)?.flag ?? "🏳️",
        country: byCountryCode.get(code) ?? null,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [subList, byCountryCode]);

  /*
   * TARGET identity is a stable entry_key.
   * `target_country_code` is only the legacy DB column name.
   */
  const avgPerTarget = useMemo(() => {
    const totals = new Map<
      string,
      { sum: number; count: number }
    >();

    for (const voteEntry of entryList) {
      const entryKey = voteEntry.target_country_code;

      const current =
        totals.get(entryKey) ?? {
          sum: 0,
          count: 0,
        };

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
  }, [entryList, byEntryKey]);

  /*
   * Bloc behaviour is country voter -> generic target entry.
   */
  const blocs = useMemo(() => {
    const totals = new Map<string, Map<string, number>>();

    for (const voteEntry of entryList) {
      const submission = subMap.get(voteEntry.submission_id);
      if (!submission) continue;

      const targetMap =
        totals.get(submission.country_code) ?? new Map<string, number>();

      const entryKey = voteEntry.target_country_code;

      targetMap.set(
        entryKey,
        (targetMap.get(entryKey) ?? 0) + voteEntry.points,
      );

      totals.set(submission.country_code, targetMap);
    }

    return Array.from(totals.entries())
      .map(([fromCountryCode, targetMap]) => {
        const top = Array.from(targetMap.entries())
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
          });

        return {
          from: fromCountryCode,
          fromName:
            byCountryCode.get(fromCountryCode)?.name ??
            UNKNOWN_COUNTRY_NAME,
          fromCountry: byCountryCode.get(fromCountryCode) ?? null,
          top,
        };
      })
      .sort((a, b) => a.fromName.localeCompare(b.fromName));
  }, [entryList, subMap, byCountryCode, byEntryKey]);

  const histogram = useMemo(() => {
    const bins = new Array(10).fill(0);

    for (const voteEntry of entryList) {
      if (voteEntry.points >= 1 && voteEntry.points <= 10) {
        bins[voteEntry.points - 1] += 1;
      }
    }

    return bins;
  }, [entryList]);

  const timeline = useMemo(() => {
    if (subList.length === 0) {
      return [] as {
        t: number;
        label: string;
        n: number;
      }[];
    }

    const buckets = new Map<number, number>();

    for (const submission of subList) {
      const minute =
        Math.floor(new Date(submission.created_at).getTime() / 60_000) *
        60_000;

      buckets.set(minute, (buckets.get(minute) ?? 0) + 1);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, n]) => ({
        t,
        n,
        label: new Date(t).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      }));
  }, [subList]);

  const statusCounts = useMemo(() => {
    const counts = {
      active: 0,
      suspicious: 0,
      verified: 0,
      deleted: 0,
    };

    for (const submission of subList) {
      const key =
        (submission.status ?? "active") as keyof typeof counts;

      if (key in counts) {
        counts[key] += 1;
      }
    }

    return counts;
  }, [subList]);

  const uniqueStats = useMemo(() => {
    const users = new Set<string>();
    const homeCountries = new Set<string>();

    let vpn = 0;
    let mismatch = 0;

    for (const submission of subList) {
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
  }, [subList]);

  const riskDistribution = useMemo(() => {
    const bins = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const submission of subList) {
      const risk = submission.risk_score ?? 0;

      if (risk >= 70) bins.critical += 1;
      else if (risk >= 40) bins.high += 1;
      else if (risk >= 20) bins.medium += 1;
      else bins.low += 1;
    }

    return bins;
  }, [subList]);

  const exportRows = () =>
    subList.map((submission) => {
      const ballotEntries = entryList.filter(
        (entry) => entry.submission_id === submission.id,
      );

      return {
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
            const entryKey = entry.target_country_code;
            const resolved = byEntryKey.get(entryKey);
            const displayName = resolved
              ? getEntryDisplayName(resolved)
              : entryKey;

            return `${displayName} [${entryKey}]:${entry.points}`;
          })
          .join("|"),
        submitted_at: submission.created_at,
      };
    });

  const refresh = () => {
    void qc.invalidateQueries({
      queryKey: ["round-results", effective],
    });

    void qc.invalidateQueries({
      queryKey: ["round-entry-catalog", effective],
    });
  };

  return (
    <AdminShell title="Analytics">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-primary">
              Round
            </p>

            <Select
              value={effective ?? undefined}
              onValueChange={setRoundId}
            >
              <SelectTrigger className="w-[320px] max-w-full">
                <SelectValue placeholder="Select round" />
              </SelectTrigger>

              <SelectContent>
                {(rounds ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.edition_name
                      ? `${item.edition_name} · `
                      : ""}
                    {item.name}
                    {item.status === "open" ? " · Open" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={subList.length === 0}
              onClick={() =>
                downloadCSV(`analytics-${effective}.csv`, exportRows())
              }
            >
              <Download className="h-4 w-4" />
              CSV
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={subList.length === 0}
              onClick={() =>
                downloadExcel(`analytics-${effective}.xls`, exportRows())
              }
            >
              <Download className="h-4 w-4" />
              Excel
            </Button>
          </div>
        </div>

        {!effective ? (
          <Empty body="Create or select a round to see analytics." />
        ) : subs.isLoading ? (
          <Loading />
        ) : subList.length === 0 ? (
          <Empty
            title="No votes yet"
            body="As voters submit, charts populate live."
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

            <div className="mt-3 grid gap-3 sm:grid-cols-4">
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

            <div className="mt-3 grid gap-6 lg:grid-cols-2">
              <Card
                title="Voters by home country"
                subtitle={`${subList.length} total`}
              >
                <BarList
                  rows={votersByHome.map((value) => ({
                    label: `${value.flag} ${value.name}`,
                    value: value.count,
                  }))}
                />
              </Card>

              <Card
                title="Average points received"
                subtitle="per target entry"
              >
                <BarList
                  rows={avgPerTarget.slice(0, 12).map((value) => ({
                    label: value.name,
                    value: Number(value.avg.toFixed(2)),
                    caption: `${value.sum} pts · ${value.count} ballots`,
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
                subtitle="per minute"
              >
                <Timeline data={timeline} />
              </Card>

              <Card
                title="Bloc behaviour"
                subtitle="Top 3 target entries chosen by each voter country"
                className="lg:col-span-2"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {blocs.map((bloc) => (
                    <div
                      key={bloc.from}
                      className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-3"
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
                              className="inline-flex gap-1 text-[10px]"
                            >
                              <EntryAvatar
                                entry={target.entry}
                                size={14}
                              />
                              {target.name}
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
                subtitle="voter risk scores"
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
                subtitle="generic round entries"
              >
                <div className="space-y-2">
                  {avgPerTarget.slice(0, 10).map((target) => (
                    <div
                      key={target.entryKey}
                      className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2"
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
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass rounded-2xl p-4", className)}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-primary" />
            {title}
          </h3>

          {subtitle ? (
            <p className="text-xs text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
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

          <div className="flex h-28 w-full items-end rounded-md bg-muted/40">
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
    <div className="space-y-2">
      {data.slice(-20).map((item) => (
        <div
          key={item.t}
          className="grid grid-cols-[70px_1fr_30px] items-center gap-2 text-xs"
        >
          <span className="text-muted-foreground">
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
      {title ? (
        <h3 className="font-semibold">{title}</h3>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
