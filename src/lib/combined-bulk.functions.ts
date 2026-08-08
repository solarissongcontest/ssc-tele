import { createServerFn } from "@tanstack/react-start";

import {
  audit,
  loadAggregation,
  loadAggregationEntryCatalog,
  loadParticipants,
  requireAdmin,
} from "@/lib/combined.server";

type BulkValue = {
  entryKey: string;
  value: number;
};

export const saveExternalSourceValues = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      sourceId: string;
      values: BulkValue[];
      note?: string;
    }) => {
      const sourceId = String(data?.sourceId ?? "").trim();

      if (!sourceId) {
        throw new Error("Missing source");
      }

      if (!Array.isArray(data.values) || data.values.length === 0) {
        throw new Error("There are no values to save");
      }

      const seen = new Set<string>();

      const values = data.values.map((row) => {
        const entryKey = String(row?.entryKey ?? "").trim();
        const value = Number(row?.value);

        if (!entryKey) {
          throw new Error("Every row needs an entry key");
        }

        if (seen.has(entryKey)) {
          throw new Error(`Duplicate entry key: ${entryKey}`);
        }

        seen.add(entryKey);

        if (!Number.isFinite(value)) {
          throw new Error(`Invalid value for ${entryKey}`);
        }

        return {
          entryKey,
          value,
        };
      });

      return {
        sourceId,
        values,
        note: String(data.note ?? "").trim().slice(0, 500),
      };
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: source, error: sourceError } = await supabaseAdmin
      .from("televote_aggregation_sources" as any)
      .select(
        "id,aggregation_id,source_round_id,source_name,source_type,input_mode",
      )
      .eq("id", data.sourceId)
      .maybeSingle();

    if (sourceError) {
      throw new Error(sourceError.message);
    }

    if (!source) {
      throw new Error("Source not found");
    }

    if ((source as any).source_round_id) {
      throw new Error(
        "Linked website rounds are read automatically and cannot be edited manually",
      );
    }

    const aggregationId = String((source as any).aggregation_id);
    const aggregation = await loadAggregation(aggregationId);

    if (
      aggregation.status === "locked" ||
      aggregation.status === "published"
    ) {
      throw new Error(
        "Unlock this combined result before editing source values",
      );
    }

    const participants = await loadParticipants(aggregationId);
    const participantSet = new Set(participants);

    const unknownParticipants = data.values
      .map((row) => row.entryKey)
      .filter((entryKey) => !participantSet.has(entryKey));

    if (unknownParticipants.length > 0) {
      throw new Error(
        `These entries are not participants in this combined result: ${unknownParticipants.join(
          ", ",
        )}`,
      );
    }

    const catalog = await loadAggregationEntryCatalog(
      aggregationId,
      participants,
    );

    const catalogSet = new Set(catalog.map((entry) => entry.entry_key));

    const unresolved = data.values
      .map((row) => row.entryKey)
      .filter((entryKey) => !catalogSet.has(entryKey));

    if (unresolved.length > 0) {
      throw new Error(
        `These entry keys cannot be resolved: ${unresolved.join(", ")}`,
      );
    }

    const sourceType = String((source as any).source_type ?? "");
    const inputMode = String((source as any).input_mode ?? "");
    const isCorrection =
      sourceType === "correction" || inputMode === "correction";

    if (
      !isCorrection &&
      data.values.some((row) => row.value < 0)
    ) {
      throw new Error(
        "Negative values are only allowed for correction sources",
      );
    }

    const { data: existingRows, error: existingError } =
      await supabaseAdmin
        .from("external_score_entries" as any)
        .select("id,country_code,value,entry_type")
        .eq("source_id", data.sourceId);

    if (existingError) {
      throw new Error(existingError.message);
    }

    const existingByKey = new Map(
      ((existingRows ?? []) as any[]).map((row) => [
        String(row.country_code),
        row,
      ]),
    );

    const reason =
      data.note ||
      `Bulk update for ${(source as any).source_name ?? "manual source"}`;

    const rowsToSave = data.values.map((row) => ({
      source_id: data.sourceId,

      // Legacy DB column. Value is the stable generic entry_key.
      country_code: row.entryKey,

      value: row.value,
      entry_type:
        existingByKey.get(row.entryKey)?.entry_type ??
        sourceType ??
        "other",
      reason,
      entered_by: actor.username,
    }));

    const { error: upsertError } = await supabaseAdmin
      .from("external_score_entries" as any)
      .upsert(rowsToSave, {
        onConflict: "source_id,country_code",
      });

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    const changed = data.values.filter((row) => {
      const previous = Number(existingByKey.get(row.entryKey)?.value ?? 0);
      return previous !== row.value;
    });

    if (changed.length > 0) {
      const { error: logError } = await supabaseAdmin
        .from("external_score_entry_log" as any)
        .insert(
          changed.map((row) => {
            const previous = Number(
              existingByKey.get(row.entryKey)?.value ?? 0,
            );

            return {
              source_id: data.sourceId,
              aggregation_id: aggregationId,

              // Legacy DB column. Value is the stable generic entry_key.
              country_code: row.entryKey,

              previous_value: previous,
              new_value: row.value,
              delta: row.value - previous,
              entry_type:
                existingByKey.get(row.entryKey)?.entry_type ??
                sourceType ??
                "other",
              reason,
              actor_username: actor.username,
            };
          }),
        );

      if (logError) {
        throw new Error(logError.message);
      }
    }

    if (aggregation.calculation_version > 0) {
      await supabaseAdmin
        .from("televote_aggregations" as any)
        .update({
          results_outdated: true,
        })
        .eq("id", aggregationId);
    }

    await audit(actor, "bulk_manual_televote_entries", {
      target_type: "televote_aggregation_source",
      target_id: data.sourceId,
      old_values: {
        changed_entries: changed.map((row) => ({
          entry_key: row.entryKey,
          value: Number(existingByKey.get(row.entryKey)?.value ?? 0),
        })),
      },
      new_values: {
        changed_entries: changed.map((row) => ({
          entry_key: row.entryKey,
          value: row.value,
        })),
      },
      reason,
    });

    return {
      ok: true,
      saved: data.values.length,
      changed: changed.length,
    };
  });


export const syncParticipantsFromLinkedRounds = createServerFn({
  method: "POST",
})
  .inputValidator((data: { aggregationId: string }) => {
    const aggregationId = String(
      data?.aggregationId ?? "",
    ).trim();

    if (!aggregationId) {
      throw new Error("Missing aggregation");
    }

    return { aggregationId };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const aggregation = await loadAggregation(
      data.aggregationId,
    );

    if (
      aggregation.status === "locked" ||
      aggregation.status === "published"
    ) {
      throw new Error(
        "Unlock this combined result before syncing entries",
      );
    }

    const { data: sourceRows, error: sourceError } =
      await supabaseAdmin
        .from("televote_aggregation_sources" as any)
        .select("source_round_id,display_order")
        .eq("aggregation_id", data.aggregationId)
        .not("source_round_id", "is", null)
        .order("display_order", {
          ascending: true,
        });

    if (sourceError) {
      throw new Error(sourceError.message);
    }

    const roundIds = Array.from(
      new Set(
        ((sourceRows ?? []) as any[])
          .map((row) =>
            String(row.source_round_id ?? ""),
          )
          .filter(Boolean),
      ),
    );

    if (roundIds.length === 0) {
      throw new Error(
        "Add a website voting round first",
      );
    }

    const { data: entryRows, error: entryError } =
      await supabaseAdmin
        .from("round_entries" as any)
        .select(
          "round_id,entry_key,display_order",
        )
        .in("round_id", roundIds);

    if (entryError) {
      throw new Error(entryError.message);
    }

    const roundOrder = new Map(
      roundIds.map((id, index) => [
        id,
        index,
      ]),
    );

    const ordered = [
      ...((entryRows ?? []) as any[]),
    ].sort(
      (a, b) =>
        (roundOrder.get(String(a.round_id)) ??
          Number.MAX_SAFE_INTEGER) -
          (roundOrder.get(String(b.round_id)) ??
            Number.MAX_SAFE_INTEGER) ||
        Number(a.display_order ?? 0) -
          Number(b.display_order ?? 0) ||
        String(a.entry_key).localeCompare(
          String(b.entry_key),
        ),
    );

    const entryKeys: string[] = [];
    const seen = new Set<string>();

    for (const row of ordered) {
      const key = String(
        row.entry_key ?? "",
      ).trim();

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      entryKeys.push(key);
    }

    if (entryKeys.length === 0) {
      throw new Error(
        "The linked website round has no round entries",
      );
    }

    const before = await loadParticipants(
      data.aggregationId,
    );

    const { error: deleteError } =
      await supabaseAdmin
        .from(
          "televote_aggregation_participants" as any,
        )
        .delete()
        .eq(
          "aggregation_id",
          data.aggregationId,
        );

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    const { error: insertError } =
      await supabaseAdmin
        .from(
          "televote_aggregation_participants" as any,
        )
        .insert(
          entryKeys.map(
            (entryKey, index) => ({
              aggregation_id:
                data.aggregationId,

              // Legacy DB column. Value is stable entry_key.
              country_code: entryKey,

              display_order: index,
            }),
          ),
        );

    if (insertError) {
      throw new Error(insertError.message);
    }

    if (aggregation.calculation_version > 0) {
      await supabaseAdmin
        .from("televote_aggregations" as any)
        .update({
          results_outdated: true,
        })
        .eq("id", data.aggregationId);
    }

    await audit(
      actor,
      "sync_combined_participants_from_linked_rounds",
      {
        target_type:
          "televote_aggregation",
        target_id: data.aggregationId,
        old_values: {
          entry_keys: before,
        },
        new_values: {
          entry_keys: entryKeys,
        },
      },
    );

    return {
      ok: true,
      entryKeys,
      count: entryKeys.length,
    };
  });
