// Server functions for combined televote aggregations.
//
// Compatibility rule:
// Database columns named `country_code` remain in place, but combined
// aggregation values stored there are stable `entry_key` values.

import { createServerFn } from "@tanstack/react-start";
import {
  requireAdmin,
  audit,
  loadAggregation,
  loadParticipants,
  loadSources,
  loadAggregationEntryCatalog,
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

export const listAggregations = createServerFn({
  method: "POST",
}).handler(async () => {
  await requireAdmin();

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const { data, error } = await supabaseAdmin
    .from("televote_aggregations" as any)
    .select("*, editions(name)")
    .order("created_at", {
      ascending: false,
    });

  if (error) throw new Error(error.message);

  return (data ?? []) as any[];
});

export const createAggregation = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      name: string;
      editionId?: string | null;
    }) => {
      const name = (
        data?.name ?? ""
      ).trim();

      if (name.length < 2) {
        throw new Error(
          "Give the combined result a name",
        );
      }

      return {
        name,
        editionId:
          data.editionId ?? null,
      };
    },
  )
  .handler(async ({ data }) => {
    const actor =
      await requireAdmin();

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const { data: row, error } =
      await supabaseAdmin
        .from(
          "televote_aggregations" as any,
        )
        .insert({
          name: data.name,
          edition_id:
            data.editionId,
        })
        .select("id")
        .single();

    if (error) {
      throw new Error(
        error.message,
      );
    }

    await audit(
      actor,
      "create_combined_televote",
      {
        target_type:
          "televote_aggregation",
        target_id:
          (row as any).id,
        new_values: {
          name: data.name,
        },
      },
    );

    return {
      id: (row as any)
        .id as string,
    };
  });

export const deleteAggregation = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: { id: string }) => {
      if (!data?.id) {
        throw new Error(
          "Missing aggregation",
        );
      }

      return { id: data.id };
    },
  )
  .handler(async ({ data }) => {
    const actor =
      await requireAdmin();

    const agg =
      await loadAggregation(
        data.id,
      );

    if (
      agg.status === "published"
    ) {
      throw new Error(
        "Unpublish before deleting this combined result",
      );
    }

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const { error } =
      await supabaseAdmin
        .from(
          "televote_aggregations" as any,
        )
        .delete()
        .eq("id", data.id);

    if (error) {
      throw new Error(
        error.message,
      );
    }

    await audit(
      actor,
      "delete_combined_televote",
      {
        target_type:
          "televote_aggregation",
        target_id: data.id,
        old_values: {
          name: agg.name,
        },
      },
    );

    return { ok: true };
  });

export const getAggregation = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: { id: string }) => {
      if (!data?.id) {
        throw new Error(
          "Missing aggregation",
        );
      }

      return { id: data.id };
    },
  )
  .handler(async ({ data }) => {
    await requireAdmin();

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const {
      agg,
      participants,
      sources,
      resolved,
      result,
    } = await buildPreview(
      data.id,
    );

    const entryCatalog =
      await loadAggregationEntryCatalog(
        data.id,
        participants,
      );

    const { data: stored } =
      await supabaseAdmin
        .from(
          "combined_televote_results" as any,
        )
        .select("*")
        .eq(
          "aggregation_id",
          data.id,
        );

    const manualSourceIds =
      sources
        .filter(
          (source) =>
            !source.source_round_id,
        )
        .map(
          (source) => source.id,
        );

    let entries: any[] = [];

    if (
      manualSourceIds.length > 0
    ) {
      const {
        data: manualEntries,
        error: manualError,
      } = await supabaseAdmin
        .from(
          "external_score_entries" as any,
        )
        .select("*")
        .in(
          "source_id",
          manualSourceIds,
        );

      if (manualError) {
        throw new Error(
          manualError.message,
        );
      }

      entries =
        (manualEntries ??
          []) as any[];
    }

    const { data: log } =
      await supabaseAdmin
        .from(
          "external_score_entry_log" as any,
        )
        .select("*")
        .eq(
          "aggregation_id",
          data.id,
        )
        .order("created_at", {
          ascending: false,
        })
        .limit(200);

    return {
      agg,
      participants,
      entryCatalog,
      sources,
      sourceValues:
        resolved.map((source) => ({
          id: source.id,
          values:
            source.values,
        })),
      preview: result,
      stored:
        (stored ??
          []) as any[],
      entries,
      log:
        (log ?? []) as any[],
    };
  });

export const updateAggregation = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      id: string;
      name?: string;
      editionId?:
        | string
        | null;
      combinationMethod?:
        | "raw"
        | "normalized";
      totalPoints?: number;
      rankExponent?: number;
      publicColumns?: Record<
        string,
        boolean
      >;
      broadcastMode?: string;
    }) => {
      if (!data?.id) {
        throw new Error(
          "Missing aggregation",
        );
      }

      const out: any = {
        id: data.id,
      };

      if (
        data.name !==
        undefined
      ) {
        const name =
          data.name.trim();

        if (
          name.length < 2
        ) {
          throw new Error(
            "Name is too short",
          );
        }

        out.name = name;
      }

      if (
        data.editionId !==
        undefined
      ) {
        out.editionId =
          data.editionId;
      }

      if (
        data.combinationMethod !==
        undefined
      ) {
        if (
          ![
            "raw",
            "normalized",
          ].includes(
            data.combinationMethod,
          )
        ) {
          throw new Error(
            "Invalid combination method",
          );
        }

        out.combinationMethod =
          data.combinationMethod;
      }

      if (
        data.totalPoints !==
        undefined
      ) {
        const totalPoints =
          Number(
            data.totalPoints,
          );

        if (
          !Number.isInteger(
            totalPoints,
          ) ||
          totalPoints < 0
        ) {
          throw new Error(
            "T must be a non-negative whole number",
          );
        }

        out.totalPoints =
          totalPoints;
      }

      if (
        data.rankExponent !==
        undefined
      ) {
        const exponent =
          Number(
            data.rankExponent,
          );

        if (
          !Number.isFinite(
            exponent,
          ) ||
          exponent <= 0 ||
          exponent > 5
        ) {
          throw new Error(
            "Exponent must be between 0 and 5",
          );
        }

        out.rankExponent =
          exponent;
      }

      if (
        data.publicColumns !==
        undefined
      ) {
        out.publicColumns =
          data.publicColumns;
      }

      if (
        data.broadcastMode !==
        undefined
      ) {
        out.broadcastMode =
          data.broadcastMode;
      }

      return out;
    },
  )
  .handler(async ({ data }) => {
    const actor =
      await requireAdmin();

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const before =
      await loadAggregation(
        data.id,
      );

    const patch: Record<
      string,
      unknown
    > = {};

    if (
      data.name !== undefined
    ) {
      patch.name = data.name;
    }

    if (
      data.editionId !==
      undefined
    ) {
      patch.edition_id =
        data.editionId;
    }

    if (
      data.combinationMethod !==
      undefined
    ) {
      patch.combination_method =
        data.combinationMethod;
    }

    if (
      data.totalPoints !==
      undefined
    ) {
      patch.total_points_to_distribute =
        data.totalPoints;
    }

    if (
      data.rankExponent !==
      undefined
    ) {
      patch.rank_exponent =
        data.rankExponent;
    }

    if (
      data.publicColumns !==
      undefined
    ) {
      patch.public_columns =
        data.publicColumns;
    }

    if (
      data.broadcastMode !==
      undefined
    ) {
      patch.broadcast_display_mode =
        data.broadcastMode;
    }

    const affectsMath =
      (data.combinationMethod !==
        undefined &&
        data.combinationMethod !==
          before.combination_method) ||
      (data.totalPoints !==
        undefined &&
        data.totalPoints !==
          before.total_points_to_distribute) ||
      (data.rankExponent !==
        undefined &&
        Number(
          data.rankExponent,
        ) !==
          Number(
            before.rank_exponent,
          ));

    if (
      affectsMath &&
      before.calculation_version >
        0
    ) {
      patch.results_outdated =
        true;
    }

    const { error } =
      await supabaseAdmin
        .from(
          "televote_aggregations" as any,
        )
        .update(patch)
        .eq("id", data.id);

    if (error) {
      throw new Error(
        error.message,
      );
    }

    await audit(
      actor,
      "update_combined_televote_config",
      {
        target_type:
          "televote_aggregation",
        target_id: data.id,
        old_values: {
          name: before.name,
          combination_method:
            before.combination_method,
          total_points_to_distribute:
            before.total_points_to_distribute,
          rank_exponent:
            before.rank_exponent,
        },
        new_values: patch,
      },
    );

    return {
      ok: true,
      outdated:
        Boolean(
          patch.results_outdated,
        ),
    };
  });

/**
 * Save combined participants by stable entry_key.
 *
 * `codes` remains accepted temporarily so older admin clients do not break.
 * The database column is still named country_code, but stores entry_key.
 */
export const setAggregationParticipants = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      id: string;
      entryKeys?: string[];
      codes?: string[];
    }) => {
      if (!data?.id) {
        throw new Error(
          "Missing aggregation",
        );
      }

      const raw =
        data.entryKeys ??
        data.codes ??
        [];

      const entryKeys =
        Array.from(
          new Set(
            raw
              .map((key) =>
                String(
                  key ?? "",
                ).trim(),
              )
              .filter(Boolean),
          ),
        );

      return {
        id: data.id,
        entryKeys,
      };
    },
  )
  .handler(async ({ data }) => {
    const actor =
      await requireAdmin();

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const before =
      await loadParticipants(
        data.id,
      );

    const catalog =
      await loadAggregationEntryCatalog(
        data.id,
        before,
      );

    const allowedKeys =
      new Set(
        catalog.map(
          (entry) =>
            entry.entry_key,
        ),
      );

    const unknown =
      data.entryKeys.filter(
        (key) =>
          !allowedKeys.has(key),
      );

    if (
      unknown.length > 0
    ) {
      throw new Error(
        `These entry keys are not available from the linked round entries: ${unknown.join(
          ", ",
        )}`,
      );
    }

    const { error: deleteError } =
      await supabaseAdmin
        .from(
          "televote_aggregation_participants" as any,
        )
        .delete()
        .eq(
          "aggregation_id",
          data.id,
        );

    if (deleteError) {
      throw new Error(
        deleteError.message,
      );
    }

    if (
      data.entryKeys.length
    ) {
      const { error } =
        await supabaseAdmin
          .from(
            "televote_aggregation_participants" as any,
          )
          .insert(
            data.entryKeys.map(
              (
                entryKey,
                index,
              ) => ({
                aggregation_id:
                  data.id,

                // Legacy column name. Value = entry_key.
                country_code:
                  entryKey,

                display_order:
                  index,
              }),
            ),
          );

      if (error) {
        throw new Error(
          error.message,
        );
      }
    }

    await supabaseAdmin
      .from(
        "televote_aggregations" as any,
      )
      .update({
        results_outdated: true,
      })
      .eq("id", data.id)
      .gt(
        "calculation_version",
        0,
      );

    await audit(
      actor,
      "update_combined_participants",
      {
        target_type:
          "televote_aggregation",
        target_id: data.id,
        old_values: {
          entry_keys: before,
        },
        new_values: {
          entry_keys:
            data.entryKeys,
        },
      },
    );

    return { ok: true };
  });

export const upsertSource = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      id?: string;
      aggregationId: string;
      sourceType?: string;
      inputMode?: string;
      sourceRoundId?:
        | string
        | null;
      sourceName?: string;
      stage?:
        | "pre_conversion"
        | "post_conversion";
      weight?: number;
      percentageWeight?: number;
      correctionTargetSourceId?:
        | string
        | null;
      correctionScope?:
        | "source"
        | "final";
      enabled?: boolean;
      displayOrder?: number;
    }) => {
      if (
        !data?.aggregationId
      ) {
        throw new Error(
          "Missing aggregation",
        );
      }

      if (
        data.sourceType &&
        !SOURCE_TYPES.includes(
          data.sourceType,
        )
      ) {
        throw new Error(
          "Invalid source type",
        );
      }

      if (
        data.inputMode &&
        ![
          "raw_results",
          "converted_points",
          "activity_points",
          "correction",
        ].includes(
          data.inputMode,
        )
      ) {
        throw new Error(
          "Invalid input mode",
        );
      }

      if (
        data.stage &&
        ![
          "pre_conversion",
          "post_conversion",
        ].includes(
          data.stage,
        )
      ) {
        throw new Error(
          "Invalid calculation stage",
        );
      }

      if (
        data.weight !==
          undefined &&
        !Number.isFinite(
          Number(data.weight),
        )
      ) {
        throw new Error(
          "Weight must be a number",
        );
      }

      if (
        data.percentageWeight !==
        undefined
      ) {
        const percentage =
          Number(
            data.percentageWeight,
          );

        if (
          !Number.isFinite(
            percentage,
          ) ||
          percentage < 0 ||
          percentage > 100
        ) {
          throw new Error(
            "Percentage weight must be between 0 and 100",
          );
        }
      }

      if (
        data.correctionScope !==
          undefined &&
        ![
          "source",
          "final",
        ].includes(
          data.correctionScope,
        )
      ) {
        throw new Error(
          "Invalid correction scope",
        );
      }

      return data;
    },
  )
  .handler(async ({ data }) => {
    const actor =
      await requireAdmin();

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const {
      inputModeForSourceType,
      methodForInputMode,
    } = await import(
      "@/lib/combined-televote-math"
    );

    const patch: Record<
      string,
      unknown
    > = {
      aggregation_id:
        data.aggregationId,
    };

    if (
      data.sourceType !==
      undefined
    ) {
      patch.source_type =
        data.sourceType;
    }

    const mode =
      (data.inputMode as any) ??
      (data.sourceType !==
      undefined
        ? inputModeForSourceType(
            data.sourceType,
          )
        : undefined);

    if (mode) {
      patch.input_mode =
        mode;
      patch.calculation_method =
        methodForInputMode(
          mode,
        );
    }

    if (
      data.sourceRoundId !==
      undefined
    ) {
      patch.source_round_id =
        data.sourceRoundId;
    }

    if (
      data.sourceName !==
      undefined
    ) {
      patch.source_name =
        data.sourceName.trim();
    }

    if (
      data.stage !== undefined
    ) {
      patch.calculation_stage =
        data.stage;
    }

    if (
      data.weight !== undefined
    ) {
      patch.weight = Number(
        data.weight,
      );
    }

    if (
      data.percentageWeight !==
      undefined
    ) {
      patch.percentage_weight =
        Number(
          data.percentageWeight,
        );
    }

    if (
      data.correctionTargetSourceId !==
      undefined
    ) {
      patch.correction_target_source_id =
        data.correctionTargetSourceId;
    }

    if (
      data.correctionScope !==
      undefined
    ) {
      patch.correction_scope =
        data.correctionScope;
    }

    if (
      data.enabled !== undefined
    ) {
      patch.enabled =
        data.enabled;
    }

    if (
      data.displayOrder !==
      undefined
    ) {
      patch.display_order =
        data.displayOrder;
    }

    if (data.id) {
      const { error } =
        await supabaseAdmin
          .from(
            "televote_aggregation_sources" as any,
          )
          .update(patch)
          .eq("id", data.id);

      if (error) {
        throw new Error(
          error.message,
        );
      }

      await audit(
        actor,
        "update_combined_source",
        {
          target_type:
            "televote_aggregation_source",
          target_id: data.id,
          new_values: patch,
        },
      );

      return {
        id: data.id,
      };
    }

    if (
      !patch.source_name
    ) {
      throw new Error(
        "Give the source a name",
      );
    }

    const { data: row, error } =
      await supabaseAdmin
        .from(
          "televote_aggregation_sources" as any,
        )
        .insert(patch)
        .select("id")
        .single();

    if (error) {
      throw new Error(
        error.message,
      );
    }

    await audit(
      actor,
      "add_combined_source",
      {
        target_type:
          "televote_aggregation",
        target_id:
          data.aggregationId,
        new_values: patch,
      },
    );

    return {
      id: (row as any)
        .id as string,
    };
  });

export const deleteSource = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: { id: string }) => {
      if (!data?.id) {
        throw new Error(
          "Missing source",
        );
      }

      return { id: data.id };
    },
  )
  .handler(async ({ data }) => {
    const actor =
      await requireAdmin();

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const { error } =
      await supabaseAdmin
        .from(
          "televote_aggregation_sources" as any,
        )
        .delete()
        .eq("id", data.id);

    if (error) {
      throw new Error(
        error.message,
      );
    }

    await audit(
      actor,
      "delete_combined_source",
      {
        target_type:
          "televote_aggregation_source",
        target_id: data.id,
      },
    );

    return { ok: true };
  });

/**
 * Add or update a manual source value by stable entry_key.
 *
 * `countryCode` remains accepted temporarily for old clients.
 */
export const upsertExternalEntry = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      sourceId: string;
      entryKey?: string;
      countryCode?: string;
      value: number;
      entryType?: string;
      reason?: string;
      confirmNegative?: boolean;
    }) => {
      if (
        !data?.sourceId
      ) {
        throw new Error(
          "Missing source",
        );
      }

      const entryKey =
        String(
          data.entryKey ??
            data.countryCode ??
            "",
        ).trim();

      if (!entryKey) {
        throw new Error(
          "Select an entry",
        );
      }

      const value =
        Number(data.value);

      if (
        !Number.isFinite(value)
      ) {
        throw new Error(
          "Value must be a number",
        );
      }

      if (
        value < 0 &&
        !data.confirmNegative
      ) {
        throw new Error(
          "Negative adjustments require confirmation",
        );
      }

      if (
        !data.reason ||
        data.reason.trim()
          .length < 3
      ) {
        throw new Error(
          "A reason or note is required",
        );
      }

      return {
        sourceId:
          data.sourceId,
        entryKey,
        value,
        entryType:
          data.entryType ??
          "other",
        reason:
          data.reason
            .trim()
            .slice(0, 500),
      };
    },
  )
  .handler(async ({ data }) => {
    const actor =
      await requireAdmin();

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const { data: source } =
      await supabaseAdmin
        .from(
          "televote_aggregation_sources" as any,
        )
        .select(
          "id,aggregation_id",
        )
        .eq(
          "id",
          data.sourceId,
        )
        .maybeSingle();

    if (!source) {
      throw new Error(
        "Source not found",
      );
    }

    const aggregationId =
      (source as any)
        .aggregation_id as string;

    const agg =
      await loadAggregation(
        aggregationId,
      );

    if (
      agg.status ===
        "locked" ||
      agg.status ===
        "published"
    ) {
      throw new Error(
        "This combined result is locked or published — unlock it before editing values",
      );
    }

    const participants =
      await loadParticipants(
        aggregationId,
      );

    if (
      !participants.includes(
        data.entryKey,
      )
    ) {
      throw new Error(
        "That entry is not an eligible participant in this combined result",
      );
    }

    const catalog =
      await loadAggregationEntryCatalog(
        aggregationId,
        participants,
      );

    if (
      !catalog.some(
        (entry) =>
          entry.entry_key ===
          data.entryKey,
      )
    ) {
      throw new Error(
        "That entry key cannot be resolved through round_entries",
      );
    }

    const { data: existing } =
      await supabaseAdmin
        .from(
          "external_score_entries" as any,
        )
        .select("id,value")
        .eq(
          "source_id",
          data.sourceId,
        )
        // Legacy column. Value = entry_key.
        .eq(
          "country_code",
          data.entryKey,
        )
        .maybeSingle();

    const previous =
      existing
        ? Number(
            (existing as any)
              .value,
          )
        : 0;

    const { error } =
      await supabaseAdmin
        .from(
          "external_score_entries" as any,
        )
        .upsert(
          {
            source_id:
              data.sourceId,

            // Legacy column. Value = entry_key.
            country_code:
              data.entryKey,

            value: data.value,
            entry_type:
              data.entryType,
            reason: data.reason,
            entered_by:
              actor.username,
          },
          {
            onConflict:
              "source_id,country_code",
          },
        );

    if (error) {
      throw new Error(
        error.message,
      );
    }

    await supabaseAdmin
      .from(
        "external_score_entry_log" as any,
      )
      .insert({
        source_id:
          data.sourceId,
        aggregation_id:
          aggregationId,

        // Legacy column. Value = entry_key.
        country_code:
          data.entryKey,

        previous_value:
          previous,
        new_value:
          data.value,
        delta:
          data.value -
          previous,
        entry_type:
          data.entryType,
        reason:
          data.reason,
        actor_username:
          actor.username,
      });

    await audit(
      actor,
      "manual_televote_entry",
      {
        target_type:
          "televote_aggregation",
        target_id:
          aggregationId,
        old_values: {
          entry_key:
            data.entryKey,
          value: previous,
        },
        new_values: {
          entry_key:
            data.entryKey,
          value: data.value,
        },
        reason:
          data.reason,
      },
    );

    return {
      ok: true,
      previous,
    };
  });

export const deleteExternalEntry = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      id: string;
      reason?: string;
    }) => {
      if (!data?.id) {
        throw new Error(
          "Missing entry",
        );
      }

      return {
        id: data.id,
        reason:
          data.reason ??
          "Removed",
      };
    },
  )
  .handler(async ({ data }) => {
    const actor =
      await requireAdmin();

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const { data: row } =
      await supabaseAdmin
        .from(
          "external_score_entries" as any,
        )
        .select(
          "*, televote_aggregation_sources(aggregation_id)",
        )
        .eq("id", data.id)
        .maybeSingle();

    if (!row) {
      throw new Error(
        "Entry not found",
      );
    }

    const aggregationId =
      (row as any)
        .televote_aggregation_sources
        ?.aggregation_id;

    const agg =
      await loadAggregation(
        aggregationId,
      );

    if (
      agg.status ===
        "locked" ||
      agg.status ===
        "published"
    ) {
      throw new Error(
        "Unlock this combined result before deleting manual values",
      );
    }

    await supabaseAdmin
      .from(
        "external_score_entries" as any,
      )
      .delete()
      .eq("id", data.id);

    await supabaseAdmin
      .from(
        "external_score_entry_log" as any,
      )
      .insert({
        source_id:
          (row as any)
            .source_id,
        aggregation_id:
          aggregationId,

        // Legacy column. Value = entry_key.
        country_code:
          (row as any)
            .country_code,

        previous_value:
          Number(
            (row as any).value,
          ),
        new_value: 0,
        delta:
          -Number(
            (row as any).value,
          ),
        entry_type:
          (row as any)
            .entry_type,
        reason:
          data.reason,
        actor_username:
          actor.username,
      });

    return { ok: true };
  });

export const recalculateCombined = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      id: string;
      confirm?: boolean;
    }) => {
      if (!data?.id) {
        throw new Error(
          "Missing aggregation",
        );
      }

      return {
        id: data.id,
        confirm:
          Boolean(
            data.confirm,
          ),
      };
    },
  )
  .handler(async ({ data }) => {
    const actor =
      await requireAdmin();

    const agg =
      await loadAggregation(
        data.id,
      );

    if (
      (agg.status ===
        "locked" ||
        agg.status ===
          "published") &&
      !data.confirm
    ) {
      throw new Error(
        "This combined result is locked or published — explicit confirmation required",
      );
    }

    const {
      version,
      calculatedAt,
      result,
    } =
      await runCombinedCalculation(
        data.id,
        actor,
      );

    return {
      version,
      calculatedAt,
      allocatedTotal:
        result.allocatedTotal,
      finalTotal:
        result.finalTotal,
      totalPoints:
        result.totalPoints,
      warnings:
        result.warnings,
    };
  });

export const setAggregationStatus = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      id: string;
      status:
        | "draft"
        | "calculated"
        | "locked"
        | "published";
      reason?: string;
    }) => {
      if (!data?.id) {
        throw new Error(
          "Missing aggregation",
        );
      }

      if (
        ![
          "draft",
          "calculated",
          "locked",
          "published",
        ].includes(
          data.status,
        )
      ) {
        throw new Error(
          "Invalid status",
        );
      }

      return {
        id: data.id,
        status:
          data.status,
        reason:
          data.reason,
      };
    },
  )
  .handler(async ({ data }) => {
    const actor =
      await requireAdmin();

    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    const before =
      await loadAggregation(
        data.id,
      );

    if (
      data.status ===
        "locked" ||
      data.status ===
        "published"
    ) {
      if (
        before.calculation_version ===
        0
      ) {
        throw new Error(
          "Calculate the combined result first",
        );
      }
    }

    if (
      data.status ===
      "published"
    ) {
      const { problems } =
        await validateCombinedForPublication(
          data.id,
        );

      if (
        problems.length
      ) {
        throw new Error(
          `Cannot publish:\n• ${problems.join(
            "\n• ",
          )}`,
        );
      }
    }

    const patch: Record<
      string,
      unknown
    > = {
      status: data.status,
    };

    if (
      data.status ===
      "locked"
    ) {
      patch.locked_at =
        new Date().toISOString();
    }

    if (
      data.status ===
      "published"
    ) {
      patch.published_at =
        new Date().toISOString();
    }

    if (
      data.status ===
        "calculated" ||
      data.status === "draft"
    ) {
      patch.locked_at =
        null;

      if (
        before.status ===
        "published"
      ) {
        patch.published_at =
          null;
      }
    }

    const { error } =
      await supabaseAdmin
        .from(
          "televote_aggregations" as any,
        )
        .update(patch)
        .eq("id", data.id);

    if (error) {
      throw new Error(
        error.message,
      );
    }

    await audit(
      actor,
      "set_combined_televote_status",
      {
        target_type:
          "televote_aggregation",
        target_id: data.id,
        old_values: {
          status:
            before.status,
        },
        new_values: {
          status:
            data.status,
        },
        reason:
          data.reason,
      },
    );

    return { ok: true };
  });

export const checkCombinedPublication = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: { id: string }) => {
      if (!data?.id) {
        throw new Error(
          "Missing aggregation",
        );
      }

      return { id: data.id };
    },
  )
  .handler(async ({ data }) => {
    await requireAdmin();

    const { problems } =
      await validateCombinedForPublication(
        data.id,
      );

    return { problems };
  });

/** Public: list published combined results. */
export const listPublishedCombined = createServerFn({
  method: "POST",
}).handler(async () => {
  const { supabaseAdmin } =
    await import(
      "@/integrations/supabase/client.server"
    );

  const { data } =
    await supabaseAdmin
      .from(
        "televote_aggregations" as any,
      )
      .select(
        "id,name,published_at,editions(name)",
      )
      .eq(
        "status",
        "published",
      )
      .order(
        "published_at",
        { ascending: false },
      );

  return (
    (data ?? []) as any[]
  ).map((aggregation) => ({
    id: aggregation.id as string,
    name:
      aggregation.name as string,
    edition:
      aggregation.editions
        ?.name ?? null,
    published_at:
      aggregation.published_at as
        | string
        | null,
  }));
});

/**
 * Public: one published combined result.
 *
 * Rows expose `entry_key`; `country_code` is retained as a compatibility
 * alias for old clients. Entry presentation metadata comes from round_entries.
 */
export const getPublishedCombined = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      id?: string;
    }) => ({
      id: data?.id,
    }),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } =
      await import(
        "@/integrations/supabase/client.server"
      );

    let query =
      supabaseAdmin
        .from(
          "televote_aggregations" as any,
        )
        .select(
          "*, editions(name)",
        )
        .eq(
          "status",
          "published",
        )
        .order(
          "published_at",
          {
            ascending: false,
          },
        )
        .limit(1);

    if (data.id) {
      query = query.eq(
        "id",
        data.id,
      ) as any;
    }

    const {
      data: aggregations,
    } = await query;

    const aggregation =
      (
        (aggregations ??
          []) as any[]
      )[0];

    if (!aggregation) {
      return {
        aggregation: null,
        rows: [],
        entryCatalog: [],
      };
    }

    const columns =
      (aggregation.public_columns ??
        {}) as Record<
        string,
        boolean
      >;

    const { data: rows } =
      await supabaseAdmin
        .from(
          "combined_televote_results" as any,
        )
        .select("*")
        .eq(
          "aggregation_id",
          aggregation.id,
        )
        .eq(
          "calculation_version",
          aggregation.calculation_version,
        )
        .order("final_rank", {
          ascending: true,
        });

    const participants =
      await loadParticipants(
        aggregation.id,
      );

    const entryCatalog =
      await loadAggregationEntryCatalog(
        aggregation.id,
        participants,
      );

    const shaped = (
      (rows ?? []) as any[]
    ).map((row) => ({
      entry_key:
        row.country_code,

      // Compatibility alias only.
      country_code:
        row.country_code,

      final_rank:
        row.final_rank,

      converted_points:
        columns.converted !==
        false
          ? Number(
              row.total_voting_points ??
                0,
            )
          : null,

      bonus_points:
        columns.bonus !==
        false
          ? Number(
              row.total_activity_points ??
                0,
            ) +
            Number(
              row.final_correction ??
                0,
            )
          : null,

      final_televote_score:
        columns.final !==
        false
          ? Number(
              row.final_combined_points ??
                0,
            )
          : null,

      combined_original_score:
        columns.combined_original
          ? Number(
              row.total_voting_points ??
                0,
            ) +
            Number(
              row.total_activity_points ??
                0,
            )
          : null,

      combined_original_rank:
        columns.combined_original
          ? row.final_rank
          : null,

      source_contributions:
        columns.sources
          ? row.source_contributions
          : null,
    }));

    return {
      aggregation: {
        id:
          aggregation.id as string,
        name:
          aggregation.name as string,
        edition:
          aggregation.editions
            ?.name ?? null,
        total_points:
          aggregation.total_points_to_distribute as number,
        version:
          aggregation.calculation_version as number,
        calculated_at:
          aggregation.calculated_at as
            | string
            | null,
        broadcast_mode:
          aggregation.broadcast_display_mode as string,
        columns: {
          sources:
            Boolean(
              columns.sources,
            ),
          combined_original:
            Boolean(
              columns.combined_original,
            ),
          converted:
            columns.converted !==
            false,
          bonus:
            columns.bonus !==
            false,
          final:
            columns.final !==
            false,
        },
      },
      rows: shaped,
      entryCatalog,
    };
  });
