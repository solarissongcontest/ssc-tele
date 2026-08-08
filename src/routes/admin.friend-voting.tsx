import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { AdminShell } from "@/components/admin-shell";
import { AnalysisScopePicker } from "@/components/analysis-scope-picker";
import { CountryFlag } from "@/components/country-flag";
import { EntryAvatar } from "@/components/entry-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEntryKeyCatalog } from "@/hooks/use-entry-key-catalog";
import { useAllCountries } from "@/hooks/use-round-results";
import {
  getScopedFriendVotingAnalysis,
  type ScopedFriendRelationship,
} from "@/lib/analysis-scope.functions";
import {
  DEFAULT_ANALYSIS_SCOPE,
  analysisScopeKey,
  type AnalysisScope,
} from "@/lib/analysis-scope";
import {
  getFriendVotingSettings,
  saveFriendVotingSettings,
  setRelationshipReview,
} from "@/lib/friend-voting.functions";
import type { FriendVotingSettings } from "@/lib/friend-voting-math";
import {
  entryMap,
  getEntryDisplayName,
} from "@/lib/round-entries";

export const Route = createFileRoute("/admin/friend-voting")({
  head: () => ({
    meta: [
      {
        title: "Friend-Voting Analysis — Solaris Admin",
      },
    ],
  }),
  component: FriendVotingPage,
});

type PageTab =
  | "overview"
  | "relationships"
  | "groups"
  | "history"
  | "settings";

type RiskFilter =
  | "attention"
  | "strong"
  | "review"
  | "repeated"
  | "all";

type SortMode =
  | "risk"
  | "opportunities"
  | "reciprocity"
  | "history";

const PAGE_SIZE = 15;

const REVIEW_STATUSES = [
  { value: "new", label: "New" },
  { value: "under_review", label: "Under review" },
  { value: "watchlist", label: "Watchlist" },
  { value: "confirmed", label: "Confirmed friend voting" },
  { value: "legitimate", label: "Legitimate" },
  { value: "dismissed", label: "Dismissed" },
] as const;

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function riskName(score: number) {
  if (score >= 90) return "Critical";
  if (score >= 80) return "Highly";
  if (score >= 65) return "Strong";
  if (score >= 50) return "Review";
  if (score >= 30) return "Notable";
  return "Normal";
}

function riskTone(score: number) {
  if (score >= 90) {
    return "border-red-400/40 bg-red-500/15 text-red-200";
  }

  if (score >= 80) {
    return "border-orange-400/40 bg-orange-500/15 text-orange-200";
  }

  if (score >= 65) {
    return "border-amber-400/40 bg-amber-500/15 text-amber-200";
  }

  if (score >= 50) {
    return "border-cyan-300/35 bg-cyan-400/10 text-cyan-100";
  }

  if (score >= 30) {
    return "border-primary/35 bg-primary/10 text-primary";
  }

  return "border-border bg-background/20 text-muted-foreground";
}

function FriendVotingPage() {
  const scopedFn = useServerFn(getScopedFriendVotingAnalysis);
  const { data: countries = [] } = useAllCountries();

  const [scope, setScope] =
    useState<AnalysisScope>(DEFAULT_ANALYSIS_SCOPE);

  const [tab, setTab] =
    useState<PageTab>("overview");

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] =
    useState<RiskFilter>("attention");
  const [reviewFilter, setReviewFilter] =
    useState("all");
  const [sortMode, setSortMode] =
    useState<SortMode>("risk");
  const [page, setPage] = useState(1);

  const [selected, setSelected] =
    useState<ScopedFriendRelationship | null>(null);

  const scoped = useQuery({
    queryKey: [
      "friend-voting-dashboard",
      analysisScopeKey(scope),
    ],
    queryFn: () =>
      scopedFn({
        data: { scope },
      }),
  });

  const relationships =
    scoped.data?.relationships ?? [];
  const groups = scoped.data?.groups ?? [];
  const moderationEvents =
    scoped.data?.moderationEvents ?? [];

  const targetKeys = useMemo(() => {
    const keys = new Set<string>();

    for (const row of relationships) {
      if (row.target_country_code) {
        keys.add(row.target_country_code);
      }
    }

    return Array.from(keys);
  }, [relationships]);

  const { data: entries = [] } =
    useEntryKeyCatalog(targetKeys);

  const byEntryKey = useMemo(
    () => entryMap(entries),
    [entries],
  );

  const countryLookup = useMemo(() => {
    const map = new Map<string, any>();

    for (const country of countries) {
      map.set(normalize(country.code), country);
      map.set(normalize(country.name), country);
    }

    return map;
  }, [countries]);

  const resolveCountry = (
    identity: string | null | undefined,
  ) =>
    countryLookup.get(normalize(identity)) ?? null;

  const voterName = (identity: string) =>
    resolveCountry(identity)?.name ?? identity;

  const targetName = (entryKey: string) => {
    const entry = byEntryKey.get(entryKey);

    if (entry) {
      return getEntryDisplayName(entry);
    }

    return (
      resolveCountry(entryKey)?.name ??
      entryKey
    );
  };

  const summary = useMemo(() => {
    const actionable = relationships.filter(
      (row) =>
        row.risk_score >= 30 &&
        row.review_status !== "legitimate" &&
        row.review_status !== "dismissed",
    );

    return {
      all: relationships.length,
      attention: actionable.length,
      strong: relationships.filter(
        (row) => row.risk_score >= 65,
      ).length,
      highly: relationships.filter(
        (row) => row.risk_score >= 80,
      ).length,
      repeated: relationships.filter(
        (row) =>
          row.repeated_after_moderation,
      ).length,
      groups: groups.length,
    };
  }, [relationships, groups]);

  const reviewQueue = useMemo(
    () =>
      relationships
        .filter(
          (row) =>
            row.risk_score >= 50 &&
            row.review_status !== "legitimate" &&
            row.review_status !== "dismissed",
        )
        .sort(
          (a, b) =>
            b.risk_score - a.risk_score ||
            b.shared_opportunities -
              a.shared_opportunities,
        )
        .slice(0, 6),
    [relationships],
  );

  const persistent = useMemo(
    () =>
      relationships
        .filter(
          (row) =>
            row.editions_count >= 2 &&
            row.support_count > 0,
        )
        .sort(
          (a, b) =>
            b.editions_count -
              a.editions_count ||
            b.risk_score - a.risk_score,
        )
        .slice(0, 6),
    [relationships],
  );

  const reciprocal = useMemo(
    () =>
      relationships
        .filter(
          (row) =>
            row.reciprocity_score >= 0.5,
        )
        .sort(
          (a, b) =>
            b.reciprocity_score -
              a.reciprocity_score ||
            b.risk_score - a.risk_score,
        )
        .slice(0, 6),
    [relationships],
  );

  const filtered = useMemo(() => {
    const needle =
      search.trim().toLowerCase();

    const rows = relationships.filter(
      (row) => {
        if (
          reviewFilter !== "all" &&
          row.review_status !== reviewFilter
        ) {
          return false;
        }

        if (riskFilter === "attention") {
          if (row.risk_score < 30) {
            return false;
          }

          if (
            row.review_status === "legitimate" ||
            row.review_status === "dismissed"
          ) {
            return false;
          }
        }

        if (
          riskFilter === "strong" &&
          row.risk_score < 65
        ) {
          return false;
        }

        if (
          riskFilter === "review" &&
          row.risk_score < 50
        ) {
          return false;
        }

        if (
          riskFilter === "repeated" &&
          !row.repeated_after_moderation
        ) {
          return false;
        }

        if (needle) {
          const haystack = [
            voterName(
              row.voting_country_code,
            ),
            row.voting_country_code,
            targetName(
              row.target_country_code,
            ),
            row.target_country_code,
            row.risk_label,
            row.review_status,
          ]
            .join(" ")
            .toLowerCase();

          if (!haystack.includes(needle)) {
            return false;
          }
        }

        return true;
      },
    );

    rows.sort((a, b) => {
      if (sortMode === "opportunities") {
        return (
          b.shared_opportunities -
            a.shared_opportunities ||
          b.risk_score - a.risk_score
        );
      }

      if (sortMode === "reciprocity") {
        return (
          b.reciprocity_score -
            a.reciprocity_score ||
          b.risk_score - a.risk_score
        );
      }

      if (sortMode === "history") {
        return (
          b.editions_count -
            a.editions_count ||
          b.rounds_count - a.rounds_count ||
          b.risk_score - a.risk_score
        );
      }

      return (
        b.risk_score - a.risk_score ||
        b.shared_opportunities -
          a.shared_opportunities
      );
    });

    return rows;
  }, [
    relationships,
    search,
    riskFilter,
    reviewFilter,
    sortMode,
    countryLookup,
    byEntryKey,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / PAGE_SIZE),
  );

  const safePage = Math.min(
    page,
    totalPages,
  );

  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  return (
    <AdminShell title="Friend-Voting Analysis">
      <div className="space-y-5 pb-10">
        <AnalysisScopePicker
          value={scope}
          onChange={(next) => {
            setScope(next);
            setPage(1);
          }}
        />

        <section className="glass-strong rounded-3xl p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.18em] text-primary">
                Integrity intelligence
              </p>

              <h2 className="mt-1 text-xl font-semibold">
                Friend-voting review
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                One Solaris country is one permanent delegation identity.
                This view surfaces recurring country → target relationships
                instead of dumping every pair into one enormous table.
              </p>

              <p className="mt-2 text-xs text-muted-foreground">
                {scoped.data
                  ? `${scoped.data.editions.length} edition${
                      scoped.data.editions.length === 1
                        ? ""
                        : "s"
                    } · ${scoped.data.rounds.length} round${
                      scoped.data.rounds.length === 1
                        ? ""
                        : "s"
                    }`
                  : "Loading scope…"}
              </p>
            </div>

            <Button
              variant="outline"
              onClick={() =>
                scoped.refetch()
              }
              disabled={scoped.isFetching}
            >
              {scoped.isFetching
                ? "Refreshing…"
                : "Refresh"}
            </Button>
          </div>
        </section>

        {scoped.isLoading ? (
          <StatusPanel text="Analysing friend-voting history…" />
        ) : scoped.error ? (
          <ErrorPanel
            text={
              scoped.error instanceof Error
                ? scoped.error.message
                : "Friend-voting analysis failed"
            }
          />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <Stat
                label="Needs attention"
                value={summary.attention}
                tone="warn"
              />
              <Stat
                label="Strong 65+"
                value={summary.strong}
                tone="warn"
              />
              <Stat
                label="Highly 80+"
                value={summary.highly}
                tone="danger"
              />
              <Stat
                label="Repeated"
                value={summary.repeated}
                tone="danger"
              />
              <Stat
                label="Groups"
                value={summary.groups}
              />
              <Stat
                label="All pairs"
                value={summary.all}
              />
            </section>

            <nav className="glass flex gap-1 overflow-x-auto rounded-2xl p-1.5">
              <NavButton
                active={tab === "overview"}
                onClick={() =>
                  setTab("overview")
                }
              >
                Overview
              </NavButton>

              <NavButton
                active={
                  tab === "relationships"
                }
                onClick={() =>
                  setTab("relationships")
                }
              >
                Relationships
              </NavButton>

              <NavButton
                active={tab === "groups"}
                onClick={() =>
                  setTab("groups")
                }
              >
                Groups
              </NavButton>

              <NavButton
                active={tab === "history"}
                onClick={() =>
                  setTab("history")
                }
              >
                History
              </NavButton>

              <NavButton
                active={tab === "settings"}
                onClick={() =>
                  setTab("settings")
                }
              >
                Settings
              </NavButton>
            </nav>

            {tab === "overview" ? (
              <OverviewTab
                reviewQueue={reviewQueue}
                persistent={persistent}
                reciprocal={reciprocal}
                groups={groups}
                voterName={voterName}
                targetName={targetName}
                resolveCountry={resolveCountry}
                byEntryKey={byEntryKey}
                onOpen={setSelected}
              />
            ) : null}

            {tab === "relationships" ? (
              <RelationshipsTab
                search={search}
                setSearch={setSearch}
                riskFilter={riskFilter}
                setRiskFilter={(value) => {
                  setRiskFilter(value);
                  setPage(1);
                }}
                reviewFilter={reviewFilter}
                setReviewFilter={(value) => {
                  setReviewFilter(value);
                  setPage(1);
                }}
                sortMode={sortMode}
                setSortMode={(value) => {
                  setSortMode(value);
                  setPage(1);
                }}
                rows={pageRows}
                totalResults={filtered.length}
                page={safePage}
                totalPages={totalPages}
                setPage={setPage}
                voterName={voterName}
                targetName={targetName}
                resolveCountry={resolveCountry}
                byEntryKey={byEntryKey}
                onOpen={setSelected}
              />
            ) : null}

            {tab === "groups" ? (
              <GroupsTab
                groups={groups}
                voterName={voterName}
              />
            ) : null}

            {tab === "history" ? (
              <HistoryTab
                events={moderationEvents}
                voterName={voterName}
                targetName={targetName}
              />
            ) : null}

            {tab === "settings" ? (
              <SettingsTab
                afterSave={() =>
                  scoped.refetch()
                }
              />
            ) : null}
          </>
        )}

        {selected ? (
          <RelationshipModal
            relationship={selected}
            voterName={voterName}
            targetName={targetName}
            resolveCountry={resolveCountry}
            targetEntry={byEntryKey.get(
              selected.target_country_code,
            )}
            onClose={() =>
              setSelected(null)
            }
            afterReview={() => {
              setSelected(null);
              scoped.refetch();
            }}
          />
        ) : null}
      </div>
    </AdminShell>
  );
}

function OverviewTab({
  reviewQueue,
  persistent,
  reciprocal,
  groups,
  voterName,
  targetName,
  resolveCountry,
  byEntryKey,
  onOpen,
}: {
  reviewQueue: ScopedFriendRelationship[];
  persistent: ScopedFriendRelationship[];
  reciprocal: ScopedFriendRelationship[];
  groups: any[];
  voterName: (identity: string) => string;
  targetName: (key: string) => string;
  resolveCountry: (identity: string) => any;
  byEntryKey: Map<string, any>;
  onOpen: (
    row: ScopedFriendRelationship,
  ) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel
        title="Review queue"
        subtitle="Highest-risk unresolved relationships first."
      >
        <CompactList
          rows={reviewQueue}
          voterName={voterName}
          targetName={targetName}
          resolveCountry={resolveCountry}
          byEntryKey={byEntryKey}
          onOpen={onOpen}
          empty="Nothing currently needs urgent review."
        />
      </Panel>

      <Panel
        title="Persistent across editions"
        subtitle="Patterns observed across multiple editions."
      >
        <CompactList
          rows={persistent}
          voterName={voterName}
          targetName={targetName}
          resolveCountry={resolveCountry}
          byEntryKey={byEntryKey}
          onOpen={onOpen}
          showHistory
          empty="No persistent multi-edition patterns in this scope."
        />
      </Panel>

      <Panel
        title="Strong reciprocity"
        subtitle="Relationships where reverse support is also meaningful."
      >
        <CompactList
          rows={reciprocal}
          voterName={voterName}
          targetName={targetName}
          resolveCountry={resolveCountry}
          byEntryKey={byEntryKey}
          onOpen={onOpen}
          showReciprocity
          empty="No strong reciprocal relationships in this scope."
        />
      </Panel>

      <Panel
        title="Highest-risk groups"
        subtitle="Only the first few groups are surfaced here."
      >
        {groups.length === 0 ? (
          <SmallEmpty text="No groups detected." />
        ) : (
          <div className="space-y-2">
            {groups
              .slice()
              .sort(
                (a, b) =>
                  b.risk_score -
                  a.risk_score,
              )
              .slice(0, 5)
              .map((group, index) => (
                <div
                  key={`${group.label}-${index}`}
                  className="rounded-2xl border border-border/60 bg-card/20 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {group.label}
                      </p>

                      <p className="text-xs text-muted-foreground">
                        {group.members.length} delegations ·{" "}
                        {group.editions_observed} edition
                        {group.editions_observed === 1
                          ? ""
                          : "s"}
                      </p>
                    </div>

                    <RiskBadge
                      score={group.risk_score}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {group.members
                      .slice(0, 6)
                      .map((member: string) => (
                        <span
                          key={member}
                          className="rounded-full border border-border/60 px-2 py-1 text-[10px]"
                        >
                          {voterName(member)}
                        </span>
                      ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function RelationshipsTab({
  search,
  setSearch,
  riskFilter,
  setRiskFilter,
  reviewFilter,
  setReviewFilter,
  sortMode,
  setSortMode,
  rows,
  totalResults,
  page,
  totalPages,
  setPage,
  voterName,
  targetName,
  resolveCountry,
  byEntryKey,
  onOpen,
}: {
  search: string;
  setSearch: (value: string) => void;
  riskFilter: RiskFilter;
  setRiskFilter: (value: RiskFilter) => void;
  reviewFilter: string;
  setReviewFilter: (value: string) => void;
  sortMode: SortMode;
  setSortMode: (value: SortMode) => void;
  rows: ScopedFriendRelationship[];
  totalResults: number;
  page: number;
  totalPages: number;
  setPage: (value: number) => void;
  voterName: (identity: string) => string;
  targetName: (key: string) => string;
  resolveCountry: (identity: string) => any;
  byEntryKey: Map<string, any>;
  onOpen: (
    row: ScopedFriendRelationship,
  ) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="glass-strong rounded-3xl p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px]">
          <Input
            placeholder="Search delegation or target"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />

          <select
            className="min-h-11 rounded-xl border border-border bg-background/30 px-3 text-sm"
            value={reviewFilter}
            onChange={(event) =>
              setReviewFilter(
                event.target.value,
              )
            }
          >
            <option value="all">
              All review states
            </option>

            {REVIEW_STATUSES.map(
              (status) => (
                <option
                  key={status.value}
                  value={status.value}
                >
                  {status.label}
                </option>
              ),
            )}
          </select>

          <select
            className="min-h-11 rounded-xl border border-border bg-background/30 px-3 text-sm"
            value={sortMode}
            onChange={(event) =>
              setSortMode(
                event.target.value as SortMode,
              )
            }
          >
            <option value="risk">
              Highest risk
            </option>
            <option value="opportunities">
              Most opportunities
            </option>
            <option value="reciprocity">
              Highest reciprocity
            </option>
            <option value="history">
              Longest history
            </option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <FilterButton
            active={
              riskFilter === "attention"
            }
            onClick={() =>
              setRiskFilter("attention")
            }
          >
            Needs attention
          </FilterButton>

          <FilterButton
            active={riskFilter === "strong"}
            onClick={() =>
              setRiskFilter("strong")
            }
          >
            Risk 65+
          </FilterButton>

          <FilterButton
            active={riskFilter === "review"}
            onClick={() =>
              setRiskFilter("review")
            }
          >
            Risk 50+
          </FilterButton>

          <FilterButton
            active={
              riskFilter === "repeated"
            }
            onClick={() =>
              setRiskFilter("repeated")
            }
          >
            Repeated
          </FilterButton>

          <FilterButton
            active={riskFilter === "all"}
            onClick={() =>
              setRiskFilter("all")
            }
          >
            All
          </FilterButton>

          <span className="ml-auto self-center text-xs text-muted-foreground">
            {totalResults} result
            {totalResults === 1 ? "" : "s"}
          </span>
        </div>
      </section>

      {rows.length === 0 ? (
        <SmallEmpty text="No relationships match these filters." />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <RelationshipRow
              key={`${row.voting_country_code}>${row.target_country_code}`}
              row={row}
              voterName={voterName}
              targetName={targetName}
              resolveCountry={resolveCountry}
              targetEntry={byEntryKey.get(
                row.target_country_code,
              )}
              onOpen={() =>
                onOpen(row)
              }
            />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="glass flex items-center justify-between rounded-2xl p-2">
          <Button
            variant="ghost"
            disabled={page <= 1}
            onClick={() =>
              setPage(
                Math.max(1, page - 1),
              )
            }
          >
            Previous
          </Button>

          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>

          <Button
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() =>
              setPage(
                Math.min(
                  totalPages,
                  page + 1,
                ),
              )
            }
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function GroupsTab({
  groups,
  voterName,
}: {
  groups: any[];
  voterName: (identity: string) => string;
}) {
  if (groups.length === 0) {
    return (
      <SmallEmpty text="No friend-voting groups were detected in this scope." />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {groups
        .slice()
        .sort(
          (a, b) =>
            b.risk_score - a.risk_score,
        )
        .map((group, index) => (
          <section
            key={`${group.label}-${index}`}
            className="glass-strong rounded-3xl p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">
                  {group.label}
                </h3>

                <p className="mt-1 text-xs text-muted-foreground">
                  {group.members.length} delegations
                </p>
              </div>

              <RiskBadge
                score={group.risk_score}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-1">
              {group.members.map(
                (member: string) => (
                  <span
                    key={member}
                    className="rounded-full border border-border/60 px-2 py-1 text-[10px]"
                  >
                    {voterName(member)}
                  </span>
                ),
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric
                label="Editions"
                value={String(
                  group.editions_observed,
                )}
              />
              <Metric
                label="Rounds"
                value={String(
                  group.rounds_observed,
                )}
              />
              <Metric
                label="Internal max"
                value={`${Math.round(
                  group.internal_maximum_share *
                    100,
                )}%`}
              />
              <Metric
                label="Top-three"
                value={`${Math.round(
                  group.internal_top_three_share *
                    100,
                )}%`}
              />
            </div>
          </section>
        ))}
    </div>
  );
}

function HistoryTab({
  events,
  voterName,
  targetName,
}: {
  events: any[];
  voterName: (identity: string) => string;
  targetName: (key: string) => string;
}) {
  const [historyPage, setHistoryPage] =
    useState(1);

  const pageSize = 20;

  const totalPages = Math.max(
    1,
    Math.ceil(events.length / pageSize),
  );

  const safePage = Math.min(
    historyPage,
    totalPages,
  );

  const visible = events.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  if (events.length === 0) {
    return (
      <SmallEmpty text="No moderation history in this scope." />
    );
  }

  return (
    <div className="space-y-3">
      <section className="glass-strong overflow-x-auto rounded-3xl p-2">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">
                When
              </th>
              <th className="p-2 text-left">
                Voter
              </th>
              <th className="p-2 text-left">
                Target
              </th>
              <th className="p-2 text-left">
                Action
              </th>
              <th className="p-2 text-left">
                Note
              </th>
            </tr>
          </thead>

          <tbody>
            {visible.map(
              (event: any) => (
                <tr
                  key={event.id}
                  className="border-t border-border/50"
                >
                  <td className="whitespace-nowrap p-2 text-xs text-muted-foreground">
                    {new Date(
                      event.performed_at,
                    ).toLocaleString()}
                  </td>

                  <td className="p-2">
                    {voterName(
                      event.voting_country_code,
                    )}
                  </td>

                  <td className="p-2">
                    {event.target_country_code
                      ? targetName(
                          event.target_country_code,
                        )
                      : "—"}
                  </td>

                  <td className="p-2">
                    {event.action}
                  </td>

                  <td className="p-2 text-muted-foreground">
                    {event.moderator_note ??
                      "—"}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>

      {totalPages > 1 ? (
        <div className="glass flex items-center justify-between rounded-2xl p-2">
          <Button
            variant="ghost"
            disabled={safePage <= 1}
            onClick={() =>
              setHistoryPage(
                Math.max(
                  1,
                  safePage - 1,
                ),
              )
            }
          >
            Previous
          </Button>

          <span className="text-xs text-muted-foreground">
            Page {safePage} of {totalPages}
          </span>

          <Button
            variant="ghost"
            disabled={
              safePage >= totalPages
            }
            onClick={() =>
              setHistoryPage(
                Math.min(
                  totalPages,
                  safePage + 1,
                ),
              )
            }
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SettingsTab({
  afterSave,
}: {
  afterSave: () => void;
}) {
  const getSettings =
    useServerFn(
      getFriendVotingSettings,
    );

  const saveSettings =
    useServerFn(
      saveFriendVotingSettings,
    );

  const [draft, setDraft] =
    useState<FriendVotingSettings | null>(
      null,
    );

  const [message, setMessage] =
    useState("");

  const settingsQuery = useQuery({
    queryKey: [
      "friend-voting-settings-dashboard",
    ],
    queryFn: async () => {
      const value =
        (await getSettings()) as FriendVotingSettings;

      setDraft(value);
      return value;
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      saveSettings({
        data: {
          settings: draft!,
        },
      }),

    onSuccess: () => {
      setMessage("Settings saved.");
      afterSave();
    },

    onError: (error: any) => {
      setMessage(
        error?.message ??
          "Could not save settings.",
      );
    },
  });

  if (
    settingsQuery.isLoading ||
    !draft
  ) {
    return (
      <StatusPanel text="Loading settings…" />
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Core thresholds"
        subtitle="These change the scoring engine, not just this screen."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Minimum opportunities"
            value={draft.minOpportunities}
            onChange={(value) =>
              setDraft({
                ...draft,
                minOpportunities: value,
              })
            }
          />

          <NumberField
            label="Support frequency"
            value={
              draft.supportFrequencyThreshold
            }
            step={0.05}
            onChange={(value) =>
              setDraft({
                ...draft,
                supportFrequencyThreshold:
                  value,
              })
            }
          />

          <NumberField
            label="Top-three threshold"
            value={draft.topThreeThreshold}
            step={0.05}
            onChange={(value) =>
              setDraft({
                ...draft,
                topThreeThreshold: value,
              })
            }
          />

          <NumberField
            label="Maximum threshold"
            value={
              draft.maximumScoreThreshold
            }
            step={0.05}
            onChange={(value) =>
              setDraft({
                ...draft,
                maximumScoreThreshold:
                  value,
              })
            }
          />

          <NumberField
            label="Preference lift"
            value={
              draft.preferenceLiftThreshold
            }
            step={0.1}
            onChange={(value) =>
              setDraft({
                ...draft,
                preferenceLiftThreshold:
                  value,
              })
            }
          />

          <NumberField
            label="Audience uplift"
            value={
              draft.audienceUpliftThreshold
            }
            step={0.1}
            onChange={(value) =>
              setDraft({
                ...draft,
                audienceUpliftThreshold:
                  value,
              })
            }
          />

          <NumberField
            label="Minimum editions"
            value={draft.minEditions}
            onChange={(value) =>
              setDraft({
                ...draft,
                minEditions: value,
              })
            }
          />

          <NumberField
            label="Streak threshold"
            value={draft.streakThreshold}
            onChange={(value) =>
              setDraft({
                ...draft,
                streakThreshold: value,
              })
            }
          />

          <NumberField
            label="Small-sample penalty"
            value={
              draft.smallSamplePenalty
            }
            onChange={(value) =>
              setDraft({
                ...draft,
                smallSamplePenalty: value,
              })
            }
          />

          <NumberField
            label="Group internal share"
            value={
              draft.cliqueInternalShareThreshold
            }
            step={0.05}
            onChange={(value) =>
              setDraft({
                ...draft,
                cliqueInternalShareThreshold:
                  value,
              })
            }
          />

          <NumberField
            label="Group minimum edge risk"
            value={
              draft.cliqueMinEdgeRisk
            }
            onChange={(value) =>
              setDraft({
                ...draft,
                cliqueMinEdgeRisk: value,
              })
            }
          />
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={
              draft.ignoreTestBallots
            }
            onChange={(event) =>
              setDraft({
                ...draft,
                ignoreTestBallots:
                  event.target.checked,
              })
            }
          />

          Exclude test / administrative deletions
        </label>
      </Panel>

      <Panel
        title="Signal weights"
        subtitle="How strongly each signal contributes to risk."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(
            draft.weights,
          ).map(([key, value]) => (
            <NumberField
              key={key}
              label={humanize(key)}
              value={Number(value)}
              onChange={(next) =>
                setDraft({
                  ...draft,
                  weights: {
                    ...draft.weights,
                    [key]: next,
                  },
                })
              }
            />
          ))}
        </div>
      </Panel>

      <Panel
        title="Risk bands"
        subtitle="Thresholds used for Notable, Review, Strong, Highly and Critical."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(
            draft.riskBands,
          ).map(([key, value]) => (
            <NumberField
              key={key}
              label={humanize(key)}
              value={Number(value)}
              onChange={(next) =>
                setDraft({
                  ...draft,
                  riskBands: {
                    ...draft.riskBands,
                    [key]: next,
                  },
                })
              }
            />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            disabled={
              saveMutation.isPending
            }
            onClick={() =>
              saveMutation.mutate()
            }
          >
            {saveMutation.isPending
              ? "Saving…"
              : "Save settings"}
          </Button>

          {message ? (
            <span className="text-sm text-muted-foreground">
              {message}
            </span>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function CompactList({
  rows,
  voterName,
  targetName,
  resolveCountry,
  byEntryKey,
  onOpen,
  showHistory = false,
  showReciprocity = false,
  empty,
}: {
  rows: ScopedFriendRelationship[];
  voterName: (identity: string) => string;
  targetName: (key: string) => string;
  resolveCountry: (identity: string) => any;
  byEntryKey: Map<string, any>;
  onOpen: (
    row: ScopedFriendRelationship,
  ) => void;
  showHistory?: boolean;
  showReciprocity?: boolean;
  empty: string;
}) {
  if (rows.length === 0) {
    return <SmallEmpty text={empty} />;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <button
          key={`${row.voting_country_code}>${row.target_country_code}`}
          type="button"
          onClick={() =>
            onOpen(row)
          }
          className="w-full rounded-2xl border border-border/60 bg-card/20 p-3 text-left"
        >
          <div className="flex items-center gap-2">
            <CountryFlag
              country={resolveCountry(
                row.voting_country_code,
              )}
              size={20}
            />

            <span className="min-w-0 flex-1 truncate font-medium">
              {voterName(
                row.voting_country_code,
              )}
            </span>

            <span className="text-muted-foreground">
              →
            </span>

            <EntryAvatar
              entry={byEntryKey.get(
                row.target_country_code,
              )}
              size={20}
            />

            <span className="min-w-0 flex-1 truncate">
              {targetName(
                row.target_country_code,
              )}
            </span>

            <RiskBadge
              score={row.risk_score}
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              {row.support_count}/
              {row.shared_opportunities} support
            </span>

            <span>
              {row.maximum_score_count} maximum
              {row.maximum_score_count === 1
                ? ""
                : "s"}
            </span>

            {showHistory ? (
              <span>
                {row.editions_count} editions ·{" "}
                {row.rounds_count} rounds
              </span>
            ) : null}

            {showReciprocity ? (
              <span>
                reciprocity{" "}
                {row.reciprocity_score.toFixed(
                  2,
                )}
              </span>
            ) : null}
          </div>
        </button>
      ))}
    </div>
  );
}

function RelationshipRow({
  row,
  voterName,
  targetName,
  resolveCountry,
  targetEntry,
  onOpen,
}: {
  row: ScopedFriendRelationship;
  voterName: (identity: string) => string;
  targetName: (key: string) => string;
  resolveCountry: (identity: string) => any;
  targetEntry: any;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-strong w-full rounded-2xl p-3.5 text-left"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CountryFlag
          country={resolveCountry(
            row.voting_country_code,
          )}
          size={22}
        />

        <span className="font-semibold">
          {voterName(
            row.voting_country_code,
          )}
        </span>

        <span className="text-muted-foreground">
          →
        </span>

        <EntryAvatar
          entry={targetEntry}
          size={22}
        />

        <span>
          {targetName(
            row.target_country_code,
          )}
        </span>

        <div className="ml-auto">
          <RiskBadge
            score={row.risk_score}
            withName
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label="Support"
          value={`${Math.round(
            row.support_frequency * 100,
          )}%`}
        />

        <Metric
          label="Maximums"
          value={`${row.maximum_score_count}/${row.shared_opportunities}`}
        />

        <Metric
          label="Average"
          value={row.average_points.toFixed(
            1,
          )}
        />

        <Metric
          label="Lift"
          value={`${row.preference_lift.toFixed(
            2,
          )}×`}
        />

        <Metric
          label="Reciprocity"
          value={row.reciprocity_score.toFixed(
            2,
          )}
        />

        <Metric
          label="History"
          value={`${row.editions_count}E · ${row.rounds_count}R`}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {row.repeated_after_moderation ? (
          <span className="rounded-full border border-red-400/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-200">
            repeated after moderation
          </span>
        ) : null}

        {row.review_status !== "new" ? (
          <span className="rounded-full border border-border/60 px-2 py-1 text-[10px] text-muted-foreground">
            {row.review_status.replace(
              /_/g,
              " ",
            )}
          </span>
        ) : null}

        <span className="ml-auto text-xs text-muted-foreground">
          Open details
        </span>
      </div>
    </button>
  );
}

function RelationshipModal({
  relationship,
  voterName,
  targetName,
  resolveCountry,
  targetEntry,
  onClose,
  afterReview,
}: {
  relationship: ScopedFriendRelationship;
  voterName: (identity: string) => string;
  targetName: (key: string) => string;
  resolveCountry: (identity: string) => any;
  targetEntry: any;
  onClose: () => void;
  afterReview: () => void;
}) {
  const reviewFn =
    useServerFn(
      setRelationshipReview,
    );

  const [status, setStatus] =
    useState(
      relationship.review_status === "new"
        ? "under_review"
        : relationship.review_status,
    );

  const [note, setNote] =
    useState(
      relationship.moderator_note ?? "",
    );

  const [message, setMessage] =
    useState("");

  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!relationship.id) {
        throw new Error(
          "This scoped relationship does not have a stored review row yet.",
        );
      }

      return reviewFn({
        data: {
          id: relationship.id,
          status,
          note,
        },
      });
    },

    onSuccess: () => {
      afterReview();
    },

    onError: (error: any) => {
      setMessage(
        error?.message ??
          "Could not save review.",
      );
    },
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close relationship details"
        className="absolute inset-0"
        onClick={onClose}
      />

      <section className="glass-strong relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-[28px] p-4 sm:rounded-[28px] sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CountryFlag
                country={resolveCountry(
                  relationship.voting_country_code,
                )}
                size={22}
              />

              <span className="font-semibold">
                {voterName(
                  relationship.voting_country_code,
                )}
              </span>

              <span className="text-muted-foreground">
                →
              </span>

              <EntryAvatar
                entry={targetEntry}
                size={22}
              />

              <span>
                {targetName(
                  relationship.target_country_code,
                )}
              </span>
            </div>

            <div className="mt-2">
              <RiskBadge
                score={
                  relationship.risk_score
                }
                withName
              />
            </div>
          </div>

          <Button
            variant="ghost"
            onClick={onClose}
          >
            Close
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="Opportunities"
            value={String(
              relationship.shared_opportunities,
            )}
          />
          <Metric
            label="Support"
            value={`${Math.round(
              relationship.support_frequency *
                100,
            )}%`}
          />
          <Metric
            label="Maximums"
            value={String(
              relationship.maximum_score_count,
            )}
          />
          <Metric
            label="Avg points"
            value={relationship.average_points.toFixed(
              2,
            )}
          />
          <Metric
            label="Preference lift"
            value={`${relationship.preference_lift.toFixed(
              2,
            )}×`}
          />
          <Metric
            label="Audience uplift"
            value={relationship.audience_uplift.toFixed(
              2,
            )}
          />
          <Metric
            label="Reciprocity"
            value={relationship.reciprocity_score.toFixed(
              2,
            )}
          />
          <Metric
            label="Longest streak"
            value={String(
              relationship.longest_support_streak,
            )}
          />
        </div>

        <div className="mt-5">
          <h3 className="text-xs uppercase tracking-widest text-primary">
            Why this score
          </h3>

          <div className="mt-2 space-y-2">
            {relationship.reasons.length === 0 ? (
              <SmallEmpty text="No specific risk contributions." />
            ) : (
              relationship.reasons.map(
                (reason, index) => (
                  <div
                    key={index}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-card/20 p-3"
                  >
                    <span className="text-sm">
                      {reason.text}
                    </span>

                    <span className="font-semibold tabular-nums text-amber-200">
                      {reason.delta > 0
                        ? "+"
                        : ""}
                      {reason.delta}
                    </span>
                  </div>
                ),
              )
            )}
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-xs uppercase tracking-widest text-primary">
            Timeline
          </h3>

          <div className="mt-2 max-h-64 overflow-auto rounded-2xl border border-border/60">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="sticky top-0 bg-background/90 text-muted-foreground backdrop-blur">
                <tr>
                  <th className="p-2 text-left">
                    Edition
                  </th>
                  <th className="p-2 text-left">
                    Round
                  </th>
                  <th className="p-2 text-right">
                    Points
                  </th>
                  <th className="p-2 text-right">
                    Rank
                  </th>
                  <th className="p-2 text-right">
                    Audience
                  </th>
                </tr>
              </thead>

              <tbody>
                {relationship.timeline.map(
                  (item, index) => (
                    <tr
                      key={`${item.roundId}-${index}`}
                      className="border-t border-border/50"
                    >
                      <td className="p-2">
                        {item.editionName}
                      </td>
                      <td className="p-2">
                        {item.roundName}
                      </td>
                      <td className="p-2 text-right font-semibold">
                        {item.points}
                      </td>
                      <td className="p-2 text-right">
                        {item.ballotRank ?? "—"}
                      </td>
                      <td className="p-2 text-right">
                        {item.audienceAverage}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 border-t border-border/60 pt-4">
          <h3 className="text-xs uppercase tracking-widest text-primary">
            Review
          </h3>

          {!relationship.id ? (
            <p className="mt-2 text-xs text-amber-200">
              This scoped pair does not yet have a stored relationship row, so
              it can be inspected but not reviewed until the historical cache
              contains this pair.
            </p>
          ) : null}

          <div className="mt-3 grid gap-3">
            <select
              className="min-h-11 rounded-xl border border-border bg-background/30 px-3 text-sm"
              value={status}
              onChange={(event) =>
                setStatus(
                  event.target.value,
                )
              }
            >
              {REVIEW_STATUSES.map(
                (item) => (
                  <option
                    key={item.value}
                    value={item.value}
                  >
                    {item.label}
                  </option>
                ),
              )}
            </select>

            <textarea
              className="min-h-24 rounded-xl border border-border bg-background/30 p-3 text-sm"
              placeholder="Moderator note"
              value={note}
              onChange={(event) =>
                setNote(
                  event.target.value,
                )
              }
            />

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={
                  !relationship.id ||
                  reviewMutation.isPending
                }
                onClick={() =>
                  reviewMutation.mutate()
                }
              >
                {reviewMutation.isPending
                  ? "Saving…"
                  : "Save review"}
              </Button>

              {message ? (
                <span className="text-sm text-red-200">
                  {message}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="glass-strong rounded-3xl p-4 sm:p-5">
      <h3 className="font-semibold">
        {title}
      </h3>

      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {subtitle}
      </p>

      <div className="mt-4">
        {children}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: number;
  tone?: "normal" | "warn" | "danger";
}) {
  return (
    <div
      className={`glass-strong rounded-2xl p-3 ${
        tone === "danger"
          ? "ring-1 ring-red-400/30"
          : tone === "warn"
            ? "ring-1 ring-amber-400/25"
            : ""
      }`}
    >
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>

      <p
        className={`mt-1 text-2xl font-semibold ${
          tone === "danger"
            ? "text-red-200"
            : tone === "warn"
              ? "text-amber-200"
              : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 shrink-0 rounded-xl px-3 text-sm font-medium ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3 text-xs font-medium ${
        active
          ? "border-primary/45 bg-primary/15 text-primary"
          : "border-border/60 bg-card/20 text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function RiskBadge({
  score,
  withName = false,
}: {
  score: number;
  withName?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[11px] font-semibold tabular-nums ${riskTone(
        score,
      )}`}
    >
      {score}
      {withName
        ? ` · ${riskName(score)}`
        : ""}
    </span>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/10 p-2">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function NumberField({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs text-muted-foreground">
        {label}
      </span>

      <input
        type="number"
        step={step}
        value={String(value)}
        onChange={(event) =>
          onChange(
            Number(event.target.value),
          )
        }
        className="min-h-11 w-full rounded-xl border border-border bg-background/30 px-3 text-sm"
      />
    </label>
  );
}

function SmallEmpty({
  text,
}: {
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function StatusPanel({
  text,
}: {
  text: string;
}) {
  return (
    <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function ErrorPanel({
  text,
}: {
  text: string;
}) {
  return (
    <div className="glass rounded-2xl border border-red-400/30 p-8 text-center">
      <p className="font-semibold text-red-200">
        Friend-voting page could not load
      </p>

      <p className="mt-2 text-sm text-muted-foreground">
        {text}
      </p>
    </div>
  );
}

function humanize(value: string) {
  return value
    .replace(
      /([a-z])([A-Z])/g,
      "$1 $2",
    )
    .replace(/_/g, " ")
    .replace(/^./, (letter) =>
      letter.toUpperCase(),
    );
}
