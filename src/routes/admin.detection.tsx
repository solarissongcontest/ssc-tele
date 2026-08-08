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
import { AnalysisScopePicker } from "@/components/analysis-scope-picker";
import { CountryFlag } from "@/components/country-flag";
import { EntryAvatar } from "@/components/entry-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEntryKeyCatalog } from "@/hooks/use-entry-key-catalog";
import { useAllCountries } from "@/hooks/use-round-results";
import {
  getScopedDetection,
  type ScopedBlocPair,
  type ScopedCluster,
  type ScopedSimilarPair,
} from "@/lib/analysis-scope.functions";
import {
  DEFAULT_ANALYSIS_SCOPE,
  analysisScopeKey,
  type AnalysisScope,
} from "@/lib/analysis-scope";
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
  const detectionFn = useServerFn(getScopedDetection);
  const { data: countries = [] } = useAllCountries();

  const [scope, setScope] =
    useState<AnalysisScope>(DEFAULT_ANALYSIS_SCOPE);

  const detection = useQuery({
    queryKey: ["scoped-detection", analysisScopeKey(scope)],
    queryFn: () =>
      detectionFn({
        data: {
          scope,
          similarityThreshold: 0.9,
        },
      }),
  });

  const similar = detection.data?.similar ?? [];
  const clusters = detection.data?.clusters ?? [];
  const blocs = detection.data?.blocs ?? [];

  const targetKeys = useMemo(
    () =>
      Array.from(
        new Set(
          blocs
            .map((pair) => pair.to)
            .filter(Boolean),
        ),
      ),
    [blocs],
  );

  const { data: targetEntries = [] } =
    useEntryKeyCatalog(targetKeys);

  const byEntryKey = useMemo(
    () => entryMap(targetEntries),
    [targetEntries],
  );

  const byCountryCode = useMemo(() => {
    const map = new Map<string, any>();

    for (const country of countries) {
      map.set(country.code, country);
    }

    return map;
  }, [countries]);

  const voterName = (countryCode: string) =>
    byCountryCode.get(countryCode)?.name ?? countryCode;

  const targetName = (entryKey: string) => {
    const entry = byEntryKey.get(entryKey);

    return entry
      ? getEntryDisplayName(entry)
      : entryKey;
  };

  return (
    <AdminShell title="Advanced Detection">
      <div className="space-y-6">
        <AnalysisScopePicker
          value={scope}
          onChange={setScope}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {detection.data
              ? `${detection.data.editions.length} edition${
                  detection.data.editions.length === 1 ? "" : "s"
                } · ${detection.data.rounds.length} round${
                  detection.data.rounds.length === 1 ? "" : "s"
                }`
              : "Loading scope…"}
          </p>

          <Button
            variant="outline"
            size="sm"
            onClick={() => detection.refetch()}
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {detection.isLoading ? (
          <LoadingRow text="Analysing selected scope…" />
        ) : detection.error ? (
          <Empty
            body={
              detection.error instanceof Error
                ? detection.error.message
                : "Detection failed"
            }
          />
        ) : (
          <>
            <SimilarSection
              rows={similar}
              byCountryCode={byCountryCode}
              voterName={voterName}
              scopeKey={analysisScopeKey(scope)}
            />

            <ClusterSection
              rows={clusters}
              byCountryCode={byCountryCode}
              voterName={voterName}
            />

            <BlocSection
              rows={blocs}
              byCountryCode={byCountryCode}
              byEntryKey={byEntryKey}
              voterName={voterName}
              targetName={targetName}
              scopeKey={analysisScopeKey(scope)}
            />
          </>
        )}
      </div>
    </AdminShell>
  );
}

function SimilarSection({
  rows,
  byCountryCode,
  voterName,
  scopeKey,
}: {
  rows: ScopedSimilarPair[];
  byCountryCode: Map<string, any>;
  voterName: (code: string) => string;
  scopeKey: string;
}) {
  return (
    <section className="glass-strong rounded-2xl p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">
            Near-identical ballots
          </h3>
          <Badge variant="outline">cosine ≥ 0.90</Badge>
        </div>

        {rows.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCSV(
                `similar-ballots-${scopeKey}.csv`,
                rows.map((pair) => ({
                  score: pair.score,
                  time_delta_sec: pair.timeDeltaSec,
                  shared_ip: pair.sharedIp,
                  shared_fingerprint: pair.sharedFingerprint,
                  a_username: pair.a.username,
                  a_country: pair.a.country_code,
                  a_edition: pair.a.edition_name,
                  a_round: pair.a.round_name,
                  b_username: pair.b.username,
                  b_country: pair.b.country_code,
                  b_edition: pair.b.edition_name,
                  b_round: pair.b.round_name,
                })),
              )
            }
          >
            Export CSV
          </Button>
        ) : null}
      </header>

      <p className="mb-3 text-xs text-muted-foreground">
        Cross-edition comparisons keep each ballot's edition and round visible,
        so repeated historical patterns are not confused with same-round timing.
      </p>

      {rows.length === 0 ? (
        <Empty body="No near-identical ballot pairs in this scope." />
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((pair, index) => {
            const aCountry =
              byCountryCode.get(pair.a.country_code);
            const bCountry =
              byCountryCode.get(pair.b.country_code);

            return (
              <li
                key={`${pair.a.id}:${pair.b.id}:${index}`}
                className="space-y-2 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
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

                  <span className="text-muted-foreground">↔</span>

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
                    <Badge variant="destructive">shared IP</Badge>
                  ) : null}

                  {pair.sharedFingerprint ? (
                    <Badge variant="destructive">
                      shared device
                    </Badge>
                  ) : null}
                </div>

                <div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                  <div>
                    {pair.a.edition_name} · {pair.a.round_name}
                  </div>
                  <div>
                    {pair.b.edition_name} · {pair.b.round_name}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ClusterSection({
  rows,
  byCountryCode,
  voterName,
}: {
  rows: ScopedCluster[];
  byCountryCode: Map<string, any>;
  voterName: (code: string) => string;
}) {
  return (
    <section className="glass-strong rounded-2xl p-4 sm:p-5">
      <header className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">
          Coordination clusters
        </h3>
        <Badge variant="outline">2+ ballots</Badge>
      </header>

      {rows.length === 0 ? (
        <Empty body="No coordination clusters in this scope." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((cluster) => (
            <div
              key={cluster.id}
              className="rounded-xl border border-border bg-card/40 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  Cluster #{cluster.id} ·{" "}
                  {cluster.members.length} ballots
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

              <ul className="space-y-2 text-xs text-muted-foreground">
                {cluster.members.map((member) => {
                  const country =
                    byCountryCode.get(member.country_code);

                  return (
                    <li
                      key={member.id}
                      className="rounded-lg border border-border/50 p-2"
                    >
                      <div className="flex items-center gap-1.5">
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

                        {member.is_vpn ? (
                          <Badge
                            variant="destructive"
                            className="ml-auto text-[10px]"
                          >
                            VPN
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-1">
                        {member.edition_name} · {member.round_name}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BlocSection({
  rows,
  byCountryCode,
  byEntryKey,
  voterName,
  targetName,
  scopeKey,
}: {
  rows: ScopedBlocPair[];
  byCountryCode: Map<string, any>;
  byEntryKey: Map<string, any>;
  voterName: (code: string) => string;
  targetName: (key: string) => string;
  scopeKey: string;
}) {
  return (
    <section className="glass-strong rounded-2xl p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">
            Voting-bloc outliers
          </h3>
          <Badge variant="outline">z ≥ 1.5</Badge>
        </div>

        {rows.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCSV(
                `voting-blocs-${scopeKey}.csv`,
                rows.map((pair) => ({
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
        “From” stays the permanent voter-country identity. “Target” stays a
        generic entry key, including custom entries, across the selected scope.
      </p>

      {rows.length === 0 ? (
        <Empty body="No voter-country → target-entry outliers in this scope." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
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
              {rows.map((pair, index) => (
                <tr
                  key={`${pair.from}:${pair.to}:${index}`}
                  className="border-t border-border/60"
                >
                  <td className="py-2 pr-3 font-medium">
                    <span className="inline-flex items-center gap-2">
                      <CountryFlag
                        country={byCountryCode.get(pair.from)}
                        size={18}
                      />
                      {voterName(pair.from)}
                    </span>
                  </td>

                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <EntryAvatar
                        entry={byEntryKey.get(pair.to)}
                        size={18}
                      />
                      {targetName(pair.to)}
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LoadingRow({ text }: { text: string }) {
  return (
    <div className="glass flex items-center gap-2 rounded-2xl p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
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
