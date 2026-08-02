// Server-only helpers for combined televote aggregations.
import { requireAdmin, audit, loadOriginalTotals } from "@/lib/televote.server";
import {
  computeCombined,
  type SourceInput,
  type CombinationMethod,
} from "@/lib/combined-televote-math";
import { CALC_ENGINE_VERSION } from "@/lib/televote-math";

export { requireAdmin, audit };

export type Aggregation = {
  id: string;
  edition_id: string | null;
  name: string;
  combination_method: CombinationMethod;
  total_points_to_distribute: number;
  rank_exponent: number;
  status: "draft" | "calculated" | "locked" | "published";
  calculation_version: number;
  calculated_at: string | null;
  calculated_by_username: string | null;
  locked_at: string | null;
  published_at: string | null;
  results_outdated: boolean;
  public_columns: Record<string, boolean>;
  broadcast_display_mode: string;
};

export async function loadAggregation(id: string): Promise<Aggregation> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("televote_aggregations" as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Combined result not found");
  return data as unknown as Aggregation;
}

export async function loadParticipants(aggregationId: string): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("televote_aggregation_participants" as any)
    .select("country_code,display_order")
    .eq("aggregation_id", aggregationId)
    .order("display_order");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => r.country_code as string);
}

export type SourceRow = {
  id: string;
  aggregation_id: string;
  source_type: string;
  source_round_id: string | null;
  source_name: string;
  calculation_stage: "pre_conversion" | "post_conversion";
  weight: number;
  enabled: boolean;
  display_order: number;
};

export async function loadSources(aggregationId: string): Promise<SourceRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("televote_aggregation_sources" as any)
    .select("*")
    .eq("aggregation_id", aggregationId)
    .order("display_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SourceRow[];
}

/** Resolve every source into `country code → value`, matched by country id. */
export async function resolveSourceValues(
  sources: SourceRow[],
  participants: string[],
): Promise<SourceInput[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: SourceInput[] = [];

  const manualIds = sources.filter((s) => !s.source_round_id).map((s) => s.id);
  const manualBySource = new Map<string, Record<string, number>>();
  if (manualIds.length) {
    const { data } = await supabaseAdmin
      .from("external_score_entries" as any)
      .select("source_id,country_code,value")
      .in("source_id", manualIds);
    for (const e of (data ?? []) as any[]) {
      const bucket = manualBySource.get(e.source_id) ?? {};
      bucket[e.country_code] = Number(e.value) || 0;
      manualBySource.set(e.source_id, bucket);
    }
  }

  for (const s of sources) {
    let values: Record<string, number> = {};
    if (s.source_round_id) {
      const totals = await loadOriginalTotals(s.source_round_id, participants);
      totals.forEach((t) => {
        values[t.code] = t.originalVotes;
      });
    } else {
      values = manualBySource.get(s.id) ?? {};
    }
    out.push({
      id: s.id,
      name: s.source_name,
      type: s.source_type,
      stage: s.calculation_stage,
      weight: Number(s.weight),
      enabled: s.enabled,
      values,
    });
  }
  return out;
}

export async function buildPreview(aggregationId: string) {
  const agg = await loadAggregation(aggregationId);
  const participants = await loadParticipants(aggregationId);
  const sources = await loadSources(aggregationId);
  const resolved = await resolveSourceValues(sources, participants);
  const result = computeCombined({
    participants,
    sources: resolved,
    method: agg.combination_method,
    totalPoints: agg.total_points_to_distribute,
    rankExponent: Number(agg.rank_exponent),
  });
  return { agg, participants, sources, resolved, result };
}

export async function runCombinedCalculation(
  aggregationId: string,
  actor: { id: string; username: string },
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { agg, participants, sources, resolved, result } =
    await buildPreview(aggregationId);
  if (participants.length === 0)
    throw new Error("Select at least one eligible country first");
  if (sources.filter((s) => s.enabled).length === 0)
    throw new Error("Enable at least one source first");
  if (!result.zeroWeight && result.distributedConverted !== result.totalPoints)
    throw new Error(
      `Integrity check failed: converted ${result.distributedConverted} ≠ T ${result.totalPoints}`,
    );

  const version = agg.calculation_version + 1;
  const calculatedAt = new Date().toISOString();

  await supabaseAdmin
    .from("combined_televote_results" as any)
    .delete()
    .eq("aggregation_id", aggregationId);

  const rows = result.rows.map((r) => ({
    aggregation_id: aggregationId,
    country_code: r.code,
    source_contributions: r.contributions,
    pre_conversion_total: r.preConversionTotal,
    manual_pre_conversion_adjustment: r.manualPreConversionAdjustment,
    combined_original_score: r.combinedOriginalScore,
    combined_original_rank: r.combinedOriginalRank,
    participant_count: r.participantCount,
    rank_base: r.rankBase,
    rank_exponent: r.rankExponent,
    rank_factor: r.rankFactor,
    weighted_score: r.weightedScore,
    exact_converted_points: r.exactConvertedPoints,
    floored_points: r.flooredPoints,
    decimal_remainder: r.decimalRemainder,
    remainder_bonus: r.remainderBonus,
    converted_points: r.convertedPoints,
    post_conversion_bonus: r.postConversionBonus,
    post_conversion_adjustment: r.postConversionAdjustment,
    final_televote_score: r.finalTelevoteScore,
    calculation_version: version,
    calculated_at: calculatedAt,
  }));
  const { error: insErr } = await supabaseAdmin
    .from("combined_televote_results" as any)
    .insert(rows);
  if (insErr) throw new Error(insErr.message);

  const { error: updErr } = await supabaseAdmin
    .from("televote_aggregations" as any)
    .update({
      status: agg.status === "draft" ? "calculated" : agg.status,
      calculation_version: version,
      calculated_at: calculatedAt,
      calculated_by: actor.id,
      calculated_by_username: actor.username,
      results_outdated: false,
    })
    .eq("id", aggregationId);
  if (updErr) throw new Error(updErr.message);

  await audit(actor, "calculate_combined_televote", {
    target_type: "televote_aggregation",
    target_id: aggregationId,
    new_values: {
      engine: CALC_ENGINE_VERSION,
      calculation_version: version,
      combination_method: agg.combination_method,
      total_points: result.totalPoints,
      rank_exponent: result.rankExponent,
      participant_count: result.participantCount,
      participants,
      sources: sources.map((s) => ({
        id: s.id,
        name: s.source_name,
        type: s.source_type,
        stage: s.calculation_stage,
        weight: Number(s.weight),
        enabled: s.enabled,
        round_id: s.source_round_id,
      })),
      source_values: resolved.map((s) => ({ id: s.id, values: s.values })),
      distributed_converted: result.distributedConverted,
      final_total: result.finalTotal,
    },
  });

  return { version, calculatedAt, result };
}

export async function validateCombinedForPublication(aggregationId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const agg = await loadAggregation(aggregationId);
  const participants = await loadParticipants(aggregationId);
  const problems: string[] = [];

  if (agg.calculation_version === 0) problems.push("Calculate the result first");
  if (agg.results_outdated)
    problems.push("Sources or settings changed — recalculate first");
  if (participants.length === 0) problems.push("No eligible countries selected");

  const { data } = await supabaseAdmin
    .from("combined_televote_results" as any)
    .select("country_code,converted_points,final_televote_score,calculation_version")
    .eq("aggregation_id", aggregationId);
  const rows = ((data ?? []) as any[]) ?? [];
  const codes = new Set(rows.map((r) => r.country_code));
  for (const c of participants)
    if (!codes.has(c)) problems.push(`Missing result row for ${c}`);
  if (rows.some((r) => r.calculation_version !== agg.calculation_version))
    problems.push("Stored rows are from an older calculation — recalculate");

  const sum = rows.reduce((a, r) => a + (r.converted_points ?? 0), 0);
  const allZero = rows.every((r) => (r.converted_points ?? 0) === 0);
  if (!allZero && sum !== agg.total_points_to_distribute)
    problems.push(
      `Converted points total ${sum} does not equal T ${agg.total_points_to_distribute}`,
    );

  return { problems, agg, participants, rows };
}
