import { createFileRoute } from "@tanstack/react-router";
import {
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Loader2,
  Network,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
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
import {
  entryMap,
  getEntryDisplayName,
} from "@/lib/round-entries";

export const Route = createFileRoute("/admin/detection")({
  head: () => ({
    meta: [
      {
        title: "Advanced Detection — Solaris Admin",
      },
    ],
  }),
  component: DetectionPage,
});

const INITIAL_SIMILAR = 8;
const INITIAL_CLUSTERS = 8;
const INITIAL_BLOCS = 12;

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function DetectionPage() {
  const detectionFn = useServerFn(getScopedDetection);
  const { data: countries = [] } = useAllCountries();

  const [scope, setScope] =
    useState<AnalysisScope>(DEFAULT_ANALYSIS_SCOPE);

  const [showAllSimilar, setShowAllSimilar] =
    useState(false);

  const [showAllClusters, setShowAllClusters] =
    useState(false);

  const [showAllBlocs, setShowAllBlocs] =
    useState(false);

  const detection = useQuery({
    queryKey: [
      "scoped-detection-identity-v2",
      analysisScopeKey(scope),
    ],
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

  const countryLookup = useMemo(() => {
    const map = new Map<string, any>();

    for (const country of countries) {
      map.set(
        normalizeIdentity(country.code),
        country,
      );
      map.set(
        normalizeIdentity(country.name),
        country,
      );
    }

    return map;
  }, [countries]);

  const resolveCountry = (
    identity: string | null | undefined,
  ) =>
    countryLookup.get(
      normalizeIdentity(identity),
    ) ?? null;

  const voterName = (
    identity: string | null | undefined,
  ) => {
    const country = resolveCountry(identity);
    return (
      country?.name ??
      identity ??
      "Unknown identity"
    );
  };

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

  const targetName = (entryKey: string) => {
    const entry = byEntryKey.get(entryKey);

    return entry
      ? getEntryDisplayName(entry)
      : entryKey;
  };

  const strongestCluster =
    clusters[0]?.combinedRisk ?? 0;

  const strongestSimilar =
    similar[0]?.maxScore ?? 0;

  const technicalClusters = clusters.filter(
    (cluster) =>
      cluster.sharedIpEdges > 0 ||
      cluster.sharedFingerprintEdges > 0 ||
      cluster.sharedDeviceEdges > 0,
  ).length;

  return (
    <AdminShell title="Advanced Detection">
      <div className="space-y-6 pb-8">
        <AnalysisScopePicker
          value={scope}
          onChange={(next) => {
            setScope(next);
            setShowAllSimilar(false);
            setShowAllClusters(false);
            setShowAllBlocs(false);
          }}
        />

        <section className="glass-strong rounded-3xl p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-primary">
                Identity-based integrity scan
              </p>

              <h2 className="mt-1 text-xl font-semibold">
                One country = one voter identity
              </h2>

              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Multiple ballots from the same Solaris country are treated as
                repeated observations of the same Head of Delegation, never as
                separate people. Clusters only connect different country
                identities.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => detection.refetch()}
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <SummaryStat
              icon={Users}
              label="Identities"
              value={detection.data?.identityCount ?? 0}
            />
            <SummaryStat
              icon={ShieldCheck}
              label="Ballots scanned"
              value={detection.data?.ballotCount ?? 0}
            />
            <SummaryStat
              icon={Network}
              label="Cross-country clusters"
              value={clusters.length}
            />
            <SummaryStat
              icon={Smartphone}
              label="Technical clusters"
              value={technicalClusters}
            />
            <SummaryStat
              icon={AlertTriangle}
              label="Highest cluster risk"
              value={strongestCluster}
              suffix="/100"
            />
          </div>

          {strongestSimilar > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Strongest same-round cross-country ballot similarity:{" "}
              <span className="font-medium text-foreground">
                {(strongestSimilar * 100).toFixed(1)}%
              </span>
            </p>
          ) : null}
        </section>

        {detection.isLoading ? (
          <Loading />
        ) : detection.error ? (
          <Empty
            title="Detection could not run"
            body={
              detection.error instanceof Error
                ? detection.error.message
                : "Unknown detection error"
            }
          />
        ) : (
          <>
            <CompactSection
              icon={AlertTriangle}
              title="Near-identical voting"
              subtitle="Different countries with highly similar ballots in the same round. Repeated matches are grouped into one country-pair row."
              count={similar.length}
              emptyText="No cross-country near-identical voting pairs were detected."
            >
              <div className="space-y-2">
                {(showAllSimilar
                  ? similar
                  : similar.slice(0, INITIAL_SIMILAR)
                ).map((pair) => (
                  <SimilarPairCard
                    key={`${pair.countryA}:${pair.countryB}`}
                    pair={pair}
                    resolveCountry={resolveCountry}
                    voterName={voterName}
                  />
                ))}
              </div>

              {similar.length > INITIAL_SIMILAR ? (
                <ShowMoreButton
                  expanded={showAllSimilar}
                  onClick={() =>
                    setShowAllSimilar((value) => !value)
                  }
                  hiddenCount={
                    similar.length - INITIAL_SIMILAR
                  }
                />
              ) : null}
            </CompactSection>

            <CompactSection
              icon={Network}
              title="Cross-country coordination clusters"
              subtitle="Each member is one Solaris country identity. A country's ballots from multiple rounds are summarized inside its member row instead of pretending they are separate voters."
              count={clusters.length}
              emptyText="No cross-country technical or coordination clusters were detected."
            >
              <div className="grid gap-3 lg:grid-cols-2">
                {(showAllClusters
                  ? clusters
                  : clusters.slice(0, INITIAL_CLUSTERS)
                ).map((cluster) => (
                  <ClusterCard
                    key={cluster.id}
                    cluster={cluster}
                    resolveCountry={resolveCountry}
                    voterName={voterName}
                  />
                ))}
              </div>

              {clusters.length > INITIAL_CLUSTERS ? (
                <ShowMoreButton
                  expanded={showAllClusters}
                  onClick={() =>
                    setShowAllClusters((value) => !value)
                  }
                  hiddenCount={
                    clusters.length - INITIAL_CLUSTERS
                  }
                />
              ) : null}
            </CompactSection>

            <CompactSection
              icon={GitBranch}
              title="Voting-bloc outliers"
              subtitle="Longer-term voter-country → target-entry preferences. This is already aggregated by permanent country identity."
              count={blocs.length}
              emptyText="No strong voting-bloc outliers were detected in this scope."
            >
              <BlocTable
                rows={
                  showAllBlocs
                    ? blocs
                    : blocs.slice(0, INITIAL_BLOCS)
                }
                resolveCountry={resolveCountry}
                voterName={voterName}
                byEntryKey={byEntryKey}
                targetName={targetName}
              />

              {blocs.length > INITIAL_BLOCS ? (
                <ShowMoreButton
                  expanded={showAllBlocs}
                  onClick={() =>
                    setShowAllBlocs((value) => !value)
                  }
                  hiddenCount={
                    blocs.length - INITIAL_BLOCS
                  }
                />
              ) : null}
            </CompactSection>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
  suffix = "",
}: {
  icon: typeof Users;
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/55 bg-card/20 p-3">
      <div className="flex items-center gap-2 text-primary">
        <Icon className="h-4 w-4" />
        <span className="text-[10px] uppercase tracking-widest">
          {label}
        </span>
      </div>

      <div className="mt-2 text-xl font-semibold tabular-nums">
        {value}
        {suffix ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CompactSection({
  icon: Icon,
  title,
  subtitle,
  count,
  emptyText,
  children,
}: {
  icon: typeof AlertTriangle;
  title: string;
  subtitle: string;
  count: number;
  emptyText: string;
  children: import("react").ReactNode;
}) {
  return (
    <section className="glass-strong rounded-3xl p-4 sm:p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">
              {title}
            </h3>
            <Badge variant="outline">
              {count}
            </Badge>
          </div>

          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </header>

      {count === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card/15 p-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function SimilarPairCard({
  pair,
  resolveCountry,
  voterName,
}: {
  pair: ScopedSimilarPair;
  resolveCountry: (
    identity: string,
  ) => any;
  voterName: (identity: string) => string;
}) {
  const [open, setOpen] =
    useState(false);

  const hasTechnical =
    pair.sharedIpMatches > 0 ||
    pair.sharedFingerprintMatches > 0 ||
    pair.sharedDeviceMatches > 0;

  return (
    <div className="rounded-2xl border border-border/55 bg-card/20">
      <button
        type="button"
        className="flex w-full items-center gap-3 p-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <div className="flex -space-x-1">
          <CountryFlag
            country={resolveCountry(pair.countryA)}
            size={24}
          />
          <CountryFlag
            country={resolveCountry(pair.countryB)}
            size={24}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {voterName(pair.countryA)}
            <span className="mx-2 text-muted-foreground">
              ↔
            </span>
            {voterName(pair.countryB)}
          </div>

          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {pair.matches} matching round
            {pair.matches === 1 ? "" : "s"} · avg{" "}
            {(pair.averageScore * 100).toFixed(1)}% · max{" "}
            {(pair.maxScore * 100).toFixed(1)}%
          </div>
        </div>

        {hasTechnical ? (
          <Badge
            variant="outline"
            className="hidden shrink-0 text-[10px] sm:inline-flex"
          >
            technical overlap
          </Badge>
        ) : null}

        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open ? (
        <div className="border-t border-border/50 px-3 pb-3 pt-2">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pair.sharedIpMatches > 0 ? (
              <Badge
                variant="outline"
                className="text-[10px]"
              >
                shared IP ×{pair.sharedIpMatches}
              </Badge>
            ) : null}

            {pair.sharedFingerprintMatches > 0 ? (
              <Badge
                variant="outline"
                className="text-[10px]"
              >
                shared fingerprint ×
                {pair.sharedFingerprintMatches}
              </Badge>
            ) : null}

            {pair.sharedDeviceMatches > 0 ? (
              <Badge
                variant="outline"
                className="text-[10px]"
              >
                shared device ×
                {pair.sharedDeviceMatches}
              </Badge>
            ) : null}
          </div>

          <div className="space-y-1.5">
            {pair.examples.map((example, index) => (
              <div
                key={`${example.edition_name}:${example.round_name}:${index}`}
                className="rounded-xl border border-border/45 bg-background/10 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium">
                    {example.edition_name} ·{" "}
                    {example.round_name}
                  </span>

                  <span className="text-xs font-semibold tabular-nums text-primary">
                    {(example.score * 100).toFixed(1)}%
                  </span>
                </div>

                <div className="mt-1 text-[11px] text-muted-foreground">
                  {example.a_username || pair.countryA}
                  {" ↔ "}
                  {example.b_username || pair.countryB}
                  {" · Δ "}
                  {formatDelta(example.timeDeltaSec)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ClusterCard({
  cluster,
  resolveCountry,
  voterName,
}: {
  cluster: ScopedCluster;
  resolveCountry: (
    identity: string,
  ) => any;
  voterName: (identity: string) => string;
}) {
  const [open, setOpen] =
    useState(false);

  return (
    <div className="rounded-2xl border border-border/55 bg-card/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold">
              {cluster.members.length} countries
            </h4>

            <Badge
              className={
                cluster.combinedRisk >= 70
                  ? "bg-destructive text-destructive-foreground"
                  : cluster.combinedRisk >= 40
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-primary/20 text-primary"
              }
            >
              risk {cluster.combinedRisk}
            </Badge>
          </div>

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {cluster.sharedIpEdges > 0 ? (
              <span>
                IP edges {cluster.sharedIpEdges}
              </span>
            ) : null}

            {cluster.sharedFingerprintEdges > 0 ? (
              <span>
                fingerprint edges{" "}
                {cluster.sharedFingerprintEdges}
              </span>
            ) : null}

            {cluster.sharedDeviceEdges > 0 ? (
              <span>
                device edges{" "}
                {cluster.sharedDeviceEdges}
              </span>
            ) : null}

            {cluster.nearIdenticalEdges > 0 ? (
              <span>
                similar-vote edges{" "}
                {cluster.nearIdenticalEdges}
              </span>
            ) : null}
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {cluster.members
          .slice(0, open ? undefined : 4)
          .map((member) => (
            <div
              key={member.country_code}
              className="inline-flex items-center gap-2 rounded-xl border border-border/50 bg-background/10 px-2.5 py-2"
            >
              <CountryFlag
                country={resolveCountry(
                  member.country_code,
                )}
                size={18}
              />

              <div>
                <div className="text-xs font-medium">
                  {voterName(member.country_code)}
                </div>

                <div className="text-[10px] text-muted-foreground">
                  {member.ballotCount} ballot
                  {member.ballotCount === 1 ? "" : "s"} ·{" "}
                  {member.rounds} round
                  {member.rounds === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          ))}

        {!open &&
        cluster.members.length > 4 ? (
          <Badge
            variant="outline"
            className="self-center"
          >
            +{cluster.members.length - 4} more
          </Badge>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 border-t border-border/50 pt-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Evidence
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
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

          <div className="mt-3 space-y-2">
            {cluster.members.map((member) => (
              <div
                key={`detail:${member.country_code}`}
                className="rounded-xl border border-border/45 bg-background/10 p-2.5"
              >
                <div className="flex items-center gap-2">
                  <CountryFlag
                    country={resolveCountry(
                      member.country_code,
                    )}
                    size={18}
                  />

                  <span className="text-xs font-semibold">
                    {voterName(member.country_code)}
                  </span>

                  <span className="ml-auto text-[10px] text-muted-foreground">
                    highest ballot risk{" "}
                    {member.highestBallotRisk}
                  </span>
                </div>

                <p className="mt-1 text-[11px] text-muted-foreground">
                  {member.ballotCount} ballots ·{" "}
                  {member.editions} editions ·{" "}
                  {member.rounds} rounds
                </p>

                {member.usernames.length > 0 ? (
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    usernames:{" "}
                    {member.usernames.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BlocTable({
  rows,
  resolveCountry,
  voterName,
  byEntryKey,
  targetName,
}: {
  rows: ScopedBlocPair[];
  resolveCountry: (
    identity: string,
  ) => any;
  voterName: (identity: string) => string;
  byEntryKey: Map<string, any>;
  targetName: (entryKey: string) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-xs uppercase text-muted-foreground">
          <tr>
            <th className="pb-2 text-left">
              Voter
            </th>
            <th className="pb-2 text-left">
              Target
            </th>
            <th className="pb-2 text-right">
              Avg pts
            </th>
            <th className="pb-2 text-right">
              Rounds
            </th>
            <th className="pb-2 text-right">
              Strength
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((pair) => (
            <tr
              key={`${pair.from}:${pair.to}`}
              className="border-t border-border/50"
            >
              <td className="py-2.5 pr-3">
                <span className="inline-flex items-center gap-2 font-medium">
                  <CountryFlag
                    country={resolveCountry(pair.from)}
                    size={18}
                  />
                  {voterName(pair.from)}
                </span>
              </td>

              <td className="py-2.5 pr-3">
                <span className="inline-flex items-center gap-2">
                  <EntryAvatar
                    entry={byEntryKey.get(pair.to)}
                    size={18}
                  />
                  {targetName(pair.to)}
                </span>
              </td>

              <td className="py-2.5 text-right tabular-nums">
                {pair.mean.toFixed(2)}
              </td>

              <td className="py-2.5 text-right tabular-nums">
                {pair.count}
              </td>

              <td className="py-2.5 text-right">
                <Badge
                  className={
                    pair.z >= 3
                      ? "bg-destructive text-destructive-foreground"
                      : pair.z >= 2
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-primary/20 text-primary"
                  }
                >
                  z {pair.z.toFixed(2)}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShowMoreButton({
  expanded,
  onClick,
  hiddenCount,
}: {
  expanded: boolean;
  onClick: () => void;
  hiddenCount: number;
}) {
  return (
    <div className="mt-3 flex justify-center">
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
      >
        {expanded ? (
          <>
            <ChevronUp className="h-4 w-4" />
            Show less
          </>
        ) : (
          <>
            <ChevronDown className="h-4 w-4" />
            Show {hiddenCount} more
          </>
        )}
      </Button>
    </div>
  );
}

function Loading() {
  return (
    <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
      Analysing country identities…
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

function formatDelta(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  if (seconds < 86_400) {
    return `${Math.round(seconds / 3600)}h`;
  }
  return `${Math.round(seconds / 86_400)}d`;
}
