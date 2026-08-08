// Server-only helpers for combined televote aggregations (component-pool model).
//
// IMPORTANT COMPATIBILITY NOTE:
// Several database columns are still named `country_code`. For combined
// televote data, their value is now semantically a stable round `entry_key`.
// Country entries remain backward compatible because their entry_key is their
// country code. Custom entries are NEVER matched by their display name.

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
import {
  resolveEntry,
  type CountryRecord,
  type ResolvedEntry,
  type RoundEntry,
} from "@/lib/round-entries";

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
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const { data, error } = await supabaseAdmin
    .from("televote_aggregations" as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Combined result not found");

  return data as unknown as Aggregation;
}

/**
 * Combined participants are stable entry keys.
 *
 * The legacy database column is still named country_code so old country-only
 * aggregations continue to work without a destructive migration.
 */
export async function loadParticipants(
  aggregationId: string,
): Promise<string[]> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const { data, error } = await supabaseAdmin
    .from("televote_aggregation_participants" as any)
    .select("country_code,display_order")
    .eq("aggregation_id", aggregationId)
    .order("display_order");

  if (error) throw new Error(error.message);

  return ((data ?? []) as any[]).map(
    (row) => row.country_code as string,
  );
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

export async function loadSources(
  aggregationId: string,
): Promise<SourceRow[]> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const { data, error } = await supabaseAdmin
    .from("televote_aggregation_sources" as any)
    .select("*")
    .eq("aggregation_id", aggregationId)
    .order("display_order");

  if (error) throw new Error(error.message);

  return (data ?? []) as unknown as SourceRow[];
}

/**
 * Resolve the entry catalogue available to a combined aggregation.
 *
 * Primary source of truth:
 *   round_entries belonging to the aggregation's linked voting rounds.
 *
 * Fallback:
 *   if an already-selected participant key is not present in the currently
 *   linked source rounds, resolve that exact entry_key from round_entries
 *   elsewhere. This keeps old/published aggregations displayable after source
 *   configuration changes without ever guessing from a display name.
 *
 * If the same entry_key appears in multiple linked rounds, the first linked
 * source round (then display_order) wins for presentation metadata. The key
 * itself remains the identity.
 */
export async function loadAggregationEntryCatalog(
  aggregationId: string,
  participantKeys?: string[],
): Promise<ResolvedEntry[]> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const sources = await loadSources(aggregationId);
  const participants =
    participantKeys ?? (await loadParticipants(aggregationId));

  const sourceRoundIds = Array.from(
    new Set(
      sources
        .map((source) => source.source_round_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const sourceRoundOrder = new Map<string, number>();
  sourceRoundIds.forEach((id, index) => {
    sourceRoundOrder.set(id, index);
  });

  const rows: RoundEntry[] = [];

  if (sourceRoundIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("round_entries" as any)
      .select(
        "id,round_id,entry_type,entry_key,country_code,custom_name,short_name,entry_code,subtitle,image_url,description,display_order",
      )
      .in("round_id", sourceRoundIds);

    if (error) throw new Error(error.message);

    rows.push(...((data ?? []) as unknown as RoundEntry[]));
  }

  const foundKeys = new Set(rows.map((row) => row.entry_key));
  const missingParticipantKeys = Array.from(
    new Set(participants.filter((key) => !foundKeys.has(key))),
  );

  if (missingParticipantKeys.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("round_entries" as any)
      .select(
        "id,round_id,entry_type,entry_key,country_code,custom_name,short_name,entry_code,subtitle,image_url,description,display_order",
      )
      .in("entry_key", missingParticipantKeys);

    if (error) throw new Error(error.message);

    rows.push(...((data ?? []) as unknown as RoundEntry[]));
  }

  rows.sort((a, b) => {
    const aRound = a.round_id ?? "";
    const bRound = b.round_id ?? "";

    const aSourceOrder =
      sourceRoundOrder.get(aRound) ?? Number.MAX_SAFE_INTEGER;
    const bSourceOrder =
      sourceRoundOrder.get(bRound) ?? Number.MAX_SAFE_INTEGER;

    return (
      aSourceOrder - bSourceOrder ||
      a.display_order - b.display_order ||
      a.entry_key.localeCompare(b.entry_key) ||
      a.id.localeCompare(b.id)
    );
  });

  // One presentation record per stable key. Do NOT use display names here.
  const uniqueByKey = new Map<string, RoundEntry>();
  for (const row of rows) {
    if (!uniqueByKey.has(row.entry_key)) {
      uniqueByKey.set(row.entry_key, row);
    }
  }

  const uniqueRows = Array.from(uniqueByKey.values());

  const countryCodes = Array.from(
    new Set(
      uniqueRows
        .map((row) => row.country_code)
        .filter((code): code is string => Boolean(code)),
    ),
  );

  const countries = new Map<string, CountryRecord>();

  if (countryCodes.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("countries")
      .select("code,name,flag,flag_url")
      .in("code", countryCodes);

    if (error) throw new Error(error.message);

    for (const country of data ?? []) {
      countries.set(country.code, country);
    }
  }

  return uniqueRows.map((row) => resolveEntry(row, countries));
}

/** Per-entry list of individual submitted scores for a voting round. */
async function loadRoundDistributions(
  roundId: string,
  participants: string[],
): Promise<Record<string, number[]>> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const out: Record<string, number[]> = {};

  participants.forEach((entryKey) => {
    out[entryKey] = [];
  });

  const { data: submissions, error: submissionError } =
    await supabaseAdmin
      .from("vote_submissions")
      .select("id,status")
      .eq("round_id", roundId);

  if (submissionError) {
    throw new Error(submissionError.message);
  }

  const valid = ((submissions ?? []) as any[]).filter(
    (submission) => submission.status !== "deleted",
  );

  if (!valid.length) return out;

  const { data: entries, error: entryError } = await supabaseAdmin
    .from("vote_entries")
    .select("submission_id,target_country_code,points")
    .in(
      "submission_id",
      valid.map((submission) => submission.id),
    );

  if (entryError) throw new Error(entryError.message);

  for (const entry of (entries ?? []) as any[]) {
    // target_country_code is the legacy column name. Value = entry_key.
    const bucket = out[entry.target_country_code];
    if (bucket) {
      bucket.push(Number(entry.points) || 0);
    }
  }

  for (const entryKey of participants) {
    out[entryKey]!.sort((a, b) => b - a);
  }

  return out;
}

/**
 * Resolve every source into `entry_key → value`.
 *
 * Legacy columns named country_code are intentionally retained. Their values
 * are interpreted as generic entry keys.
 */
export async function resolveSourceValues(
  sources: SourceRow[],
  participants: string[],
): Promise<ComponentSourceInput[]> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const out: ComponentSourceInput[] = [];

  const manualIds = sources
    .filter((source) => !source.source_round_id)
    .map((source) => source.id);

  const manualBySource = new Map<string, Record<string, number>>();
  const distBySource = new Map<string, Record<string, number[]>>();

  if (manualIds.length) {
    const { data, error } = await supabaseAdmin
      .from("external_score_entries" as any)
      .select("source_id,country_code,value")
      .in("source_id", manualIds);

    if (error) throw new Error(error.message);

    for (const entry of (data ?? []) as any[]) {
      const entryKey = entry.country_code as string;

      const bucket = manualBySource.get(entry.source_id) ?? {};
      bucket[entryKey] =
        (bucket[entryKey] ?? 0) + (Number(entry.value) || 0);
      manualBySource.set(entry.source_id, bucket);

      const distribution = distBySource.get(entry.source_id) ?? {};
      distribution[entryKey] = [
        ...(distribution[entryKey] ?? []),
        Number(entry.value) || 0,
      ];
      distBySource.set(entry.source_id, distribution);
    }
  }

  for (const source of sources) {
    const mode = resolveInputMode({
      type: source.source_type,
      inputMode: source.input_mode ?? undefined,
    });

    let values: Record<string, number> = {};
    let distributions: Record<string, number[]> | undefined;

    if (
      source.source_round_id &&
      mode === "converted_points"
    ) {
      // Already-converted televote points are taken as-is; they are never
      // rank-weighted a second time.
      const { data, error } = await supabaseAdmin
        .from("round_results")
        .select("country_code,final_points,calculation_version")
        .eq("round_id", source.source_round_id);

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as any[];

      const latest = rows.reduce(
        (max, row) =>
          Math.max(max, Number(row.calculation_version) || 0),
        0,
      );

      for (const row of rows) {
        if ((Number(row.calculation_version) || 0) !== latest) {
          continue;
        }

        // country_code is a legacy column name. Value = entry_key.
        values[row.country_code] = Number(row.final_points) || 0;
      }
    } else if (source.source_round_id) {
      const totals = await loadOriginalTotals(
        source.source_round_id,
        participants,
      );

      totals.forEach((total) => {
        values[total.code] = total.originalVotes;
      });

      distributions = await loadRoundDistributions(
        source.source_round_id,
        participants,
      );
    } else {
      values = manualBySource.get(source.id) ?? {};
      distributions = distBySource.get(source.id);
    }

    out.push({
      id: source.id,
      name: source.source_name,
      type: source.source_type,
      inputMode: mode,
      percentageWeight: Number(source.percentage_weight ?? 0),
      enabled: source.enabled,
      displayOrder: source.display_order,
      values,
      distributions,
      correctionTargetSourceId: source.correction_target_source_id,
      correctionScope: (source.correction_scope ?? "final") as CorrectionScope,
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

  return {
    agg,
    participants,
    sources,
    resolved,
    result,
  };
}

export async function runCombinedCalculation(
  aggregationId: string,
  actor: { id: string; username: string },
) {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const {
    agg,
    participants,
    sources,
    resolved,
    result,
  } = await buildPreview(aggregationId);

  if (result.errors.length) {
    throw new Error(result.errors[0]);
  }

  const version = agg.calculation_version + 1;
  const calculatedAt = new Date().toISOString();

  for (const pool of result.pools) {
    await supabaseAdmin
      .from("televote_aggregation_sources" as any)
      .update({
        calculation_method: pool.method,
        exact_point_pool: pool.exactPool,
        floored_point_pool: pool.flooredPool,
        pool_remainder: pool.poolRemainder,
        pool_remainder_bonus: pool.poolBonus,
        final_point_pool: pool.finalPool,
      })
      .eq("id", pool.sourceId);
  }

  // Previous versions are kept. Only rewrite this calculation version.
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

  const poolById = new Map(
    result.pools.map((pool) => [pool.sourceId, pool]),
  );

  const componentRows = result.rows.flatMap((row) =>
    row.componentResults.map((component) => ({
      aggregation_id: aggregationId,
      component_id: component.sourceId,
      component_name: component.sourceName,
      component_type: component.sourceType,

      // Legacy column name. Value = entry_key.
      country_code: component.countryCode,

      calculation_version: version,
      method: component.method,
      percentage_weight:
        poolById.get(component.sourceId)?.percentageWeight ?? 0,
      component_pool:
        poolById.get(component.sourceId)?.finalPool ?? 0,
      raw_score: component.rawScore,
      raw_rank: component.rawRank,
      participant_count: component.participantCount,
      rank_base: component.rankBase,
      rank_exponent: component.rankExponent,
      rank_factor: component.rankFactor,
      weighted_score: component.weightedScore,
      source_weighted_total: component.sourceWeightedTotal,
      exact_allocation: component.exactAllocation,
      floored_allocation: component.flooredAllocation,
      decimal_remainder: component.decimalRemainder,
      remainder_bonus: component.remainderBonus,
      final_allocated_points: component.finalAllocatedPoints,
      tie_break_data: component.tieBreakData,
      calculated_at: calculatedAt,
    })),
  );

  if (componentRows.length) {
    const { error } = await supabaseAdmin
      .from("combined_televote_component_results" as any)
      .insert(componentRows);

    if (error) throw new Error(error.message);
  }

  const finalRows = result.rows.map((row) => ({
    aggregation_id: aggregationId,

    // Legacy column name. Value = entry_key.
    country_code: row.code,

    calculation_version: version,
    source_contributions: row.componentResults.map((component) => ({
      source_id: component.sourceId,
      source_name: component.sourceName,
      source_type: component.sourceType,
      method: component.method,
      raw_score: component.rawScore,
      allocated_points: component.finalAllocatedPoints,
    })),
    total_voting_points: row.totalVotingPoints,
    total_activity_points: row.totalActivityPoints,
    final_correction: row.finalCorrection,
    final_combined_points: row.finalCombinedPoints,
    final_rank: row.finalRank,
    final_tie_break_data: row.finalTieBreakData,

    // Legacy display columns kept in sync.
    converted_points: row.totalVotingPoints,
    post_conversion_bonus: row.totalActivityPoints,
    post_conversion_adjustment: row.finalCorrection,
    final_televote_score: row.finalCombinedPoints,
    combined_original_rank: row.finalRank,
    participant_count: participants.length,
    calculated_at: calculatedAt,
  }));

  const { error: insertError } = await supabaseAdmin
    .from("combined_televote_results" as any)
    .insert(finalRows);

  if (insertError) throw new Error(insertError.message);

  const { error: updateError } = await supabaseAdmin
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

  if (updateError) throw new Error(updateError.message);

  await audit(actor, "calculate_combined_televote", {
    target_type: "televote_aggregation",
    target_id: aggregationId,
    new_values: {
      engine: COMBINED_ENGINE_VERSION,
      calculation_version: version,
      total_points: result.totalPoints,
      allocated_total: result.allocatedTotal,
      final_total: result.finalTotal,
      participant_entry_keys: participants,
      pools: result.pools,
      sources: sources.map((source) => ({
        id: source.id,
        name: source.source_name,
        type: source.source_type,
        method: methodForSourceType(source.source_type),
        percentage_weight: Number(source.percentage_weight ?? 0),
        enabled: source.enabled,
        round_id: source.source_round_id,
      })),
      source_values: resolved.map((source) => ({
        id: source.id,
        values: source.values,
      })),
    },
  });

  return {
    version,
    calculatedAt,
    result,
  };
}

export async function validateCombinedForPublication(
  aggregationId: string,
) {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const agg = await loadAggregation(aggregationId);
  const participants = await loadParticipants(aggregationId);
  const entryCatalog = await loadAggregationEntryCatalog(
    aggregationId,
    participants,
  );

  const problems: string[] = [];

  if (agg.calculation_version === 0) {
    problems.push("Calculate the result first");
  }

  if (agg.results_outdated) {
    problems.push("Sources or settings changed — recalculate first");
  }

  if (participants.length === 0) {
    problems.push("No eligible entries selected");
  }

  const resolvedKeys = new Set(
    entryCatalog.map((entry) => entry.entry_key),
  );

  for (const entryKey of participants) {
    if (!resolvedKeys.has(entryKey)) {
      problems.push(
        `Participant entry key ${entryKey} cannot be resolved through round_entries`,
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("combined_televote_results" as any)
    .select(
      "country_code,total_voting_points,total_activity_points,final_combined_points,final_correction,calculation_version",
    )
    .eq("aggregation_id", aggregationId)
    .eq("calculation_version", agg.calculation_version);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];

  const resultKeys = new Set(
    rows.map((row) => row.country_code as string),
  );

  for (const entryKey of participants) {
    if (!resultKeys.has(entryKey)) {
      problems.push(`Missing result row for ${entryKey}`);
    }
  }

  for (const row of rows) {
    if (!participants.includes(row.country_code)) {
      problems.push(
        `Ineligible entry key in results: ${row.country_code}`,
      );
    }
  }

  const allocated = rows.reduce(
    (sum, row) =>
      sum +
      Number(row.total_voting_points ?? 0) +
      Number(row.total_activity_points ?? 0),
    0,
  );

  const corrections = rows.reduce(
    (sum, row) => sum + Number(row.final_correction ?? 0),
    0,
  );

  if (
    rows.length &&
    allocated !== agg.total_points_to_distribute
  ) {
    problems.push(
      `Allocated component points total ${allocated} does not equal the overall pool ${agg.total_points_to_distribute}`,
    );
  }

  if (corrections !== 0) {
    problems.push(
      `Manual corrections of ${corrections} point(s) are applied — confirm this is intended`,
    );
  }

  return {
    problems,
    agg,
    participants,
    entryCatalog,
    rows,
  };
}
