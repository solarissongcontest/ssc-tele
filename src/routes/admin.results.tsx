import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Trophy,
  RefreshCcw,
  Download,
  FileSpreadsheet,
  FileJson,
  Loader2,
  ChevronDown,
} from "lucide-react";
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
  useAllRounds,
  useAllCountries,
  useRoundResults,
} from "@/hooks/use-round-results";
import { downloadCSV, downloadExcel, downloadJSON } from "@/lib/export";
import { cn } from "@/lib/utils";
import { CountryFlag, countryName } from "@/components/country-flag";

type CountryRow = { code: string; name: string; flag: string; flag_url: string | null };

export const Route = createFileRoute("/admin/results")({
  head: () => ({ meta: [{ title: "Results — Solaris Admin" }] }),
  component: ResultsPage,
});

function ResultsPage() {
  const qc = useQueryClient();
  const { data: rounds, isLoading: roundsLoading } = useAllRounds();
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

  const round = rounds?.find((r) => r.id === effective) ?? null;

  const scoreboard = useMemo(() => {
    const totals = new Map<string, { points: number; voters: Set<string> }>();
    const subMap = new Map((subs.data ?? []).map((s) => [s.id, s]));
    for (const e of entries.data ?? []) {
      const cur = totals.get(e.target_country_code) ?? { points: 0, voters: new Set() };
      cur.points += e.points;
      const sub = subMap.get(e.submission_id);
      if (sub) cur.voters.add(sub.username_normalized);
      totals.set(e.target_country_code, cur);
    }
    return Array.from(totals.entries())
      .map(([code, v]) => {
        const c = byCode.get(code);
        return {
          code,
          name: countryName(c),
          flag: c?.flag ?? "🏳️",
          flag_url: c?.flag_url ?? null,
          country: c ?? null,
          points: v.points,
          voters: v.voters.size,
        };
      })
      .sort((a, b) => b.points - a.points || b.voters - a.voters);
  }, [entries.data, subs.data, byCode]);

  const entriesBySub = useMemo(() => {
    const m = new Map<string, { code: string; name: string; flag: string; points: number }[]>();
    for (const e of entries.data ?? []) {
      const arr = m.get(e.submission_id) ?? [];
      const c = byCode.get(e.target_country_code);
      arr.push({
        code: e.target_country_code,
        name: c?.name ?? e.target_country_code,
        flag: c?.flag ?? "🏳️",
        points: e.points,
      });
      m.set(e.submission_id, arr);
    }
    for (const v of m.values()) v.sort((a, b) => b.points - a.points);
    return m;
  }, [entries.data, byCode]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["results.subs", effective] });
    qc.invalidateQueries({ queryKey: ["results.entries", effective] });
  };

  const exportOverallCSV = () => {
    downloadCSV(
      `solaris-${slug(round?.name)}-scoreboard.csv`,
      scoreboard.map((r, i) => ({
        rank: i + 1,
        country_code: r.code,
        country: r.name,
        points: r.points,
        voters: r.voters,
      })),
    );
  };

  const exportDetailedCSV = () => {
    const rows: Record<string, unknown>[] = [];
    for (const s of subs.data ?? []) {
      const home = byCode.get(s.country_code);
      const breakdown = entriesBySub.get(s.id) ?? [];
      for (const b of breakdown) {
        rows.push({
          submission_id: s.id,
          username: s.username,
          home_country: home?.name ?? s.country_code,
          home_code: s.country_code,
          submitted_at: s.created_at,
          target_country: b.name,
          target_code: b.code,
          points: b.points,
        });
      }
    }
    downloadCSV(`solaris-${slug(round?.name)}-detailed.csv`, rows);
  };

  const exportExcel = () => {
    downloadExcel(
      `solaris-${slug(round?.name)}-scoreboard.xls`,
      scoreboard.map((r, i) => ({
        Rank: i + 1,
        Country: r.name,
        Code: r.code,
        Points: r.points,
        Voters: r.voters,
      })),
    );
  };

  const exportJSON = () => {
    downloadJSON(`solaris-${slug(round?.name)}-results.json`, {
      round: round
        ? { id: round.id, name: round.name, status: round.status, edition: round.edition_name }
        : null,
      scoreboard,
      submissions: (subs.data ?? []).map((s) => ({
        ...s,
        breakdown: entriesBySub.get(s.id) ?? [],
      })),
    });
  };

  const totalVotes = subs.data?.length ?? 0;
  const totalPoints = scoreboard.reduce((a, b) => a + b.points, 0);

  return (
    <AdminShell title="Results">
      <div className="space-y-6">
        {/* Header bar */}
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
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="bg-hero text-primary-foreground">
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportOverallCSV}>
                  <Download className="h-4 w-4" /> CSV — overall
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportDetailedCSV}>
                  <Download className="h-4 w-4" /> CSV — detailed
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportExcel}>
                  <FileSpreadsheet className="h-4 w-4" /> Excel / Sheets
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportJSON}>
                  <FileJson className="h-4 w-4" /> JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Submissions" value={totalVotes} />
          <Stat label="Points cast" value={totalPoints} />
          <Stat label="Countries scored" value={scoreboard.length} />
          <Stat
            label="Round status"
            value={round?.status ?? "—"}
            valueClass={round?.status === "open" ? "text-primary" : ""}
          />
        </div>

        {roundsLoading || subs.isLoading ? (
          <Loading />
        ) : !effective ? (
          <Empty title="No rounds yet" body="Create a round to see results here." />
        ) : (
          <>
            {/* Scoreboard */}
            <section className="glass-strong rounded-2xl overflow-hidden">
              <header className="px-4 sm:px-5 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Scoreboard</h3>
                </div>
                <Badge variant="outline" className="tabular-nums">
                  {scoreboard.length} countries
                </Badge>
              </header>
              {scoreboard.length === 0 ? (
                <Empty body="No votes yet — the scoreboard will update live as votes come in." plain />
              ) : (
                <ol className="divide-y divide-border">
                  {scoreboard.map((r, i) => {
                    const rank = i + 1;
                    return (
                      <li
                        key={r.code}
                        className={cn(
                          "flex items-center gap-3 px-4 sm:px-5 py-3",
                          rank <= 3 && "bg-primary/5",
                        )}
                      >
                        <span
                          className={cn(
                            "w-7 text-center font-bold tabular-nums",
                            rank === 1 && "text-primary text-lg",
                            rank === 2 && "text-foreground",
                            rank === 3 && "text-foreground/80",
                            rank > 3 && "text-muted-foreground",
                          )}
                        >
                          {rank}
                        </span>
                        <span className="text-2xl leading-none">{r.flag}</span>
                        <span className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{r.name}</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {r.voters} {r.voters === 1 ? "voter" : "voters"} · {r.code}
                          </div>
                        </span>
                        <span className="font-bold tabular-nums text-lg text-primary">
                          {r.points}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {/* Detailed voter breakdown */}
            <section className="glass-strong rounded-2xl overflow-hidden">
              <header className="px-4 sm:px-5 py-3 border-b border-border">
                <h3 className="font-semibold">Voter breakdown</h3>
                <p className="text-xs text-muted-foreground">
                  Tap a row to expand a voter's full point distribution.
                </p>
              </header>
              {(subs.data ?? []).length === 0 ? (
                <Empty body="No submissions yet." plain />
              ) : (
                <ul className="divide-y divide-border">
                  {(subs.data ?? []).map((s) => {
                    const home = byCode.get(s.country_code);
                    const breakdown = entriesBySub.get(s.id) ?? [];
                    return (
                      <li key={s.id}>
                        <Collapsible>
                          <CollapsibleTrigger className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-card/40 transition">
                            <span className="text-xl leading-none">{home?.flag ?? "🏳️"}</span>
                            <span className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{s.username}</div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {home?.name ?? s.country_code} ·{" "}
                                {new Date(s.created_at).toLocaleString()}
                              </div>
                            </span>
                            <Badge variant="outline" className="tabular-nums">
                              {breakdown.length} picks
                            </Badge>
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="px-4 sm:px-5 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                              {breakdown.map((b) => (
                                <div
                                  key={b.code}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-card/60 border border-border"
                                >
                                  <span className="text-lg leading-none">{b.flag}</span>
                                  <span className="text-xs flex-1 truncate">{b.name}</span>
                                  <span className="text-xs font-bold tabular-nums text-primary">
                                    {b.points}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </li>
                    );
                  })}
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
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", valueClass)}>{value}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
      Loading results…
    </div>
  );
}

function Empty({ title, body, plain }: { title?: string; body: string; plain?: boolean }) {
  return (
    <div
      className={cn(
        "p-10 text-center space-y-1",
        !plain && "glass-strong rounded-2xl",
      )}
    >
      {title && <h3 className="font-semibold">{title}</h3>}
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function slug(s?: string | null) {
  return (s ?? "round").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
