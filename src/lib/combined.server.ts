// Server-only helpers for combined televote aggregations (component-pool model).
import { requireAdmin, audit, loadOriginalTotals } from "@/lib/televote.server";
import {
  computeCombined,
  methodForSourceType,
  COMBINED_ENGINE_VERSION,
  resolveInputMode,
  type ComponentSourceInput,
  type CorrectionScope,
  type SourceInputMode,
} from "@/lib/combined-televote-math";


export { requireAdmin, audit };

export type Aggregation = {
  id: string;
  edition_id: string | null;
  name: string;
  combination_method: string;
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
  input_mode: SourceInputMode | null;
  source_round_id: string | null;
  source_name: string;
  calculation_stage: "pre_conversion" | "post_conversion";
  calculation_method: string;
  percentage_weight: number;
  weight: number;
  enabled: boolean;
  display_order: number;
  correction_target_source_id: string | null;
  correction_scope: CorrectionScope;
  exact_point_pool: number | null;
  floored_point_pool: number | null;
  pool_remainder: number | null;
  pool_remainder_bonus: number | null;
  final_point_pool: number | null;
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

/** Per-country list of individual submitted scores for a voting round. */
async function loadRoundDistributions(
  roundId: string,
  participants: string[],
): Promise<Record<string, number[]>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: Record<string, number[]> = {};
  participants.forEach((c) => (out[c] = []));
  const { data: subs } = await supabaseAdmin
    .from("vote_submissions")
    .select("id,status")
    .eq("round_id", roundId);
  const valid = ((subs ?? []) as any[]).filter((s) => s.status !== "deleted");
  if (!valid.length) return out;
  const { data: entries } = await supabaseAdmin
    .from("vote_entries")
    .select("submission_id,target_country_code,points")
    .in(
      "submission_id",
      valid.map((s) => s.id),
    );
  for (const e of (entries ?? []) as any[]) {
    const bucket = out[e.target_country_code];
    if (bucket) bucket.push(Number(e.points) || 0);
  }
  for (const c of participants) out[c]!.sort((a, b) => b - a);
  return out;
}

/** Resolve every source into `country code → value`, matched by country id. */
export async function resolveSourceValues(
  sources: SourceRow[],
  participants: string[],
): Promise<ComponentSourceInput[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: ComponentSourceInput[] = [];

  const manualIds = sources.filter((s) => !s.source_round_id).map((s) => s.id);
  const manualBySource = new Map<string, Record<string, number>>();
  const distBySource = new Map<string, Record<string, number[]>>();
  if (manualIds.length) {
    const { data } = await supabaseAdmin
      .from("external_score_entries" as any)
      .select("source_id,country_code,value")
      .in("source_id", manualIds);
    for (const e of (data ?? []) as any[]) {
      const bucket = manualBySource.get(e.source_id) ?? {};
      bucket[e.country_code] = (bucket[e.country_code] ?? 0) + (Number(e.value) || 0);
      manualBySource.set(e.source_id, bucket);
      const dist = distBySource.get(e.source_id) ?? {};
      dist[e.country_code] = [...(dist[e.country_code] ?? []), Number(e.value) || 0];
      distBySource.set(e.source_id, dist);
    }
  }

  for (const s of sources) {
    let values: Record<string, number> = {};
    let distributions: Record<string, number[]> | undefined;
    if (s.source_round_id) {
      const totals = await loadOriginalTotals(s.source_round_id, participants);
      totals.forEach((t) => {
        values[t.code] = t.originalVotes;
      });
      distributions = await loadRoundDistributions(s.source_round_id, participants);
    } else {
      values = manualBySource.get(s.id) ?? {};
      distributions = distBySource.get(s.id);
    }
    out.push({
      id: s.id,
      name: s.source_name,
      type: s.source_type,
      percentageWeight: Number(s.percentage_weight ?? 0),
      enabled: s.enabled,
      displayOrder: s.display_order,
      values,
      distributions,
      correctionTargetSourceId: s.correction_target_source_id,
      correctionScope: (s.correction_scope ?? "final") as CorrectionScope,
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
  if (result.errors.length) throw new Error(result.errors[0]);

  const version = agg.calculation_version + 1;
  const calculatedAt = new Date().toISOString();

  // Persist the component pools onto their sources.
  for (const p of result.pools) {
    await supabaseAdmin
      .from("televote_aggregation_sources" as any)
      .update({
        calculation_method: p.method,
        exact_point_pool: p.exactPool,
        floored_point_pool: p.flooredPool,
        pool_remainder: p.poolRemainder,
        pool_remainder_bonus: p.poolBonus,
        final_point_pool: p.finalPool,
      })
      .eq("id", p.sourceId);
  }

  // Previous versions are kept — only rewrite this version.
  await supabaseAdmin
    .from("combined_televote_component_results" as any)
    .delete()
    .eq("aggregation_id", aggregationId)
    .eq("calculation_version", version);
  await supabaseAdmin
    .from("combined_televote_results" as any)
    .delete()
    .eq("aggregation_id", aggregationId)
    .eq("calculation_version", version);

  const poolById = new Map(result.pools.map((p) => [p.sourceId, p]));
  const componentRows = result.rows.flatMap((r) =>
    r.componentResults.map((c) => ({
      aggregation_id: aggregationId,
      component_id: c.sourceId,
      component_name: c.sourceName,
      component_type: c.sourceType,
      country_code: c.countryCode,
      calculation_version: version,
      method: c.method,
      percentage_weight: poolById.get(c.sourceId)?.percentageWeight ?? 0,
      component_pool: poolById.get(c.sourceId)?.finalPool ?? 0,
      raw_score: c.rawScore,
      raw_rank: c.rawRank,
      participant_count: c.participantCount,
      rank_base: c.rankBase,
      rank_exponent: c.rankExponent,
      rank_factor: c.rankFactor,
      weighted_score: c.weightedScore,
      source_weighted_total: c.sourceWeightedTotal,
      exact_allocation: c.exactAllocation,
      floored_allocation: c.flooredAllocation,
      decimal_remainder: c.decimalRemainder,
      remainder_bonus: c.remainderBonus,
      final_allocated_points: c.finalAllocatedPoints,
      tie_break_data: c.tieBreakData,
      calculated_at: calculatedAt,
    })),
  );
  if (componentRows.length) {
    const { error } = await supabaseAdmin
      .from("combined_televote_component_results" as any)
      .insert(componentRows);
    if (error) throw new Error(error.message);
  }

  const finalRows = result.rows.map((r) => ({
    aggregation_id: aggregationId,
    country_code: r.code,
    calculation_version: version,
    source_contributions: r.componentResults.map((c) => ({
      source_id: c.sourceId,
      source_name: c.sourceName,
      source_type: c.sourceType,
      method: c.method,
      raw_score: c.rawScore,
      allocated_points: c.finalAllocatedPoints,
    })),
    total_voting_points: r.totalVotingPoints,
    total_activity_points: r.totalActivityPoints,
    final_correction: r.finalCorrection,
    final_combined_points: r.finalCombinedPoints,
    final_rank: r.finalRank,
    final_tie_break_data: r.finalTieBreakData,
    // legacy display columns kept in sync
    converted_points: r.totalVotingPoints,
    post_conversion_bonus: r.totalActivityPoints,
    post_conversion_adjustment: r.finalCorrection,
    final_televote_score: r.finalCombinedPoints,
    combined_original_rank: r.finalRank,
    participant_count: participants.length,
    calculated_at: calculatedAt,
  }));
  const { error: insErr } = await supabaseAdmin
    .from("combined_televote_results" as any)
    .insert(finalRows);
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
      engine: COMBINED_ENGINE_VERSION,
      calculation_version: version,
      total_points: result.totalPoints,
      allocated_total: result.allocatedTotal,
      final_total: result.finalTotal,
      participants,
      pools: result.pools,
      sources: sources.map((s) => ({
        id: s.id,
        name: s.source_name,
        type: s.source_type,
        method: methodForSourceType(s.source_type),
        percentage_weight: Number(s.percentage_weight ?? 0),
        enabled: s.enabled,
        round_id: s.source_round_id,
      })),
      source_values: resolved.map((s) => ({ id: s.id, values: s.values })),
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
    .select(
      "country_code,total_voting_points,total_activity_points,final_combined_points,final_correction,calculation_version",
    )
    .eq("aggregation_id", aggregationId)
    .eq("calculation_version", agg.calculation_version);
  const rows = (data ?? []) as any[];
  const codes = new Set(rows.map((r) => r.country_code));
  for (const c of participants)
    if (!codes.has(c)) problems.push(`Missing result row for ${c}`);

  const allocated = rows.reduce(
    (a, r) => a + Number(r.total_voting_points ?? 0) + Number(r.total_activity_points ?? 0),
    0,
  );
  const corrections = rows.reduce((a, r) => a + Number(r.final_correction ?? 0), 0);
  if (rows.length && allocated !== agg.total_points_to_distribute)
    problems.push(
      `Allocated component points total ${allocated} does not equal the overall pool ${agg.total_points_to_distribute}`,
    );
  if (corrections !== 0)
    problems.push(
      `Manual corrections of ${corrections} point(s) are applied — confirm this is intended`,
    );

  return { problems, agg, participants, rows };
}
