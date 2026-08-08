import { createFileRoute } from "@tanstack/react-router";
import {
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Heart,
  History,
  Inbox,
  Loader2,
  RefreshCcw,
  Search,
  ShieldAlert,
  Sliders,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { AnalysisScopePicker } from "@/components/analysis-scope-picker";
import { CountryFlag } from "@/components/country-flag";
import { EntryAvatar } from "@/components/entry-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
import { downloadCSV } from "@/lib/export";
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

const REVIEW_STATUSES = [
  { value: "new", label: "New" },
  { value: "under_review", label: "Under review" },
  { value: "watchlist", label: "Watchlist" },
  { value: "confirmed", label: "Confirmed friend voting" },
  { value: "legitimate", label: "Legitimate" },
  { value: "dismissed", label: "Dismissed" },
];

const PAGE_SIZE = 18;

type SortMode =
  | "risk"
  | "opportunities"
  | "reciprocity"
  | "recent";

type PresetFilter =
  | "attention"
  | "65plus"
  | "50plus"
  | "repeated"
  | "all";

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function riskClass(score: number) {
  if (score >= 90) {
    return "bg-red-500/20 text-red-300 border-red-400/35";
  }

  if (score >= 80) {
    return "bg-orange-500/20 text-orange-300 border-orange-400/35";
  }

  if (score >= 65) {
    return "bg-amber-500/20 text-amber-300 border-amber-400/35";
  }

  if (score >= 50) {
    return "bg-cyan-500/15 text-cyan-200 border-cyan-300/30";
  }

  if (score >= 30) {
    return "bg-primary/15 text-primary border-primary/30";
  }

  return "bg-muted/50 text-muted-foreground border-border";
}

function riskLabel(score: number) {
  if (score >= 90) return "Critical";
  if (score >= 80) return "Highly suspicious";
  if (score >= 65) return "Strong";
  if (score >= 50) return "Review";
  if (score >= 30) return "Notable";
  return "Normal";
}

function FriendVotingPage() {
  const scopedFn = useServerFn(getScopedFriendVotingAnalysis);
  const { data: countries = [] } = useAllCountries();

  const [scope, setScope] =
    useState<AnalysisScope>(DEFAULT_ANALYSIS_SCOPE);

  const [search, setSearch] = useState("");
  const [preset, setPreset] =
    useState<PresetFilter>("attention");
  const [reviewStatus, setReviewStatus] =
    useState("all");
  const [sortMode, setSortMode] =
    useState<SortMode>("risk");
  const [page, setPage] = useState(1);

  const [selected, setSelected] =
    useState<ScopedFriendRelationship | null>(null);

  const scoped = useQuery({
    queryKey: [
      "scoped-friend-voting-redesign",
      analysisScopeKey(scope),
    ],
    queryFn: () =>
      scopedFn({
        data: { scope },
      }),
  });

  const relationships = scoped.data?.relationships ?? [];
  const groups = scoped.data?.groups ?? [];
  const moderationEvents =
    scoped.data?.moderationEvents ?? [];

  const targetKeys = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...relationships.map(
              (row) => row.target_country_code,
            ),
            ...moderationEvents
              .map(
                (event: any) =>
                  event.target_country_code,
              )
              .filter(Boolean),
          ].filter(Boolean),
        ),
      ),
    [relationships, moderationEvents],
  );

  const { data: targetEntries = [] } =
    useEntryKeyCatalog(targetKeys);

  const byEntryKey = useMemo(
    () => entryMap(targetEntries),
    [targetEntries],
  );

  const countryLookup = useMemo(() => {
    const map = new Map<string, any>();

    for (const country of countries) {
      map.set(normalizeIdentity(country.code), country);
      map.set(normalizeIdentity(country.name), country);
    }

    return map;
  }, [countries]);

  const resolveCountry = (
    identity: string | null | undefined,
  ) =>
    countryLookup.get(normalizeIdentity(identity)) ?? null;

  const voterName = (identity: string) =>
    resolveCountry(identity)?.name ?? identity;

  const targetName = (entryKey: string) => {
    const entry = byEntryKey.get(entryKey);

    if (entry) return getEntryDisplayName(entry);

    return resolveCountry(entryKey)?.name ?? entryKey;
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const rows = relationships.filter((row) => {
      if (
        reviewStatus !== "all" &&
        row.review_status !== reviewStatus
      ) {
        return false;
      }

      if (preset === "attention") {
        if (row.risk_score < 30) return false;

        if (
          row.review_status === "legitimate" ||
          row.review_status === "dismissed"
        ) {
          return false;
        }
      }

      if (preset === "65plus" && row.risk_score < 65) {
        return false;
      }

      if (preset === "50plus" && row.risk_score < 50) {
        return false;
      }

      if (
        preset === "repeated" &&
        !row.repeated_after_moderation
      ) {
        return false;
      }

      if (needle) {
        const haystack = [
          row.voting_country_code,
          voterName(row.voting_country_code),
          row.target_country_code,
          targetName(row.target_country_code),
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
    });

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

      if (sortMode === "recent") {
        const aTime =
          a.timeline.at(-1)?.createdAt ?? "";
        const bTime =
          b.timeline.at(-1)?.createdAt ?? "";

        return (
          bTime.localeCompare(aTime) ||
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
    preset,
    reviewStatus,
    sortMode,
    countryLookup,
    byEntryKey,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / PAGE_SIZE),
  );

  const safePage = Math.min(page, totalPages);

  const visibleRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const summary = useMemo(() => {
    const attention = relationships.filter(
      (row) =>
        row.risk_score >= 30 &&
        row.review_status !== "legitimate" &&
        row.review_status !== "dismissed",
    );

    return {
      relationships: relationships.length,
      attention: attention.length,
      strong: relationships.filter(
        (row) => row.risk_score >= 65,
      ).length,
      critical: relationships.filter(
        (row) => row.risk_score >= 80,
      ).length,
      repeated: relationships.filter(
        (row) => row.repeated_after_moderation,
      ).length,
      reviewed: relationships.filter(
        (row) =>
          row.review_status !== "new" &&
          row.review_status !==
            "under_review",
      ).length,
    };
  }, [relationships]);

  const priorityRows = useMemo(
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
        .slice(0, 8),
    [relationships],
  );

  const persistentRows = useMemo(
    () =>
      relationships
        .filter(
          (row) =>
            row.editions_count >= 2 &&
            row.support_count > 0,
        )
        .sort(
          (a, b) =>
            b.editions_count - a.editions_count ||
            b.risk_score - a.risk_score,
        )
        .slice(0, 8),
    [relationships],
  );

  const reciprocalRows = useMemo(
    () =>
      relationships
        .filter(
          (row) => row.reciprocity_score >= 0.5,
        )
        .sort(
          (a, b) =>
            b.reciprocity_score -
              a.reciprocity_score ||
            b.risk_score - a.risk_score,
        )
        .slice(0, 8),
    [relationships],
  );

  const exportRows = () =>
    filtered.map((row) => ({
      voting_country_code:
        row.voting_country_code,
      voting_country: voterName(
        row.voting_country_code,
      ),
      target_entry_key:
        row.target_country_code,
      target_entry: targetName(
        row.target_country_code,
      ),
      opportunities:
        row.shared_opportunities,
      support_count: row.support_count,
      support_frequency:
        row.support_frequency,
      max_scores:
        row.maximum_score_count,
      avg_points: row.average_points,
      preference_lift:
        row.preference_lift,
      audience_uplift:
        row.audience_uplift,
      reciprocity:
        row.reciprocity_score,
      editions:
        row.editions_count,
      rounds:
        row.rounds_count,
      repeated_after_moderation:
        row.repeated_after_moderation,
      risk: row.risk_score,
      risk_label: row.risk_label,
      review_status:
        row.review_status,
    }));

  const changePreset = (
    next: PresetFilter,
  ) => {
    setPreset(next);
    setPage(1);
  };

  return (
    <AdminShell title="Friend-Voting Analysis">
      <div className="space-y-6 pb-10">
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
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">
                  Relationship intelligence
                </h2>
              </div>

              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                One voting country is one permanent delegation identity.
                This page ranks recurring voter-country → target-entry
                relationships so you can investigate patterns instead of
                scrolling through every possible pair.
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
              onClick={() => scoped.refetch()}
              disabled={scoped.isFetching}
            >
              <RefreshCcw
                className={
                  scoped.isFetching
                    ? "h-4 w-4 animate-spin"
                    : "h-4 w-4"
                }
              />
              Refresh
            </Button>
          </div>
        </section>

        {scoped.isLoading ? (
          <Loading />
        ) : scoped.error ? (
          <Empty
            title="Friend-voting analysis failed"
            body={
              scoped.error instanceof Error
                ? scoped.error.message
                : "Unknown analysis error"
            }
          />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <SummaryCard
                label="Needs attention"
                value={summary.attention}
                tone="warn"
              />
              <SummaryCard
                label="Strong 65+"
                value={summary.strong}
                tone={
                  summary.strong > 0
                    ? "warn"
                    : "normal"
                }
              />
              <SummaryCard
                label="Highly 80+"
                value={summary.critical}
                tone={
                  summary.critical > 0
                    ? "danger"
                    : "normal"
                }
              />
              <SummaryCard
                label="Repeated"
                value={summary.repeated}
                tone={
                  summary.repeated > 0
                    ? "danger"
                    : "normal"
                }
              />
              <SummaryCard
                label="Reviewed"
                value={summary.reviewed}
              />
              <SummaryCard
                label="All pairs"
                value={summary.relationships}
              />
            </section>

            <Tabs defaultValue="overview">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="overview">
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  Overview
                </TabsTrigger>

                <TabsTrigger value="relationships">
                  <Heart className="mr-1.5 h-4 w-4" />
                  Relationships
                </TabsTrigger>

                <TabsTrigger value="groups">
                  <Users className="mr-1.5 h-4 w-4" />
                  Groups
                </TabsTrigger>

                <TabsTrigger value="history">
                  <History className="mr-1.5 h-4 w-4" />
                  History
                </TabsTrigger>

                <TabsTrigger value="settings">
                  <Sliders className="mr-1.5 h-4 w-4" />
                  Settings
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="overview"
                className="mt-5 space-y-6"
              >
                <section className="grid gap-6 xl:grid-cols-2">
                  <DashboardPanel
                    title="Review queue"
                    subtitle="Highest-risk relationships that are not already dismissed or marked legitimate."
                    icon={Inbox}
                  >
                    <CompactRelationshipList
                      rows={priorityRows}
                      onOpen={setSelected}
                      voterName={voterName}
                      targetName={targetName}
                      resolveCountry={resolveCountry}
                      byEntryKey={byEntryKey}
                      empty="Nothing currently needs urgent review."
                    />
                  </DashboardPanel>

                  <DashboardPanel
                    title="Persistent across editions"
                    subtitle="Relationships surviving across multiple editions are more useful than one-off loyalty."
                    icon={History}
                  >
                    <CompactRelationshipList
                      rows={persistentRows}
                      onOpen={setSelected}
                      voterName={voterName}
                      targetName={targetName}
                      resolveCountry={resolveCountry}
                      byEntryKey={byEntryKey}
                      showPersistence
                      empty="No multi-edition patterns in this scope."
                    />
                  </DashboardPanel>
                </section>

                <section className="grid gap-6 xl:grid-cols-2">
                  <DashboardPanel
                    title="Strong reciprocity"
                    subtitle="Pairs where the reverse relationship is also strong enough to matter."
                    icon={ArrowRight}
                  >
                    <CompactRelationshipList
                      rows={reciprocalRows}
                      onOpen={setSelected}
                      voterName={voterName}
                      targetName={targetName}
                      resolveCountry={resolveCountry}
                      byEntryKey={byEntryKey}
                      showReciprocity
                      empty="No strong reciprocal patterns in this scope."
                    />
                  </DashboardPanel>

                  <DashboardPanel
                    title="Friend groups"
                    subtitle="Only the highest-risk detected groups are surfaced here. Full details remain in the Groups tab."
                    icon={Users}
                  >
                    {groups.length === 0 ? (
                      <TinyEmpty text="No friend groups detected." />
                    ) : (
                      <div className="space-y-2">
                        {groups
                          .slice()
                          .sort(
                            (a, b) =>
                              b.risk_score -
                              a.risk_score,
                          )
                          .slice(0, 6)
                          .map((group, index) => (
                            <div
                              key={`${group.label}:${index}`}
                              className="rounded-2xl border border-border/55 bg-card/20 p-3"
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

                                <Badge
                                  variant="outline"
                                  className={riskClass(
                                    group.risk_score,
                                  )}
                                >
                                  {group.risk_score}
                                </Badge>
                              </div>

                              <div className="mt-2 flex flex-wrap gap-1">
                                {group.members
                                  .slice(0, 6)
                                  .map((member) => (
                                    <Badge
                                      key={member}
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      {voterName(member)}
                                    </Badge>
                                  ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </DashboardPanel>
                </section>
              </TabsContent>

              <TabsContent
                value="relationships"
                className="mt-5 space-y-4"
              >
                <section className="glass-strong rounded-3xl p-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                      <Input
                        className="pl-9"
                        placeholder="Search delegation or target"
                        value={search}
                        onChange={(event) => {
                          setSearch(
                            event.target.value,
                          );
                          setPage(1);
                        }}
                      />
                    </div>

                    <Select
                      value={reviewStatus}
                      onValueChange={(value) => {
                        setReviewStatus(value);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="all">
                          All review states
                        </SelectItem>

                        {REVIEW_STATUSES.map(
                          (item) => (
                            <SelectItem
                              key={item.value}
                              value={item.value}
                            >
                              {item.label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>

                    <Select
                      value={sortMode}
                      onValueChange={(value) => {
                        setSortMode(
                          value as SortMode,
                        );
                        setPage(1);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="risk">
                          Highest risk
                        </SelectItem>
                        <SelectItem value="opportunities">
                          Most opportunities
                        </SelectItem>
                        <SelectItem value="reciprocity">
                          Highest reciprocity
                        </SelectItem>
                        <SelectItem value="recent">
                          Most recent
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <FilterChip
                      active={preset === "attention"}
                      onClick={() =>
                        changePreset("attention")
                      }
                    >
                      Needs attention
                    </FilterChip>

                    <FilterChip
                      active={preset === "65plus"}
                      onClick={() =>
                        changePreset("65plus")
                      }
                    >
                      Risk 65+
                    </FilterChip>

                    <FilterChip
                      active={preset === "50plus"}
                      onClick={() =>
                        changePreset("50plus")
                      }
                    >
                      Risk 50+
                    </FilterChip>

                    <FilterChip
                      active={preset === "repeated"}
                      onClick={() =>
                        changePreset("repeated")
                      }
                    >
                      Repeated
                    </FilterChip>

                    <FilterChip
                      active={preset === "all"}
                      onClick={() =>
                        changePreset("all")
                      }
                    >
                      All
                    </FilterChip>

                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {filtered.length} result
                        {filtered.length === 1
                          ? ""
                          : "s"}
                      </span>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={filtered.length === 0}
                        onClick={() =>
                          downloadCSV(
                            `friend-voting-${analysisScopeKey(
                              scope,
                            )}.csv`,
                            exportRows(),
                          )
                        }
                      >
                        <Download className="h-4 w-4" />
                        CSV
                      </Button>
                    </div>
                  </div>
                </section>

                {visibleRows.length === 0 ? (
                  <Empty
                    title="No matching relationships"
                    body="Change the filters or selected analysis period."
                  />
                ) : (
                  <div className="space-y-2">
                    {visibleRows.map((row) => (
                      <RelationshipCard
                        key={`${row.voting_country_code}>${row.target_country_code}`}
                        row={row}
                        onOpen={() =>
                          setSelected(row)
                        }
                        voterName={voterName}
                        targetName={targetName}
                        resolveCountry={resolveCountry}
                        targetEntry={byEntryKey.get(
                          row.target_country_code,
                        )}
                      />
                    ))}
                  </div>
                )}

                {filtered.length > PAGE_SIZE ? (
                  <div className="glass flex items-center justify-between rounded-2xl px-3 py-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={safePage <= 1}
                      onClick={() =>
                        setPage((value) =>
                          Math.max(
                            1,
                            value - 1,
                          ),
                        )
                      }
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>

                    <span className="text-xs text-muted-foreground">
                      Page {safePage} of {totalPages}
                    </span>

                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        safePage >= totalPages
                      }
                      onClick={() =>
                        setPage((value) =>
                          Math.min(
                            totalPages,
                            value + 1,
                          ),
                        )
                      }
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent
                value="groups"
                className="mt-5"
              >
                {groups.length === 0 ? (
                  <Empty
                    title="No friend groups"
                    body="No multi-delegation friend-voting groups were detected in this scope."
                  />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {groups
                      .slice()
                      .sort(
                        (a, b) =>
                          b.risk_score -
                          a.risk_score,
                      )
                      .map((group, index) => (
                        <section
                          key={`${group.label}:${index}`}
                          className="glass-strong rounded-3xl p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="font-semibold">
                                {group.label}
                              </h3>

                              <p className="mt-1 text-xs text-muted-foreground">
                                {group.risk_label}
                              </p>
                            </div>

                            <Badge
                              variant="outline"
                              className={riskClass(
                                group.risk_score,
                              )}
                            >
                              {group.risk_score}
                            </Badge>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {group.members.map(
                              (member) => (
                                <Badge
                                  key={member}
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {voterName(member)}
                                </Badge>
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
                )}
              </TabsContent>

              <TabsContent
                value="history"
                className="mt-5"
              >
                <ModerationHistory
                  rows={moderationEvents}
                  voterName={voterName}
                  targetName={targetName}
                />
              </TabsContent>

              <TabsContent
                value="settings"
                className="mt-5"
              >
                <SettingsPanel
                  onSaved={() =>
                    scoped.refetch()
                  }
                />
              </TabsContent>
            </Tabs>
          </>
        )}

        <RelationshipDialog
          relationship={selected}
          onClose={() => setSelected(null)}
          voterName={voterName}
          targetName={targetName}
          resolveCountry={resolveCountry}
          byEntryKey={byEntryKey}
          onReviewed={() => scoped.refetch()}
        />
      </div>
    </AdminShell>
  );
}

function SummaryCard({
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
      className={`glass-strong rounded-2xl p-3.5 ${
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
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "danger"
            ? "text-red-300"
            : tone === "warn"
              ? "text-amber-300"
              : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DashboardPanel({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle: string;
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

        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      </header>

      {children}
    </section>
  );
}

function CompactRelationshipList({
  rows,
  onOpen,
  voterName,
  targetName,
  resolveCountry,
  byEntryKey,
  showPersistence = false,
  showReciprocity = false,
  empty,
}: {
  rows: ScopedFriendRelationship[];
  onOpen: (row: ScopedFriendRelationship) => void;
  voterName: (identity: string) => string;
  targetName: (key: string) => string;
  resolveCountry: (identity: string) => any;
  byEntryKey: Map<string, any>;
  showPersistence?: boolean;
  showReciprocity?: boolean;
  empty: string;
}) {
  if (rows.length === 0) {
    return <TinyEmpty text={empty} />;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <button
          type="button"
          key={`${row.voting_country_code}>${row.target_country_code}`}
          onClick={() => onOpen(row)}
          className="w-full rounded-2xl border border-border/55 bg-card/20 p-3 text-left transition hover:bg-card/35"
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

            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

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

            <Badge
              variant="outline"
              className={riskClass(
                row.risk_score,
              )}
            >
              {row.risk_score}
            </Badge>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              {row.support_count}/
              {row.shared_opportunities} supported
            </span>

            <span>
              {row.maximum_score_count} maximums
            </span>

            {showPersistence ? (
              <span>
                {row.editions_count} editions ·{" "}
                {row.rounds_count} rounds
              </span>
            ) : null}

            {showReciprocity ? (
              <span>
                reciprocity{" "}
                {row.reciprocity_score.toFixed(2)}
              </span>
            ) : null}
          </div>
        </button>
      ))}
    </div>
  );
}

function RelationshipCard({
  row,
  onOpen,
  voterName,
  targetName,
  resolveCountry,
  targetEntry,
}: {
  row: ScopedFriendRelationship;
  onOpen: () => void;
  voterName: (identity: string) => string;
  targetName: (key: string) => string;
  resolveCountry: (identity: string) => any;
  targetEntry: any;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-strong w-full rounded-2xl p-3.5 text-left transition hover:ring-1 hover:ring-primary/25"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <CountryFlag
            country={resolveCountry(
              row.voting_country_code,
            )}
            size={22}
          />

          <span className="min-w-0 truncate font-semibold">
            {voterName(
              row.voting_country_code,
            )}
          </span>

          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />

          <EntryAvatar
            entry={targetEntry}
            size={22}
          />

          <span className="min-w-0 truncate">
            {targetName(
              row.target_country_code,
            )}
          </span>
        </div>

        <Badge
          variant="outline"
          className={`shrink-0 ${riskClass(
            row.risk_score,
          )}`}
        >
          {row.risk_score} ·{" "}
          {riskLabel(row.risk_score)}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
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
          label="Avg points"
          value={row.average_points.toFixed(1)}
        />
        <Metric
          label="Lift"
          value={`${row.preference_lift.toFixed(2)}×`}
        />
        <Metric
          label="Reciprocity"
          value={row.reciprocity_score.toFixed(2)}
        />
        <Metric
          label="History"
          value={`${row.editions_count}E · ${row.rounds_count}R`}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {row.repeated_after_moderation ? (
          <Badge variant="destructive">
            repeated after moderation
          </Badge>
        ) : null}

        {row.review_status !== "new" ? (
          <Badge variant="outline">
            {REVIEW_STATUSES.find(
              (item) =>
                item.value ===
                row.review_status,
            )?.label ?? row.review_status}
          </Badge>
        ) : null}

        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          Details
        </span>
      </div>
    </button>
  );
}

function RelationshipDialog({
  relationship,
  onClose,
  voterName,
  targetName,
  resolveCountry,
  byEntryKey,
  onReviewed,
}: {
  relationship: ScopedFriendRelationship | null;
  onClose: () => void;
  voterName: (identity: string) => string;
  targetName: (key: string) => string;
  resolveCountry: (identity: string) => any;
  byEntryKey: Map<string, any>;
  onReviewed: () => void;
}) {
  const reviewFn = useServerFn(
    setRelationshipReview,
  );

  const [status, setStatus] =
    useState("under_review");
  const [note, setNote] = useState("");

  const review = useMutation({
    mutationFn: async () => {
      if (!relationship?.id) {
        throw new Error(
          "This relationship does not yet have a stored review row.",
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
      toast.success("Review saved");
      onReviewed();
      onClose();
    },

    onError: (error: any) =>
      toast.error(
        error?.message ??
          "Could not save review",
      ),
  });

  return (
    <Dialog
      open={Boolean(relationship)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {relationship ? (
              <span className="inline-flex max-w-full items-center gap-2">
                <CountryFlag
                  country={resolveCountry(
                    relationship.voting_country_code,
                  )}
                  size={20}
                />

                <span className="truncate">
                  {voterName(
                    relationship.voting_country_code,
                  )}
                </span>

                <ArrowRight className="h-4 w-4 shrink-0" />

                <EntryAvatar
                  entry={byEntryKey.get(
                    relationship.target_country_code,
                  )}
                  size={20}
                />

                <span className="truncate">
                  {targetName(
                    relationship.target_country_code,
                  )}
                </span>
              </span>
            ) : (
              "Relationship"
            )}
          </DialogTitle>
        </DialogHeader>

        {relationship ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={riskClass(
                  relationship.risk_score,
                )}
              >
                Risk {relationship.risk_score} ·{" "}
                {riskLabel(
                  relationship.risk_score,
                )}
              </Badge>

              <Badge variant="outline">
                {relationship.editions_count} edition
                {relationship.editions_count === 1
                  ? ""
                  : "s"}
              </Badge>

              <Badge variant="outline">
                {relationship.rounds_count} round
                {relationship.rounds_count === 1
                  ? ""
                  : "s"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric
                label="Opportunities"
                value={String(
                  relationship.shared_opportunities,
                )}
              />
              <Metric
                label="Support rate"
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

            <section>
              <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
                Why the score moved
              </h4>

              {relationship.reasons.length === 0 ? (
                <TinyEmpty text="No specific risk contributions." />
              ) : (
                <div className="space-y-1.5">
                  {relationship.reasons.map(
                    (reason, index) => (
                      <div
                        key={index}
                        className="flex items-start justify-between gap-4 rounded-xl border border-border/50 bg-card/20 px-3 py-2"
                      >
                        <span className="text-sm">
                          {reason.text}
                        </span>

                        <span
                          className={
                            reason.delta >= 0
                              ? "text-sm font-semibold tabular-nums text-amber-300"
                              : "text-sm font-semibold tabular-nums text-emerald-300"
                          }
                        >
                          {reason.delta > 0
                            ? "+"
                            : ""}
                          {reason.delta}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
                Relationship timeline
              </h4>

              <div className="max-h-72 overflow-y-auto rounded-2xl border border-border/60">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="sticky top-0 bg-background/90 uppercase text-muted-foreground backdrop-blur">
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
                        Audience avg
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {relationship.timeline.map(
                      (item, index) => (
                        <tr
                          key={`${item.roundId}:${index}`}
                          className="border-t border-border/50"
                        >
                          <td className="p-2">
                            {item.editionName}
                          </td>
                          <td className="p-2">
                            {item.roundName}
                          </td>
                          <td className="p-2 text-right font-semibold tabular-nums">
                            {item.points}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {item.ballotRank ?? "—"}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {item.audienceAverage}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-2 border-t border-border/60 pt-4">
              <h4 className="text-xs uppercase tracking-widest text-primary">
                Review
              </h4>

              <Select
                value={status}
                onValueChange={setStatus}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {REVIEW_STATUSES.map(
                    (item) => (
                      <SelectItem
                        key={item.value}
                        value={item.value}
                      >
                        {item.label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>

              <Textarea
                placeholder="Moderator note"
                value={note}
                onChange={(event) =>
                  setNote(event.target.value)
                }
              />
            </section>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>

          <Button
            disabled={
              !relationship?.id ||
              review.isPending
            }
            onClick={() => review.mutate()}
          >
            Save review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModerationHistory({
  rows,
  voterName,
  targetName,
}: {
  rows: any[];
  voterName: (identity: string) => string;
  targetName: (key: string) => string;
}) {
  const [page, setPage] = useState(1);

  const pages = Math.max(
    1,
    Math.ceil(rows.length / 25),
  );

  const safePage = Math.min(page, pages);

  const visible = rows.slice(
    (safePage - 1) * 25,
    safePage * 25,
  );

  if (rows.length === 0) {
    return (
      <Empty
        title="No moderation history"
        body="No moderation events fall inside this analysis period."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="glass-strong overflow-x-auto rounded-3xl p-2">
        <table className="w-full min-w-[760px] text-sm">
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
            {visible.map((event: any) => (
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
                  {event.moderator_note ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 25 ? (
        <div className="glass flex items-center justify-between rounded-2xl px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={safePage <= 1}
            onClick={() =>
              setPage((value) =>
                Math.max(1, value - 1),
              )
            }
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>

          <span className="text-xs text-muted-foreground">
            Page {safePage} of {pages}
          </span>

          <Button
            variant="ghost"
            size="sm"
            disabled={safePage >= pages}
            onClick={() =>
              setPage((value) =>
                Math.min(
                  pages,
                  value + 1,
                ),
              )
            }
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SettingsPanel({
  onSaved,
}: {
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(
    getFriendVotingSettings,
  );
  const saveFn = useServerFn(
    saveFriendVotingSettings,
  );

  const [draft, setDraft] =
    useState<FriendVotingSettings | null>(
      null,
    );

  const settings = useQuery({
    queryKey: ["fv.settings"],
    queryFn: async () => {
      const value =
        (await getFn()) as FriendVotingSettings;

      setDraft(value);
      return value;
    },
  });

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          settings: draft!,
        },
      }),

    onSuccess: () => {
      toast.success("Detection settings saved");

      void qc.invalidateQueries({
        queryKey: ["fv.settings"],
      });

      onSaved();
    },

    onError: (error: any) =>
      toast.error(
        error?.message ??
          "Could not save settings",
      ),
  });

  if (settings.isLoading || !draft) {
    return <Loading />;
  }

  return (
    <div className="space-y-5">
      <section className="glass-strong rounded-3xl p-4 sm:p-5">
        <h3 className="font-semibold">
          Core thresholds
        </h3>

        <p className="mt-1 text-xs text-muted-foreground">
          These affect scoring, not just the way this page is displayed.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Minimum shared opportunities"
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
            label="Maximum-score threshold"
            value={
              draft.maximumScoreThreshold
            }
            step={0.05}
            onChange={(value) =>
              setDraft({
                ...draft,
                maximumScoreThreshold: value,
              })
            }
          />

          <NumberField
            label="Preference-lift threshold"
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
            label="Audience-uplift threshold"
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
            value={draft.smallSamplePenalty}
            onChange={(value) =>
              setDraft({
                ...draft,
                smallSamplePenalty: value,
              })
            }
          />

          <NumberField
            label="Clique internal share"
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
            label="Clique minimum edge risk"
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

        <label className="mt-4 flex min-h-11 items-center gap-2 text-sm">
          <Switch
            checked={draft.ignoreTestBallots}
            onCheckedChange={(checked) =>
              setDraft({
                ...draft,
                ignoreTestBallots: checked,
              })
            }
          />

          Exclude test / administrative deletions from integrity evidence
        </label>
      </section>

      <section className="glass-strong rounded-3xl p-4 sm:p-5">
        <h3 className="font-semibold">
          Signal weights
        </h3>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(
            draft.weights,
          ).map(([key, value]) => (
            <NumberField
              key={key}
              label={humanizeKey(key)}
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
      </section>

      <section className="glass-strong rounded-3xl p-4 sm:p-5">
        <h3 className="font-semibold">
          Risk bands
        </h3>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(
            draft.riskBands,
          ).map(([key, value]) => (
            <NumberField
              key={key}
              label={humanizeKey(key)}
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

        <Button
          className="mt-4"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          Save settings
        </Button>
      </section>
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
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
      </Label>

      <Input
        type="number"
        step={step}
        value={String(value)}
        onChange={(event) =>
          onChange(
            Number(event.target.value),
          )
        }
      />
    </div>
  );
}

function FilterChip({
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
      className={`min-h-9 rounded-full border px-3 text-xs font-medium transition ${
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border/70 bg-card/20 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
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
    <div className="rounded-xl border border-border/50 bg-background/10 p-2.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function TinyEmpty({
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

function Loading() {
  return (
    <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
      Analysing…
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

      <p className="mt-1 text-sm text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function humanizeKey(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (letter) =>
      letter.toUpperCase(),
    );
}
