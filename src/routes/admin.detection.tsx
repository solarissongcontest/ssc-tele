import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAllRounds } from "@/hooks/use-round-results";
import {
  getSimilarBallots,
  getClusters,
  getVotingBlocs,
  type SimilarPair,
  type Cluster,
  type BlocPair,
} from "@/lib/detection.functions";
import {
  AlertTriangle,
  Users,
  GitBranch,
  RefreshCcw,
  Loader2,
} from "lucide-react";
import { downloadCSV } from "@/lib/export";

export const Route = createFileRoute("/admin/detection")({
  head: () => ({ meta: [{ title: "Advanced Detection — Solaris Admin" }] }),
  component: DetectionPage,
});

function DetectionPage() {
  const { data: rounds } = useAllRounds();
  const [roundId, setRoundId] = useState<string | null>(null);
  const effective =
    roundId ?? rounds?.find((r) => r.status === "open")?.id ?? rounds?.[0]?.id ?? null;

  const similarFn = useServerFn(getSimilarBallots);
  const clusterFn = useServerFn(getClusters);
  const blocsFn = useServerFn(getVotingBlocs);

  const similar = useQuery({
    queryKey: ["detect.similar", effective],
    queryFn: () =>
      similarFn({ data: { roundId: effective!, threshold: 0.9 } }) as Promise<SimilarPair[]>,
    enabled: !!effective,
  });
  const clusters = useQuery({
    queryKey: ["detect.clusters", effective],
    queryFn: () =>
      clusterFn({ data: { roundId: effective! } }) as Promise<Cluster[]>,
    enabled: !!effective,
  });
  const blocs = useQuery({
    queryKey: ["detect.blocs", effective],
    queryFn: () => blocsFn({ data: { roundId: effective } }) as Promise<BlocPair[]>,
    enabled: !!effective,
  });

  const refresh = () => {
    similar.refetch();
    clusters.refetch();
    blocs.refetch();
  };

  return (
    <AdminShell title="Advanced Detection">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-primary">Round</p>
            <Select
              value={effective ?? undefined}
              onValueChange={(v) => setRoundId(v)}
            >
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

        {/* Similar ballots */}
        <section className="glass-strong rounded-2xl p-4 sm:p-5">
          <header className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Near-identical ballots</h3>
              <Badge variant="outline">cosine ≥ 0.90</Badge>
            </div>
            {similar.data && similar.data.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCSV(
                    `similar-ballots-${effective}.csv`,
                    similar.data!.map((p) => ({
                      score: p.score,
                      time_delta_sec: p.timeDeltaSec,
                      shared_ip: p.sharedIp,
                      shared_fingerprint: p.sharedFingerprint,
                      a_username: p.a.username,
                      a_country: p.a.country_code,
                      b_username: p.b.username,
                      b_country: p.b.country_code,
                    })),
                  )
                }
              >
                Export CSV
              </Button>
            )}
          </header>
          {similar.isLoading ? (
            <LoadingRow />
          ) : !similar.data || similar.data.length === 0 ? (
            <Empty body="No suspicious ballot pairs detected." />
          ) : (
            <ul className="divide-y divide-border/60">
              {similar.data.map((p, i) => (
                <li
                  key={i}
                  className="py-3 flex flex-wrap items-center gap-2 text-sm"
                >
                  <Badge className="bg-primary/20 text-primary">
                    {(p.score * 100).toFixed(1)}%
                  </Badge>
                  <span className="font-medium">
                    {p.a.username} ({p.a.country_code})
                  </span>
                  <span className="text-muted-foreground">↔</span>
                  <span className="font-medium">
                    {p.b.username} ({p.b.country_code})
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    Δ {formatDelta(p.timeDeltaSec)}
                  </span>
                  {p.sharedIp && <Badge variant="destructive">shared IP</Badge>}
                  {p.sharedFingerprint && (
                    <Badge variant="destructive">shared device</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Clusters */}
        <section className="glass-strong rounded-2xl p-4 sm:p-5">
          <header className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Coordination clusters</h3>
            <Badge variant="outline">2+ voters</Badge>
          </header>
          {clusters.isLoading ? (
            <LoadingRow />
          ) : !clusters.data || clusters.data.length === 0 ? (
            <Empty body="No coordination clusters detected." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {clusters.data.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-border bg-card/50 p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold">
                      Cluster #{c.id} · {c.members.length} voters
                    </div>
                    <Badge
                      className={
                        c.combinedRisk >= 70
                          ? "bg-destructive text-destructive-foreground"
                          : c.combinedRisk >= 40
                            ? "bg-amber-500/20 text-amber-500"
                            : "bg-primary/20 text-primary"
                      }
                    >
                      risk {c.combinedRisk}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {c.reasons.map((r) => (
                      <Badge key={r} variant="outline" className="text-[10px]">
                        {r}
                      </Badge>
                    ))}
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    {c.members.map((m) => (
                      <li key={m.id} className="flex items-center gap-1.5">
                        <span className="text-foreground font-medium">
                          {m.username}
                        </span>
                        <span>({m.country_code})</span>
                        {m.ip_country && m.ip_country !== m.country_code && (
                          <Badge variant="outline" className="text-[10px]">
                            IP {m.ip_country}
                          </Badge>
                        )}
                        {m.is_vpn && (
                          <Badge variant="destructive" className="text-[10px]">
                            VPN
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Voting blocs */}
        <section className="glass-strong rounded-2xl p-4 sm:p-5">
          <header className="flex items-center gap-2 mb-3">
            <GitBranch className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Voting-bloc outliers</h3>
            <Badge variant="outline">z ≥ 1.5</Badge>
          </header>
          {blocs.isLoading ? (
            <LoadingRow />
          ) : !blocs.data || blocs.data.length === 0 ? (
            <Empty body="No outlier country → country patterns found." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left py-2 pr-3">From</th>
                    <th className="text-left py-2 pr-3">To</th>
                    <th className="text-right py-2 pr-3">Mean pts</th>
                    <th className="text-right py-2 pr-3">Ballots</th>
                    <th className="text-right py-2">z-score</th>
                  </tr>
                </thead>
                <tbody>
                  {blocs.data.map((p, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="py-2 pr-3 font-medium">{p.from}</td>
                      <td className="py-2 pr-3">{p.to}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {p.mean.toFixed(2)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {p.count}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        <Badge
                          className={
                            p.z >= 3
                              ? "bg-destructive text-destructive-foreground"
                              : p.z >= 2
                                ? "bg-amber-500/20 text-amber-500"
                                : "bg-primary/20 text-primary"
                          }
                        >
                          {p.z.toFixed(2)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Analysing…
    </div>
  );
}

function Empty({ body }: { body: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">{body}</div>
  );
}

function formatDelta(sec: number) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}
