import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BarChart3, Loader2, RefreshCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  useAllRounds,
  useAllCountries,
  useRoundResults,
} from "@/hooks/use-round-results";
import { cn } from "@/lib/utils";
import { CountryFlag, countryName, UNKNOWN_COUNTRY_NAME } from "@/components/country-flag";

type CountryRow = { code: string; name: string; flag: string; flag_url: string | null };

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Solaris Admin" }] }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const qc = useQueryClient();
  const { data: rounds } = useAllRounds();
  const { data: countries } = useAllCountries();
  const [roundId, setRoundId] = useState<string | null>(null);

  const effective =
    roundId ??
    rounds?.find((r) => r.status === "open")?.id ??
    rounds?.[0]?.id ??
    null;

  const { subs, entries } = useRoundResults(effective);

  const byCode = useMemo(() => {
    const m = new Map<string, CountryRow>();
    (countries ?? []).forEach((c) => m.set(c.code, c));
    return m;
  }, [countries]);

  const round = rounds?.find((r) => r.id === effective);
  const subList = subs.data ?? [];
  const entryList = entries.data ?? [];
  const subMap = useMemo(() => new Map(subList.map((s) => [s.id, s])), [subList]);

  /* Voters by home country */
  const votersByHome = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of subList) m.set(s.country_code, (m.get(s.country_code) ?? 0) + 1);
    return Array.from(m.entries())
      .map(([code, n]) => ({
        code,
        name: byCode.get(code)?.name ?? code,
        flag: byCode.get(code)?.flag ?? "🏳️",
        n,
      }))
      .sort((a, b) => b.n - a.n);
  }, [subList, byCode]);

  /* Average points per target country */
  const avgPerTarget = useMemo(() => {
    const tot = new Map<string, { sum: number; count: number }>();
    for (const e of entryList) {
      const cur = tot.get(e.target_country_code) ?? { sum: 0, count: 0 };
      cur.sum += e.points;
      cur.count += 1;
      tot.set(e.target_country_code, cur);
    }
    return Array.from(tot.entries())
      .map(([code, v]) => ({
        code,
        name: byCode.get(code)?.name ?? code,
        flag: byCode.get(code)?.flag ?? "🏳️",
        avg: v.sum / v.count,
        sum: v.sum,
        count: v.count,
      }))
      .sort((a, b) => b.avg - a.avg);
  }, [entryList, byCode]);

  /* Bloc behaviour: top 3 destinations per voter country */
  const blocs = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const e of entryList) {
      const sub = subMap.get(e.submission_id);
      if (!sub) continue;
      const inner = m.get(sub.country_code) ?? new Map<string, number>();
      inner.set(e.target_country_code, (inner.get(e.target_country_code) ?? 0) + e.points);
      m.set(sub.country_code, inner);
    }
    return Array.from(m.entries())
      .map(([from, inner]) => {
        const top = Array.from(inner.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([code, points]) => ({
            code,
            name: byCode.get(code)?.name ?? code,
            flag: byCode.get(code)?.flag ?? "🏳️",
            points,
          }));
        return {
          from,
          fromName: byCode.get(from)?.name ?? from,
          fromFlag: byCode.get(from)?.flag ?? "🏳️",
          top,
        };
      })
      .sort((a, b) => a.fromName.localeCompare(b.fromName));
  }, [entryList, subMap, byCode]);

  /* Points distribution histogram (1-10) */
  const histogram = useMemo(() => {
    const bins = new Array(10).fill(0);
    for (const e of entryList) {
      if (e.points >= 1 && e.points <= 10) bins[e.points - 1] += 1;
    }
    return bins;
  }, [entryList]);

  /* Submissions over time (per minute, capped) */
  const timeline = useMemo(() => {
    if (subList.length === 0) return [] as { t: number; label: string; n: number }[];
    const buckets = new Map<number, number>();
    for (const s of subList) {
      const minute = Math.floor(new Date(s.created_at).getTime() / 60000) * 60000;
      buckets.set(minute, (buckets.get(minute) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, n]) => ({
        t,
        n,
        label: new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }));
  }, [subList]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["results.subs", effective] });
    qc.invalidateQueries({ queryKey: ["results.entries", effective] });
  };

  return (
    <AdminShell title="Analytics">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-primary">Round</p>
            <Select value={effective ?? undefined} onValueChange={(v) => setRoundId(v)}>
              <SelectTrigger className="w-[320px] max-w-full">
                <SelectValue placeholder="Select round" />
              </SelectTrigger>
              <SelectContent>
                {(rounds ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.edition_name ? `${r.edition_name} · ` : ""}
                    {r.name}
                    {r.status === "open" ? " · Open" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
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
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Voters by home country" subtitle={`${subList.length} total`}>
              <BarList
                rows={votersByHome.map((v) => ({
                  label: `${v.flag} ${v.name}`,
                  value: v.n,
                }))}
              />
            </Card>

            <Card title="Average points received" subtitle="per target country">
              <BarList
                rows={avgPerTarget.slice(0, 12).map((v) => ({
                  label: `${v.flag} ${v.name}`,
                  value: Number(v.avg.toFixed(2)),
                  caption: `${v.sum} pts · ${v.count} ballots`,
                }))}
                max={10}
              />
            </Card>

            <Card title="Points distribution" subtitle="how voters spend points">
              <Histogram bins={histogram} />
            </Card>

            <Card title="Submissions over time" subtitle="per minute">
              <Timeline data={timeline} />
            </Card>

            <Card
              title="Bloc behaviour"
              subtitle="Top 3 destinations chosen by each voter country"
              className="lg:col-span-2"
            >
              <div className="grid sm:grid-cols-2 gap-2">
                {blocs.map((b) => (
                  <div
                    key={b.from}
                    className="flex items-start gap-3 p-3 rounded-lg bg-card/50 border border-border"
                  >
                    <span className="text-xl leading-none">{b.fromFlag}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{b.fromName}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {b.top.map((t) => (
                          <Badge
                            key={t.code}
                            variant="outline"
                            className="text-[10px] gap-1"
                          >
                            {t.flag} {t.name}
                            <span className="text-primary font-semibold tabular-nums">
                              {t.points}
                            </span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

/* ---------------- helpers ---------------- */

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
    <section className={cn("glass-strong rounded-2xl p-4 sm:p-5", className)}>
      <header className="mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">{title}</h3>
        </div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function BarList({
  rows,
  max,
}: {
  rows: { label: string; value: number; caption?: string }[];
  max?: number;
}) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No data.</p>;
  const cap = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i}>
          <div className="flex justify-between text-xs gap-2">
            <span className="truncate">{r.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {r.caption ? `${r.caption} · ` : ""}
              <span className="text-foreground font-semibold">{r.value}</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden mt-1">
            <div
              className="h-full bg-hero"
              style={{ width: `${Math.min(100, (r.value / cap) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Histogram({ bins }: { bins: number[] }) {
  const max = Math.max(...bins, 1);
  const W = 320;
  const H = 140;
  const bw = W / bins.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full">
      {bins.map((v, i) => {
        const h = (v / max) * H;
        return (
          <g key={i}>
            <rect
              x={i * bw + 3}
              y={H - h}
              width={bw - 6}
              height={h}
              rx={3}
              className="fill-primary/80"
            />
            <text
              x={i * bw + bw / 2}
              y={H + 14}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {i + 1}
            </text>
            {v > 0 && (
              <text
                x={i * bw + bw / 2}
                y={H - h - 4}
                textAnchor="middle"
                className="fill-foreground text-[10px] font-semibold"
              >
                {v}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Timeline({ data }: { data: { t: number; label: string; n: number }[] }) {
  if (data.length === 0) return <p className="text-xs text-muted-foreground">No data yet.</p>;
  const W = 480;
  const H = 140;
  const max = Math.max(...data.map((d) => d.n), 1);
  const xs = (i: number) =>
    data.length === 1 ? W / 2 : (i / (data.length - 1)) * (W - 20) + 10;
  const ys = (n: number) => H - (n / max) * (H - 20) - 10;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${xs(i)},${ys(d.n)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full">
      <path d={path} className="stroke-primary fill-none" strokeWidth={2} />
      {data.map((d, i) => (
        <g key={d.t}>
          <circle cx={xs(i)} cy={ys(d.n)} r={3} className="fill-primary" />
        </g>
      ))}
      <text x={10} y={H + 18} className="fill-muted-foreground text-[10px]">
        {data[0].label}
      </text>
      <text
        x={W - 10}
        y={H + 18}
        textAnchor="end"
        className="fill-muted-foreground text-[10px]"
      >
        {data[data.length - 1].label}
      </text>
    </svg>
  );
}

function Loading() {
  return (
    <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
      Loading analytics…
    </div>
  );
}

function Empty({ title, body }: { title?: string; body: string }) {
  return (
    <div className="glass-strong rounded-2xl p-10 text-center">
      {title && <h3 className="font-semibold">{title}</h3>}
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
