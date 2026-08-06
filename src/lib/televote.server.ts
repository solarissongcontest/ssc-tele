// Server-only helpers for the official televote conversion.
// Nothing here may run in the browser: only the backend may compute, store,
// lock or publish results.

import { useSession } from "@tanstack/react-start/server";
import { createHash } from "node:crypto";
import {
  convertRound,
  CALC_ENGINE_VERSION,
  type ConversionInput,
} from "@/lib/televote-math";

type SessionData = { token?: string };
const SESSION_COOKIE_NAME = "solaris-admin";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function sessionConfig() {
  const password = process.env.ADMIN_SESSION_SECRET;
  if (!password) throw new Error("ADMIN_SESSION_SECRET is not set");
  return {
    password,
    name: SESSION_COOKIE_NAME,
    maxAge: SESSION_TTL_SECONDS,
    cookie: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: true,
      path: "/",
    },
  };
}

export type Actor = { id: string; username: string };

export async function requireAdmin(): Promise<Actor> {
  const session = await useSession<SessionData>(sessionConfig());
  const token = session.data.token;
  if (!token) throw new Error("Not authenticated");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const { data: sess } = await supabaseAdmin
    .from("admin_sessions" as any)
    .select("admin_id")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!sess) throw new Error("Session expired — sign in again");
  const { data: admin } = await supabaseAdmin
    .from("admin_accounts" as any)
    .select("id, username, disabled")
    .eq("id", (sess as any).admin_id)
    .maybeSingle();
  if (!admin || (admin as any).disabled) throw new Error("Not authenticated");
  return { id: (admin as any).id, username: (admin as any).username };
}

export async function audit(
  actor: Actor,
  action: string,
  opts: {
    target_type?: string;
    target_id?: string;
    old_values?: unknown;
    new_values?: unknown;
    reason?: string;
  } = {},
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("admin_audit_log" as any).insert({
    actor_admin_id: actor.id,
    actor_username: actor.username,
    action,
    target_type: opts.target_type ?? null,
    target_id: opts.target_id ?? null,
    old_values: opts.old_values ?? null,
    new_values: opts.new_values ?? null,
    reason: opts.reason ?? null,
  });
}

export type RoundConfig = {
  id: string;
  name: string;
  status: "draft" | "open" | "closed";
  total_points_to_distribute: number;
  rank_exponent: number;
  results_status: "draft" | "calculated" | "locked" | "published";
  calculation_version: number;
  calculated_at: string | null;
  calculated_by_username: string | null;
  calc_participant_codes: string[] | null;
  results_outdated: boolean;
  public_advanced_transparency: boolean;
  broadcast_display_mode: "original" | "converted" | "combined";
};

export async function loadRound(roundId: string): Promise<RoundConfig> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("rounds")
    .select(
      "id,name,status,total_points_to_distribute,rank_exponent,results_status,calculation_version,calculated_at,calculated_by_username,calc_participant_codes,results_outdated,public_advanced_transparency,broadcast_display_mode",
    )
    .eq("id", roundId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Round not found");
  return data as unknown as RoundConfig;
}

/** Eligible participants = the round's configured line-up (stable entry keys). */
export async function loadParticipants(roundId: string): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("round_entries" as any)
    .select("entry_key,display_order")
    .eq("round_id", roundId)
    .order("display_order");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => r.entry_key as string);
}


/** Original (untouched) vote totals per eligible participant. */
export async function loadOriginalTotals(
  roundId: string,
  participants: string[],
): Promise<ConversionInput[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: subs, error: subErr } = await supabaseAdmin
    .from("vote_submissions")
    .select("id,username_normalized,status")
    .eq("round_id", roundId);
  if (subErr) throw new Error(subErr.message);
  const valid = (subs ?? []).filter((s: any) => s.status !== "deleted");
  const subMap = new Map(valid.map((s: any) => [s.id as string, s]));
  if (valid.length === 0) {
    return participants.map((code) => ({ code, originalVotes: 0, originalVoters: 0 }));
  }
  const { data: entries, error: entErr } = await supabaseAdmin
    .from("vote_entries")
    .select("submission_id,target_country_code,points")
    .in("submission_id", valid.map((s: any) => s.id));
  if (entErr) throw new Error(entErr.message);

  const tally = new Map<string, { votes: number; voters: Set<string> }>();
  for (const code of participants) tally.set(code, { votes: 0, voters: new Set() });
  for (const e of entries ?? []) {
    const bucket = tally.get((e as any).target_country_code);
    if (!bucket) continue; // ineligible country → never counted
    bucket.votes += (e as any).points ?? 0;
    const sub = subMap.get((e as any).submission_id);
    if (sub) bucket.voters.add((sub as any).username_normalized);
  }
  return participants.map((code) => ({
    code,
    originalVotes: tally.get(code)!.votes,
    originalVoters: tally.get(code)!.voters.size,
  }));
}

/**
 * Official calculation. Recomputes from live vote data, stores every
 * intermediate value and stamps the run with actor / version / timestamp.
 */
export async function runOfficialCalculation(roundId: string, actor: Actor) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const round = await loadRound(roundId);
  const participants = await loadParticipants(roundId);
  if (participants.length === 0)
    throw new Error("This round has no eligible participants");

  const totals = await loadOriginalTotals(roundId, participants);
  const result = convertRound(
    totals,
    round.total_points_to_distribute,
    Number(round.rank_exponent),
  );

  if (!result.zeroWeight && result.distributedTotal !== result.totalPoints) {
    throw new Error(
      `Conversion integrity check failed: distributed ${result.distributedTotal} ≠ T ${result.totalPoints}`,
    );
  }

  const version = round.calculation_version + 1;
  const calculatedAt = new Date().toISOString();

  const { error: delErr } = await supabaseAdmin
    .from("round_results" as any)
    .delete()
    .eq("round_id", roundId);
  if (delErr) throw new Error(delErr.message);

  const rows = result.rows.map((r) => ({
    round_id: roundId,
    country_code: r.code,
    original_votes: r.originalVotes,
    original_voters: r.originalVoters,
    original_rank: r.originalRank,
    participant_count: r.participantCount,
    rank_base: r.rankBase,
    rank_exponent: r.rankExponent,
    rank_factor: r.rankFactor,
    weighted_score: r.weightedScore,
    exact_points: r.exactPoints,
    floored_points: r.flooredPoints,
    decimal_remainder: r.decimalRemainder,
    remainder_bonus: r.remainderBonus,
    final_points: r.finalPoints,
    total_points_to_distribute: result.totalPoints,
    calculation_version: version,
    calculated_at: calculatedAt,
    calculated_by_username: actor.username,
  }));
  const { error: insErr } = await supabaseAdmin
    .from("round_results" as any)
    .insert(rows);
  if (insErr) throw new Error(insErr.message);

  const { error: updErr } = await supabaseAdmin
    .from("rounds")
    .update({
      results_status: "calculated",
      calculation_version: version,
      calculated_at: calculatedAt,
      calculated_by: actor.id,
      calculated_by_username: actor.username,
      calc_participant_codes: participants,
      results_outdated: false,
    } as any)
    .eq("id", roundId);
  if (updErr) throw new Error(updErr.message);

  await audit(actor, "calculate_televote_conversion", {
    target_type: "round",
    target_id: roundId,
    new_values: {
      engine: CALC_ENGINE_VERSION,
      calculation_version: version,
      total_points: result.totalPoints,
      rank_exponent: result.rankExponent,
      participant_count: result.participantCount,
      rank_base: result.rankBase,
      distributed_total: result.distributedTotal,
      zero_weight: result.zeroWeight,
    },
  });

  return { ...result, version, calculatedAt, participants };
}

/** Publication gate — every rule must pass before results can go public. */
export async function validateForPublication(roundId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const round = await loadRound(roundId);
  const participants = await loadParticipants(roundId);
  const problems: string[] = [];

  if (!Number.isInteger(round.total_points_to_distribute) || round.total_points_to_distribute < 0)
    problems.push("Total points T must be a non-negative whole number");
  if (round.status !== "closed") problems.push("Voting must be closed first");
  if (participants.length === 0) problems.push("There must be at least one eligible participant");
  if (round.calculation_version === 0) problems.push("Results have not been calculated yet");
  if (round.results_outdated) problems.push("The lineup or settings changed — recalculate first");

  const { data: results } = await supabaseAdmin
    .from("round_results" as any)
    .select("country_code,final_points,total_points_to_distribute,calculation_version")
    .eq("round_id", roundId);
  const rows = (results ?? []) as any[];
  const codes = new Set(rows.map((r) => r.country_code));

  for (const c of participants)
    if (!codes.has(c)) problems.push(`Missing result row for ${c}`);
  for (const r of rows)
    if (!participants.includes(r.country_code))
      problems.push(`Ineligible participant in results: ${r.country_code}`);
  if (rows.some((r) => r.calculation_version !== round.calculation_version))
    problems.push("Result rows are from an older calculation — recalculate");

  const sum = rows.reduce((a, r) => a + (r.final_points ?? 0), 0);
  const allZero = rows.every((r) => (r.final_points ?? 0) === 0);
  if (!allZero && sum !== round.total_points_to_distribute)
    problems.push(`Converted total ${sum} does not equal T ${round.total_points_to_distribute}`);

  return { problems, round, participants, rows };
}
