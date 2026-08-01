// Thin server-function wrappers for the televote conversion system.
import { createServerFn } from "@tanstack/react-start";
import {
  requireAdmin,
  audit,
  loadRound,
  loadParticipants,
  loadOriginalTotals,
  runOfficialCalculation,
  validateForPublication,
} from "@/lib/televote.server";

export const getTelevoteConversion = createServerFn({ method: "POST" })
  .inputValidator((data: { roundId: string }) => {
    if (!data?.roundId) throw new Error("Missing round");
    return { roundId: data.roundId };
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const round = await loadRound(data.roundId);
    const participants = await loadParticipants(data.roundId);
    const originals = await loadOriginalTotals(data.roundId, participants);
    const { data: stored } = await supabaseAdmin
      .from("round_results" as any)
      .select("*")
      .eq("round_id", data.roundId);
    return { round, participants, originals, stored: (stored ?? []) as any[] };
  });

export const updateConversionConfig = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      roundId: string;
      totalPoints?: number;
      rankExponent?: number;
      advancedTransparency?: boolean;
      broadcastMode?: "original" | "converted" | "combined";
    }) => {
      if (!data?.roundId) throw new Error("Missing round");
      const out: any = { roundId: data.roundId };
      if (data.totalPoints !== undefined) {
        const t = Number(data.totalPoints);
        if (!Number.isInteger(t) || t < 0)
          throw new Error("T must be a non-negative whole number");
        out.totalPoints = t;
      }
      if (data.rankExponent !== undefined) {
        const e = Number(data.rankExponent);
        if (!Number.isFinite(e) || e <= 0 || e > 5)
          throw new Error("Rank exponent must be between 0 and 5");
        out.rankExponent = e;
      }
      if (data.advancedTransparency !== undefined)
        out.advancedTransparency = !!data.advancedTransparency;
      if (data.broadcastMode !== undefined) {
        if (!["original", "converted", "combined"].includes(data.broadcastMode))
          throw new Error("Invalid broadcast mode");
        out.broadcastMode = data.broadcastMode;
      }
      return out;
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const before = await loadRound(data.roundId);

    const patch: Record<string, unknown> = {};
    if (data.totalPoints !== undefined) patch.total_points_to_distribute = data.totalPoints;
    if (data.rankExponent !== undefined) patch.rank_exponent = data.rankExponent;
    if (data.advancedTransparency !== undefined)
      patch.public_advanced_transparency = data.advancedTransparency;
    if (data.broadcastMode !== undefined) patch.broadcast_display_mode = data.broadcastMode;

    // Changing T or the exponent never rewrites a stored result — it only
    // flags it as needing recalculation.
    const affectsMath =
      (data.totalPoints !== undefined &&
        data.totalPoints !== before.total_points_to_distribute) ||
      (data.rankExponent !== undefined &&
        Number(data.rankExponent) !== Number(before.rank_exponent));
    if (affectsMath && before.calculation_version > 0) patch.results_outdated = true;

    const { error } = await supabaseAdmin
      .from("rounds")
      .update(patch as any)
      .eq("id", data.roundId);
    if (error) throw new Error(error.message);

    await audit(actor, "update_televote_config", {
      target_type: "round",
      target_id: data.roundId,
      old_values: {
        total_points_to_distribute: before.total_points_to_distribute,
        rank_exponent: before.rank_exponent,
        public_advanced_transparency: before.public_advanced_transparency,
        broadcast_display_mode: before.broadcast_display_mode,
      },
      new_values: patch,
    });
    return { ok: true, outdated: !!patch.results_outdated };
  });

export const recalculateConversion = createServerFn({ method: "POST" })
  .inputValidator((data: { roundId: string; confirm?: boolean }) => {
    if (!data?.roundId) throw new Error("Missing round");
    return { roundId: data.roundId, confirm: !!data.confirm };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const round = await loadRound(data.roundId);
    if (round.results_status === "locked" && !data.confirm)
      throw new Error("This result is locked — explicit confirmation required");
    if (round.results_status === "published" && !data.confirm)
      throw new Error("This result is published — explicit confirmation required");
    const result = await runOfficialCalculation(data.roundId, actor);
    return {
      version: result.version,
      calculatedAt: result.calculatedAt,
      participantCount: result.participantCount,
      rankBase: result.rankBase,
      distributedTotal: result.distributedTotal,
      totalPoints: result.totalPoints,
      zeroWeight: result.zeroWeight,
    };
  });

export const setResultsStatus = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      roundId: string;
      status: "calculated" | "locked" | "published";
      reason?: string;
    }) => {
      if (!data?.roundId) throw new Error("Missing round");
      if (!["calculated", "locked", "published"].includes(data.status))
        throw new Error("Invalid status");
      return {
        roundId: data.roundId,
        status: data.status,
        reason: data.reason ?? undefined,
      };
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const before = await loadRound(data.roundId);

    if (data.status === "locked" || data.status === "published") {
      if (before.calculation_version === 0)
        throw new Error("Calculate the conversion before locking or publishing");
    }
    if (data.status === "published") {
      const { problems } = await validateForPublication(data.roundId);
      if (problems.length)
        throw new Error(`Cannot publish:\n• ${problems.join("\n• ")}`);
    }

    const { error } = await supabaseAdmin
      .from("rounds")
      .update({ results_status: data.status } as any)
      .eq("id", data.roundId);
    if (error) throw new Error(error.message);

    await audit(actor, `televote_results_${data.status}`, {
      target_type: "round",
      target_id: data.roundId,
      old_values: { results_status: before.results_status },
      new_values: { results_status: data.status },
      reason: data.reason,
    });
    return { ok: true };
  });

export const checkPublicationReadiness = createServerFn({ method: "POST" })
  .inputValidator((data: { roundId: string }) => {
    if (!data?.roundId) throw new Error("Missing round");
    return { roundId: data.roundId };
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    const { problems } = await validateForPublication(data.roundId);
    return { problems };
  });

/** Public, unauthenticated: only ever exposes PUBLISHED rounds. */
export const getPublishedResults = createServerFn({ method: "POST" })
  .inputValidator((data: { roundId?: string }) => ({ roundId: data?.roundId }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("rounds")
      .select(
        "id,name,results_status,total_points_to_distribute,rank_exponent,calculated_at,calculation_version,public_advanced_transparency,broadcast_display_mode,editions(name)",
      )
      .eq("results_status", "published")
      .order("closed_at", { ascending: false })
      .limit(1);
    if (data.roundId) query = supabaseAdmin
      .from("rounds")
      .select(
        "id,name,results_status,total_points_to_distribute,rank_exponent,calculated_at,calculation_version,public_advanced_transparency,broadcast_display_mode,editions(name)",
      )
      .eq("results_status", "published")
      .eq("id", data.roundId)
      .limit(1);

    const { data: rounds, error } = await query;
    if (error) throw new Error(error.message);
    const round = (rounds ?? [])[0] as any;
    if (!round) return { round: null, rows: [] };

    const { data: results } = await supabaseAdmin
      .from("round_results" as any)
      .select("*")
      .eq("round_id", round.id)
      .order("final_points", { ascending: false });

    const advanced = !!round.public_advanced_transparency;
    const rows = ((results ?? []) as any[]).map((r) => ({
      country_code: r.country_code,
      original_votes: r.original_votes,
      final_points: r.final_points,
      original_rank: r.original_rank,
      ...(advanced
        ? {
            rank_factor: Number(r.rank_factor),
            weighted_score: Number(r.weighted_score),
            exact_points: Number(r.exact_points),
            floored_points: r.floored_points,
            decimal_remainder: Number(r.decimal_remainder),
            remainder_bonus: r.remainder_bonus,
          }
        : {}),
    }));
    return {
      round: {
        id: round.id,
        name: round.name,
        edition: round.editions?.name ?? null,
        total_points: round.total_points_to_distribute,
        calculated_at: round.calculated_at,
        version: round.calculation_version,
        advanced,
        broadcast_mode: round.broadcast_display_mode as
          | "original"
          | "converted"
          | "combined",
      },
      rows,
    };
  });
