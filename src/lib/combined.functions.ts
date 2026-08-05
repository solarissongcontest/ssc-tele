// Server functions for combined televote aggregations.
import { createServerFn } from "@tanstack/react-start";
import {
  requireAdmin,
  audit,
  loadAggregation,
  loadParticipants,
  loadSources,
  buildPreview,
  runCombinedCalculation,
  validateCombinedForPublication,
} from "@/lib/combined.server";

const SOURCE_TYPES = [
  "round",
  "instagram",
  "external_televote",
  "imported",
  "activity",
  "correction",
  "other",
];

export const listAggregations = createServerFn({ method: "POST" }).handler(
  async () => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("televote_aggregations" as any)
      .select("*, editions(name)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  },
);

export const createAggregation = createServerFn({ method: "POST" })
  .inputValidator((data: { name: string; editionId?: string | null }) => {
    const name = (data?.name ?? "").trim();
    if (name.length < 2) throw new Error("Give the combined result a name");
    return { name, editionId: data.editionId ?? null };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("televote_aggregations" as any)
      .insert({ name: data.name, edition_id: data.editionId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(actor, "create_combined_televote", {
      target_type: "televote_aggregation",
      target_id: (row as any).id,
      new_values: { name: data.name },
    });
    return { id: (row as any).id as string };
  });

export const deleteAggregation = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("Missing aggregation");
    return { id: data.id };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const agg = await loadAggregation(data.id);
    if (agg.status === "published")
      throw new Error("Unpublish before deleting this combined result");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("televote_aggregations" as any)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "delete_combined_televote", {
      target_type: "televote_aggregation",
      target_id: data.id,
      old_values: { name: agg.name },
    });
    return { ok: true };
  });

export const getAggregation = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("Missing aggregation");
    return { id: data.id };
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { agg, participants, sources, resolved, result } = await buildPreview(
      data.id,
    );
    const { data: stored } = await supabaseAdmin
      .from("combined_televote_results" as any)
      .select("*")
      .eq("aggregation_id", data.id);
    const { data: entries } = await supabaseAdmin
      .from("external_score_entries" as any)
      .select("*")
      .in(
        "source_id",
        sources.filter((s) => !s.source_round_id).map((s) => s.id).concat("00000000-0000-0000-0000-000000000000"),
      );
    const { data: log } = await supabaseAdmin
      .from("external_score_entry_log" as any)
      .select("*")
      .eq("aggregation_id", data.id)
      .order("created_at", { ascending: false })
      .limit(200);
    return {
      agg,
      participants,
      sources,
      sourceValues: resolved.map((s) => ({ id: s.id, values: s.values })),
      preview: result,
      stored: (stored ?? []) as any[],
      entries: (entries ?? []) as any[],
      log: (log ?? []) as any[],
    };
  });

export const updateAggregation = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      name?: string;
      editionId?: string | null;
      combinationMethod?: "raw" | "normalized";
      totalPoints?: number;
      rankExponent?: number;
      publicColumns?: Record<string, boolean>;
      broadcastMode?: string;
    }) => {
      if (!data?.id) throw new Error("Missing aggregation");
      const out: any = { id: data.id };
      if (data.name !== undefined) {
        const n = data.name.trim();
        if (n.length < 2) throw new Error("Name is too short");
        out.name = n;
      }
      if (data.editionId !== undefined) out.editionId = data.editionId;
      if (data.combinationMethod !== undefined) {
        if (!["raw", "normalized"].includes(data.combinationMethod))
          throw new Error("Invalid combination method");
        out.combinationMethod = data.combinationMethod;
      }
      if (data.totalPoints !== undefined) {
        const t = Number(data.totalPoints);
        if (!Number.isInteger(t) || t < 0)
          throw new Error("T must be a non-negative whole number");
        out.totalPoints = t;
      }
      if (data.rankExponent !== undefined) {
        const e = Number(data.rankExponent);
        if (!Number.isFinite(e) || e <= 0 || e > 5)
          throw new Error("Exponent must be between 0 and 5");
        out.rankExponent = e;
      }
      if (data.publicColumns !== undefined) out.publicColumns = data.publicColumns;
      if (data.broadcastMode !== undefined) out.broadcastMode = data.broadcastMode;
      return out;
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const before = await loadAggregation(data.id);

    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.editionId !== undefined) patch.edition_id = data.editionId;
    if (data.combinationMethod !== undefined)
      patch.combination_method = data.combinationMethod;
    if (data.totalPoints !== undefined)
      patch.total_points_to_distribute = data.totalPoints;
    if (data.rankExponent !== undefined) patch.rank_exponent = data.rankExponent;
    if (data.publicColumns !== undefined) patch.public_columns = data.publicColumns;
    if (data.broadcastMode !== undefined)
      patch.broadcast_display_mode = data.broadcastMode;

    const affectsMath =
      (data.combinationMethod !== undefined &&
        data.combinationMethod !== before.combination_method) ||
      (data.totalPoints !== undefined &&
        data.totalPoints !== before.total_points_to_distribute) ||
      (data.rankExponent !== undefined &&
        Number(data.rankExponent) !== Number(before.rank_exponent));
    if (affectsMath && before.calculation_version > 0) patch.results_outdated = true;

    const { error } = await supabaseAdmin
      .from("televote_aggregations" as any)
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "update_combined_televote_config", {
      target_type: "televote_aggregation",
      target_id: data.id,
      old_values: {
        name: before.name,
        combination_method: before.combination_method,
        total_points_to_distribute: before.total_points_to_distribute,
        rank_exponent: before.rank_exponent,
      },
      new_values: patch,
    });
    return { ok: true, outdated: !!patch.results_outdated };
  });

export const setAggregationParticipants = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; codes: string[] }) => {
    if (!data?.id) throw new Error("Missing aggregation");
    const codes = Array.from(new Set(data.codes ?? []));
    return { id: data.id, codes };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const before = await loadParticipants(data.id);
    await supabaseAdmin
      .from("televote_aggregation_participants" as any)
      .delete()
      .eq("aggregation_id", data.id);
    if (data.codes.length) {
      const { error } = await supabaseAdmin
        .from("televote_aggregation_participants" as any)
        .insert(
          data.codes.map((c, i) => ({
            aggregation_id: data.id,
            country_code: c,
            display_order: i,
          })),
        );
      if (error) throw new Error(error.message);
    }
    await supabaseAdmin
      .from("televote_aggregations" as any)
      .update({ results_outdated: true })
      .eq("id", data.id)
      .gt("calculation_version", 0);
    await audit(actor, "update_combined_participants", {
      target_type: "televote_aggregation",
      target_id: data.id,
      old_values: { codes: before },
      new_values: { codes: data.codes },
    });
    return { ok: true };
  });

export const upsertSource = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id?: string;
      aggregationId: string;
      sourceType?: string;
      sourceRoundId?: string | null;
      sourceName?: string;
      stage?: "pre_conversion" | "post_conversion";
      weight?: number;
      enabled?: boolean;
      displayOrder?: number;
    }) => {
      if (!data?.aggregationId) throw new Error("Missing aggregation");
      if (data.sourceType && !SOURCE_TYPES.includes(data.sourceType))
        throw new Error("Invalid source type");
      if (data.stage && !["pre_conversion", "post_conversion"].includes(data.stage))
        throw new Error("Invalid calculation stage");
      if (data.weight !== undefined && !Number.isFinite(Number(data.weight)))
        throw new Error("Weight must be a number");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { aggregation_id: data.aggregationId };
    if (data.sourceType !== undefined) patch.source_type = data.sourceType;
    if (data.sourceRoundId !== undefined) patch.source_round_id = data.sourceRoundId;
    if (data.sourceName !== undefined) patch.source_name = data.sourceName.trim();
    if (data.stage !== undefined) patch.calculation_stage = data.stage;
    if (data.weight !== undefined) patch.weight = Number(data.weight);
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.displayOrder !== undefined) patch.display_order = data.displayOrder;

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("televote_aggregation_sources" as any)
        .update(patch)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      await audit(actor, "update_combined_source", {
        target_type: "televote_aggregation_source",
        target_id: data.id,
        new_values: patch,
      });
      return { id: data.id };
    }
    if (!patch.source_name) throw new Error("Give the source a name");
    const { data: row, error } = await supabaseAdmin
      .from("televote_aggregation_sources" as any)
      .insert(patch)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(actor, "add_combined_source", {
      target_type: "televote_aggregation",
      target_id: data.aggregationId,
      new_values: patch,
    });
    return { id: (row as any).id as string };
  });

export const deleteSource = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("Missing source");
    return { id: data.id };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("televote_aggregation_sources" as any)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "delete_combined_source", {
      target_type: "televote_aggregation_source",
      target_id: data.id,
    });
    return { ok: true };
  });

export const upsertExternalEntry = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      sourceId: string;
      countryCode: string;
      value: number;
      entryType?: string;
      reason?: string;
      confirmNegative?: boolean;
    }) => {
      if (!data?.sourceId) throw new Error("Missing source");
      if (!data?.countryCode) throw new Error("Select a country");
      const v = Number(data.value);
      if (!Number.isFinite(v)) throw new Error("Value must be a number");
      if (v < 0 && !data.confirmNegative)
        throw new Error("Negative adjustments require confirmation");
      if (!data.reason || data.reason.trim().length < 3)
        throw new Error("A reason or note is required");
      return {
        sourceId: data.sourceId,
        countryCode: data.countryCode,
        value: v,
        entryType: data.entryType ?? "other",
        reason: data.reason.trim().slice(0, 500),
      };
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: src } = await supabaseAdmin
      .from("televote_aggregation_sources" as any)
      .select("id,aggregation_id")
      .eq("id", data.sourceId)
      .maybeSingle();
    if (!src) throw new Error("Source not found");
    const aggregationId = (src as any).aggregation_id as string;
    const agg = await loadAggregation(aggregationId);
    if (agg.status === "locked" || agg.status === "published")
      throw new Error(
        "This combined result is locked or published — unlock it before editing values",
      );

    const { data: existing } = await supabaseAdmin
      .from("external_score_entries" as any)
      .select("id,value")
      .eq("source_id", data.sourceId)
      .eq("country_code", data.countryCode)
      .maybeSingle();
    const previous = existing ? Number((existing as any).value) : 0;

    const { error } = await supabaseAdmin
      .from("external_score_entries" as any)
      .upsert(
        {
          source_id: data.sourceId,
          country_code: data.countryCode,
          value: data.value,
          entry_type: data.entryType,
          reason: data.reason,
          entered_by: actor.username,
        },
        { onConflict: "source_id,country_code" },
      );
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("external_score_entry_log" as any).insert({
      source_id: data.sourceId,
      aggregation_id: aggregationId,
      country_code: data.countryCode,
      previous_value: previous,
      new_value: data.value,
      delta: data.value - previous,
      entry_type: data.entryType,
      reason: data.reason,
      actor_username: actor.username,
    });
    await audit(actor, "manual_televote_entry", {
      target_type: "televote_aggregation",
      target_id: aggregationId,
      old_values: { country: data.countryCode, value: previous },
      new_values: { country: data.countryCode, value: data.value },
      reason: data.reason,
    });
    return { ok: true, previous };
  });

export const deleteExternalEntry = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; reason?: string }) => {
    if (!data?.id) throw new Error("Missing entry");
    return { id: data.id, reason: data.reason ?? "Removed" };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("external_score_entries" as any)
      .select("*, televote_aggregation_sources(aggregation_id)")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Entry not found");
    const aggregationId = (row as any).televote_aggregation_sources?.aggregation_id;
    await supabaseAdmin
      .from("external_score_entries" as any)
      .delete()
      .eq("id", data.id);
    await supabaseAdmin.from("external_score_entry_log" as any).insert({
      source_id: (row as any).source_id,
      aggregation_id: aggregationId,
      country_code: (row as any).country_code,
      previous_value: Number((row as any).value),
      new_value: 0,
      delta: -Number((row as any).value),
      entry_type: (row as any).entry_type,
      reason: data.reason,
      actor_username: actor.username,
    });
    return { ok: true };
  });

export const recalculateCombined = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; confirm?: boolean }) => {
    if (!data?.id) throw new Error("Missing aggregation");
    return { id: data.id, confirm: !!data.confirm };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const agg = await loadAggregation(data.id);
    if ((agg.status === "locked" || agg.status === "published") && !data.confirm)
      throw new Error(
        "This combined result is locked or published — explicit confirmation required",
      );
    const { version, calculatedAt, result } = await runCombinedCalculation(
      data.id,
      actor,
    );
    return {
      version,
      calculatedAt,
      allocatedTotal: result.allocatedTotal,
      finalTotal: result.finalTotal,
      totalPoints: result.totalPoints,
      warnings: result.warnings,
    };
  });

export const setAggregationStatus = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      status: "draft" | "calculated" | "locked" | "published";
      reason?: string;
    }) => {
      if (!data?.id) throw new Error("Missing aggregation");
      if (!["draft", "calculated", "locked", "published"].includes(data.status))
        throw new Error("Invalid status");
      return { id: data.id, status: data.status, reason: data.reason };
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const before = await loadAggregation(data.id);
    if (data.status === "locked" || data.status === "published") {
      if (before.calculation_version === 0)
        throw new Error("Calculate the combined result first");
    }
    if (data.status === "published") {
      const { problems } = await validateCombinedForPublication(data.id);
      if (problems.length) throw new Error(`Cannot publish:\n• ${problems.join("\n• ")}`);
    }
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "locked") patch.locked_at = new Date().toISOString();
    if (data.status === "published") patch.published_at = new Date().toISOString();
    if (data.status === "calculated" || data.status === "draft") {
      patch.locked_at = null;
      if (before.status === "published") patch.published_at = null;
    }
    const { error } = await supabaseAdmin
      .from("televote_aggregations" as any)
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "set_combined_televote_status", {
      target_type: "televote_aggregation",
      target_id: data.id,
      old_values: { status: before.status },
      new_values: { status: data.status },
      reason: data.reason,
    });
    return { ok: true };
  });

export const checkCombinedPublication = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("Missing aggregation");
    return { id: data.id };
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    const { problems } = await validateCombinedForPublication(data.id);
    return { problems };
  });

/** Public: list published combined results. */
export const listPublishedCombined = createServerFn({ method: "POST" }).handler(
  async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("televote_aggregations" as any)
      .select("id,name,published_at,editions(name)")
      .eq("status", "published")
      .order("published_at", { ascending: false });
    return ((data ?? []) as any[]).map((a) => ({
      id: a.id as string,
      name: a.name as string,
      edition: a.editions?.name ?? null,
      published_at: a.published_at as string | null,
    }));
  },
);

/** Public: one published combined result, respecting the public column config. */
export const getPublishedCombined = createServerFn({ method: "POST" })
  .inputValidator((data: { id?: string }) => ({ id: data?.id }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("televote_aggregations" as any)
      .select("*, editions(name)")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1);
    if (data.id) q = q.eq("id", data.id) as any;
    const { data: aggs } = await q;
    const agg = ((aggs ?? []) as any[])[0];
    if (!agg) return { aggregation: null, rows: [] };

    const cols = (agg.public_columns ?? {}) as Record<string, boolean>;
    const { data: rows } = await supabaseAdmin
      .from("combined_televote_results" as any)
      .select("*")
      .eq("aggregation_id", agg.id)
      .order("final_televote_score", { ascending: false });

    const shaped = ((rows ?? []) as any[]).map((r) => ({
      country_code: r.country_code,
      converted_points: cols.converted !== false ? r.converted_points : null,
      bonus_points:
        cols.bonus !== false
          ? Number(r.post_conversion_bonus) + Number(r.post_conversion_adjustment)
          : null,
      final_televote_score: cols.final !== false ? Number(r.final_televote_score) : null,
      combined_original_score: cols.combined_original
        ? Number(r.combined_original_score)
        : null,
      combined_original_rank: cols.combined_original ? r.combined_original_rank : null,
      source_contributions: cols.sources ? r.source_contributions : null,
    }));

    return {
      aggregation: {
        id: agg.id as string,
        name: agg.name as string,
        edition: agg.editions?.name ?? null,
        total_points: agg.total_points_to_distribute as number,
        version: agg.calculation_version as number,
        calculated_at: agg.calculated_at as string | null,
        broadcast_mode: agg.broadcast_display_mode as string,
        columns: {
          sources: !!cols.sources,
          combined_original: !!cols.combined_original,
          converted: cols.converted !== false,
          bonus: cols.bonus !== false,
          final: cols.final !== false,
        },
      },
      rows: shaped,
    };
  });
