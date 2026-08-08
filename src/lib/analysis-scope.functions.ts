import { createHash } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

import {
  analyse,
  mergeSettings,
  type Ballot,
  type ModerationHistoryRow,
  type RoundInfo,
} from "@/lib/friend-voting-math";
import {
  validateAnalysisScope,
  type AnalysisScope,
} from "@/lib/analysis-scope";

type SessionData = {
  token?: string;
};

type Actor = {
  id: string;
  username: string;
  is_super_admin: boolean;
};

type ScopeRound = {
  id: string;
  name: string;
  edition_id: string;
  edition_name: string;
  status: string;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  entry_keys: string[];
};

type ScopeEdition = {
  id: string;
  name: string;
  created_at: string;
};

const SESSION_COOKIE_NAME = "solaris-admin";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function sessionConfig() {
  const password = process.env.ADMIN_SESSION_SECRET;

  if (!password) {
    throw new Error("ADMIN_SESSION_SECRET is not set");
  }

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

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

async function requireAdmin(): Promise<Actor> {
  const session = await useSession<SessionData>(sessionConfig());
  const token = session.data.token;

  if (!token) throw new Error("Not authenticated");

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const { data: sessionRow, error: sessionError } = await supabaseAdmin
    .from("admin_sessions" as any)
    .select("admin_id")
    .eq("token_hash", sha256(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (sessionError) throw new Error(sessionError.message);
  if (!sessionRow) throw new Error("Session expired");

  const { data: adminRow, error: adminError } = await supabaseAdmin
    .from("admin_accounts" as any)
    .select("id,username,is_super_admin,disabled")
    .eq("id", (sessionRow as any).admin_id)
    .maybeSingle();

  if (adminError) throw new Error(adminError.message);

  if (!adminRow || (adminRow as any).disabled) {
    throw new Error("Not authenticated");
  }

  return {
    id: String((adminRow as any).id),
    username: String((adminRow as any).username),
    is_super_admin: Boolean((adminRow as any).is_super_admin),
  };
}

async function resolveScope(
  scopeInput: AnalysisScope,
): Promise<{
  editions: ScopeEdition[];
  rounds: ScopeRound[];
}> {
  const scope = validateAnalysisScope(scopeInput);

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const [
    { data: editionRows, error: editionError },
    { data: roundRows, error: roundError },
  ] = await Promise.all([
    supabaseAdmin
      .from("editions" as any)
      .select("id,name,created_at")
      .order("created_at", { ascending: true }),

    supabaseAdmin
      .from("rounds" as any)
      .select(
        "id,name,edition_id,status,opened_at,closed_at,created_at,editions(name),round_entries(entry_key)",
      )
      .order("created_at", { ascending: true }),
  ]);

  if (editionError) throw new Error(editionError.message);
  if (roundError) throw new Error(roundError.message);

  const editions: ScopeEdition[] = ((editionRows ?? []) as any[]).map(
    (edition) => ({
      id: String(edition.id),
      name: String(edition.name),
      created_at: String(edition.created_at),
    }),
  );

  const allRounds: ScopeRound[] = ((roundRows ?? []) as any[]).map(
    (round) => ({
      id: String(round.id),
      name: String(round.name),
      edition_id: String(round.edition_id),
      edition_name: String(round.editions?.name ?? "Unknown edition"),
      status: String(round.status ?? "draft"),
      opened_at: round.opened_at ?? null,
      closed_at: round.closed_at ?? null,
      created_at: String(round.created_at),
      entry_keys: (round.round_entries ?? [])
        .map((entry: any) => String(entry.entry_key ?? ""))
        .filter(Boolean),
    }),
  );

  let selectedRounds: ScopeRound[];

  if (scope.mode === "all_editions") {
    selectedRounds = allRounds;
  } else if (scope.mode === "round") {
    selectedRounds = allRounds.filter(
      (round) => round.id === scope.roundId,
    );
  } else if (scope.mode === "edition") {
    selectedRounds = allRounds.filter(
      (round) => round.edition_id === scope.editionId,
    );
  } else {
    const fromIndex = editions.findIndex(
      (edition) => edition.id === scope.fromEditionId,
    );
    const toIndex = editions.findIndex(
      (edition) => edition.id === scope.toEditionId,
    );

    if (fromIndex < 0 || toIndex < 0) {
      throw new Error("Edition range could not be resolved");
    }

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);

    const selectedEditionIds = new Set(
      editions.slice(start, end + 1).map((edition) => edition.id),
    );

    selectedRounds = allRounds.filter((round) =>
      selectedEditionIds.has(round.edition_id),
    );
  }

  const selectedEditionIds = new Set(
    selectedRounds.map((round) => round.edition_id),
  );

  return {
    editions: editions.filter((edition) =>
      selectedEditionIds.has(edition.id),
    ),
    rounds: selectedRounds,
  };
}

type RawSubmission = {
  id: string;
  round_id: string;
  country_code: string;
  username: string;
  username_normalized: string;
  created_at: string;
  status: string | null;
  deletion_category: string | null;
  risk_score: number;
  ip_country: string | null;
  is_vpn: boolean;
  ip_hash: string | null;
  fingerprint_hash: string | null;
  device_token_hash: string | null;
  vote_entries: {
    target_country_code: string;
    points: number;
  }[];
};

async function loadScopedSubmissions(
  roundIds: string[],
): Promise<RawSubmission[]> {
  if (roundIds.length === 0) return [];

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const { data, error } = await supabaseAdmin
    .from("vote_submissions" as any)
    .select(
      "id,round_id,country_code,username,username_normalized,created_at,status,deletion_category,risk_score,ip_country,is_vpn,ip_hash,fingerprint_hash,device_token_hash,vote_entries(target_country_code,points)",
    )
    .in("round_id", roundIds)
    .order("created_at", { ascending: true })
    .limit(50000);

  if (error) throw new Error(error.message);

  return ((data ?? []) as any[]).map((submission) => ({
    id: String(submission.id),
    round_id: String(submission.round_id),
    country_code: String(submission.country_code ?? ""),
    username: String(submission.username ?? ""),
    username_normalized: String(
      submission.username_normalized ?? submission.username ?? "",
    ),
    created_at: String(submission.created_at),
    status: submission.status ?? null,
    deletion_category: submission.deletion_category ?? null,
    risk_score: Number(submission.risk_score ?? 0),
    ip_country: submission.ip_country ?? null,
    is_vpn: Boolean(submission.is_vpn),
    ip_hash: submission.ip_hash ?? null,
    fingerprint_hash: submission.fingerprint_hash ?? null,
    device_token_hash: submission.device_token_hash ?? null,
    vote_entries: (submission.vote_entries ?? []).map((entry: any) => ({
      target_country_code: String(entry.target_country_code ?? ""),
      points: Number(entry.points ?? 0),
    })),
  }));
}

function isResultsEligible(submission: RawSubmission) {
  return submission.status !== "deleted";
}

export type ScopedAnalyticsSubmission = {
  id: string;
  round_id: string;
  round_name: string;
  edition_id: string;
  edition_name: string;
  username: string;
  username_normalized: string;
  country_code: string;
  created_at: string;
  status: string | null;
  risk_score: number;
  ip_country: string | null;
  is_vpn: boolean;
};

export type ScopedAnalyticsEntry = {
  submission_id: string;
  round_id: string;
  target_entry_key: string;
  points: number;
};

export const getScopedAnalytics = createServerFn({
  method: "POST",
})
  .inputValidator((input: { scope: AnalysisScope }) => ({
    scope: validateAnalysisScope(input.scope),
  }))
  .handler(async ({ data }): Promise<{
    editions: ScopeEdition[];
    rounds: ScopeRound[];
    submissions: ScopedAnalyticsSubmission[];
    entries: ScopedAnalyticsEntry[];
  }> => {
    await requireAdmin();

    const resolved = await resolveScope(data.scope);
    const roundById = new Map(
      resolved.rounds.map((round) => [round.id, round]),
    );

    const raw = await loadScopedSubmissions(
      resolved.rounds.map((round) => round.id),
    );

    const submissions = raw.map((submission) => {
      const round = roundById.get(submission.round_id);

      return {
        id: submission.id,
        round_id: submission.round_id,
        round_name: round?.name ?? "Unknown round",
        edition_id: round?.edition_id ?? "",
        edition_name: round?.edition_name ?? "Unknown edition",
        username: submission.username,
        username_normalized: submission.username_normalized,
        country_code: submission.country_code,
        created_at: submission.created_at,
        status: submission.status,
        risk_score: submission.risk_score,
        ip_country: submission.ip_country,
        is_vpn: submission.is_vpn,
      };
    });

    const entries: ScopedAnalyticsEntry[] = [];

    for (const submission of raw) {
      if (!isResultsEligible(submission)) continue;

      for (const entry of submission.vote_entries) {
        entries.push({
          submission_id: submission.id,
          round_id: submission.round_id,
          target_entry_key: entry.target_country_code,
          points: entry.points,
        });
      }
    }

    return {
      editions: resolved.editions,
      rounds: resolved.rounds,
      submissions,
      entries,
    };
  });

export type ScopedSimilarPair = {
  a: {
    id: string;
    username: string;
    country_code: string;
    created_at: string;
    edition_name: string;
    round_name: string;
  };
  b: {
    id: string;
    username: string;
    country_code: string;
    created_at: string;
    edition_name: string;
    round_name: string;
  };
  score: number;
  timeDeltaSec: number;
  sharedIp: boolean;
  sharedFingerprint: boolean;
};

export type ScopedCluster = {
  id: number;
  members: {
    id: string;
    username: string;
    country_code: string;
    created_at: string;
    edition_name: string;
    round_name: string;
    ip_country: string | null;
    is_vpn: boolean;
    risk_score: number;
  }[];
  reasons: string[];
  combinedRisk: number;
};

export type ScopedBlocPair = {
  from: string;
  to: string;
  mean: number;
  count: number;
  z: number;
};

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;

  for (const [key, value] of a) {
    const other = b.get(key);
    if (other) dot += value * other;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

export const getScopedDetection = createServerFn({
  method: "POST",
})
  .inputValidator(
    (input: {
      scope: AnalysisScope;
      similarityThreshold?: number;
    }) => ({
      scope: validateAnalysisScope(input.scope),
      similarityThreshold: Math.max(
        0,
        Math.min(1, input.similarityThreshold ?? 0.9),
      ),
    }),
  )
  .handler(async ({ data }): Promise<{
    editions: ScopeEdition[];
    rounds: ScopeRound[];
    similar: ScopedSimilarPair[];
    clusters: ScopedCluster[];
    blocs: ScopedBlocPair[];
  }> => {
    await requireAdmin();

    const resolved = await resolveScope(data.scope);
    const roundById = new Map(
      resolved.rounds.map((round) => [round.id, round]),
    );

    const raw = (
      await loadScopedSubmissions(
        resolved.rounds.map((round) => round.id),
      )
    ).filter(isResultsEligible);

    const list = raw.slice(0, 10000);

    const vectors = list.map((submission) => {
      const map = new Map<string, number>();

      for (const entry of submission.vote_entries) {
        map.set(entry.target_country_code, entry.points);
      }

      return map;
    });

    const similar: ScopedSimilarPair[] = [];

    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const score = cosine(vectors[i], vectors[j]);

        if (score < data.similarityThreshold) continue;

        const a = list[i];
        const b = list[j];
        const aRound = roundById.get(a.round_id);
        const bRound = roundById.get(b.round_id);

        similar.push({
          a: {
            id: a.id,
            username: a.username,
            country_code: a.country_code,
            created_at: a.created_at,
            edition_name: aRound?.edition_name ?? "Unknown edition",
            round_name: aRound?.name ?? "Unknown round",
          },
          b: {
            id: b.id,
            username: b.username,
            country_code: b.country_code,
            created_at: b.created_at,
            edition_name: bRound?.edition_name ?? "Unknown edition",
            round_name: bRound?.name ?? "Unknown round",
          },
          score: Number(score.toFixed(4)),
          timeDeltaSec: Math.round(
            Math.abs(
              new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime(),
            ) / 1000,
          ),
          sharedIp: Boolean(
            a.ip_hash && a.ip_hash === b.ip_hash,
          ),
          sharedFingerprint: Boolean(
            a.fingerprint_hash &&
              a.fingerprint_hash === b.fingerprint_hash,
          ),
        });
      }
    }

    similar.sort((a, b) => b.score - a.score);

    const parent = list.map((_, index) => index);

    const find = (index: number): number => {
      if (parent[index] === index) return index;
      parent[index] = find(parent[index]);
      return parent[index];
    };

    const union = (a: number, b: number) => {
      const rootA = find(a);
      const rootB = find(b);

      if (rootA !== rootB) parent[rootA] = rootB;
    };

    const reasonsByIndex = new Map<number, Set<string>>();

    const addReason = (index: number, reason: string) => {
      const current = reasonsByIndex.get(index) ?? new Set<string>();
      current.add(reason);
      reasonsByIndex.set(index, current);
    };

    const identifierGroups = (
      getter: (submission: RawSubmission) => string | null,
      reason: string,
    ) => {
      const groups = new Map<string, number[]>();

      list.forEach((submission, index) => {
        const value = getter(submission);
        if (!value) return;

        const indexes = groups.get(value) ?? [];
        indexes.push(index);
        groups.set(value, indexes);
      });

      for (const indexes of groups.values()) {
        if (indexes.length < 2) continue;

        for (let i = 1; i < indexes.length; i += 1) {
          union(indexes[0], indexes[i]);
        }

        indexes.forEach((index) => addReason(index, reason));
      }
    };

    identifierGroups((submission) => submission.ip_hash, "shared IP");
    identifierGroups(
      (submission) => submission.fingerprint_hash,
      "shared device fingerprint",
    );
    identifierGroups(
      (submission) => submission.device_token_hash,
      "shared device token",
    );

    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (cosine(vectors[i], vectors[j]) < data.similarityThreshold) {
          continue;
        }

        union(i, j);
        addReason(i, "near-identical ballots");
        addReason(j, "near-identical ballots");
      }
    }

    const grouped = new Map<number, number[]>();

    list.forEach((_, index) => {
      const root = find(index);
      const indexes = grouped.get(root) ?? [];
      indexes.push(index);
      grouped.set(root, indexes);
    });

    const clusters: ScopedCluster[] = [];
    let clusterId = 1;

    for (const indexes of grouped.values()) {
      if (indexes.length < 2) continue;

      const members = indexes.map((index) => list[index]);
      const reasons = new Set<string>();

      for (const index of indexes) {
        for (const reason of reasonsByIndex.get(index) ?? []) {
          reasons.add(reason);
        }
      }

      const averageRisk =
        members.reduce(
          (sum, member) => sum + member.risk_score,
          0,
        ) / members.length;

      clusters.push({
        id: clusterId,
        members: members.map((member) => {
          const round = roundById.get(member.round_id);

          return {
            id: member.id,
            username: member.username,
            country_code: member.country_code,
            created_at: member.created_at,
            edition_name: round?.edition_name ?? "Unknown edition",
            round_name: round?.name ?? "Unknown round",
            ip_country: member.ip_country,
            is_vpn: member.is_vpn,
            risk_score: member.risk_score,
          };
        }),
        reasons: Array.from(reasons),
        combinedRisk: Math.min(
          100,
          Math.round(
            averageRisk + Math.max(0, members.length - 1) * 10,
          ),
        ),
      });

      clusterId += 1;
    }

    clusters.sort((a, b) => b.combinedRisk - a.combinedRisk);

    const aggregates = new Map<
      string,
      Map<string, { sum: number; count: number }>
    >();

    for (const submission of list) {
      const targets =
        aggregates.get(submission.country_code) ??
        new Map<string, { sum: number; count: number }>();

      for (const entry of submission.vote_entries) {
        const current =
          targets.get(entry.target_country_code) ??
          { sum: 0, count: 0 };

        current.sum += entry.points;
        current.count += 1;
        targets.set(entry.target_country_code, current);
      }

      aggregates.set(submission.country_code, targets);
    }

    const blocs: ScopedBlocPair[] = [];

    for (const [from, targets] of aggregates) {
      const means = Array.from(targets.values()).map(
        (value) => value.sum / value.count,
      );

      const meanAll =
        means.reduce((sum, value) => sum + value, 0) /
        Math.max(1, means.length);

      const variance =
        means.reduce(
          (sum, value) => sum + (value - meanAll) ** 2,
          0,
        ) / Math.max(1, means.length);

      const sd = Math.sqrt(variance) || 1;

      for (const [to, value] of targets) {
        const mean = value.sum / value.count;
        const z = (mean - meanAll) / sd;

        if (value.count >= 2 && z >= 1.5) {
          blocs.push({
            from,
            to,
            mean: Number(mean.toFixed(2)),
            count: value.count,
            z: Number(z.toFixed(2)),
          });
        }
      }
    }

    blocs.sort((a, b) => b.z - a.z);

    return {
      editions: resolved.editions,
      rounds: resolved.rounds,
      similar: similar.slice(0, 200),
      clusters: clusters.slice(0, 200),
      blocs: blocs.slice(0, 200),
    };
  });

export type ScopedFriendRelationship = {
  id: string | null;
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
  timeline: {
    editionName: string;
    roundName: string;
    roundId: string;
    points: number;
    maxScore: number;
    ballotRank: number | null;
    audienceAverage: number;
    audienceRank: number | null;
    status: string;
    deletionCategory: string | null;
    createdAt: string;
  }[];
};

export type ScopedFriendGroup = {
  label: string;
  members: string[];
  internal_point_share: number;
  internal_top_three_share: number;
  internal_maximum_share: number;
  group_reciprocity: number;
  editions_observed: number;
  rounds_observed: number;
  strong_internal_edges: number;
  average_internal_support: number;
  average_external_support: number;
  deleted_internal_ballots: number;
  repeated_after_moderation: boolean;
  risk_score: number;
  risk_label: string;
  reasons: string[];
};

export const getScopedFriendVotingAnalysis = createServerFn({
  method: "POST",
})
  .inputValidator((input: { scope: AnalysisScope }) => ({
    scope: validateAnalysisScope(input.scope),
  }))
  .handler(async ({ data }): Promise<{
    editions: ScopeEdition[];
    rounds: ScopeRound[];
    relationships: ScopedFriendRelationship[];
    groups: ScopedFriendGroup[];
    moderationEvents: any[];
  }> => {
    await requireAdmin();

    const resolved = await resolveScope(data.scope);
    const roundIds = resolved.rounds.map((round) => round.id);

    if (roundIds.length === 0) {
      return {
        editions: resolved.editions,
        rounds: [],
        relationships: [],
        groups: [],
        moderationEvents: [],
      };
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const [
      raw,
      { data: settingsRow },
      { data: storedRows },
    ] = await Promise.all([
      loadScopedSubmissions(roundIds),

      supabaseAdmin
        .from("friend_voting_settings" as any)
        .select("settings")
        .eq("singleton", true)
        .maybeSingle(),

      supabaseAdmin
        .from("friend_voting_relationships" as any)
        .select(
          "id,voting_country_code,target_country_code,review_status,moderator_note",
        ),
    ]);

    const settings = mergeSettings(
      (settingsRow as any)?.settings ?? null,
    );

    const maxByRound = new Map<string, number>();

    for (const submission of raw) {
      for (const entry of submission.vote_entries) {
        maxByRound.set(
          submission.round_id,
          Math.max(
            maxByRound.get(submission.round_id) ?? 0,
            entry.points,
          ),
        );
      }
    }

    const rounds: RoundInfo[] = resolved.rounds.map((round) => ({
      id: round.id,
      editionId: round.edition_id,
      editionName: round.edition_name,
      name: round.name,
      participants: round.entry_keys,
      maxScore: maxByRound.get(round.id) ?? 10,
      closedAt: round.closed_at,
    }));

    const ballots: Ballot[] = raw.map((submission) => ({
      id: submission.id,
      roundId: submission.round_id,
      votingCountry: submission.country_code,
      username: submission.username,
      createdAt: submission.created_at,
      status: submission.status ?? "active",
      deletionCategory: submission.deletion_category,
      entries: submission.vote_entries.map((entry) => ({
        target: entry.target_country_code,
        points: entry.points,
      })),
    }));

    const times = ballots
      .map((ballot) => ballot.createdAt)
      .filter(Boolean)
      .sort();

    let moderationQuery = supabaseAdmin
      .from("vote_moderation_events" as any)
      .select(
        "id,voting_country_code,target_country_code,action,reason_category,performed_at,performed_by_username,moderator_note",
      )
      .order("performed_at", { ascending: false })
      .limit(2000);

    if (data.scope.mode !== "all_editions" && times.length > 0) {
      moderationQuery = moderationQuery
        .gte("performed_at", times[0])
        .lte("performed_at", times[times.length - 1]);
    }

    const { data: moderationRows, error: moderationError } =
      await moderationQuery;

    if (moderationError) throw new Error(moderationError.message);

    const history: ModerationHistoryRow[] = (
      (moderationRows ?? []) as any[]
    ).map((row) => ({
      votingCountry: String(row.voting_country_code ?? ""),
      targetCountry: row.target_country_code
        ? String(row.target_country_code)
        : null,
      action: String(row.action ?? ""),
      reasonCategory: row.reason_category
        ? String(row.reason_category)
        : null,
      performedAt: String(row.performed_at),
    }));

    const result = analyse({
      rounds,
      ballots,
      moderationHistory: history,
      settings,
    });

    const storedByPair = new Map(
      ((storedRows ?? []) as any[]).map((row) => [
        `${row.voting_country_code}>${row.target_country_code}`,
        row,
      ]),
    );

    const relationships: ScopedFriendRelationship[] =
      result.relationships
        .filter((relationship) => relationship.sharedOpportunities > 0)
        .map((relationship) => {
          const stored = storedByPair.get(
            `${relationship.votingCountry}>${relationship.targetCountry}`,
          ) as any;

          return {
            id: stored?.id ? String(stored.id) : null,
            voting_country_code: relationship.votingCountry,
            target_country_code: relationship.targetCountry,
            shared_opportunities: relationship.sharedOpportunities,
            support_count: relationship.supportCount,
            maximum_score_count: relationship.maximumScoreCount,
            active_maximum_score_count:
              relationship.activeMaximumScoreCount,
            deleted_maximum_score_count:
              relationship.deletedMaximumScoreCount,
            average_points: relationship.averagePoints,
            support_frequency: relationship.supportFrequency,
            top_three_frequency: relationship.topThreeFrequency,
            maximum_score_frequency:
              relationship.maximumScoreFrequency,
            preference_lift: relationship.preferenceLift,
            audience_uplift: relationship.audienceUplift,
            longest_support_streak:
              relationship.longestSupportStreak,
            editions_count: relationship.editionsCount,
            rounds_count: relationship.roundsCount,
            reciprocity_score: relationship.reciprocityScore,
            clique_score: relationship.cliqueScore,
            previous_friend_vote_deletions:
              relationship.previousFriendVoteDeletions,
            repeated_after_moderation:
              relationship.repeatedAfterModeration,
            risk_score: relationship.riskScore,
            risk_label: relationship.riskLabel,
            reasons: relationship.reasons,
            review_status: stored?.review_status ?? "new",
            moderator_note: stored?.moderator_note ?? null,
            timeline: relationship.timeline,
          };
        });

    const groups: ScopedFriendGroup[] = result.groups.map((group) => ({
      label: group.label,
      members: group.members,
      internal_point_share: group.internalPointShare,
      internal_top_three_share: group.internalTopThreeShare,
      internal_maximum_share: group.internalMaximumShare,
      group_reciprocity: group.groupReciprocity,
      editions_observed: group.editionsObserved,
      rounds_observed: group.roundsObserved,
      strong_internal_edges: group.strongInternalEdges,
      average_internal_support: group.averageInternalSupport,
      average_external_support: group.averageExternalSupport,
      deleted_internal_ballots: group.deletedInternalBallots,
      repeated_after_moderation: group.repeatedAfterModeration,
      risk_score: group.riskScore,
      risk_label: group.riskLabel,
      reasons: group.reasons,
    }));

    return {
      editions: resolved.editions,
      rounds: resolved.rounds,
      relationships,
      groups,
      moderationEvents: (moderationRows ?? []) as any[],
    };
  });
