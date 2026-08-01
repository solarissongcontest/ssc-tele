import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Calculator,
  Lock,
  Radio,
  RefreshCcw,
  Loader2,
  Download,
  FileJson,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAllRounds, useAllCountries } from "@/hooks/use-round-results";
import { CountryFlag, countryName } from "@/components/country-flag";
import { downloadCSV, downloadJSON } from "@/lib/export";
import {
  convertRound,
  formulaPreview,
  DEFAULT_RANK_EXPONENT,
  type ConversionRow,
} from "@/lib/televote-math";
import {
  getTelevoteConversion,
  updateConversionConfig,
  recalculateConversion,
  setResultsStatus,
  checkPublicationReadiness,
} from "@/lib/televote.functions";

export const Route = createFileRoute("/admin/televote")({
  head: () => ({
    meta: [
      { title: "Televote Conversion — Solaris Admin" },
      {
        name: "description",
        content:
          "Convert original Solaris televote totals into a fixed pool of whole-number televote points with a full audit trail.",
      },
    ],
  }),
  component: TelevotePage,
});

const num = (v: number, d = 4) =>
  Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

function TelevotePage() {
  const qc = useQueryClient();
  const { data: rounds } = useAllRounds();
  const { data: countries } = useAllCountries();
  const [roundId, setRoundId] = useState<string | null>(null);
  const [tInput, setTInput] = useState("");
  const [eInput, setEInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mode, setMode] = useState<"original" | "converted" | "side">("side");

  const effective = roundId ?? rounds?.[0]?.id ?? null;

  const fetchConversion = useServerFn(getTelevoteConversion);
  const saveConfig = useServerFn(updateConversionConfig);
  const recalc = useServerFn(recalculateConversion);
  const setStatus = useServerFn(setResultsStatus);
  const checkReady = useServerFn(checkPublicationReadiness);

  const conv = useQuery({
    queryKey: ["televote-conversion", effective],
    queryFn: async () =>
      effective ? await fetchConversion({ data: { roundId: effective } }) : null,
    enabled: !!effective,
    refetchInterval: 10_000,
  });

  const round = conv.data?.round ?? null;

  useEffect(() => {
    if (round) {
      setTInput(String(round.total_points_to_distribute));
      setEInput(String(round.rank_exponent));
    }
  }, [round?.id, round?.calculation_version]);

  const byCode = useMemo(() => {
    const m = new Map<string, any>();
    (countries ?? []).forEach((c) => m.set(c.code, c));
    return m;
  }, [countries]);

  const participants = conv.data?.participants ?? [];
  const n = participants.length;
  const parsedT = Number(tInput);
  const parsedE = Number(eInput);
  const validT = Number.isInteger(parsedT) && parsedT >= 0;
  const validE = Number.isFinite(parsedE) && parsedE > 0 && parsedE <= 5;

  /** Unofficial browser preview — never stored. */
  const preview = useMemo(() => {
    if (!conv.data) return null;
    return convertRound(
      conv.data.originals,
      validT ? parsedT : (round?.total_points_to_distribute ?? 0),
      validE ? parsedE : Number(round?.rank_exponent ?? DEFAULT_RANK_EXPONENT),
    );
  }, [conv.data, parsedT, parsedE, validT, validE, round]);

  const storedRows: ConversionRow[] = useMemo(() => {
    const rows = (conv.data?.stored ?? []).map((r: any) => ({
      code: r.country_code,
      originalVotes: r.original_votes,
      originalVoters: r.original_voters,
      originalRank: r.original_rank,
      originalShare: 0,
      participantCount: r.participant_count,
      rankBase: r.rank_base,
      rankExponent: Number(r.rank_exponent),
      rankFactor: Number(r.rank_factor),
      weightedScore: Number(r.weighted_score),
      exactPoints: Number(r.exact_points),
      flooredPoints: r.floored_points,
      decimalRemainder: Number(r.decimal_remainder),
      remainderBonus: r.remainder_bonus,
      finalPoints: r.final_points,
    }));
    const totalOriginal = rows.reduce((a, b) => a + b.originalVotes, 0);
    rows.forEach((r) => {
      r.originalShare = totalOriginal > 0 ? r.originalVotes / totalOriginal : 0;
    });
    return rows.sort(
      (a, b) => b.finalPoints - a.finalPoints || a.originalRank - b.originalRank,
    );
  }, [conv.data]);

  const hasStored = storedRows.length > 0;
  const displayRows = hasStored ? storedRows : (preview?.rows ?? []);
  const showingPreview = !hasStored || !!round?.results_outdated;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["televote-conversion", effective] });
    qc.invalidateQueries({ queryKey: ["all-rounds"] });
  };

  const configM = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      await saveConfig({ data: { roundId: effective!, ...payload } as any }),
    onSuccess: (r: any) => {
      invalidate();
      toast.success(
        r?.outdated ? "Saved — result marked as needing recalculation" : "Settings saved",
      );
    },
    onError: (e: any) => toast.error(e.message),
  });

  const recalcM = useMutation({
    mutationFn: async (confirm: boolean) =>
      await recalc({ data: { roundId: effective!, confirm } }),
    onSuccess: (r: any) => {
      invalidate();
      setConfirmOpen(false);
      if (r?.zeroWeight)
        toast.warning(
          "All original totals are zero — no voting weight exists, so every converted value is 0.",
        );
      else
        toast.success(
          `Calculated v${r.version}: ${r.distributedTotal} points across ${r.participantCount} countries`,
        );
    },
    onError: (e: any) => toast.error(e.message),
  });

  const statusM = useMutation({
    mutationFn: async (status: "calculated" | "locked" | "published") =>
      await setStatus({ data: { roundId: effective!, status } }),
    onSuccess: () => {
      invalidate();
      toast.success("Result status updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const readiness = useQuery({
    queryKey: ["televote-readiness", effective, round?.calculation_version, round?.results_outdated],
    queryFn: async () =>
      effective ? await checkReady({ data: { roundId: effective } }) : null,
    enabled: !!effective && !!round && round.calculation_version > 0,
  });

  const needsRecalc = !!round?.results_outdated;
  const isLocked = round?.results_status === "locked" || round?.results_status === "published";

  const exportAudit = () =>
    downloadCSV(
      `solaris-${round?.name ?? "round"}-conversion-audit.csv`.replace(/\s+/g, "-").toLowerCase(),
      displayRows.map((r) => ({
        original_rank: r.originalRank,
        country: countryName(byCode.get(r.code)),
        country_code: r.code,
        original_votes: r.originalVotes,
        original_share: (r.originalShare * 100).toFixed(4) + "%",
        rank_factor: r.rankFactor,
        weighted_score: r.weightedScore,
        exact_converted_quota: r.exactPoints,
        floored_points: r.flooredPoints,
        decimal_remainder: r.decimalRemainder,
        remainder_bonus: r.remainderBonus,
        final_converted_points: r.finalPoints,
      })),
    );

  const exportJson = () =>
    downloadJSON(`solaris-conversion-${round?.id ?? "round"}.json`, {
      round,
      participants,
      rows: displayRows,
      source: hasStored ? "official-stored" : "browser-preview",
    });

  const statusBadge = () => {
    const s = round?.results_status ?? "draft";
    const tone =
      s === "published"
        ? "bg-emerald-500/20 text-emerald-300"
        : s === "locked"
          ? "bg-amber-500/20 text-amber-200"
          : s === "calculated"
            ? "bg-sky-500/20 text-sky-200"
            : "bg-muted/30 text-muted-foreground";
    return <Badge className={tone}>{s}</Badge>;
  };

  return (
    <AdminShell title="Televote Conversion">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-primary">Round</p>
            <Select value={effective ?? undefined} onValueChange={setRoundId}>
              <SelectTrigger className="w-[320px] max-w-full">
                <SelectValue placeholder="Select round" />
              </SelectTrigger>
              <SelectContent>
                {(rounds ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.edition_name ? `${r.edition_name} — ` : ""}
                    {r.name} ({r.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge()}
            {needsRecalc && (
              <Badge className="bg-destructive/25 text-destructive-foreground">
                needs recalculation
              </Badge>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={exportAudit}>
              <Download className="mr-2 h-4 w-4" /> Audit CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportJson}>
              <FileJson className="mr-2 h-4 w-4" /> JSON
            </Button>
          </div>
        </div>

        {/* Configuration */}
        <section className="glass rounded-3xl p-5 space-y-5">
          <header className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <h2 className="text-sm uppercase tracking-widest text-primary">
              Conversion settings
            </h2>
          </header>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="tval">Total points to distribute (T)</Label>
              <Input
                id="tval"
                inputMode="numeric"
                value={tInput}
                onChange={(e) => setTInput(e.target.value.replace(/[^0-9]/g, ""))}
                onBlur={() =>
                  validT &&
                  parsedT !== round?.total_points_to_distribute &&
                  configM.mutate({ totalPoints: parsedT })
                }
              />
              {!validT && (
                <p className="text-xs text-destructive">
                  T must be a non-negative whole number.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="eval">Rank exponent (e)</Label>
              <Input
                id="eval"
                inputMode="decimal"
                value={eInput}
                onChange={(e) => setEInput(e.target.value)}
                onBlur={() =>
                  validE &&
                  parsedE !== Number(round?.rank_exponent) &&
                  configM.mutate({ rankExponent: parsedE })
                }
              />
              <p className="text-xs text-muted-foreground">Default 1.33</p>
            </div>
            <div className="space-y-2">
              <Label>Eligible participants (n)</Label>
              <div className="rounded-2xl border border-white/10 px-4 py-2 text-lg font-semibold">
                {n}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Rank base (n + 2)</Label>
              <div className="rounded-2xl border border-white/10 px-4 py-2 text-lg font-semibold">
                {n + 2}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 px-4 py-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Live formula preview
            </p>
            <p className="mt-1 font-mono text-lg">
              {formulaPreview(n, validE ? parsedE : Number(round?.rank_exponent ?? DEFAULT_RANK_EXPONENT))}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              exact_i = weighted_i ÷ Σweighted × {validT ? parsedT : round?.total_points_to_distribute ?? 0}
              , then floor + largest-remainder allocation.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div className="rounded-2xl border border-white/10 px-4 py-3">
              <p className="text-xs text-muted-foreground">Calculation status</p>
              <p className="mt-1 font-medium">
                {round?.calculation_version
                  ? needsRecalc
                    ? "Outdated — recalculate"
                    : "Up to date"
                  : "Never calculated"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 px-4 py-3">
              <p className="text-xs text-muted-foreground">Last calculated</p>
              <p className="mt-1 font-medium">
                {round?.calculated_at
                  ? new Date(round.calculated_at).toLocaleString()
                  : "—"}
                {round?.calculated_by_username ? ` · ${round.calculated_by_username}` : ""}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 px-4 py-3">
              <p className="text-xs text-muted-foreground">Result version</p>
              <p className="mt-1 font-medium">v{round?.calculation_version ?? 0}</p>
            </div>
          </div>

          {preview?.zeroWeight && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
              <p>
                All original totals are zero. Proportional conversion cannot distribute T
                without any voting weight — every country receives 0 points. No result is
                fabricated.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() =>
                isLocked ? setConfirmOpen(true) : recalcM.mutate(false)
              }

              disabled={!effective || recalcM.isPending}
            >
              {recalcM.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-4 w-4" />
              )}
              Recalculate
            </Button>
            <Button
              variant="outline"
              onClick={() => statusM.mutate("locked")}
              disabled={!round?.calculation_version || statusM.isPending}
            >
              <Lock className="mr-2 h-4 w-4" /> Lock result
            </Button>
            <Button
              variant="outline"
              onClick={() => statusM.mutate("published")}
              disabled={!round?.calculation_version || statusM.isPending}
            >
              <Radio className="mr-2 h-4 w-4" /> Publish result
            </Button>
            {round?.results_status !== "draft" && (
              <Button
                variant="ghost"
                onClick={() => statusM.mutate("calculated")}
                disabled={statusM.isPending}
              >
                Unlock / unpublish
              </Button>
            )}
          </div>

          {readiness.data && (
            <div className="text-sm">
              {readiness.data.problems.length === 0 ? (
                <p className="flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" /> All publication checks pass.
                </p>
              ) : (
                <ul className="space-y-1 text-amber-200">
                  {readiness.data.problems.map((p: string) => (
                    <li key={p} className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4" /> {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3">
              <span className="text-sm">
                Public advanced transparency view
                <span className="block text-xs text-muted-foreground">
                  Expose weighted calculation details on the public result page.
                </span>
              </span>
              <Switch
                checked={!!round?.public_advanced_transparency}
                onCheckedChange={(v) => configM.mutate({ advancedTransparency: v })}
              />
            </label>
            <div className="space-y-2 rounded-2xl border border-white/10 px-4 py-3">
              <Label>Broadcast graphics display mode</Label>
              <Select
                value={round?.broadcast_display_mode ?? "converted"}
                onValueChange={(v) => configM.mutate({ broadcastMode: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="original">Original televote totals</SelectItem>
                  <SelectItem value="converted">Converted televote points</SelectItem>
                  <SelectItem value="combined">Combined contest total</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Display only — stored data is never altered.
              </p>
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="glass rounded-3xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm uppercase tracking-widest text-primary">
              {showingPreview ? "Unofficial preview" : `Official result · v${round?.calculation_version}`}
            </h2>
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
              <TabsList>
                <TabsTrigger value="original">Original</TabsTrigger>
                <TabsTrigger value="converted">Converted</TabsTrigger>
                <TabsTrigger value="side">Side-by-side</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {showingPreview && (
            <p className="text-xs text-amber-200">
              These figures are a browser preview only. Press Recalculate to generate and
              store the official backend result.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Orig. rank</th>
                  <th className="py-2 pr-3">Country</th>
                  {mode !== "converted" && (
                    <>
                      <th className="py-2 pr-3 text-right">Original votes</th>
                      <th className="py-2 pr-3 text-right">Share</th>
                    </>
                  )}
                  {mode === "side" && (
                    <>
                      <th className="py-2 pr-3 text-right">Rank factor</th>
                      <th className="py-2 pr-3 text-right">Weighted</th>
                      <th className="py-2 pr-3 text-right">Exact quota</th>
                      <th className="py-2 pr-3 text-right">Floored</th>
                      <th className="py-2 pr-3 text-right">Remainder</th>
                      <th className="py-2 pr-3 text-right">Bonus</th>
                    </>
                  )}
                  {mode !== "original" && (
                    <th className="py-2 pr-3 text-right">Converted points</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r) => {
                  const c = byCode.get(r.code);
                  return (
                    <tr key={r.code} className="border-t border-white/5">
                      <td className="py-2 pr-3 tabular-nums">{r.originalRank}</td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2">
                          <CountryFlag country={c} size={20} />
                          <span>{countryName(c)}</span>
                        </span>
                      </td>
                      {mode !== "converted" && (
                        <>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {r.originalVotes}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {(r.originalShare * 100).toFixed(2)}%
                          </td>
                        </>
                      )}
                      {mode === "side" && (
                        <>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {num(r.rankFactor, 3)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {num(r.weightedScore, 2)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {num(r.exactPoints, 4)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {r.flooredPoints}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {num(r.decimalRemainder, 4)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {r.remainderBonus}
                          </td>
                        </>
                      )}
                      {mode !== "original" && (
                        <td className="py-2 pr-3 text-right text-base font-semibold tabular-nums">
                          {r.finalPoints}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {displayRows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-muted-foreground">
                      No eligible participants configured for this round yet.
                    </td>
                  </tr>
                )}
              </tbody>
              {displayRows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-white/15 font-semibold">
                    <td className="py-2 pr-3" colSpan={2}>
                      Total
                    </td>
                    {mode !== "converted" && (
                      <>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {displayRows.reduce((a, b) => a + b.originalVotes, 0)}
                        </td>
                        <td />
                      </>
                    )}
                    {mode === "side" && <td colSpan={6} />}
                    {mode !== "original" && (
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {displayRows.reduce((a, b) => a + b.finalPoints, 0)}
                      </td>
                    )}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recalculate a {round?.results_status} result?</AlertDialogTitle>
            <AlertDialogDescription>
              This round's result is {round?.results_status}. Recalculating replaces the
              stored official figures with a new version. This action is recorded in the
              moderator audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => recalcM.mutate(true)}>
              Yes, recalculate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}
