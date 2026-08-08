// Friend-voting analysis server functions (admin-gated, service-role reads).
//
// The stored analysis is a cache: `recalculateFriendVoting` rebuilds it from
// the full historical ballot record (active + deleted) and preserves any
// review status / moderator notes an admin has already set.

import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash } from "node:crypto";
import {
  analyse,
  mergeSettings,
  DEFAULT_SETTINGS,
  type Ballot,
  type FriendVotingSettings,
  type GroupMetrics,
  type ModerationHistoryRow,
  type RelationshipMetrics,
  type RoundInfo,
} from "@/lib/friend-voting-math";

type SessionData = { token?: string };

function sessionConfig() {
  const password = process.env.ADMIN_SESSION_SECRET;
  if (!password) throw new Error("ADMIN_SESSION_SECRET is not set");
  return {
    password,
    name: "solaris-admin",
    maxAge: 60 * 60 * 24 * 7,
    cookie: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: true,
      path: "/",
    },
  };
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

type Actor = { id: string; username: string; is_super_admin: boolean };

async function requireAdmin(): Promise<Actor> {
  const session = await useSession<SessionData>(sessionConfig());
  const token = session.data.token;
  if (!token) throw new Error("Not authenticated");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: sess } = await supabaseAdmin
    .from("admin_sessions" as any)
    .select("admin_id")
    .eq("token_hash", sha256(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!sess) throw new Error("Session expired");
  const { data: admin } = await supabaseAdmin
    .from("admin_accounts" as any)
    .select("id, username, is_super_admin, disabled")
    .eq("id", (sess as any).admin_id)
    .maybeSingle();
  if (!admin || (admin as any).disabled) throw new Error("Not authenticated");
  return {
    id: (admin as any).id,
    username: (admin as any).username,
    is_super_admin: (admin as any).is_super_admin,
  };
}

// --------------------------------------------------------------- settings

export const getFriendVotingSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<FriendVotingSettings> => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("friend_voting_settings" as any)
      .select("settings")
      .eq("singleton", true)
      .maybeSingle();
    return mergeSettings((data as any)?.settings ?? null);
  },
);

export const saveFriendVotingSettings = createServerFn({ method: "POST" })
  .inputValidator((d: { settings: Partial<FriendVotingSettings> }) => {
    if (!d?.settings || typeof d.settings !== "object")
      throw new Error("Invalid settings");
    return d;
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const merged = mergeSettings(data.settings);
    const { error } = await supabaseAdmin
      .from("friend_voting_settings" as any)
      .update({ settings: merged as any, updated_by_username: actor.username })
      .eq("singleton", true);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("admin_audit_log" as any).insert({
      actor_admin_id: actor.id,
      actor_username: actor.username,
      action: "update_friend_voting_settings",
      target_type: "friend_voting_settings",
      new_values: merged as any,
    });
    return merged;
  });

export const resetFriendVotingSettings = createServerFn({ method: "POST" }).handler(
  async () => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("friend_voting_settings" as any)
      .update({ settings: DEFAULT_SETTINGS as any, updated_by_username: actor.username })
      .eq("singleton", true);
    return DEFAULT_SETTINGS;
  },
);

// -------------------------------------------------------------- recalculate

export const recalculateFriendVoting = createServerFn({ method: "POST" }).handler(
  async () => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: settingsRow } = await supabaseAdmin
      .from("friend_voting_settings" as any)
      .select("settings")
      .eq("singleton", true)
      .maybeSingle();
    const settings = mergeSettings((settingsRow as any)?.settings ?? null);

    const { data: roundRows, error: rErr } = await supabaseAdmin
      .from("rounds" as any)
      .select(
        "id, name, closed_at, created_at, edition_id, editions(name), round_entries(entry_key)",
      )
      .order("created_at", { ascending: true });
    if (rErr) throw new Error(rErr.message);

    const { data: subRows, error: sErr } = await supabaseAdmin
      .from("vote_submissions" as any)
      .select(
        "id, round_id, country_code, username, created_at, status, deletion_category, vote_entries(target_country_code, points)",
      )
      .limit(50000);
    if (sErr) throw new Error(sErr.message);

    const { data: histRows } = await supabaseAdmin
      .from("vote_moderation_events" as any)
      .select("voting_country_code, target_country_code, action, reason_category, performed_at")
      .limit(50000);

    const maxByRound = new Map<string, number>();
    for (const s of (subRows ?? []) as any[]) {
      for (const e of s.vote_entries ?? []) {
        maxByRound.set(s.round_id, Math.max(maxByRound.get(s.round_id) ?? 0, e.points));
      }
    }

    const rounds: RoundInfo[] = ((roundRows ?? []) as any[]).map((r) => ({
      id: r.id,
      editionId: r.edition_id,
      editionName: r.editions?.name ?? "Unknown edition",
      name: r.name,
      // Targets are generic round entries identified by stable entry_key.
      // Country entries remain backward compatible because entry_key === country code.
      // vote_submissions.country_code remains the permanent voter/delegation identity.
      participants: (r.round_entries ?? []).map((e: any) => e.entry_key),
      maxScore: maxByRound.get(r.id) ?? 10,
      closedAt: r.closed_at,
    }));

    const ballots: Ballot[] = ((subRows ?? []) as any[]).map((s) => ({
      id: s.id,
      roundId: s.round_id,
      votingCountry: s.country_code,
      username: s.username,
      createdAt: s.created_at,
      status: s.status,
      deletionCategory: s.deletion_category ?? null,
      entries: (s.vote_entries ?? []).map((e: any) => ({
        target: e.target_country_code,
        points: e.points,
      })),
    }));

    const history: ModerationHistoryRow[] = ((histRows ?? []) as any[]).map((h) => ({
      votingCountry: h.voting_country_code,
      targetCountry: h.target_country_code,
      action: h.action,
      reasonCategory: h.reason_category,
      performedAt: h.performed_at,
    }));

    const result = analyse({ rounds, ballots, moderationHistory: history, settings });

    // Preserve existing review state.
    const { data: existing } = await supabaseAdmin
      .from("friend_voting_relationships" as any)
      .select("voting_country_code, target_country_code, review_status, reviewed_by, reviewed_at, moderator_note");
    const prev = new Map(
      ((existing ?? []) as any[]).map((r) => [
        `${r.voting_country_code}>${r.target_country_code}`,
        r,
      ]),
    );

    const payload = result.relationships
      .filter((m) => m.sharedOpportunities > 0)
      .map((m) => {
        const p = prev.get(`${m.votingCountry}>${m.targetCountry}`);
        return {
          voting_country_code: m.votingCountry,
          target_country_code: m.targetCountry,
          shared_opportunities: m.sharedOpportunities,
          active_opportunities: m.activeOpportunities,
          deleted_opportunities: m.deletedOpportunities,
          support_count: m.supportCount,
          top_three_count: m.topThreeCount,
          maximum_score_count: m.maximumScoreCount,
          active_maximum_score_count: m.activeMaximumScoreCount,
          deleted_maximum_score_count: m.deletedMaximumScoreCount,
          second_score_count: m.secondScoreCount,
          total_points: m.totalPoints,
          active_points: m.activePoints,
          deleted_points: m.deletedPoints,
          average_points: m.averagePoints,
          average_points_supported: m.averagePointsSupported,
          average_ballot_rank: m.averageBallotRank,
          support_frequency: m.supportFrequency,
          top_three_frequency: m.topThreeFrequency,
          maximum_score_frequency: m.maximumScoreFrequency,
          preference_lift: m.preferenceLift,
          top_score_concentration: m.topScoreConcentration,
          audience_uplift: m.audienceUplift,
          normalized_audience_uplift: m.normalizedAudienceUplift,
          longest_support_streak: m.longestSupportStreak,
          current_support_streak: m.currentSupportStreak,
          editions_count: m.editionsCount,
          rounds_count: m.roundsCount,
          first_support_at: m.firstSupportAt,
          last_support_at: m.lastSupportAt,
          last_maximum_at: m.lastMaximumAt,
          reciprocity_score: m.reciprocityScore,
          clique_score: m.cliqueScore,
          previous_friend_vote_deletions: m.previousFriendVoteDeletions,
          previous_coordination_deletions: m.previousCoordinationDeletions,
          previous_duplicate_deletions: m.previousDuplicateDeletions,
          repeated_after_moderation: m.repeatedAfterModeration,
          risk_score: m.riskScore,
          risk_label: m.riskLabel,
          reasons: m.reasons as any,
          timeline: m.timeline as any,
          calculated_at: new Date().toISOString(),
          review_status: p?.review_status ?? "new",
          reviewed_by: p?.reviewed_by ?? null,
          reviewed_at: p?.reviewed_at ?? null,
          moderator_note: p?.moderator_note ?? null,
        };
      });

    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabaseAdmin
        .from("friend_voting_relationships" as any)
        .upsert(payload.slice(i, i + 500) as any, {
          onConflict: "voting_country_code,target_country_code",
        });
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("friend_voting_groups" as any).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (result.groups.length) {
      const { error } = await supabaseAdmin.from("friend_voting_groups" as any).insert(
        result.groups.map((g) => ({
          label: g.label,
          members: g.members,
          internal_point_share: g.internalPointShare,
          internal_top_three_share: g.internalTopThreeShare,
          internal_maximum_share: g.internalMaximumShare,
          group_reciprocity: g.groupReciprocity,
          editions_observed: g.editionsObserved,
          rounds_observed: g.roundsObserved,
          strong_internal_edges: g.strongInternalEdges,
          average_internal_support: g.averageInternalSupport,
          average_external_support: g.averageExternalSupport,
          deleted_internal_ballots: g.deletedInternalBallots,
          repeated_after_moderation: g.repeatedAfterModeration,
          risk_score: g.riskScore,
          risk_label: g.riskLabel,
          edges: g.edges as any,
          reasons: g.reasons as any,
          calculated_at: new Date().toISOString(),
        })) as any,
      );
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("admin_audit_log" as any).insert({
      actor_admin_id: actor.id,
      actor_username: actor.username,
      action: "recalculate_friend_voting",
      target_type: "friend_voting",
      new_values: {
        relationships: payload.length,
        groups: result.groups.length,
      } as any,
    });

    return {
      relationships: payload.length,
      groups: result.groups.length,
      calculatedAt: new Date().toISOString(),
    };
  },
);

// ----------------------------------------------------------------- reading

export type RelationshipRow = {
  id: string;
  voting_country_code: string;
  target_country_code: string;
  shared_opportunities: number;
  support_count: number;
  maximum_score_count: number;
  active_maximum_score_count: number;
  deleted_maximum_score_count: number;
  average_points: number;
  support_frequency: number;
  top_three_frequency: number;
  maximum_score_frequency: number;
  preference_lift: number;
  audience_uplift: number;
  longest_support_streak: number;
  editions_count: number;
  rounds_count: number;
  reciprocity_score: number;
  clique_score: number;
  previous_friend_vote_deletions: number;
  repeated_after_moderation: boolean;
  risk_score: number;
  risk_label: string;
  reasons: { text: string; delta: number }[];
  review_status: string;
  moderator_note: string | null;
  calculated_at: string;
};

export const listFriendVotingRelationships = createServerFn({ method: "POST" })
  .inputValidator(
    (
      d: {
        search?: string;
        minRisk?: number;
        reviewStatus?: string | null;
        onlyRepeated?: boolean;
        limit?: number;
      } = {},
    ) => ({
      search: (d?.search ?? "").trim().toUpperCase(),
      minRisk: d?.minRisk ?? 0,
      reviewStatus: d?.reviewStatus ?? null,
      onlyRepeated: !!d?.onlyRepeated,
      limit: Math.min(d?.limit ?? 500, 2000),
    }),
  )
  .handler(async ({ data }): Promise<RelationshipRow[]> => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("friend_voting_relationships" as any)
      .select("*")
      .gte("risk_score", data.minRisk)
      .order("risk_score", { ascending: false })
      .limit(data.limit);
    if (data.reviewStatus) q = q.eq("review_status", data.reviewStatus);
    if (data.onlyRepeated) q = q.eq("repeated_after_moderation", true);
    if (data.search)
      q = q.or(
        `voting_country_code.ilike.%${data.search}%,target_country_code.ilike.%${data.search}%`,
      );
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as any as RelationshipRow[];
  });

export const getFriendVotingRelationship = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("Missing id");
    return d;
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rel, error } = await supabaseAdmin
      .from("friend_voting_relationships" as any)
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rel) throw new Error("Relationship not found");
    const r = rel as any;
    const { data: events } = await supabaseAdmin
      .from("vote_moderation_events" as any)
      .select("*")
      .eq("voting_country_code", r.voting_country_code)
      .order("performed_at", { ascending: false })
      .limit(200);
    const { data: groups } = await supabaseAdmin
      .from("friend_voting_groups" as any)
      .select("*")
      .contains("members", [r.voting_country_code]);
    return {
      relationship: r as RelationshipRow & {
        timeline: any[];
      },
      moderationEvents: (events ?? []) as any[],
      groups: ((groups ?? []) as any[]).filter((g) =>
        (g.members ?? []).includes(r.target_country_code),
      ),
    };
  });

export const listFriendVotingGroups = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("friend_voting_groups" as any)
      .select("*")
      .order("risk_score", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  },
);

export const listModerationHistory = createServerFn({ method: "POST" })
  .inputValidator((d: { votingCountry?: string | null } = {}) => ({
    votingCountry: d?.votingCountry ?? null,
  }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("vote_moderation_events" as any)
      .select("*")
      .order("performed_at", { ascending: false })
      .limit(500);
    if (data.votingCountry) q = q.eq("voting_country_code", data.votingCountry);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as any[];
  });

// ---------------------------------------------------------------- reviewing

export const setRelationshipReview = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { id: string; status: string; note?: string }) => {
      const allowed = [
        "new",
        "under_review",
        "watchlist",
        "confirmed",
        "legitimate",
        "dismissed",
      ];
      if (!d?.id) throw new Error("Missing id");
      if (!allowed.includes(d.status)) throw new Error("Invalid review status");
      return { id: d.id, status: d.status, note: (d.note ?? "").slice(0, 2000) };
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("friend_voting_relationships" as any)
      .select("voting_country_code, target_country_code, review_status")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("friend_voting_relationships" as any)
      .update({
        review_status: data.status,
        reviewed_by: actor.id,
        reviewed_at: new Date().toISOString(),
        moderator_note: data.note || null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    const b = before as any;
    await supabaseAdmin.from("vote_moderation_events" as any).insert({
      voting_country_code: b?.voting_country_code ?? null,
      target_country_code: b?.target_country_code ?? null,
      action: `relationship_${data.status}`,
      previous_status: b?.review_status ?? null,
      new_status: data.status,
      reason_category: "friend_voting",
      moderator_note: data.note || null,
      performed_by: actor.id,
      performed_by_username: actor.username,
    });
    await supabaseAdmin.from("admin_audit_log" as any).insert({
      actor_admin_id: actor.id,
      actor_username: actor.username,
      action: "review_friend_voting_relationship",
      target_type: "friend_voting_relationship",
      target_id: data.id,
      old_values: before as any,
      new_values: { review_status: data.status, note: data.note } as any,
    });
    return { ok: true };
  });

export type { FriendVotingSettings, GroupMetrics, RelationshipMetrics };
