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
  RefreshCcw,
  Search,
  Sliders,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { CountryFlag } from "@/components/country-flag";
import { EmptyState } from "@/components/empty-state";
import { EntryAvatar } from "@/components/entry-avatar";
import { TableSkeleton } from "@/components/panel-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { downloadCSV } from "@/lib/export";
import {
  getEntryDisplayName,
  entryMap,
} from "@/lib/round-entries";
import {
  getFriendVotingRelationship,
  getFriendVotingSettings,
  listFriendVotingGroups,
  listFriendVotingRelationships,
  listModerationHistory,
  recalculateFriendVoting,
  saveFriendVotingSettings,
  setRelationshipReview,
  type RelationshipRow,
} from "@/lib/friend-voting.functions";
import type { FriendVotingSettings } from "@/lib/friend-voting-math";

export const Route = createFileRoute("/admin/friend-voting")({
  head: () => ({
    meta: [
      {
        title: "Friend-Voting Analysis — Solaris Admin",
      },
      {
        name: "description",
        content:
          "Long-term relationship analysis between stable Solaris voter identities and stable target entry keys.",
      },
    ],
  }),
  component: FriendVotingPage,
});

const REVIEW_STATUSES = [
  { value: "new", label: "New" },
  {
    value: "under_review",
    label: "Under review",
  },
  {
    value: "watchlist",
    label: "Watchlist",
  },
  {
    value: "confirmed",
    label: "Confirmed friend voting",
  },
  {
    value: "legitimate",
    label: "Legitimate",
  },
  {
    value: "dismissed",
    label: "Dismissed",
  },
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
  const qc = useQueryClient();

  const listFn = useServerFn(
    listFriendVotingRelationships,
  );
  const groupsFn = useServerFn(
    listFriendVotingGroups,
  );
  const historyFn = useServerFn(
    listModerationHistory,
  );
  const recalcFn = useServerFn(
    recalculateFriendVoting,
  );

  const { data: countries } = useAllCountries();

  const [search, setSearch] = useState("");
  const [minRisk, setMinRisk] = useState(0);
  const [reviewStatus, setReviewStatus] =
    useState("all");
  const [onlyRepeated, setOnlyRepeated] =
    useState(false);
  const [openId, setOpenId] =
    useState<string | null>(null);

  const relationships = useQuery({
    queryKey: [
      "fv.rels",
      search,
      minRisk,
      reviewStatus,
      onlyRepeated,
    ],

    queryFn: () =>
      listFn({
        data: {
          search,
          minRisk,
          reviewStatus:
            reviewStatus === "all"
              ? null
              : reviewStatus,
          onlyRepeated,
        },
      }) as Promise<RelationshipRow[]>,
  });

  const groups = useQuery({
    queryKey: ["fv.groups"],
    queryFn: () =>
      groupsFn() as Promise<any[]>,
  });

  const history = useQuery({
    queryKey: ["fv.history"],
    queryFn: () =>
      historyFn({
        data: {},
      }) as Promise<any[]>,
  });

  const recalc = useMutation({
    mutationFn: () =>
      recalcFn() as Promise<any>,

    onSuccess: (result) => {
      toast.success(
        `Analysis rebuilt · ${result.relationships} relationships · ${result.groups} friend groups`,
      );

      void qc.invalidateQueries({
        queryKey: ["fv.rels"],
      });

      void qc.invalidateQueries({
        queryKey: ["fv.groups"],
      });

      void qc.invalidateQueries({
        queryKey: ["fv.history"],
      });
    },

    onError: (error: any) =>
      toast.error(
        error?.message ??
          "Recalculation failed",
      ),
  });

  const rows =
    relationships.data ?? [];

  const targetKeys = useMemo(
    () =>
      Array.from(
        new Set([
          ...rows.map(
            (row) =>
              row.target_country_code,
          ),
          ...(history.data ?? [])
            .map(
              (event: any) =>
                event.target_country_code,
            )
            .filter(Boolean),
        ]),
      ),
    [rows, history.data],
  );

  const {
    data: targetEntries = [],
  } = useEntryKeyCatalog(
    targetKeys,
  );

  const byEntryKey = useMemo(
    () => entryMap(targetEntries),
    [targetEntries],
  );

  const byCountryCode = useMemo(() => {
    const map = new Map<string, any>();

    for (const country of
      countries ?? []) {
      map.set(
        country.code,
        country,
      );
    }

    return map;
  }, [countries]);

  const targetName = (
    entryKey:
      | string
      | null
      | undefined,
  ) => {
    if (!entryKey) return "—";

    const entry =
      byEntryKey.get(entryKey);

    return entry
      ? getEntryDisplayName(
          entry,
        )
      : entryKey;
  };

  const voterName = (
    countryCode:
      | string
      | null
      | undefined,
  ) => {
    if (!countryCode) return "—";

    return (
      byCountryCode.get(
        countryCode,
      )?.name ??
      countryCode
    );
  };

  const summary =
    useMemo(() => {
      const high = rows.filter(
        (row) =>
          row.risk_score >= 65,
      ).length;

      const repeated =
        rows.filter(
          (row) =>
            row.repeated_after_moderation,
        ).length;

      const watch =
        rows.filter(
          (row) =>
            row.review_status ===
            "watchlist",
        ).length;

      return {
        total: rows.length,
        high,
        repeated,
        watch,
      };
    }, [rows]);

  return (
    <AdminShell title="Friend-Voting Analysis">
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            The voting side of a
            relationship is the
            permanent Solaris
            delegation country.
            The receiving side is
            a stable target
            entry_key, which may
            represent either a
            country entry or a
            custom entry.
            Usernames and network
            signals remain
            supporting evidence
            rather than identity.
          </p>

          <Button
            onClick={() =>
              recalc.mutate()
            }
            disabled={
              recalc.isPending
            }
          >
            <RefreshCcw
              className={
                recalc.isPending
                  ? "h-4 w-4 animate-spin"
                  : "h-4 w-4"
              }
            />

            {recalc.isPending
              ? "Analysing…"
              : "Recalculate analysis"}
          </Button>
        </header>

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
          <TabsList>
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
              <div className="min-w-[200px] flex-1 space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-primary">
                  Identity / target key
                </Label>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                  <Input
                    className="pl-9"
                    placeholder="Search voter country or target entry key"
                    value={search}
                    onChange={(
                      event,
                    ) =>
                      setSearch(
                        event
                          .target
                          .value,
                      )
                    }
                  />
                </div>
              </div>

              <div className="w-48 space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-primary">
                  Minimum risk:{" "}
                  {minRisk}
                </Label>

                <Slider
                  value={[
                    minRisk,
                  ]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(
                    value,
                  ) =>
                    setMinRisk(
                      value[0] ??
                        0,
                    )
                  }
                />
              </div>

              <div className="w-52 space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-primary">
                  Review status
                </Label>

                <Select
                  value={
                    reviewStatus
                  }
                  onValueChange={
                    setReviewStatus
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="all">
                      All
                    </SelectItem>

                    {REVIEW_STATUSES.map(
                      (
                        item,
                      ) => (
                        <SelectItem
                          key={
                            item.value
                          }
                          value={
                            item.value
                          }
                        >
                          {
                            item.label
                          }
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pb-2">
                <Switch
                  checked={
                    onlyRepeated
                  }
                  onCheckedChange={
                    setOnlyRepeated
                  }
                />

                <span className="text-sm">
                  Repeat offenders
                  only
                </span>
              </div>

              {rows.length > 0 ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCSV(
                      "friend-voting-relationships.csv",
                      rows.map(
                        (
                          row,
                        ) => ({
                          voting_country_code:
                            row.voting_country_code,
                          voting_country:
                            voterName(
                              row.voting_country_code,
                            ),
                          target_entry_key:
                            row.target_country_code,
                          target_entry:
                            targetName(
                              row.target_country_code,
                            ),
                          opportunities:
                            row.shared_opportunities,
                          support:
                            row.support_count,
                          max_scores:
                            row.maximum_score_count,
                          deleted_max_scores:
                            row.deleted_maximum_score_count,
                          avg_points:
                            row.average_points,
                          preference_lift:
                            row.preference_lift,
                          audience_uplift:
                            row.audience_uplift,
                          reciprocity:
                            row.reciprocity_score,
                          risk:
                            row.risk_score,
                          label:
                            row.risk_label,
                          review_status:
                            row.review_status,
                        }),
                      ),
                    )
                  }
                >
                  Export CSV
                </Button>
              ) : null}
            </div>

            {relationships.isLoading ? (
              <TableSkeleton />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Heart}
                title="No relationship data yet"
                description="Run the analysis to build the historical relationship dataset."
              />
            ) : (
              <div className="glass-strong overflow-x-auto rounded-2xl p-2">
                <table className="w-full text-sm">
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
                    {rows.map(
                      (row) => {
                        const voterCountry =
                          byCountryCode.get(
                            row.voting_country_code,
                          );

                        const targetEntry =
                          byEntryKey.get(
                            row.target_country_code,
                          );

                        return (
                          <tr
                            key={
                              row.id
                            }
                            className="cursor-pointer border-t border-border/60 hover:bg-primary/5"
                            onClick={() =>
                              setOpenId(
                                row.id,
                              )
                            }
                          >
                            <td className="py-2 pl-2 pr-3">
                              <span className="inline-flex items-center gap-1.5 font-medium">
                                <CountryFlag
                                  country={
                                    voterCountry
                                  }
                                  size={
                                    18
                                  }
                                />

                                {voterName(
                                  row.voting_country_code,
                                )}
                              </span>
                            </td>

                            <td className="py-2 pr-3">
                              <span className="inline-flex items-center gap-1.5">
                                <EntryAvatar
                                  entry={
                                    targetEntry
                                  }
                                  size={
                                    18
                                  }
                                />

                                {targetName(
                                  row.target_country_code,
                                )}
                              </span>
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {
                                row.shared_opportunities
                              }
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {
                                row.support_count
                              }{" "}
                              (
                              {Math.round(
                                row.support_frequency *
                                  100,
                              )}
                              %)
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {
                                row.maximum_score_count
                              }

                              {row.deleted_maximum_score_count >
                              0 ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  (+
                                  {
                                    row.deleted_maximum_score_count
                                  }{" "}
                                  del)
                                </span>
                              ) : null}
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {row.average_points.toFixed(
                                2,
                              )}
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {row.preference_lift.toFixed(
                                2,
                              )}
                              ×
                            </td>

                            <td className="py-2 pr-3 text-right tabular-nums">
                              {row.audience_uplift >=
                              0
                                ? "+"
                                : ""}
                              {row.audience_uplift.toFixed(
                                1,
                              )}
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
                                {
                                  row.risk_score
                                }
                              </Badge>
                            </td>

                            <td className="py-2 pr-2">
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                              >
                                {REVIEW_STATUSES.find(
                                  (
                                    item,
                                  ) =>
                                    item.value ===
                                    row.review_status,
                                )
                                  ?.label ??
                                  row.review_status}
                              </Badge>
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="groups"
            className="mt-4"
          >
            {groups.isLoading ? (
              <TableSkeleton />
            ) : (groups.data ?? [])
                .length === 0 ? (
              <EmptyState
                icon={Users}
                title="No friend groups detected"
                description="Groups appear when three or more delegation identities repeatedly exchange strong support."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {(groups.data ?? []).map(
                  (
                    group,
                  ) => (
                    <div
                      key={
                        group.id
                      }
                      className="glass-strong rounded-2xl p-4"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="font-semibold">
                          {
                            group.label
                          }{" "}
                          ·{" "}
                          {
                            group.members
                              .length
                          }{" "}
                          delegations
                        </h3>

                        <Badge
                          className={riskClass(
                            group.risk_score,
                          )}
                        >
                          {
                            group.risk_score
                          }
                        </Badge>
                      </div>

                      <p className="mb-2 text-xs text-muted-foreground">
                        {
                          group.risk_label
                        }
                      </p>

                      <div className="mb-3 flex flex-wrap gap-1">
                        {group.members.map(
                          (
                            member: string,
                          ) => (
                            <Badge
                              key={
                                member
                              }
                              variant="outline"
                              className="text-[10px]"
                            >
                              {voterName(
                                member,
                              )}
                            </Badge>
                          ),
                        )}
                      </div>

                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {(
                          group.reasons ??
                          []
                        ).map(
                          (
                            reason: string,
                            index: number,
                          ) => (
                            <li
                              key={
                                index
                              }
                            >
                              •{" "}
                              {
                                reason
                              }
                            </li>
                          ),
                        )}
                      </ul>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
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
                          label="Avg internal support"
                          value={Number(
                            group.average_internal_support,
                          ).toFixed(
                            2,
                          )}
                        />

                        <Metric
                          label="Avg external support"
                          value={Number(
                            group.average_external_support,
                          ).toFixed(
                            2,
                          )}
                        />
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="history"
            className="mt-4"
          >
            {history.isLoading ? (
              <TableSkeleton />
            ) : (history.data ?? [])
                .length === 0 ? (
              <EmptyState
                icon={History}
                title="No moderation history"
                description="Every moderation action on a ballot or relationship is recorded here permanently."
              />
            ) : (
              <div className="glass-strong overflow-x-auto rounded-2xl p-2">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pl-2 pr-3 text-left">
                        When
                      </th>
                      <th className="py-2 pr-3 text-left">
                        Voter country
                      </th>
                      <th className="py-2 pr-3 text-left">
                        Target entry
                      </th>
                      <th className="py-2 pr-3 text-left">
                        Action
                      </th>
                      <th className="py-2 pr-3 text-left">
                        Category
                      </th>
                      <th className="py-2 pr-3 text-left">
                        Moderator
                      </th>
                      <th className="py-2 pr-2 text-left">
                        Note
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {(history.data ?? []).map(
                      (
                        event: any,
                      ) => {
                        const targetEntry =
                          event.target_country_code
                            ? byEntryKey.get(
                                event.target_country_code,
                              )
                            : null;

                        return (
                          <tr
                            key={
                              event.id
                            }
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
                              {event.target_country_code ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <EntryAvatar
                                    entry={
                                      targetEntry
                                    }
                                    size={
                                      16
                                    }
                                  />

                                  {targetName(
                                    event.target_country_code,
                                  )}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>

                            <td className="py-2 pr-3">
                              {
                                event.action
                              }
                            </td>

                            <td className="py-2 pr-3">
                              {
                                event.reason_category ??
                                "—"
                              }
                            </td>

                            <td className="py-2 pr-3">
                              {
                                event.performed_by_username ??
                                "—"
                              }
                            </td>

                            <td className="py-2 pr-2 text-muted-foreground">
                              {
                                event.moderator_note ??
                                "—"
                              }
                            </td>
                          </tr>
                        );
                      },
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
            <SettingsPanel />
          </TabsContent>
        </Tabs>
      </div>

      <RelationshipDialog
        id={openId}
        onClose={() =>
          setOpenId(null)
        }
      />
    </AdminShell>
  );
}

function RelationshipDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const detailFn = useServerFn(
    getFriendVotingRelationship,
  );
  const reviewFn = useServerFn(
    setRelationshipReview,
  );

  const { data: countries } =
    useAllCountries();

  const [note, setNote] =
    useState("");
  const [status, setStatus] =
    useState("under_review");

  const detail = useQuery({
    queryKey: [
      "fv.detail",
      id,
    ],

    queryFn: () =>
      detailFn({
        data: {
          id: id!,
        },
      }) as Promise<any>,

    enabled:
      Boolean(id),
  });

  const relationship =
    detail.data?.relationship;

  const detailTargetKeys =
    useMemo(
      () =>
        Array.from(
          new Set(
            [
              relationship?.target_country_code,
              ...(
                detail.data
                  ?.moderationEvents ??
                []
              ).map(
                (
                  event: any,
                ) =>
                  event.target_country_code,
              ),
            ].filter(
              Boolean,
            ) as string[],
          ),
        ),
      [
        relationship?.target_country_code,
        detail.data
          ?.moderationEvents,
      ],
    );

  const {
    data: targetEntries = [],
  } = useEntryKeyCatalog(
    detailTargetKeys,
  );

  const byEntryKey = useMemo(
    () =>
      entryMap(
        targetEntries,
      ),
    [targetEntries],
  );

  const byCountryCode =
    useMemo(() => {
      const map =
        new Map<
          string,
          any
        >();

      for (const country of
        countries ?? []) {
        map.set(
          country.code,
          country,
        );
      }

      return map;
    }, [countries]);

  const targetName = (
    entryKey: string,
  ) => {
    const entry =
      byEntryKey.get(
        entryKey,
      );

    return entry
      ? getEntryDisplayName(
          entry,
        )
      : entryKey;
  };

  const voterName = (
    countryCode: string,
  ) =>
    byCountryCode.get(
      countryCode,
    )?.name ??
    countryCode;

  const save = useMutation({
    mutationFn: () =>
      reviewFn({
        data: {
          id: id!,
          status,
          note,
        },
      }) as Promise<any>,

    onSuccess: () => {
      toast.success(
        "Review status saved",
      );

      void qc.invalidateQueries({
        queryKey: [
          "fv.rels",
        ],
      });

      void qc.invalidateQueries({
        queryKey: [
          "fv.detail",
          id,
        ],
      });

      void qc.invalidateQueries({
        queryKey: [
          "fv.history",
        ],
      });
    },

    onError: (
      error: any,
    ) =>
      toast.error(
        error?.message ??
          "Could not save",
      ),
  });

  const targetEntry =
    relationship
      ? byEntryKey.get(
          relationship.target_country_code,
        )
      : null;

  return (
    <Dialog
      open={Boolean(id)}
      onOpenChange={(
        open,
      ) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
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
                  entry={
                    targetEntry
                  }
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

        {!relationship ? (
          <TableSkeleton />
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Badge
                className={riskClass(
                  relationship.risk_score,
                )}
              >
                Risk{" "}
                {
                  relationship.risk_score
                }
              </Badge>

              <span className="text-sm text-muted-foreground">
                {
                  relationship.risk_label
                }
              </span>
            </div>

            <section>
              <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
                Why this score
              </h4>

              <ul className="space-y-1 text-sm">
                {(
                  relationship.reasons ??
                  []
                ).map(
                  (
                    reason: any,
                    index: number,
                  ) => (
                    <li
                      key={
                        index
                      }
                      className="flex items-start justify-between gap-3"
                    >
                      <span>
                        {
                          reason.text
                        }
                      </span>

                      <span
                        className={
                          reason.delta >=
                          0
                            ? "tabular-nums text-amber-400"
                            : "tabular-nums text-emerald-400"
                        }
                      >
                        {reason.delta >
                        0
                          ? "+"
                          : ""}
                        {
                          reason.delta
                        }
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </section>

            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                label="Audience uplift"
                value={String(
                  relationship.audience_uplift,
                )}
              />
              <Metric
                label="Longest streak"
                value={String(
                  relationship.longest_support_streak,
                )}
              />
              <Metric
                label="Editions"
                value={String(
                  relationship.editions_count,
                )}
              />
              <Metric
                label="Reciprocity"
                value={String(
                  relationship.reciprocity_score,
                )}
              />
            </section>

            <section>
              <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
                Timeline
              </h4>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 text-left">
                        Edition
                      </th>
                      <th className="py-1 pr-3 text-left">
                        Round
                      </th>
                      <th className="py-1 pr-3 text-right">
                        Points
                      </th>
                      <th className="py-1 pr-3 text-right">
                        Rank
                      </th>
                      <th className="py-1 pr-3 text-right">
                        Audience avg
                      </th>
                      <th className="py-1 text-left">
                        Ballot
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {(
                      relationship.timeline ??
                      []
                    ).map(
                      (
                        item: any,
                        index: number,
                      ) => (
                        <tr
                          key={
                            index
                          }
                          className="border-t border-border/60"
                        >
                          <td className="py-1 pr-3">
                            {
                              item.editionName
                            }
                          </td>

                          <td className="py-1 pr-3">
                            {
                              item.roundName
                            }
                          </td>

                          <td className="py-1 pr-3 text-right tabular-nums">
                            {
                              item.points
                            }
                            {item.points >=
                              item.maxScore &&
                            item.points >
                              0
                              ? " ★"
                              : ""}
                          </td>

                          <td className="py-1 pr-3 text-right tabular-nums">
                            {
                              item.ballotRank ??
                              "—"
                            }
                          </td>

                          <td className="py-1 pr-3 text-right tabular-nums">
                            {
                              item.audienceAverage
                            }
                          </td>

                          <td className="py-1">
                            {item.status ===
                            "deleted" ? (
                              <Badge
                                variant="destructive"
                                className="text-[10px]"
                              >
                                deleted
                                {item.deletionCategory
                                  ? ` · ${item.deletionCategory}`
                                  : ""}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                              >
                                {
                                  item.status
                                }
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {(detail.data
              ?.moderationEvents ??
              []).length > 0 ? (
              <section>
                <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
                  Moderation
                  history for this
                  voter identity
                </h4>

                <ul className="space-y-1 text-xs text-muted-foreground">
                  {detail.data.moderationEvents.map(
                    (
                      event: any,
                    ) => (
                      <li
                        key={
                          event.id
                        }
                      >
                        {new Date(
                          event.performed_at,
                        ).toLocaleString()}{" "}
                        ·{" "}
                        {
                          event.action
                        }

                        {event.target_country_code
                          ? ` · target ${targetName(
                              event.target_country_code,
                            )}`
                          : ""}

                        {event.reason_category
                          ? ` · ${event.reason_category}`
                          : ""}

                        {event.performed_by_username
                          ? ` · ${event.performed_by_username}`
                          : ""}
                      </li>
                    ),
                  )}
                </ul>
              </section>
            ) : null}

            <section className="space-y-2 border-t border-border/60 pt-4">
              <h4 className="text-xs uppercase tracking-widest text-primary">
                Review decision
              </h4>

              <Select
                value={status}
                onValueChange={
                  setStatus
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {REVIEW_STATUSES.map(
                    (
                      item,
                    ) => (
                      <SelectItem
                        key={
                          item.value
                        }
                        value={
                          item.value
                        }
                      >
                        {
                          item.label
                        }
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>

              <Textarea
                placeholder="Moderator note"
                value={note}
                onChange={(
                  event,
                ) =>
                  setNote(
                    event
                      .target
                      .value,
                  )
                }
              />

              <Button
                onClick={() =>
                  save.mutate()
                }
                disabled={
                  save.isPending
                }
              >
                Save decision
              </Button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

function SettingsPanel() {
  const qc = useQueryClient();

  const getFn = useServerFn(
    getFriendVotingSettings,
  );

  const saveFn = useServerFn(
    saveFriendVotingSettings,
  );

  const [
    draft,
    setDraft,
  ] =
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
          settings:
            draft!,
        },
      }) as Promise<any>,

    onSuccess: () => {
      toast.success(
        "Detection settings saved · recalculate to apply",
      );

      void qc.invalidateQueries({
        queryKey: [
          "fv.settings",
        ],
      });
    },

    onError: (
      error: any,
    ) =>
      toast.error(
        error?.message ??
          "Could not save settings",
      ),
  });

  if (
    settings.isLoading ||
    !draft
  ) {
    return <TableSkeleton />;
  }

  const setTopLevelNumber = (
    key: keyof FriendVotingSettings,
    value: number,
  ) => {
    setDraft({
      ...draft,
      [key]: value,
    } as FriendVotingSettings);
  };

  return (
    <div className="glass-strong space-y-5 rounded-2xl p-4 sm:p-5">
      <div>
        <h3 className="font-semibold">
          Core thresholds
        </h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Minimum shared opportunities"
            value={
              draft.minOpportunities
            }
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "minOpportunities",
                value,
              )
            }
          />

          <NumberField
            label="Support frequency threshold"
            value={
              draft.supportFrequencyThreshold
            }
            step={0.05}
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "supportFrequencyThreshold",
                value,
              )
            }
          />

          <NumberField
            label="Top-three threshold"
            value={
              draft.topThreeThreshold
            }
            step={0.05}
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "topThreeThreshold",
                value,
              )
            }
          />

          <NumberField
            label="Maximum-score threshold"
            value={
              draft.maximumScoreThreshold
            }
            step={0.05}
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "maximumScoreThreshold",
                value,
              )
            }
          />

          <NumberField
            label="Preference-lift threshold"
            value={
              draft.preferenceLiftThreshold
            }
            step={0.1}
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "preferenceLiftThreshold",
                value,
              )
            }
          />

          <NumberField
            label="Audience-uplift threshold"
            value={
              draft.audienceUpliftThreshold
            }
            step={0.1}
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "audienceUpliftThreshold",
                value,
              )
            }
          />

          <NumberField
            label="Minimum editions"
            value={
              draft.minEditions
            }
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "minEditions",
                value,
              )
            }
          />

          <NumberField
            label="Streak threshold"
            value={
              draft.streakThreshold
            }
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "streakThreshold",
                value,
              )
            }
          />

          <NumberField
            label="Small-sample penalty"
            value={
              draft.smallSamplePenalty
            }
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "smallSamplePenalty",
                value,
              )
            }
          />

          <NumberField
            label="Group internal share threshold"
            value={
              draft.cliqueInternalShareThreshold
            }
            step={0.05}
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "cliqueInternalShareThreshold",
                value,
              )
            }
          />

          <NumberField
            label="Group minimum edge risk"
            value={
              draft.cliqueMinEdgeRisk
            }
            onChange={(
              value,
            ) =>
              setTopLevelNumber(
                "cliqueMinEdgeRisk",
                value,
              )
            }
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={
            draft.ignoreTestBallots
          }
          onCheckedChange={(
            value,
          ) =>
            setDraft({
              ...draft,
              ignoreTestBallots:
                value,
            })
          }
        />

        Exclude test /
        administrative
        deletions from
        integrity evidence
      </label>

      <div>
        <h3 className="font-semibold">
          Signal weights
        </h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(
            draft.weights,
          ).map(
            ([
              key,
              value,
            ]) => (
              <NumberField
                key={key}
                label={humanizeKey(
                  key,
                )}
                value={
                  value
                }
                onChange={(
                  next,
                ) =>
                  setDraft({
                    ...draft,
                    weights: {
                      ...draft.weights,
                      [key]:
                        next,
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
          {Object.entries(
            draft.riskBands,
          ).map(
            ([
              key,
              value,
            ]) => (
              <NumberField
                key={key}
                label={humanizeKey(
                  key,
                )}
                value={
                  value
                }
                onChange={(
                  next,
                ) =>
                  setDraft({
                    ...draft,
                    riskBands: {
                      ...draft.riskBands,
                      [key]:
                        next,
                    },
                  })
                }
              />
            ),
          )}
        </div>
      </div>

      <Button
        onClick={() =>
          save.mutate()
        }
        disabled={
          save.isPending
        }
      >
        Save settings
      </Button>
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
  onChange: (
    value: number,
  ) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
      </Label>

      <Input
        type="number"
        step={step}
        value={String(
          value,
        )}
        onChange={(
          event,
        ) =>
          onChange(
            Number(
              event.target
                .value,
            ),
          )
        }
      />
    </div>
  );
}

function humanizeKey(
  value: string,
) {
  return value
    .replace(
      /([a-z])([A-Z])/g,
      "$1 $2",
    )
    .replace(
      /_/g,
      " ",
    )
    .replace(
      /^./,
      (letter) =>
        letter.toUpperCase(),
    );
}
