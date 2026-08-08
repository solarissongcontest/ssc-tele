import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Heart,
  History,
  Loader2,
  RefreshCcw,
  Search,
  Sliders,
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
import { Slider } from "@/components/ui/slider";
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

function riskClass(score: number) {
  if (score >= 80) {
    return "bg-destructive text-destructive-foreground";
  }

  if (score >= 65) {
    return "bg-amber-500/25 text-amber-400";
  }

  if (score >= 50) {
    return "bg-primary/25 text-primary";
  }

  return "bg-muted text-muted-foreground";
}

function FriendVotingPage() {
  const scopedFn = useServerFn(getScopedFriendVotingAnalysis);
  const { data: countries = [] } = useAllCountries();

  const [scope, setScope] =
    useState<AnalysisScope>(DEFAULT_ANALYSIS_SCOPE);

  const [search, setSearch] = useState("");
  const [minRisk, setMinRisk] = useState(0);
  const [reviewStatus, setReviewStatus] =
    useState("all");
  const [onlyRepeated, setOnlyRepeated] =
    useState(false);

  const [selected, setSelected] =
    useState<ScopedFriendRelationship | null>(null);

  const scoped = useQuery({
    queryKey: [
      "scoped-friend-voting",
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

  const byCountryCode = useMemo(() => {
    const map = new Map<string, any>();

    for (const country of countries) {
      map.set(country.code, country);
    }

    return map;
  }, [countries]);

  const voterName = (countryCode: string) =>
    byCountryCode.get(countryCode)?.name ??
    countryCode;

  const targetName = (entryKey: string) => {
    const entry = byEntryKey.get(entryKey);

    return entry
      ? getEntryDisplayName(entry)
      : entryKey;
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return relationships.filter((row) => {
      if (row.risk_score < minRisk) return false;

      if (
        reviewStatus !== "all" &&
        row.review_status !== reviewStatus
      ) {
        return false;
      }

      if (
        onlyRepeated &&
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
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(needle)) {
          return false;
        }
      }

      return true;
    });
  }, [
    relationships,
    minRisk,
    reviewStatus,
    onlyRepeated,
    search,
    byCountryCode,
    byEntryKey,
  ]);

  const summary = useMemo(
    () => ({
      total: relationships.length,
      high: relationships.filter(
        (row) => row.risk_score >= 65,
      ).length,
      repeated: relationships.filter(
        (row) => row.repeated_after_moderation,
      ).length,
      watch: relationships.filter(
        (row) => row.review_status === "watchlist",
      ).length,
    }),
    [relationships],
  );

  return (
    <AdminShell title="Friend-Voting Analysis">
      <div className="space-y-6">
        <AnalysisScopePicker
          value={scope}
          onChange={setScope}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              Risk is recalculated from ballots inside the selected period.
              The voter side remains the permanent Solaris country identity;
              the receiving side remains a stable target entry key.
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
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
            Refresh analysis
          </Button>
        </div>

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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Relationships"
                value={summary.total}
              />
              <Stat
                label="High risk (65+)"
                value={summary.high}
              />
              <Stat
                label="Repeat offenders"
                value={summary.repeated}
              />
              <Stat
                label="On watchlist"
                value={summary.watch}
              />
            </div>

            <Tabs defaultValue="relationships">
              <TabsList className="max-w-full overflow-x-auto">
                <TabsTrigger value="relationships">
                  <Heart className="mr-1.5 h-4 w-4" />
                  Relationships
                </TabsTrigger>

                <TabsTrigger value="groups">
                  <Users className="mr-1.5 h-4 w-4" />
                  Friend groups
                </TabsTrigger>

                <TabsTrigger value="history">
                  <History className="mr-1.5 h-4 w-4" />
                  Moderation history
                </TabsTrigger>

                <TabsTrigger value="settings">
                  <Sliders className="mr-1.5 h-4 w-4" />
                  Detection settings
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="relationships"
                className="mt-4 space-y-4"
              >
                <div className="glass-strong flex flex-wrap items-end gap-4 rounded-2xl p-4">
                  <div className="min-w-[220px] flex-1 space-y-1.5">
                    <Label className="text-xs uppercase tracking-widest text-primary">
                      Search
                    </Label>

                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                      <Input
                        className="pl-9"
                        placeholder="Voter country or target entry"
                        value={search}
                        onChange={(event) =>
                          setSearch(event.target.value)
                        }
                      />
                    </div>
                  </div>

                  <div className="w-48 space-y-1.5">
                    <Label className="text-xs uppercase tracking-widest text-primary">
                      Minimum risk: {minRisk}
                    </Label>

                    <Slider
                      value={[minRisk]}
                      min={0}
                      max={100}
                      step={5}
                      onValueChange={(value) =>
                        setMinRisk(value[0] ?? 0)
                      }
                    />
                  </div>

                  <div className="w-52 space-y-1.5">
                    <Label className="text-xs uppercase tracking-widest text-primary">
                      Review status
                    </Label>

                    <Select
                      value={reviewStatus}
                      onValueChange={setReviewStatus}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="all">
                          All
                        </SelectItem>

                        {REVIEW_STATUSES.map((item) => (
                          <SelectItem
                            key={item.value}
                            value={item.value}
                          >
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <label className="flex min-h-11 items-center gap-2">
                    <Switch
                      checked={onlyRepeated}
                      onCheckedChange={setOnlyRepeated}
                    />
                    <span className="text-sm">
                      Repeat offenders only
                    </span>
                  </label>

                  {filtered.length > 0 ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        downloadCSV(
                          `friend-voting-${analysisScopeKey(
                            scope,
                          )}.csv`,
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
                            support: row.support_count,
                            max_scores:
                              row.maximum_score_count,
                            avg_points:
                              row.average_points,
                            preference_lift:
                              row.preference_lift,
                            audience_uplift:
                              row.audience_uplift,
                            reciprocity:
                              row.reciprocity_score,
                            risk: row.risk_score,
                            label: row.risk_label,
                            review_status:
                              row.review_status,
                            editions:
                              row.editions_count,
                            rounds:
                              row.rounds_count,
                          })),
                        )
                      }
                    >
                      Export CSV
                    </Button>
                  ) : null}
                </div>

                {filtered.length === 0 ? (
                  <Empty
                    title="No relationship data"
                    body="No relationships match this period and filter combination."
                  />
                ) : (
                  <div className="glass-strong overflow-x-auto rounded-2xl p-2">
                    <table className="w-full min-w-[980px] text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="py-2 pl-2 pr-3 text-left">
                            Voting country
                          </th>
                          <th className="py-2 pr-3 text-left">
                            Target entry
                          </th>
                          <th className="py-2 pr-3 text-right">
                            Opps
                          </th>
                          <th className="py-2 pr-3 text-right">
                            Support
                          </th>
                          <th className="py-2 pr-3 text-right">
                            Max
                          </th>
                          <th className="py-2 pr-3 text-right">
                            Avg
                          </th>
                          <th className="py-2 pr-3 text-right">
                            Lift
                          </th>
                          <th className="py-2 pr-3 text-right">
                            Uplift
                          </th>
                          <th className="py-2 pr-3 text-right">
                            Recip.
                          </th>
                          <th className="py-2 pr-3 text-right">
                            Risk
                          </th>
                          <th className="py-2 pr-2 text-left">
                            Status
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {filtered.map((row) => {
                          const targetEntry =
                            byEntryKey.get(
                              row.target_country_code,
                            );

                          return (
                            <tr
                              key={`${row.voting_country_code}>${row.target_country_code}`}
                              className="cursor-pointer border-t border-border/60 hover:bg-primary/5"
                              onClick={() =>
                                setSelected(row)
                              }
                            >
                              <td className="py-2 pl-2 pr-3">
                                <span className="inline-flex items-center gap-1.5 font-medium">
                                  <CountryFlag
                                    country={byCountryCode.get(
                                      row.voting_country_code,
                                    )}
                                    size={18}
                                  />
                                  {voterName(
                                    row.voting_country_code,
                                  )}
                                </span>
                              </td>

                              <td className="py-2 pr-3">
                                <span className="inline-flex items-center gap-1.5">
                                  <EntryAvatar
                                    entry={targetEntry}
                                    size={18}
                                  />
                                  {targetName(
                                    row.target_country_code,
                                  )}
                                </span>
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {row.shared_opportunities}
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {row.support_count} (
                                {Math.round(
                                  row.support_frequency * 100,
                                )}
                                %)
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {row.maximum_score_count}
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {row.average_points.toFixed(2)}
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {row.preference_lift.toFixed(2)}×
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {row.audience_uplift >= 0
                                  ? "+"
                                  : ""}
                                {row.audience_uplift.toFixed(1)}
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {row.reciprocity_score.toFixed(
                                  2,
                                )}
                              </td>

                              <td className="py-2 pr-3 text-right">
                                <Badge
                                  className={riskClass(
                                    row.risk_score,
                                  )}
                                >
                                  {row.risk_score}
                                </Badge>
                              </td>

                              <td className="py-2 pr-2">
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {REVIEW_STATUSES.find(
                                    (item) =>
                                      item.value ===
                                      row.review_status,
                                  )?.label ??
                                    row.review_status}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="groups"
                className="mt-4"
              >
                {groups.length === 0 ? (
                  <Empty
                    title="No friend groups"
                    body="No multi-delegation friend-voting groups were detected in this scope."
                  />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {groups.map((group, index) => (
                      <div
                        key={`${group.label}:${index}`}
                        className="glass-strong rounded-2xl p-4"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className="font-semibold">
                            {group.label} ·{" "}
                            {group.members.length} delegations
                          </h3>

                          <Badge
                            className={riskClass(
                              group.risk_score,
                            )}
                          >
                            {group.risk_score}
                          </Badge>
                        </div>

                        <p className="mb-2 text-xs text-muted-foreground">
                          {group.risk_label}
                        </p>

                        <div className="mb-3 flex flex-wrap gap-1">
                          {group.members.map((member) => (
                            <Badge
                              key={member}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {voterName(member)}
                            </Badge>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <Metric
                            label="Internal max share"
                            value={`${Math.round(
                              group.internal_maximum_share *
                                100,
                            )}%`}
                          />
                          <Metric
                            label="Internal top-3 share"
                            value={`${Math.round(
                              group.internal_top_three_share *
                                100,
                            )}%`}
                          />
                          <Metric
                            label="Editions observed"
                            value={String(
                              group.editions_observed,
                            )}
                          />
                          <Metric
                            label="Rounds observed"
                            value={String(
                              group.rounds_observed,
                            )}
                          />
                        </div>

                        {group.reasons.length > 0 ? (
                          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                            {group.reasons.map(
                              (reason, reasonIndex) => (
                                <li key={reasonIndex}>
                                  • {reason}
                                </li>
                              ),
                            )}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="history"
                className="mt-4"
              >
                {moderationEvents.length === 0 ? (
                  <Empty
                    title="No moderation history"
                    body="No moderation events fall inside this selected analysis period."
                  />
                ) : (
                  <div className="glass-strong overflow-x-auto rounded-2xl p-2">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="py-2 pl-2 pr-3 text-left">
                            When
                          </th>
                          <th className="py-2 pr-3 text-left">
                            Voter
                          </th>
                          <th className="py-2 pr-3 text-left">
                            Target
                          </th>
                          <th className="py-2 pr-3 text-left">
                            Action
                          </th>
                          <th className="py-2 pr-2 text-left">
                            Note
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {moderationEvents.map(
                          (event: any) => (
                            <tr
                              key={event.id}
                              className="border-t border-border/60"
                            >
                              <td className="whitespace-nowrap py-2 pl-2 pr-3 text-muted-foreground">
                                {new Date(
                                  event.performed_at,
                                ).toLocaleString()}
                              </td>

                              <td className="py-2 pr-3">
                                {voterName(
                                  event.voting_country_code,
                                )}
                              </td>

                              <td className="py-2 pr-3">
                                {event.target_country_code
                                  ? targetName(
                                      event.target_country_code,
                                    )
                                  : "—"}
                              </td>

                              <td className="py-2 pr-3">
                                {event.action}
                              </td>

                              <td className="py-2 pr-2 text-muted-foreground">
                                {event.moderator_note ?? "—"}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="settings"
                className="mt-4"
              >
                <SettingsPanel
                  onSaved={() => scoped.refetch()}
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
          byCountryCode={byCountryCode}
          byEntryKey={byEntryKey}
          onReviewed={() => scoped.refetch()}
        />
      </div>
    </AdminShell>
  );
}

function RelationshipDialog({
  relationship,
  onClose,
  voterName,
  targetName,
  byCountryCode,
  byEntryKey,
  onReviewed,
}: {
  relationship: ScopedFriendRelationship | null;
  onClose: () => void;
  voterName: (code: string) => string;
  targetName: (key: string) => string;
  byCountryCode: Map<string, any>;
  byEntryKey: Map<string, any>;
  onReviewed: () => void;
}) {
  const reviewFn = useServerFn(setRelationshipReview);

  const [status, setStatus] =
    useState("under_review");
  const [note, setNote] = useState("");

  const review = useMutation({
    mutationFn: async () => {
      if (!relationship?.id) {
        throw new Error(
          "Run the stored all-history recalculation once before reviewing this relationship.",
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
      toast.error(error?.message ?? "Could not save review"),
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
              <span className="inline-flex items-center gap-2">
                <CountryFlag
                  country={byCountryCode.get(
                    relationship.voting_country_code,
                  )}
                  size={20}
                />
                {voterName(
                  relationship.voting_country_code,
                )}
                <span className="text-muted-foreground">
                  →
                </span>
                <EntryAvatar
                  entry={byEntryKey.get(
                    relationship.target_country_code,
                  )}
                  size={20}
                />
                {targetName(
                  relationship.target_country_code,
                )}
              </span>
            ) : (
              "Relationship"
            )}
          </DialogTitle>
        </DialogHeader>

        {relationship ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                className={riskClass(
                  relationship.risk_score,
                )}
              >
                Risk {relationship.risk_score}
              </Badge>

              <span className="text-sm text-muted-foreground">
                {relationship.risk_label}
              </span>
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
                  relationship.support_frequency * 100,
                )}%`}
              />
              <Metric
                label="Max scores"
                value={String(
                  relationship.maximum_score_count,
                )}
              />
              <Metric
                label="Preference lift"
                value={`${relationship.preference_lift}×`}
              />
              <Metric
                label="Editions"
                value={String(
                  relationship.editions_count,
                )}
              />
              <Metric
                label="Rounds"
                value={String(
                  relationship.rounds_count,
                )}
              />
              <Metric
                label="Reciprocity"
                value={String(
                  relationship.reciprocity_score,
                )}
              />
              <Metric
                label="Audience uplift"
                value={String(
                  relationship.audience_uplift,
                )}
              />
            </div>

            <section>
              <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
                Why this score
              </h4>

              <ul className="space-y-1 text-sm">
                {relationship.reasons.map(
                  (reason, index) => (
                    <li
                      key={index}
                      className="flex items-start justify-between gap-3"
                    >
                      <span>{reason.text}</span>
                      <span
                        className={
                          reason.delta >= 0
                            ? "tabular-nums text-amber-400"
                            : "tabular-nums text-emerald-400"
                        }
                      >
                        {reason.delta > 0 ? "+" : ""}
                        {reason.delta}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </section>

            <section>
              <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
                Timeline inside selected period
              </h4>

              <div className="max-h-72 overflow-y-auto rounded-xl border border-border/60">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="sticky top-0 bg-background/80 uppercase text-muted-foreground backdrop-blur">
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
                          key={`${item.roundId}:${index}`}
                          className="border-t border-border/60"
                        >
                          <td className="p-2">
                            {item.editionName}
                          </td>
                          <td className="p-2">
                            {item.roundName}
                          </td>
                          <td className="p-2 text-right tabular-nums">
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
                Review decision
              </h4>

              {!relationship.id ? (
                <p className="text-xs text-amber-400">
                  This pair does not yet have a stored all-history relationship
                  row. The scoped analysis is still valid, but moderation review
                  can only be attached after the all-history cache has been
                  calculated at least once.
                </p>
              ) : null}

              <Select
                value={status}
                onValueChange={setStatus}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {REVIEW_STATUSES.map((item) => (
                    <SelectItem
                      key={item.value}
                      value={item.value}
                    >
                      {item.label}
                    </SelectItem>
                  ))}
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
            Save decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsPanel({
  onSaved,
}: {
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getFriendVotingSettings);
  const saveFn = useServerFn(saveFriendVotingSettings);

  const [draft, setDraft] =
    useState<FriendVotingSettings | null>(null);

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
    <div className="glass-strong space-y-5 rounded-2xl p-4 sm:p-5">
      <div>
        <h3 className="font-semibold">
          Core thresholds
        </h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
            label="Support frequency threshold"
            value={draft.supportFrequencyThreshold}
            step={0.05}
            onChange={(value) =>
              setDraft({
                ...draft,
                supportFrequencyThreshold: value,
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
            value={draft.maximumScoreThreshold}
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
            value={draft.preferenceLiftThreshold}
            step={0.1}
            onChange={(value) =>
              setDraft({
                ...draft,
                preferenceLiftThreshold: value,
              })
            }
          />

          <NumberField
            label="Audience-uplift threshold"
            value={draft.audienceUpliftThreshold}
            step={0.1}
            onChange={(value) =>
              setDraft({
                ...draft,
                audienceUpliftThreshold: value,
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
        </div>
      </div>

      <label className="flex min-h-11 items-center gap-2 text-sm">
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

      <div>
        <h3 className="font-semibold">
          Signal weights
        </h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(draft.weights).map(
            ([key, value]) => (
              <NumberField
                key={key}
                label={humanizeKey(key)}
                value={value}
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
            ),
          )}
        </div>
      </div>

      <div>
        <h3 className="font-semibold">
          Risk bands
        </h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(draft.riskBands).map(
            ([key, value]) => (
              <NumberField
                key={key}
                label={humanizeKey(key)}
                value={value}
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
            ),
          )}
        </div>
      </div>

      <Button
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        Save settings
      </Button>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="glass-strong rounded-2xl p-4">
      <p className="text-xs uppercase tracking-widest text-primary">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {value}
      </p>
    </div>
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
    <div className="rounded-xl border border-border/60 p-2">
      <p className="text-[10px] uppercase text-muted-foreground">
        {label}
      </p>
      <p className="font-medium tabular-nums">
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
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
      </Label>

      <Input
        type="number"
        step={step}
        value={String(value)}
        onChange={(event) =>
          onChange(Number(event.target.value))
        }
      />
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
      <p className="text-sm text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function humanizeKey(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
