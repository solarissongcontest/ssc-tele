import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { TableSkeleton } from "@/components/panel-skeleton";
import { CountryFlag } from "@/components/country-flag";
import { toast } from "sonner";
import {
  listFriendVotingRelationships,
  getFriendVotingRelationship,
  listFriendVotingGroups,
  listModerationHistory,
  recalculateFriendVoting,
  getFriendVotingSettings,
  saveFriendVotingSettings,
  setRelationshipReview,
  type RelationshipRow,
} from "@/lib/friend-voting.functions";
import type { FriendVotingSettings } from "@/lib/friend-voting-math";
import { downloadCSV } from "@/lib/export";
import { Heart, RefreshCcw, Users, History, Sliders, Search } from "lucide-react";

export const Route = createFileRoute("/admin/friend-voting")({
  head: () => ({
    meta: [
      { title: "Friend-Voting Analysis — Solaris Admin" },
      {
        name: "description",
        content:
          "Long-term relationship analysis between Solaris delegations: preferential voting, reciprocity, friend groups and moderation history.",
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
  if (score >= 80) return "bg-destructive text-destructive-foreground";
  if (score >= 65) return "bg-amber-500/25 text-amber-400";
  if (score >= 50) return "bg-primary/25 text-primary";
  return "bg-muted text-muted-foreground";
}

function FriendVotingPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listFriendVotingRelationships);
  const groupsFn = useServerFn(listFriendVotingGroups);
  const historyFn = useServerFn(listModerationHistory);
  const recalcFn = useServerFn(recalculateFriendVoting);

  const [search, setSearch] = useState("");
  const [minRisk, setMinRisk] = useState(0);
  const [reviewStatus, setReviewStatus] = useState<string>("all");
  const [onlyRepeated, setOnlyRepeated] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const rels = useQuery({
    queryKey: ["fv.rels", search, minRisk, reviewStatus, onlyRepeated],
    queryFn: () =>
      listFn({
        data: {
          search,
          minRisk,
          reviewStatus: reviewStatus === "all" ? null : reviewStatus,
          onlyRepeated,
        },
      }) as Promise<RelationshipRow[]>,
  });
  const groups = useQuery({
    queryKey: ["fv.groups"],
    queryFn: () => groupsFn() as Promise<any[]>,
  });
  const history = useQuery({
    queryKey: ["fv.history"],
    queryFn: () => historyFn({ data: {} }) as Promise<any[]>,
  });

  const recalc = useMutation({
    mutationFn: () => recalcFn() as Promise<any>,
    onSuccess: (r) => {
      toast.success(
        `Analysis rebuilt — ${r.relationships} relationships, ${r.groups} friend groups`,
      );
      qc.invalidateQueries({ queryKey: ["fv.rels"] });
      qc.invalidateQueries({ queryKey: ["fv.groups"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Recalculation failed"),
  });

  const rows = rels.data ?? [];
  const summary = useMemo(() => {
    const high = rows.filter((r) => r.risk_score >= 65).length;
    const repeated = rows.filter((r) => r.repeated_after_moderation).length;
    const watch = rows.filter((r) => r.review_status === "watchlist").length;
    return { total: rows.length, high, repeated, watch };
  }, [rows]);

  return (
    <AdminShell title="Friend-Voting Analysis">
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Relationships are tracked by the permanent delegation identity (the
            fictional voting country), across every edition and round. Deleted
            ballots stay in this evidence set even though they no longer affect
            official results.
          </p>
          <Button onClick={() => recalc.mutate()} disabled={recalc.isPending}>
            <RefreshCcw
              className={recalc.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
            {recalc.isPending ? "Analysing…" : "Recalculate analysis"}
          </Button>
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Relationships" value={summary.total} />
          <Stat label="High risk (65+)" value={summary.high} />
          <Stat label="Repeat offenders" value={summary.repeated} />
          <Stat label="On watchlist" value={summary.watch} />
        </div>

        <Tabs defaultValue="relationships">
          <TabsList>
            <TabsTrigger value="relationships">
              <Heart className="mr-1.5 h-4 w-4" /> Relationships
            </TabsTrigger>
            <TabsTrigger value="groups">
              <Users className="mr-1.5 h-4 w-4" /> Friend groups
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="mr-1.5 h-4 w-4" /> Moderation history
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Sliders className="mr-1.5 h-4 w-4" /> Detection settings
            </TabsTrigger>
          </TabsList>

          {/* ---------------------------------------------- relationships */}
          <TabsContent value="relationships" className="mt-4 space-y-4">
            <div className="glass-strong flex flex-wrap items-end gap-4 rounded-2xl p-4">
              <div className="min-w-[200px] flex-1 space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-primary">
                  Country
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search voting or target country"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
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
                  onValueChange={(v) => setMinRisk(v[0] ?? 0)}
                />
              </div>
              <div className="w-52 space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-primary">
                  Review status
                </Label>
                <Select value={reviewStatus} onValueChange={setReviewStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {REVIEW_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch checked={onlyRepeated} onCheckedChange={setOnlyRepeated} />
                <span className="text-sm">Repeat offenders only</span>
              </div>
              {rows.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCSV(
                      "friend-voting-relationships.csv",
                      rows.map((r) => ({
                        voting_country: r.voting_country_code,
                        target_country: r.target_country_code,
                        opportunities: r.shared_opportunities,
                        support: r.support_count,
                        max_scores: r.maximum_score_count,
                        deleted_max_scores: r.deleted_maximum_score_count,
                        avg_points: r.average_points,
                        preference_lift: r.preference_lift,
                        audience_uplift: r.audience_uplift,
                        reciprocity: r.reciprocity_score,
                        risk: r.risk_score,
                        label: r.risk_label,
                        review_status: r.review_status,
                      })),
                    )
                  }
                >
                  Export CSV
                </Button>
              )}
            </div>

            {rels.isLoading ? (
              <TableSkeleton />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Heart}
                title="No relationship data yet"
                body="Run the analysis to build the historical relationship dataset."
              />
            ) : (
              <div className="glass-strong overflow-x-auto rounded-2xl p-2">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pl-2 pr-3 text-left">Voting country</th>
                      <th className="py-2 pr-3 text-left">Target</th>
                      <th className="py-2 pr-3 text-right">Opps</th>
                      <th className="py-2 pr-3 text-right">Support</th>
                      <th className="py-2 pr-3 text-right">Max</th>
                      <th className="py-2 pr-3 text-right">Avg</th>
                      <th className="py-2 pr-3 text-right">Lift</th>
                      <th className="py-2 pr-3 text-right">Uplift</th>
                      <th className="py-2 pr-3 text-right">Recip.</th>
                      <th className="py-2 pr-3 text-right">Risk</th>
                      <th className="py-2 pr-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="cursor-pointer border-t border-border/60 hover:bg-primary/5"
                        onClick={() => setOpenId(r.id)}
                      >
                        <td className="py-2 pl-2 pr-3">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <CountryFlag code={r.voting_country_code} className="h-4 w-6" />
                            {r.voting_country_code}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <span className="inline-flex items-center gap-1.5">
                            <CountryFlag code={r.target_country_code} className="h-4 w-6" />
                            {r.target_country_code}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.shared_opportunities}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.support_count} ({Math.round(r.support_frequency * 100)}%)
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.maximum_score_count}
                          {r.deleted_maximum_score_count > 0 && (
                            <span className="text-muted-foreground">
                              {" "}
                              (+{r.deleted_maximum_score_count} del)
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.average_points.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.preference_lift.toFixed(2)}×
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.audience_uplift >= 0 ? "+" : ""}
                          {r.audience_uplift.toFixed(1)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.reciprocity_score.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Badge className={riskClass(r.risk_score)}>
                            {r.risk_score}
                          </Badge>
                        </td>
                        <td className="py-2 pr-2">
                          <Badge variant="outline" className="text-[10px]">
                            {REVIEW_STATUSES.find((s) => s.value === r.review_status)
                              ?.label ?? r.review_status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ------------------------------------------------- groups */}
          <TabsContent value="groups" className="mt-4">
            {groups.isLoading ? (
              <TableSkeleton />
            ) : (groups.data ?? []).length === 0 ? (
              <EmptyState
                icon={Users}
                title="No friend groups detected"
                body="Groups appear when three or more delegations repeatedly exchange their highest scores."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {(groups.data ?? []).map((g) => (
                  <div key={g.id} className="glass-strong rounded-2xl p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="font-semibold">
                        {g.label} · {g.members.length} delegations
                      </h3>
                      <Badge className={riskClass(g.risk_score)}>{g.risk_score}</Badge>
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">{g.risk_label}</p>
                    <div className="mb-3 flex flex-wrap gap-1">
                      {g.members.map((m: string) => (
                        <Badge key={m} variant="outline" className="text-[10px]">
                          {m}
                        </Badge>
                      ))}
                    </div>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {(g.reasons ?? []).map((r: string, i: number) => (
                        <li key={i}>• {r}</li>
                      ))}
                    </ul>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <Metric
                        label="Internal max share"
                        value={`${Math.round(g.internal_maximum_share * 100)}%`}
                      />
                      <Metric
                        label="Internal top-3 share"
                        value={`${Math.round(g.internal_top_three_share * 100)}%`}
                      />
                      <Metric
                        label="Avg internal support"
                        value={Number(g.average_internal_support).toFixed(2)}
                      />
                      <Metric
                        label="Avg external support"
                        value={Number(g.average_external_support).toFixed(2)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ------------------------------------------------ history */}
          <TabsContent value="history" className="mt-4">
            {history.isLoading ? (
              <TableSkeleton />
            ) : (history.data ?? []).length === 0 ? (
              <EmptyState
                icon={History}
                title="No moderation history"
                body="Every moderation action on a ballot or relationship is recorded here permanently."
              />
            ) : (
              <div className="glass-strong overflow-x-auto rounded-2xl p-2">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pl-2 pr-3 text-left">When</th>
                      <th className="py-2 pr-3 text-left">Delegation</th>
                      <th className="py-2 pr-3 text-left">Target</th>
                      <th className="py-2 pr-3 text-left">Action</th>
                      <th className="py-2 pr-3 text-left">Category</th>
                      <th className="py-2 pr-3 text-left">Moderator</th>
                      <th className="py-2 pr-2 text-left">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(history.data ?? []).map((e) => (
                      <tr key={e.id} className="border-t border-border/60">
                        <td className="py-2 pl-2 pr-3 whitespace-nowrap text-muted-foreground">
                          {new Date(e.performed_at).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3">{e.voting_country_code ?? "—"}</td>
                        <td className="py-2 pr-3">{e.target_country_code ?? "—"}</td>
                        <td className="py-2 pr-3">{e.action}</td>
                        <td className="py-2 pr-3">{e.reason_category ?? "—"}</td>
                        <td className="py-2 pr-3">{e.performed_by_username ?? "—"}</td>
                        <td className="py-2 pr-2 text-muted-foreground">
                          {e.moderator_note ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ----------------------------------------------- settings */}
          <TabsContent value="settings" className="mt-4">
            <SettingsPanel />
          </TabsContent>
        </Tabs>
      </div>

      <RelationshipDialog id={openId} onClose={() => setOpenId(null)} />
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass-strong rounded-2xl p-4">
      <p className="text-xs uppercase tracking-widest text-primary">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 p-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
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
  const detailFn = useServerFn(getFriendVotingRelationship);
  const reviewFn = useServerFn(setRelationshipReview);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("under_review");

  const detail = useQuery({
    queryKey: ["fv.detail", id],
    queryFn: () => detailFn({ data: { id: id! } }) as Promise<any>,
    enabled: !!id,
  });

  const save = useMutation({
    mutationFn: () => reviewFn({ data: { id: id!, status, note } }) as Promise<any>,
    onSuccess: () => {
      toast.success("Review status saved");
      qc.invalidateQueries({ queryKey: ["fv.rels"] });
      qc.invalidateQueries({ queryKey: ["fv.detail", id] });
      qc.invalidateQueries({ queryKey: ["fv.history"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  const rel = detail.data?.relationship;

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rel
              ? `${rel.voting_country_code} → ${rel.target_country_code}`
              : "Relationship"}
          </DialogTitle>
        </DialogHeader>
        {!rel ? (
          <TableSkeleton />
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Badge className={riskClass(rel.risk_score)}>
                Risk {rel.risk_score}
              </Badge>
              <span className="text-sm text-muted-foreground">{rel.risk_label}</span>
            </div>

            <section>
              <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
                Why this score
              </h4>
              <ul className="space-y-1 text-sm">
                {(rel.reasons ?? []).map((r: any, i: number) => (
                  <li key={i} className="flex items-start justify-between gap-3">
                    <span>{r.text}</span>
                    <span
                      className={
                        r.delta >= 0
                          ? "tabular-nums text-amber-400"
                          : "tabular-nums text-emerald-400"
                      }
                    >
                      {r.delta > 0 ? "+" : ""}
                      {r.delta}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Opportunities" value={String(rel.shared_opportunities)} />
              <Metric label="Support rate" value={`${Math.round(rel.support_frequency * 100)}%`} />
              <Metric label="Max scores" value={String(rel.maximum_score_count)} />
              <Metric label="Preference lift" value={`${rel.preference_lift}×`} />
              <Metric label="Audience uplift" value={String(rel.audience_uplift)} />
              <Metric label="Longest streak" value={String(rel.longest_support_streak)} />
              <Metric label="Editions" value={String(rel.editions_count)} />
              <Metric label="Reciprocity" value={String(rel.reciprocity_score)} />
            </section>

            <section>
              <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
                Timeline
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 text-left">Edition</th>
                      <th className="py-1 pr-3 text-left">Round</th>
                      <th className="py-1 pr-3 text-right">Points</th>
                      <th className="py-1 pr-3 text-right">Rank</th>
                      <th className="py-1 pr-3 text-right">Audience avg</th>
                      <th className="py-1 text-left">Ballot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rel.timeline ?? []).map((t: any, i: number) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-1 pr-3">{t.editionName}</td>
                        <td className="py-1 pr-3">{t.roundName}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {t.points}
                          {t.points >= t.maxScore && t.points > 0 ? " ★" : ""}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {t.ballotRank ?? "—"}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {t.audienceAverage}
                        </td>
                        <td className="py-1">
                          {t.status === "deleted" ? (
                            <Badge variant="destructive" className="text-[10px]">
                              deleted{t.deletionCategory ? ` · ${t.deletionCategory}` : ""}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              {t.status}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {(detail.data?.moderationEvents ?? []).length > 0 && (
              <section>
                <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
                  Moderation history for this delegation
                </h4>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {detail.data.moderationEvents.map((e: any) => (
                    <li key={e.id}>
                      {new Date(e.performed_at).toLocaleString()} — {e.action}
                      {e.target_country_code ? ` (${e.target_country_code})` : ""}
                      {e.reason_category ? ` · ${e.reason_category}` : ""}
                      {e.performed_by_username ? ` · ${e.performed_by_username}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-2 border-t border-border/60 pt-4">
              <h4 className="text-xs uppercase tracking-widest text-primary">
                Review decision
              </h4>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REVIEW_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                placeholder="Moderator note (stored permanently in the integrity history)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                Save decision
              </Button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsPanel() {
  const qc = useQueryClient();
  const getFn = useServerFn(getFriendVotingSettings);
  const saveFn = useServerFn(saveFriendVotingSettings);
  const [draft, setDraft] = useState<FriendVotingSettings | null>(null);

  const q = useQuery({
    queryKey: ["fv.settings"],
    queryFn: async () => {
      const s = (await getFn()) as FriendVotingSettings;
      setDraft(s);
      return s;
    },
  });

  const save = useMutation({
    mutationFn: () => saveFn({ data: { settings: draft! } }) as Promise<any>,
    onSuccess: () => {
      toast.success("Detection settings saved — recalculate to apply");
      qc.invalidateQueries({ queryKey: ["fv.settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save settings"),
  });

  if (q.isLoading || !draft) return <TableSkeleton />;

  const num = (
    label: string,
    key: keyof FriendVotingSettings,
    step = 1,
  ) => (
    <div className="space-y-1.5" key={String(key)}>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step={step}
        value={String(draft[key] as number)}
        onChange={(e) =>
          setDraft({ ...draft, [key]: Number(e.target.value) } as FriendVotingSettings)
        }
      />
    </div>
  );

  return (
    <div className="glass-strong space-y-5 rounded-2xl p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {num("Minimum shared opportunities", "minOpportunities")}
        {num("Support frequency threshold", "supportFrequencyThreshold", 0.05)}
        {num("Top-three threshold", "topThreeThreshold", 0.05)}
        {num("Maximum-score threshold", "maximumScoreThreshold", 0.05)}
        {num("Preference-lift threshold", "preferenceLiftThreshold", 0.1)}
        {num("Minimum editions", "minEditions")}
        {num("Streak threshold", "streakThreshold")}
        {num("Small-sample penalty", "smallSamplePenalty")}
        {num("Group internal share threshold", "cliqueInternalShareThreshold", 0.05)}
        {num("Group minimum edge risk", "cliqueMinEdgeRisk")}
      </div>

      <div>
        <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
          Signal weights
        </h4>
        <div className="grid gap-3 sm:grid-cols-4">
          {Object.entries(draft.weights).map(([k, v]) => (
            <div key={k} className="space-y-1.5">
              <Label className="text-xs capitalize">
                {k.replace(/([A-Z])/g, " $1")}
              </Label>
              <Input
                type="number"
                value={String(v)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    weights: { ...draft.weights, [k]: Number(e.target.value) },
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs uppercase tracking-widest text-primary">
          Risk bands
        </h4>
        <div className="grid gap-3 sm:grid-cols-5">
          {Object.entries(draft.riskBands).map(([k, v]) => (
            <div key={k} className="space-y-1.5">
              <Label className="text-xs capitalize">{k}</Label>
              <Input
                type="number"
                value={String(v)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    riskBands: { ...draft.riskBands, [k]: Number(e.target.value) },
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={draft.ignoreTestBallots}
          onCheckedChange={(v) => setDraft({ ...draft, ignoreTestBallots: v })}
        />
        <span className="text-sm">
          Exclude test / administrative deletions from integrity evidence
        </span>
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        Save settings
      </Button>
    </div>
  );
}
