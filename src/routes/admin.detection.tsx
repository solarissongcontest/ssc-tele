import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  GitBranch,
  Loader2,
  RefreshCcw,
  Users,
} from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { CountryFlag } from "@/components/country-flag";
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
} from "@/hooks/use-round-results";
import {
  getClusters,
  getSimilarBallots,
  getVotingBlocs,
  type BlocPair,
  type Cluster,
  type SimilarPair,
} from "@/lib/detection.functions";
import { downloadCSV } from "@/lib/export";
import {
  entryMap,
  getEntryDisplayName,
} from "@/lib/round-entries";

export const Route = createFileRoute("/admin/detection")({
  head: () => ({
    meta: [{ title: "Advanced Detection — Solaris Admin" }],
  }),
  component: DetectionPage,
});

function DetectionPage() {
  const { data: rounds } = useAllRounds();
  const { data: countries } = useAllCountries();

  const [roundId, setRoundId] = useState<string | null>(null);

  const effective =
    roundId ??
    rounds?.find((round) => round.status === "open")?.id ??
    rounds?.[0]?.id ??
    null;

  const { data: roundEntries = [] } =
    useRoundEntryCatalog(effective);

  const byEntryKey = useMemo(
    () => entryMap(roundEntries),
    [roundEntries],
  );

  const byCountryCode = useMemo(() => {
    const map = new Map<string, any>();

    for (const country of countries ?? []) {
      map.set(country.code, country);
    }

    return map;
  }, [countries]);

  const similarFn = useServerFn(getSimilarBallots);
  const clusterFn = useServerFn(getClusters);
  const blocsFn = useServerFn(getVotingBlocs);

  const similar = useQuery({
    queryKey: ["detect.similar", effective],
    queryFn: () =>
      similarFn({
        data: {
          roundId: effective!,
          threshold: 0.9,
        },
      }) as Promise<SimilarPair[]>,
    enabled: Boolean(effective),
  });

  const clusters = useQuery({
    queryKey: ["detect.clusters", effective],
    queryFn: () =>
      clusterFn({
        data: {
          roundId: effective!,
        },
      }) as Promise<Cluster[]>,
    enabled: Boolean(effective),
  });

  const blocs = useQuery({
    queryKey: ["detect.blocs", effective],
    queryFn: () =>
      blocsFn({
        data: {
          roundId: effective,
        },
      }) as Promise<BlocPair[]>,
    enabled: Boolean(effective),
  });

  const refresh = () => {
    void similar.refetch();
    void clusters.refetch();
    void blocs.refetch();
  };

  const targetName = (entryKey: string) => {
    const entry = byEntryKey.get(entryKey);

    return entry
      ? getEntryDisplayName(entry)
      : entryKey;
  };

  const voterName = (countryCode: string) =>
    byCountryCode.get(countryCode)?.name ?? countryCode;

  return (
    <AdminShell title="Advanced Detection">
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
                {(rounds ?? []).map((round) => (
                  <SelectItem key={round.id} value={round.id}>
                    {round.edition_name
                      ? `${round.edition_name} · `
                      : ""}
                    {round.name}
                    {round.status === "open" ? " · Open" : ""}
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

        <section className="glass-strong rounded-2xl p-4 sm:p-5">
          <header className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">
                Near-identical ballots
              </h3>
              <Badge variant="outline">
                cosine ≥ 0.90
              </Badge>
            </div>

            {similar.data && similar.data.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCSV(
                    `similar-ballots-${effective}.csv`,
                    similar.data!.map((pair) => ({
                      score: pair.score,
                      time_delta_sec: pair.timeDeltaSec,
                      shared_ip: pair.sharedIp,
                      shared_fingerprint:
                        pair.sharedFingerprint,
                      a_username: pair.a.username,
                      a_country: pair.a.country_code,
                      b_username: pair.b.username,
                      b_country: pair.b.country_code,
                    })),
                  )
                }
              >
                Export CSV
              </Button>
            ) : null}
          </header>

          <p className="mb-3 text-xs text-muted-foreground">
            Similarity vectors are keyed by stable target entry keys.
            The voters themselves remain identified by their Solaris countries.
          </p>

          {similar.isLoading ? (
            <LoadingRow />
          ) : !similar.data || similar.data.length === 0 ? (
            <Empty body="No suspicious ballot pairs detected." />
          ) : (
            <ul className="divide-y divide-border/60">
              {similar.data.map((pair, index) => {
                const aCountry =
                  byCountryCode.get(pair.a.country_code);
                const bCountry =
                  byCountryCode.get(pair.b.country_code);

                return (
                  <li
                    key={index}
                    className="flex flex-wrap items-center gap-2 py-3 text-sm"
                  >
                    <Badge className="bg-primary/20 text-primary">
                      {(pair.score * 100).toFixed(1)}%
                    </Badge>

                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <CountryFlag
                        country={aCountry}
                        size={16}
                      />
                      {pair.a.username} ({voterName(pair.a.country_code)})
                    </span>

                    <span className="text-muted-foreground">
                      ↔
                    </span>

                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <CountryFlag
                        country={bCountry}
                        size={16}
                      />
                      {pair.b.username} ({voterName(pair.b.country_code)})
                    </span>

                    <span className="ml-auto text-xs text-muted-foreground">
                      Δ {formatDelta(pair.timeDeltaSec)}
                    </span>

                    {pair.sharedIp ? (
                      <Badge variant="destructive">
                        shared IP
                      </Badge>
                    ) : null}

                    {pair.sharedFingerprint ? (
                      <Badge variant="destructive">
                        shared device
                      </Badge>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="glass-strong rounded-2xl p-4 sm:p-5">
          <header className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">
              Coordination clusters
            </h3>
            <Badge variant="outline">
              2+ voters
            </Badge>
          </header>

          {clusters.isLoading ? (
            <LoadingRow />
          ) : !clusters.data || clusters.data.length === 0 ? (
            <Empty body="No coordination clusters detected." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {clusters.data.map((cluster) => (
                <div
                  key={cluster.id}
                  className="rounded-xl border border-border bg-card/50 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      Cluster #{cluster.id} ·{" "}
                      {cluster.members.length} voters
                    </div>

                    <Badge
                      className={
                        cluster.combinedRisk >= 70
                          ? "bg-destructive text-destructive-foreground"
                          : cluster.combinedRisk >= 40
                            ? "bg-amber-500/20 text-amber-500"
                            : "bg-primary/20 text-primary"
                      }
                    >
                      risk {cluster.combinedRisk}
                    </Badge>
                  </div>

                  <div className="mb-2 flex flex-wrap gap-1">
                    {cluster.reasons.map((reason) => (
                      <Badge
                        key={reason}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {reason}
                      </Badge>
                    ))}
                  </div>

                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {cluster.members.map((member) => {
                      const country =
                        byCountryCode.get(member.country_code);

                      return (
                        <li
                          key={member.id}
                          className="flex items-center gap-1.5"
                        >
                          <CountryFlag
                            country={country}
                            size={15}
                          />

                          <span className="font-medium text-foreground">
                            {member.username}
                          </span>

                          <span>
                            ({voterName(member.country_code)})
                          </span>

                          {member.ip_country &&
                          member.ip_country !== member.country_code ? (
                            <Badge
                              variant="outline"
                              className="text-[10px]"
                            >
                              IP {member.ip_country}
                            </Badge>
                          ) : null}

                          {member.is_vpn ? (
                            <Badge
                              variant="destructive"
                              className="text-[10px]"
                            >
                              VPN
                            </Badge>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="glass-strong rounded-2xl p-4 sm:p-5">
          <header className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">
                Voting-bloc outliers
              </h3>
              <Badge variant="outline">
                z ≥ 1.5
              </Badge>
            </div>

            {blocs.data && blocs.data.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCSV(
                    `voting-blocs-${effective}.csv`,
                    blocs.data!.map((pair) => ({
                      from_voter_country: pair.from,
                      from_voter_name: voterName(pair.from),
                      target_entry_key: pair.to,
                      target_entry: targetName(pair.to),
                      mean_points: pair.mean,
                      ballots: pair.count,
                      z_score: pair.z,
                    })),
                  )
                }
              >
                Export CSV
              </Button>
            ) : null}
          </header>

          <p className="mb-3 text-xs text-muted-foreground">
            “From” is a permanent voter-country identity. “Target” is a
            round entry identified by entry_key, so custom entries are valid
            targets without pretending to be countries.
          </p>

          {blocs.isLoading ? (
            <LoadingRow />
          ) : !blocs.data || blocs.data.length === 0 ? (
            <Empty body="No voter-country → target-entry outliers found." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 text-left">
                      From voter
                    </th>
                    <th className="py-2 pr-3 text-left">
                      Target entry
                    </th>
                    <th className="py-2 pr-3 text-right">
                      Mean pts
                    </th>
                    <th className="py-2 pr-3 text-right">
                      Ballots
                    </th>
                    <th className="py-2 text-right">
                      z-score
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {blocs.data.map((pair, index) => {
                    const voterCountry =
                      byCountryCode.get(pair.from);

                    const targetEntry =
                      byEntryKey.get(pair.to);

                    return (
                      <tr
                        key={index}
                        className="border-t border-border/60"
                      >
                        <td className="py-2 pr-3 font-medium">
                          <span className="inline-flex items-center gap-2">
                            <CountryFlag
                              country={voterCountry}
                              size={18}
                            />
                            {voterName(pair.from)}
                          </span>
                        </td>

                        <td className="py-2 pr-3">
                          <span className="inline-flex items-center gap-2">
                            <EntryAvatar
                              entry={targetEntry}
                              size={18}
                            />
                            <span>{targetName(pair.to)}</span>
                          </span>
                        </td>

                        <td className="py-2 pr-3 text-right tabular-nums">
                          {pair.mean.toFixed(2)}
                        </td>

                        <td className="py-2 pr-3 text-right tabular-nums">
                          {pair.count}
                        </td>

                        <td className="py-2 text-right tabular-nums">
                          <Badge
                            className={
                              pair.z >= 3
                                ? "bg-destructive text-destructive-foreground"
                                : pair.z >= 2
                                  ? "bg-amber-500/20 text-amber-500"
                                  : "bg-primary/20 text-primary"
                            }
                          >
                            {pair.z.toFixed(2)}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
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
      <Loader2 className="h-4 w-4 animate-spin" />
      Analysing…
    </div>
  );
}

function Empty({ body }: { body: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      {body}
    </div>
  );
}

function formatDelta(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;

  return `${Math.round(seconds / 86_400)}d`;
}
