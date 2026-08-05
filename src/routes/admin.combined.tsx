import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Layers,
  Plus,
  Trash2,
  RefreshCcw,
  Loader2,
  Lock,
  Radio,
  Download,
  AlertTriangle,
  ChevronDown,
  Save,
} from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAllRounds, useAllCountries } from "@/hooks/use-round-results";
import { CountryFlag, countryName } from "@/components/country-flag";
import { downloadCSV, downloadJSON } from "@/lib/export";
import {
  listAggregations,
  createAggregation,
  deleteAggregation,
  getAggregation,
  updateAggregation,
  setAggregationParticipants,
  upsertSource,
  deleteSource,
  upsertExternalEntry,
  recalculateCombined,
  setAggregationStatus,
} from "@/lib/combined.functions";

export const Route = createFileRoute("/admin/combined")({
  head: () => ({
    meta: [
      { title: "Combined Televote — Solaris Admin" },
      {
        name: "description",
        content:
          "Combine multiple Solaris voting rounds, Instagram results, imported votes and activity points into one final televote result.",
      },
    ],
  }),
  component: CombinedPage,
});

const SOURCE_TYPES = [
  { value: "round", label: "Website voting round" },
  { value: "instagram", label: "Instagram Stories" },
  { value: "external_televote", label: "External televote" },
  { value: "imported", label: "Imported results" },
  { value: "activity", label: "Activity points" },
  { value: "correction", label: "Correction / adjustment" },
  { value: "other", label: "Other" },
];

const num = (v: number, d = 3) =>
  Number.isFinite(Number(v))
    ? Number(v).toLocaleString(undefined, { maximumFractionDigits: d })
    : "—";

function CombinedPage() {
  const qc = useQueryClient();
  const { data: rounds } = useAllRounds();
  const { data: countries } = useAllCountries();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const listFn = useServerFn(listAggregations);
  const createFn = useServerFn(createAggregation);
  const removeFn = useServerFn(deleteAggregation);
  const detailFn = useServerFn(getAggregation);
  const updateFn = useServerFn(updateAggregation);
  const participantsFn = useServerFn(setAggregationParticipants);
  const sourceFn = useServerFn(upsertSource);
  const deleteSourceFn = useServerFn(deleteSource);
  const entryFn = useServerFn(upsertExternalEntry);
  const recalcFn = useServerFn(recalculateCombined);
  const statusFn = useServerFn(setAggregationStatus);

  const list = useQuery({
    queryKey: ["combined-aggregations"],
    queryFn: async () => (await listFn()) as any[],
    refetchInterval: 15_000,
  });

  const activeId = selectedId ?? list.data?.[0]?.id ?? null;

  const detail = useQuery({
    queryKey: ["combined-aggregation", activeId],
    queryFn: async () =>
      activeId ? await detailFn({ data: { id: activeId } }) : null,
    enabled: !!activeId,
    refetchInterval: 10_000,
  });

  const agg = detail.data?.agg ?? null;
  const preview = detail.data?.preview ?? null;
  const sources = detail.data?.sources ?? [];
  const participants = detail.data?.participants ?? [];
  const entries = detail.data?.entries ?? [];
  const log = detail.data?.log ?? [];

  const [tInput, setTInput] = useState("");
  const [eInput, setEInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  useEffect(() => {
    if (agg) {
      setTInput(String(agg.total_points_to_distribute));
      setEInput(String(agg.rank_exponent));
      setNameInput(agg.name);
    }
  }, [agg?.id, agg?.calculation_version, agg?.total_points_to_distribute]);

  const byCode = useMemo(() => {
    const m = new Map<string, any>();
    (countries ?? []).forEach((c) => m.set(c.code, c));
    return m;
  }, [countries]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["combined-aggregation", activeId] });
    qc.invalidateQueries({ queryKey: ["combined-aggregations"] });
  };

  const run = <T,>(fn: (v: T) => Promise<unknown>, ok: string) =>
    useMutation({
      mutationFn: fn,
      onSuccess: () => {
        toast.success(ok);
        refresh();
      },
      onError: (e: any) => toast.error(e?.message ?? "Something went wrong"),
    });

  const createMut = run(
    async (name: string) => await createFn({ data: { name } }),
    "Combined result created",
  );
  const updateMut = run(
    async (patch: any) => await updateFn({ data: { id: activeId!, ...patch } }),
    "Saved",
  );
  const participantsMut = run(
    async (codes: string[]) =>
      await participantsFn({ data: { id: activeId!, codes } }),
    "Countries updated",
  );
  const sourceMut = run(
    async (patch: any) =>
      await sourceFn({ data: { aggregationId: activeId!, ...patch } }),
    "Source saved",
  );
  const sourceDeleteMut = run(
    async (id: string) => await deleteSourceFn({ data: { id } }),
    "Source removed",
  );
  const entryMut = run(
    async (payload: any) => await entryFn({ data: payload }),
    "Value saved",
  );
  const recalcMut = useMutation({
    mutationFn: async (confirm: boolean) =>
      await recalcFn({ data: { id: activeId!, confirm } }),
    onSuccess: (res: any) => {
      toast.success(
        `Recalculated · v${res.version} · ${res.distributedConverted} converted points distributed`,
      );
      (res.warnings ?? []).forEach((w: string) => toast.warning(w));
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Calculation failed"),
  });
  const statusMut = run(
    async (status: any) => await statusFn({ data: { id: activeId!, status } }),
    "Status updated",
  );
  const deleteMut = run(async (id: string) => {
    await removeFn({ data: { id } });
    setSelectedId(null);
  }, "Combined result deleted");

  const [entryDialog, setEntryDialog] = useState<{ sourceId: string } | null>(null);

  const locked = agg?.status === "locked" || agg?.status === "published";

  const exportRows = () =>
    (preview?.rows ?? []).map((r: any) => ({
      rank: r.finalRank,
      country: countryName(byCode.get(r.code)) || r.code,
      code: r.code,
      voting_points: r.totalVotingPoints,
      activity_points: r.totalActivityPoints,
      correction: r.finalCorrection,
      final: r.finalCombinedPoints,
      ...Object.fromEntries(
        (preview?.pools ?? []).map((p: any) => [
          `pool_${p.sourceName}`,
          r.componentResults.find((c: any) => c.sourceId === p.sourceId)
            ?.finalAllocatedPoints ?? 0,
        ]),
      ),
    }));


  return (
    <AdminShell title="Combined Televote">
      <div className="space-y-6">
        {/* Aggregation list */}
        <section className="glass rounded-3xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Combined results</h2>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="e.g. Grand Final Combined Televote"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              onClick={() => {
                createMut.mutate(newName);
                setNewName("");
              }}
              disabled={newName.trim().length < 2 || createMut.isPending}
            >
              <Plus className="h-4 w-4" /> Create
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(list.data ?? []).map((a: any) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={`rounded-full px-4 py-2 text-sm border transition ${
                  a.id === activeId
                    ? "border-primary/60 text-foreground"
                    : "border-white/10 text-muted-foreground"
                }`}
              >
                {a.name}
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {a.status}
                </Badge>
              </button>
            ))}
            {!list.isLoading && (list.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No combined results yet — create one above.
              </p>
            )}
          </div>
        </section>

        {agg && (
          <>
            {/* Settings */}
            <section className="glass rounded-3xl p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold">Configuration</h3>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{agg.status}</Badge>
                  {agg.calculation_version > 0 && (
                    <Badge variant="outline">v{agg.calculation_version}</Badge>
                  )}
                  {agg.results_outdated && (
                    <Badge className="bg-amber-500/20 text-amber-200">
                      <AlertTriangle className="h-3 w-3 mr-1" /> Outdated
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <div className="flex gap-2">
                    <Input
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => updateMut.mutate({ name: nameInput })}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Component weights</Label>
                  <div className="rounded-2xl border border-white/10 px-3 py-2 text-sm">
                    {preview ? (
                      <span
                        className={
                          Math.abs(preview.totalPercentage - 100) < 1e-6
                            ? "text-foreground"
                            : "text-amber-300"
                        }
                      >
                        Enabled components total {num(preview.totalPercentage)}% — must
                        be exactly 100%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Loading…</span>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Total televote points (T)</Label>
                  <div className="flex gap-2">
                    <Input
                      inputMode="numeric"
                      value={tInput}
                      onChange={(e) => setTInput(e.target.value)}
                    />
                    <Button
                      variant="secondary"
                      onClick={() =>
                        updateMut.mutate({ totalPoints: Number(tInput) })
                      }
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Rank exponent</Label>
                  <div className="flex gap-2">
                    <Input value={eInput} onChange={(e) => setEInput(e.target.value)} />
                    <Button
                      variant="secondary"
                      onClick={() =>
                        updateMut.mutate({ rankExponent: Number(eInput) })
                      }
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Formula: combinedOriginal<sub>i</sub> × ({participants.length + 2} −
                combinedRank<sub>i</sub>)<sup>{Number(agg.rank_exponent)}</sup> — shares
                of T distributed by the largest remainder method, so converted points
                total exactly {agg.total_points_to_distribute}.
              </p>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => recalcMut.mutate(locked)}
                  disabled={recalcMut.isPending}
                >
                  {recalcMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                  Recalculate
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => statusMut.mutate("locked")}
                >
                  <Lock className="h-4 w-4" /> Lock
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => statusMut.mutate("published")}
                >
                  <Radio className="h-4 w-4" /> Publish
                </Button>
                {locked && (
                  <Button
                    variant="ghost"
                    onClick={() => statusMut.mutate("calculated")}
                  >
                    Unlock / unpublish
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() =>
                    downloadCSV(`${agg.name}-combined-televote.csv`, exportRows())
                  }
                >
                  <Download className="h-4 w-4" /> CSV
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    downloadJSON(`${agg.name}-combined-audit.json`, {
                      aggregation: agg,
                      sources,
                      preview,
                    })
                  }
                >
                  Audit JSON
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => deleteMut.mutate(agg.id)}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </div>

              <div className="grid gap-2 sm:grid-cols-3 pt-2 border-t border-white/10">
                {(
                  [
                    ["sources", "Show individual source values publicly"],
                    ["combined_original", "Show combined original score publicly"],
                    ["converted", "Show converted points publicly"],
                    ["bonus", "Show bonus / activity points publicly"],
                    ["final", "Show final televote score publicly"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={
                        key === "converted" || key === "bonus" || key === "final"
                          ? (agg.public_columns?.[key] ?? true) !== false
                          : !!agg.public_columns?.[key]
                      }
                      onCheckedChange={(v) =>
                        updateMut.mutate({
                          publicColumns: { ...(agg.public_columns ?? {}), [key]: v },
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </section>

            {/* Participants */}
            <ParticipantsSection
              countries={countries ?? []}
              participants={participants}
              onSave={(codes) => participantsMut.mutate(codes)}
            />

            {/* Sources */}
            <section className="glass rounded-3xl p-5 space-y-4">
              <h3 className="text-base font-semibold">Sources</h3>
              <div className="rounded-2xl border border-white/10 p-3 text-xs text-muted-foreground space-y-1">
                <p>
                  <span className="text-foreground font-medium">Before conversion:</span>{" "}
                  affects the combined original score, the original rank and the
                  converted point distribution.
                </p>
                <p>
                  <span className="text-foreground font-medium">After conversion:</span>{" "}
                  adds directly to the final score and does not affect the converted
                  point distribution.
                </p>
              </div>

              <div className="space-y-3">
                {sources.map((s: any) => (
                  <div
                    key={s.id}
                    className="rounded-2xl border border-white/10 p-3 space-y-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(v) =>
                          sourceMut.mutate({ id: s.id, enabled: v })
                        }
                      />
                      <Input
                        className="max-w-[220px]"
                        defaultValue={s.source_name}
                        onBlur={(e) =>
                          e.target.value !== s.source_name &&
                          sourceMut.mutate({ id: s.id, sourceName: e.target.value })
                        }
                      />
                      <Select
                        value={s.calculation_stage}
                        onValueChange={(v) => sourceMut.mutate({ id: s.id, stage: v })}
                      >
                        <SelectTrigger className="w-[190px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pre_conversion">Before conversion</SelectItem>
                          <SelectItem value="post_conversion">After conversion</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs">Weight</Label>
                        <Input
                          className="w-20"
                          defaultValue={String(s.weight)}
                          onBlur={(e) =>
                            Number(e.target.value) !== Number(s.weight) &&
                            sourceMut.mutate({ id: s.id, weight: Number(e.target.value) })
                          }
                        />
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {SOURCE_TYPES.find((t) => t.value === s.source_type)?.label ??
                          s.source_type}
                      </Badge>
                      {!s.source_round_id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEntryDialog({ sourceId: s.id })}
                        >
                          <Plus className="h-3 w-3" /> Values
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive ml-auto"
                        onClick={() => sourceDeleteMut.mutate(s.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {!s.source_round_id && (
                      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        {entries
                          .filter((e: any) => e.source_id === s.id)
                          .map((e: any) => (
                            <span
                              key={e.id}
                              className="rounded-full border border-white/10 px-2 py-1"
                            >
                              {countryName(byCode.get(e.country_code)) || e.country_code}:{" "}
                              <span className="text-foreground">{Number(e.value)}</span>
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <AddSourceForm
                rounds={rounds ?? []}
                onAdd={(patch) => sourceMut.mutate(patch)}
              />
            </section>

            {/* Preview table */}
            <section className="glass rounded-3xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Combined result preview</h3>
                {preview && (
                  <p className="text-xs text-muted-foreground">
                    Allocated {preview.allocatedTotal} / G{" "}
                    {preview.totalPoints} · Final total {num(preview.finalTotal)}
                  </p>
                )}
              </div>
              {(preview?.warnings ?? []).map((w: string) => (
                <p key={w} className="text-xs text-amber-300">
                  <AlertTriangle className="inline h-3 w-3 mr-1" />
                  {w}
                </p>
              ))}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Country</th>
                      {(preview?.pools ?? []).map((p: any) => (
                        <th key={p.sourceId} className="py-2 pr-3 text-right">
                          {p.sourceName}
                          <span className="block text-[10px] normal-case text-muted-foreground">
                            {num(p.percentageWeight)}% · {p.finalPool} pts
                          </span>
                        </th>
                      ))}
                      <th className="py-2 pr-3 text-right">Voting</th>
                      <th className="py-2 pr-3 text-right">Activity</th>
                      <th className="py-2 pr-3 text-right">Correction</th>
                      <th className="py-2 pr-3 text-right">Final</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(preview?.rows ?? []).map((r: any) => {
                      const c = byCode.get(r.code);
                      const open = expanded === r.code;
                      const comp = (id: string) =>
                        r.componentResults.find((x: any) => x.sourceId === id);
                      return (
                        <>
                          <tr key={r.code} className="border-t border-white/5">
                            <td className="py-2 pr-3 tabular-nums">{r.finalRank}</td>
                            <td className="py-2 pr-3">
                              <span className="flex items-center gap-2">
                                <CountryFlag country={c} size={18} />
                                {countryName(c) || r.code}
                              </span>
                            </td>
                            {(preview?.pools ?? []).map((p: any) => {
                              const cr = comp(p.sourceId);
                              return (
                                <td
                                  key={p.sourceId}
                                  className="py-2 pr-3 text-right tabular-nums"
                                >
                                  {cr ? (
                                    <>
                                      <span className="font-medium">
                                        {cr.finalAllocatedPoints}
                                      </span>
                                      <span className="block text-[10px] text-muted-foreground">
                                        raw {num(cr.rawScore)}
                                        {cr.rawRank ? ` · #${cr.rawRank}` : ""}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground">0*</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {r.totalVotingPoints}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {r.totalActivityPoints}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {num(r.finalCorrection)}
                            </td>
                            <td className="py-2 pr-3 text-right text-base font-semibold tabular-nums">
                              {r.finalCombinedPoints}
                            </td>
                            <td>
                              <button
                                onClick={() => setExpanded(open ? null : r.code)}
                                className="text-muted-foreground"
                              >
                                <ChevronDown
                                  className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}
                                />
                              </button>
                            </td>
                          </tr>
                          {open && (
                            <tr key={r.code + "-d"} className="bg-white/[0.03]">
                              <td
                                colSpan={7 + (preview?.pools ?? []).length}
                                className="p-3 text-xs space-y-2"
                              >
                                {r.componentResults.map((cr: any) => (
                                  <div key={cr.sourceId} className="space-y-0.5">
                                    <p className="text-foreground font-medium">
                                      {cr.sourceName} —{" "}
                                      {cr.method === "rank_weighted"
                                        ? "rank-weighted"
                                        : "proportional"}{" "}
                                      · pool{" "}
                                      {(preview?.pools ?? []).find(
                                        (p: any) => p.sourceId === cr.sourceId,
                                      )?.finalPool ?? 0}
                                    </p>
                                    {cr.method === "rank_weighted" ? (
                                      <p>
                                        Rank #{cr.rawRank} · factor = ({cr.rankBase} −{" "}
                                        {cr.rawRank})^{cr.rankExponent} ={" "}
                                        {num(cr.rankFactor, 4)} · weighted{" "}
                                        {num(cr.weightedScore, 4)} /{" "}
                                        {num(cr.sourceWeightedTotal, 4)}
                                      </p>
                                    ) : (
                                      <p>
                                        Share = {num(cr.rawScore)} /{" "}
                                        {num(cr.sourceRawTotal)}
                                      </p>
                                    )}
                                    <p>
                                      Exact {num(cr.exactAllocation, 6)} → floored{" "}
                                      {cr.flooredAllocation} + remainder bonus{" "}
                                      {cr.remainderBonus} = {cr.finalAllocatedPoints}
                                    </p>
                                    {cr.tieBreakData?.rawTie && (
                                      <p className="text-amber-300">
                                        Tie on raw score — resolved by{" "}
                                        {String(
                                          cr.tieBreakData.rankResolvedBy ?? "raw score",
                                        ).replace(/_/g, " ")}
                                        {cr.tieBreakData.distribution
                                          ? ` (${cr.tieBreakData.distribution.slice(0, 8).join(", ")})`
                                          : ""}
                                      </p>
                                    )}
                                  </div>
                                ))}
                                <p className="border-t border-white/10 pt-2">
                                  Final = voting {r.totalVotingPoints} + activity{" "}
                                  {r.totalActivityPoints} + correction{" "}
                                  {num(r.finalCorrection)} = {r.finalCombinedPoints}
                                </p>
                                {r.finalTieBreakData?.tied && (
                                  <p className="text-amber-300">
                                    Final tie resolved by {r.finalTieBreakData.resolvedBy}
                                  </p>
                                )}
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                0* = the country is missing from that source and is counted as zero.
              </p>
            </section>


            {/* Manual entry audit */}
            {log.length > 0 && (
              <section className="glass rounded-3xl p-5 space-y-2">
                <h3 className="text-base font-semibold">Manual change history</h3>
                <div className="space-y-1 text-xs text-muted-foreground max-h-64 overflow-y-auto">
                  {log.map((l: any) => (
                    <div key={l.id}>
                      {new Date(l.created_at).toLocaleString()} ·{" "}
                      <span className="text-foreground">{l.actor_username}</span> ·{" "}
                      {countryName(byCode.get(l.country_code)) || l.country_code}:{" "}
                      {Number(l.previous_value)} → {Number(l.new_value)} (
                      {Number(l.delta) >= 0 ? "+" : ""}
                      {Number(l.delta)}) · {l.entry_type} · {l.reason}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <ManualEntryDialog
        open={!!entryDialog}
        onOpenChange={(o) => !o && setEntryDialog(null)}
        countries={(countries ?? []).filter((c: any) => participants.includes(c.code))}
        onSave={(payload) =>
          entryMut.mutate({ ...payload, sourceId: entryDialog!.sourceId })
        }
      />
    </AdminShell>
  );
}

function ParticipantsSection({
  countries,
  participants,
  onSave,
}: {
  countries: any[];
  participants: string[];
  onSave: (codes: string[]) => void;
}) {
  const [sel, setSel] = useState<string[]>(participants);
  const [search, setSearch] = useState("");
  useEffect(() => setSel(participants), [participants.join(",")]);
  const filtered = countries.filter((c) =>
    (c.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="glass rounded-3xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">
          Eligible countries{" "}
          <span className="text-muted-foreground text-sm">({sel.length})</span>
        </h3>
        <Button size="sm" onClick={() => onSave(sel)}>
          Save countries
        </Button>
      </div>
      <Input
        placeholder="Search countries…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ScrollArea className="h-56 rounded-2xl border border-white/10 p-2">
        <div className="grid gap-1 sm:grid-cols-2">
          {filtered.map((c) => (
            <label key={c.code} className="flex items-center gap-2 py-1 text-sm">
              <Checkbox
                checked={sel.includes(c.code)}
                onCheckedChange={(v) =>
                  setSel((prev) =>
                    v ? [...prev, c.code] : prev.filter((x) => x !== c.code),
                  )
                }
              />
              <CountryFlag country={c} size={18} />
              {c.name}
            </label>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}

function AddSourceForm({
  rounds,
  onAdd,
}: {
  rounds: any[];
  onAdd: (patch: any) => void;
}) {
  const [type, setType] = useState("round");
  const [roundId, setRoundId] = useState<string>("");
  const [name, setName] = useState("");
  const [stage, setStage] = useState("pre_conversion");
  const [weight, setWeight] = useState("1");

  return (
    <div className="rounded-2xl border border-dashed border-white/15 p-3 grid gap-2 sm:grid-cols-5 items-end">
      <div className="space-y-1">
        <Label className="text-xs">Type</Label>
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v);
            if (v !== "round") setRoundId("");
            if (v === "activity") setStage("post_conversion");
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {type === "round" ? (
        <div className="space-y-1">
          <Label className="text-xs">Voting round</Label>
          <Select
            value={roundId}
            onValueChange={(v) => {
              setRoundId(v);
              const r = rounds.find((x) => x.id === v);
              if (r && !name) setName(r.name);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select round" />
            </SelectTrigger>
            <SelectContent>
              {rounds.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.edition_name ? `${r.edition_name} — ` : ""}
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs">Source name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-xs">Stage</Label>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pre_conversion">Before conversion</SelectItem>
            <SelectItem value="post_conversion">After conversion</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Weight</Label>
        <Input value={weight} onChange={(e) => setWeight(e.target.value)} />
      </div>
      <Button
        onClick={() => {
          const finalName =
            name.trim() ||
            rounds.find((r) => r.id === roundId)?.name ||
            SOURCE_TYPES.find((t) => t.value === type)?.label ||
            "Source";
          if (type === "round" && !roundId) {
            toast.error("Select a voting round");
            return;
          }
          onAdd({
            sourceType: type,
            sourceRoundId: type === "round" ? roundId : null,
            sourceName: finalName,
            stage,
            weight: Number(weight) || 1,
          });
          setName("");
          setRoundId("");
        }}
      >
        <Plus className="h-4 w-4" /> Add source
      </Button>
    </div>
  );
}

function ManualEntryDialog({
  open,
  onOpenChange,
  countries,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  countries: any[];
  onSave: (payload: any) => void;
}) {
  const [code, setCode] = useState("");
  const [value, setValue] = useState("");
  const [entryType, setEntryType] = useState("external_televote");
  const [reason, setReason] = useState("");
  const negative = Number(value) < 0;
  const [confirmNegative, setConfirmNegative] = useState(false);

  useEffect(() => {
    if (open) {
      setCode("");
      setValue("");
      setReason("");
      setConfirmNegative(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add or update a value</DialogTitle>
          <DialogDescription>
            Every manual change is stored as a separate auditable entry with the
            previous value, the change, your reason and a timestamp.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Country</Label>
            <Select value={code} onValueChange={setCode}>
              <SelectTrigger>
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Value</Label>
            <Input value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Entry type</Label>
            <Select value={entryType} onValueChange={setEntryType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="external_televote">External televote</SelectItem>
                <SelectItem value="instagram">Instagram result</SelectItem>
                <SelectItem value="activity">Activity bonus</SelectItem>
                <SelectItem value="correction">Correction</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Reason / note</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {negative && (
            <label className="flex items-start gap-2 rounded-2xl border border-amber-400/30 p-3 text-xs text-amber-200">
              <Checkbox
                checked={confirmNegative}
                onCheckedChange={(v) => setConfirmNegative(!!v)}
              />
              This is a negative adjustment. Scores can never fall below zero — confirm
              you want to subtract points.
            </label>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onSave({
                countryCode: code,
                value: Number(value),
                entryType,
                reason,
                confirmNegative,
              });
              onOpenChange(false);
            }}
            disabled={!code || !reason.trim() || (negative && !confirmNegative)}
          >
            Save value
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
