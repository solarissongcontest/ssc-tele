// Friend-voting analysis engine.
//
// Pure, dependency-free math so it can be unit tested and reused by the
// server functions. The central rule: the selected fictional country IS the
// permanent Head-of-Delegation identity. Usernames / IPs are supporting
// evidence only and never define identity here.
//
// Official results only ever contain non-deleted ballots. Integrity analysis
// intentionally includes deleted / excluded ballots, weighted by why they
// were removed.

// ---------------------------------------------------------------- settings

export type FriendVotingSettings = {
  minOpportunities: number;
  supportFrequencyThreshold: number;
  topThreeThreshold: number;
  maximumScoreThreshold: number;
  preferenceLiftThreshold: number;
  audienceUpliftThreshold: number;
  minEditions: number;
  streakThreshold: number;
  smallSamplePenalty: number;
  cliqueInternalShareThreshold: number;
  cliqueMinEdgeRisk: number;
  ignoreTestBallots: boolean;
  riskCategories: string[];
  weights: {
    confidence: number;
    support: number;
    topThree: number;
    maximum: number;
    preferenceLift: number;
    audienceUplift: number;
    streak: number;
    reciprocity: number;
    clique: number;
    previousDeletion: number;
    repeatedAfterModeration: number;
    technical: number;
  };
  riskBands: {
    notable: number;
    review: number;
    strong: number;
    highly: number;
    critical: number;
  };
};

export const DEFAULT_SETTINGS: FriendVotingSettings = {
  minOpportunities: 5,
  supportFrequencyThreshold: 0.8,
  topThreeThreshold: 0.8,
  maximumScoreThreshold: 0.6,
  preferenceLiftThreshold: 2,
  audienceUpliftThreshold: 0,
  minEditions: 2,
  streakThreshold: 7,
  smallSamplePenalty: 20,
  cliqueInternalShareThreshold: 0.5,
  cliqueMinEdgeRisk: 65,
  ignoreTestBallots: true,
  riskCategories: [
    "friend_voting",
    "coordinated_voting",
    "duplicate_vote",
    "impersonation",
  ],
  weights: {
    confidence: 10,
    support: 15,
    topThree: 15,
    maximum: 20,
    preferenceLift: 10,
    audienceUplift: 10,
    streak: 5,
    reciprocity: 15,
    clique: 10,
    previousDeletion: 15,
    repeatedAfterModeration: 15,
    technical: 10,
  },
  riskBands: { notable: 30, review: 50, strong: 65, highly: 80, critical: 90 },
};

export function mergeSettings(
  partial: Partial<FriendVotingSettings> | null | undefined,
): FriendVotingSettings {
  const p = partial ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...p,
    weights: { ...DEFAULT_SETTINGS.weights, ...(p.weights ?? {}) },
    riskBands: { ...DEFAULT_SETTINGS.riskBands, ...(p.riskBands ?? {}) },
  };
}

// ------------------------------------------------------------------ inputs

export type BallotEntry = { target: string; points: number };

export type Ballot = {
  id: string;
  roundId: string;
  votingCountry: string;
  username: string | null;
  createdAt: string;
  /** active | suspicious | verified | deleted */
  status: string;
  deletionCategory: string | null;
  entries: BallotEntry[];
};

export type RoundInfo = {
  id: string;
  editionId: string;
  editionName: string;
  name: string;
  participants: string[];
  /** highest score a single country may receive in this round */
  maxScore: number;
  closedAt?: string | null;
};

export type ModerationHistoryRow = {
  votingCountry: string;
  targetCountry: string | null;
  action: string;
  reasonCategory: string | null;
  performedAt: string;
};

// ------------------------------------------------------------------ output

export type TimelineRow = {
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
};

export type RelationshipMetrics = {
  votingCountry: string;
  targetCountry: string;
  sharedOpportunities: number;
  activeOpportunities: number;
  deletedOpportunities: number;
  supportCount: number;
  topThreeCount: number;
  maximumScoreCount: number;
  activeMaximumScoreCount: number;
  deletedMaximumScoreCount: number;
  secondScoreCount: number;
  totalPoints: number;
  activePoints: number;
  deletedPoints: number;
  averagePoints: number;
  averagePointsSupported: number;
  averageBallotRank: number | null;
  firstRankPct: number;
  topThreePct: number;
  supportFrequency: number;
  topThreeFrequency: number;
  maximumScoreFrequency: number;
  preferenceLift: number;
  topScoreConcentration: number;
  audienceUplift: number;
  normalizedAudienceUplift: number;
  aboveAudienceCount: number;
  longestSupportStreak: number;
  currentSupportStreak: number;
  editionsCount: number;
  roundsCount: number;
  firstSupportAt: string | null;
  lastSupportAt: string | null;
  lastMaximumAt: string | null;
  previousFriendVoteDeletions: number;
  previousCoordinationDeletions: number;
  previousDuplicateDeletions: number;
  previousModeratedBallots: number;
  repeatedAfterModeration: boolean;
  reciprocityScore: number;
  cliqueScore: number;
  riskScore: number;
  riskLabel: string;
  reasons: { text: string; delta: number }[];
  timeline: TimelineRow[];
};

// ---------------------------------------------------------------- helpers

const round2 = (n: number) => Math.round(n * 100) / 100;

export function normalizeUsername(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Jaro-Winkler similarity, used for username-anomaly evidence only. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array(a.length).fill(false);
  const bM = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - range);
    const end = Math.min(i + range + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = true;
      bM[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - t) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Ballots deleted for these reasons carry no friend-voting weight. */
const NO_WEIGHT_CATEGORIES = new Set([
  "test_submission",
  "administrative_error",
  "wrong_voting_country",
]);

export function countsForResults(b: Ballot) {
  return b.status !== "deleted";
}

export function countsForIntegrity(b: Ballot, s: FriendVotingSettings) {
  if (b.status !== "deleted") return true;
  if (!b.deletionCategory) return true;
  if (!s.ignoreTestBallots && b.deletionCategory === "test_submission") return true;
  return !NO_WEIGHT_CATEGORIES.has(b.deletionCategory);
}

function ballotPointsMap(b: Ballot) {
  const m = new Map<string, number>();
  for (const e of b.entries) m.set(e.target, (m.get(e.target) ?? 0) + e.points);
  return m;
}

/** 1-based rank of target on this ballot (highest points = 1), null if unscored. */
function ballotRank(pointsMap: Map<string, number>, target: string): number | null {
  const p = pointsMap.get(target);
  if (!p) return null;
  const sorted = [...pointsMap.values()].sort((x, y) => y - x);
  return sorted.indexOf(p) + 1;
}

// --------------------------------------------------------------- analysis

export type AnalysisInput = {
  rounds: RoundInfo[];
  ballots: Ballot[];
  moderationHistory?: ModerationHistoryRow[];
  settings?: Partial<FriendVotingSettings>;
};

export type AnalysisOutput = {
  relationships: RelationshipMetrics[];
  groups: GroupMetrics[];
  settings: FriendVotingSettings;
};

export function analyse(input: AnalysisInput): AnalysisOutput {
  const settings = mergeSettings(input.settings);
  const roundById = new Map(input.rounds.map((r) => [r.id, r]));
  const history = input.moderationHistory ?? [];

  // Per-round audience aggregates from RESULTS-ELIGIBLE ballots only.
  type RoundAgg = {
    audiencePoints: Map<string, number>; // total points per target
    audienceVoters: Map<string, number>; // eligible voters per target
    audienceRank: Map<string, number>;
  };
  const roundAgg = new Map<string, RoundAgg>();
  for (const r of input.rounds) {
    roundAgg.set(r.id, {
      audiencePoints: new Map(),
      audienceVoters: new Map(),
      audienceRank: new Map(),
    });
  }
  for (const b of input.ballots) {
    const r = roundById.get(b.roundId);
    const agg = roundAgg.get(b.roundId);
    if (!r || !agg || !countsForResults(b)) continue;
    const pm = ballotPointsMap(b);
    for (const t of r.participants) {
      if (t === b.votingCountry) continue;
      agg.audienceVoters.set(t, (agg.audienceVoters.get(t) ?? 0) + 1);
      agg.audiencePoints.set(t, (agg.audiencePoints.get(t) ?? 0) + (pm.get(t) ?? 0));
    }
  }
  for (const agg of roundAgg.values()) {
    const ordered = [...agg.audiencePoints.entries()].sort((a, b) => b[1] - a[1]);
    ordered.forEach(([code], i) => agg.audienceRank.set(code, i + 1));
  }

  // Bucket integrity-eligible ballots by voting country.
  const byVoter = new Map<string, Ballot[]>();
  for (const b of input.ballots) {
    if (!roundById.has(b.roundId)) continue;
    if (!countsForIntegrity(b, settings)) continue;
    const arr = byVoter.get(b.votingCountry) ?? [];
    arr.push(b);
    byVoter.set(b.votingCountry, arr);
  }
  for (const arr of byVoter.values())
    arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Pass 1 — raw pair aggregates per voting country.
  type Pair = {
    votingCountry: string;
    targetCountry: string;
    timeline: TimelineRow[];
  };
  const pairs = new Map<string, Pair>();
  const key = (a: string, b: string) => `${a}>${b}`;

  // voter-level totals for preference lift / top-score concentration
  const voterTotals = new Map<
    string,
    { pointsSum: number; opportunities: number; maxScores: number }
  >();
  const voterMaxToTarget = new Map<string, Map<string, number>>();

  for (const [voter, ballots] of byVoter) {
    const totals = { pointsSum: 0, opportunities: 0, maxScores: 0 };
    const maxToTarget = new Map<string, number>();
    for (const b of ballots) {
      const r = roundById.get(b.roundId)!;
      const agg = roundAgg.get(b.roundId)!;
      const pm = ballotPointsMap(b);
      for (const target of r.participants) {
        // Ineligible relationships are never shared opportunities.
        if (target === voter) continue;
        const points = pm.get(target) ?? 0;
        totals.pointsSum += points;
        totals.opportunities += 1;
        if (points > 0 && points >= r.maxScore) {
          totals.maxScores += 1;
          maxToTarget.set(target, (maxToTarget.get(target) ?? 0) + 1);
        }
        const k = key(voter, target);
        let pair = pairs.get(k);
        if (!pair) {
          pair = { votingCountry: voter, targetCountry: target, timeline: [] };
          pairs.set(k, pair);
        }
        // audience average excludes this voter's own ballot
        const totalPts = agg.audiencePoints.get(target) ?? 0;
        const voters = agg.audienceVoters.get(target) ?? 0;
        const ownCounts = countsForResults(b);
        const othersPts = totalPts - (ownCounts ? points : 0);
        const othersVoters = voters - (ownCounts ? 1 : 0);
        pair.timeline.push({
          editionName: r.editionName,
          roundName: r.name,
          roundId: r.id,
          points,
          maxScore: r.maxScore,
          ballotRank: ballotRank(pm, target),
          audienceAverage: othersVoters > 0 ? round2(othersPts / othersVoters) : 0,
          audienceRank: agg.audienceRank.get(target) ?? null,
          status: b.status,
          deletionCategory: b.deletionCategory,
          createdAt: b.createdAt,
        });
      }
    }
    voterTotals.set(voter, totals);
    voterMaxToTarget.set(voter, maxToTarget);
  }

  // Pass 2 — per-pair metrics (without reciprocity/clique yet).
  const base = new Map<string, RelationshipMetrics>();
  for (const [k, pair] of pairs) {
    base.set(k, buildMetrics(pair.votingCountry, pair.targetCountry, pair.timeline, {
      roundById,
      voterTotals: voterTotals.get(pair.votingCountry)!,
      voterMaxToTarget: voterMaxToTarget.get(pair.votingCountry)!,
      history,
      settings,
    }));
  }

  // Pass 3 — reciprocity.
  for (const [k, m] of base) {
    const rev = base.get(key(m.targetCountry, m.votingCountry));
    if (!rev) continue;
    const a = normalisedSupport(m);
    const b = normalisedSupport(rev);
    m.reciprocityScore = round2(Math.min(a, b));
    base.set(k, m);
  }

  // Pass 4 — groups (cliques) from strong mutual edges.
  const groups = detectGroups([...base.values()], settings, input);
  const cliqueOf = new Map<string, number>();
  groups.forEach((g) => {
    for (const mem of g.members)
      cliqueOf.set(mem, Math.max(cliqueOf.get(mem) ?? 0, g.riskScore));
  });
  for (const m of base.values()) {
    if (cliqueOf.has(m.votingCountry) && cliqueOf.has(m.targetCountry)) {
      m.cliqueScore = round2(
        Math.min(cliqueOf.get(m.votingCountry)!, cliqueOf.get(m.targetCountry)!) / 100,
      );
    }
  }

  // Pass 5 — final explainable risk score.
  const relationships = [...base.values()].map((m) => scoreRelationship(m, settings));
  relationships.sort((a, b) => b.riskScore - a.riskScore);
  return { relationships, groups, settings };
}

function normalisedSupport(m: RelationshipMetrics) {
  return (
    0.4 * m.supportFrequency +
    0.35 * m.maximumScoreFrequency +
    0.25 * m.topThreeFrequency
  );
}

function buildMetrics(
  votingCountry: string,
  targetCountry: string,
  timeline: TimelineRow[],
  ctx: {
    roundById: Map<string, RoundInfo>;
    voterTotals: { pointsSum: number; opportunities: number; maxScores: number };
    voterMaxToTarget: Map<string, number>;
    history: ModerationHistoryRow[];
    settings: FriendVotingSettings;
  },
): RelationshipMetrics {
  timeline.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const shared = timeline.length;
  let active = 0;
  let deleted = 0;
  let support = 0;
  let topThree = 0;
  let maxCount = 0;
  let activeMax = 0;
  let deletedMax = 0;
  let secondCount = 0;
  let totalPoints = 0;
  let activePoints = 0;
  let deletedPoints = 0;
  let rankSum = 0;
  let rankN = 0;
  let firstRank = 0;
  let aboveAudience = 0;
  let upliftSum = 0;
  let normUpliftSum = 0;
  let streak = 0;
  let longest = 0;
  let current = 0;
  let firstSupportAt: string | null = null;
  let lastSupportAt: string | null = null;
  let lastMaximumAt: string | null = null;
  const editions = new Set<string>();
  const rounds = new Set<string>();

  for (const row of timeline) {
    const isDeleted = row.status === "deleted";
    if (isDeleted) deleted++;
    else active++;
    totalPoints += row.points;
    if (isDeleted) deletedPoints += row.points;
    else activePoints += row.points;
    editions.add(row.editionName);
    rounds.add(row.roundId);
    upliftSum += row.points - row.audienceAverage;
    normUpliftSum += (row.points - row.audienceAverage) / (row.maxScore || 1);
    if (row.points > row.audienceAverage) aboveAudience++;
    if (row.points > 0) {
      support++;
      streak++;
      longest = Math.max(longest, streak);
      firstSupportAt = firstSupportAt ?? row.createdAt;
      lastSupportAt = row.createdAt;
      if (row.ballotRank !== null) {
        rankSum += row.ballotRank;
        rankN++;
        if (row.ballotRank === 1) firstRank++;
        if (row.ballotRank <= 3) topThree++;
        if (row.ballotRank === 2) secondCount++;
      }
      if (row.points >= row.maxScore) {
        maxCount++;
        lastMaximumAt = row.createdAt;
        if (isDeleted) deletedMax++;
        else activeMax++;
      }
    } else {
      streak = 0;
    }
  }
  current = streak;

  const avgPoints = shared ? totalPoints / shared : 0;
  const otherOpps = ctx.voterTotals.opportunities - shared;
  const otherPoints = ctx.voterTotals.pointsSum - totalPoints;
  const otherAvg = otherOpps > 0 ? otherPoints / otherOpps : 0;
  const preferenceLift = otherAvg > 0 ? avgPoints / otherAvg : avgPoints > 0 ? 3 : 0;
  const concentration =
    ctx.voterTotals.maxScores > 0
      ? (ctx.voterMaxToTarget.get(targetCountry) ?? 0) / ctx.voterTotals.maxScores
      : 0;

  // Prior moderation on this exact relationship.
  const rel = ctx.history.filter(
    (h) =>
      h.votingCountry === votingCountry &&
      (h.targetCountry === targetCountry || h.targetCountry === null),
  );
  const cat = (c: string) =>
    rel.filter((h) => h.reasonCategory === c && (h.action === "deleted" || h.action === "excluded"))
      .length;
  const friendDel = cat("friend_voting");
  const coordDel = cat("coordinated_voting");
  const dupDel = cat("duplicate_vote");
  const moderated = rel.length;
  const lastModerationAt = rel
    .map((h) => h.performedAt)
    .sort()
    .pop();
  const repeated =
    !!lastModerationAt &&
    friendDel + coordDel > 0 &&
    timeline.some((t) => t.points > 0 && t.createdAt > lastModerationAt);

  return {
    votingCountry,
    targetCountry,
    sharedOpportunities: shared,
    activeOpportunities: active,
    deletedOpportunities: deleted,
    supportCount: support,
    topThreeCount: topThree,
    maximumScoreCount: maxCount,
    activeMaximumScoreCount: activeMax,
    deletedMaximumScoreCount: deletedMax,
    secondScoreCount: secondCount,
    totalPoints: round2(totalPoints),
    activePoints: round2(activePoints),
    deletedPoints: round2(deletedPoints),
    averagePoints: round2(avgPoints),
    averagePointsSupported: support ? round2(totalPoints / support) : 0,
    averageBallotRank: rankN ? round2(rankSum / rankN) : null,
    firstRankPct: support ? round2(firstRank / support) : 0,
    topThreePct: support ? round2(topThree / support) : 0,
    supportFrequency: shared ? round2(support / shared) : 0,
    topThreeFrequency: shared ? round2(topThree / shared) : 0,
    maximumScoreFrequency: shared ? round2(maxCount / shared) : 0,
    preferenceLift: round2(preferenceLift),
    topScoreConcentration: round2(concentration),
    audienceUplift: shared ? round2(upliftSum / shared) : 0,
    normalizedAudienceUplift: shared ? round2(normUpliftSum / shared) : 0,
    aboveAudienceCount: aboveAudience,
    longestSupportStreak: longest,
    currentSupportStreak: current,
    editionsCount: editions.size,
    roundsCount: rounds.size,
    firstSupportAt,
    lastSupportAt,
    lastMaximumAt,
    previousFriendVoteDeletions: friendDel,
    previousCoordinationDeletions: coordDel,
    previousDuplicateDeletions: dupDel,
    previousModeratedBallots: moderated,
    repeatedAfterModeration: repeated,
    reciprocityScore: 0,
    cliqueScore: 0,
    riskScore: 0,
    riskLabel: "Normal voting pattern",
    reasons: [],
    timeline,
  };
}

export function riskLabelFor(score: number, s: FriendVotingSettings) {
  const b = s.riskBands;
  if (score >= b.critical) return "Critical repeated or coordinated pattern";
  if (score >= b.highly) return "Highly suspicious friend-voting pattern";
  if (score >= b.strong) return "Strong preferential-voting pattern";
  if (score >= b.review) return "Review recommended";
  if (score >= b.notable) return "Notable loyalty";
  return "Normal voting pattern";
}

function scoreRelationship(
  m: RelationshipMetrics,
  s: FriendVotingSettings,
): RelationshipMetrics {
  const w = s.weights;
  const reasons: { text: string; delta: number }[] = [];
  const add = (delta: number, text: string) => {
    if (delta === 0) return;
    reasons.push({ text, delta: Math.round(delta * 10) / 10 });
  };

  const confidence = Math.min(1, m.sharedOpportunities / Math.max(1, s.minOpportunities * 2));
  const cConf = confidence * w.confidence;
  add(cConf, `${m.sharedOpportunities} shared voting opportunities analysed`);

  const cSupport = m.supportFrequency * w.support;
  add(
    cSupport,
    `Supported target in ${m.supportCount} of ${m.sharedOpportunities} eligible appearances`,
  );

  const cTop3 = m.topThreeFrequency * w.topThree;
  add(cTop3, `Ranked in the voter's top three in ${m.topThreeCount} appearances`);

  const cMax = m.maximumScoreFrequency * w.maximum;
  add(
    cMax,
    `Awarded the maximum score ${m.maximumScoreCount} times (${m.activeMaximumScoreCount} active, ${m.deletedMaximumScoreCount} deleted)`,
  );

  const cLift =
    Math.min(1, Math.max(0, (m.preferenceLift - 1) / Math.max(0.001, s.preferenceLiftThreshold - 1))) *
    w.preferenceLift;
  add(cLift, `Preference lift of ${m.preferenceLift.toFixed(2)}x versus other recurring targets`);

  const cUplift = Math.min(1, Math.max(0, m.normalizedAudienceUplift / 0.5)) * w.audienceUplift;
  add(
    cUplift,
    `Average score ${m.audienceUplift >= 0 ? "+" : ""}${m.audienceUplift.toFixed(1)} points versus the rest of the audience`,
  );

  const cStreak =
    Math.min(1, m.longestSupportStreak / Math.max(1, s.streakThreshold)) * w.streak;
  add(cStreak, `Longest unbroken support streak: ${m.longestSupportStreak}`);

  const cRecip = Math.min(1, m.reciprocityScore) * w.reciprocity;
  add(cRecip, `Reciprocal support detected (strength ${m.reciprocityScore.toFixed(2)})`);

  const cClique = Math.min(1, m.cliqueScore) * w.clique;
  add(cClique, "Both countries belong to a detected friend group");

  const cPrev = Math.min(1, (m.previousFriendVoteDeletions + m.previousCoordinationDeletions) / 2) * w.previousDeletion;
  add(
    cPrev,
    `${m.previousFriendVoteDeletions} previous friend-voting deletion(s), ${m.previousCoordinationDeletions} coordination deletion(s)`,
  );

  const cRepeat = m.repeatedAfterModeration ? w.repeatedAfterModeration : 0;
  add(cRepeat, "Behaviour continued after previous moderation");

  const cTech = Math.min(1, m.previousDuplicateDeletions / 2) * w.technical;
  add(cTech, "Related technical / duplicate-vote evidence on record");

  let raw =
    cConf + cSupport + cTop3 + cMax + cLift + cUplift + cStreak + cRecip + cClique +
    cPrev + cRepeat + cTech;

  // sample-size penalty
  let penalty = 0;
  if (m.sharedOpportunities < s.minOpportunities) {
    penalty =
      -s.smallSamplePenalty *
      (1 - m.sharedOpportunities / Math.max(1, s.minOpportunities));
    add(penalty, `Small-sample adjustment (${m.sharedOpportunities} opportunities)`);
  }
  if (m.editionsCount < s.minEditions) {
    const p = -Math.round(s.smallSamplePenalty / 4);
    penalty += p;
    add(p, `Observed in only ${m.editionsCount} edition(s)`);
  }
  raw += penalty;

  const maxPossible =
    w.confidence + w.support + w.topThree + w.maximum + w.preferenceLift +
    w.audienceUplift + w.streak + w.reciprocity + w.clique + w.previousDeletion +
    w.repeatedAfterModeration + w.technical;
  const score = Math.max(0, Math.min(100, Math.round((raw / maxPossible) * 100)));

  m.riskScore = score;
  m.riskLabel = riskLabelFor(score, s);
  m.reasons = reasons.sort((a, b) => b.delta - a.delta);
  return m;
}

// ------------------------------------------------------------------ groups

export type GroupMetrics = {
  label: string;
  members: string[];
  internalPointShare: number;
  internalTopThreeShare: number;
  internalMaximumShare: number;
  groupReciprocity: number;
  editionsObserved: number;
  roundsObserved: number;
  strongInternalEdges: number;
  averageInternalSupport: number;
  averageExternalSupport: number;
  deletedInternalBallots: number;
  repeatedAfterModeration: number;
  riskScore: number;
  riskLabel: string;
  edges: {
    from: string;
    to: string;
    opportunities: number;
    maximumRate: number;
    averagePoints: number;
    deletedCases: number;
    risk: number;
  }[];
  reasons: string[];
};

function detectGroups(
  rels: RelationshipMetrics[],
  s: FriendVotingSettings,
  input: AnalysisInput,
): GroupMetrics[] {
  const provisional = rels.map((m) => ({
    ...m,
    provisionalRisk: provisionalRisk(m, s),
  }));
  const strong = provisional.filter(
    (m) =>
      m.provisionalRisk >= s.cliqueMinEdgeRisk &&
      m.sharedOpportunities >= Math.max(3, s.minOpportunities - 2) &&
      m.roundsCount >= 2,
  );
  const byKey = new Map(strong.map((m) => [`${m.votingCountry}>${m.targetCountry}`, m]));

  // union-find over mutually strong edges only
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const m of strong) {
    if (byKey.has(`${m.targetCountry}>${m.votingCountry}`)) {
      union(m.votingCountry, m.targetCountry);
    }
  }
  const comps = new Map<string, string[]>();
  for (const c of parent.keys()) {
    const r = find(c);
    comps.set(r, [...(comps.get(r) ?? []), c]);
  }

  const roundById = new Map(input.rounds.map((r) => [r.id, r]));
  const settings = s;
  const groups: GroupMetrics[] = [];
  let idx = 1;
  for (const members of comps.values()) {
    if (members.length < 3) continue;
    const set = new Set(members);
    let internalPts = 0;
    let allPts = 0;
    let internalTop3 = 0;
    let allTop3 = 0;
    let internalMax = 0;
    let allMax = 0;
    let deletedInternal = 0;
    const editions = new Set<string>();
    const rounds = new Set<string>();

    for (const b of input.ballots) {
      if (!set.has(b.votingCountry)) continue;
      if (!countsForIntegrity(b, settings)) continue;
      const r = roundById.get(b.roundId);
      if (!r) continue;
      const pm = ballotPointsMap(b);
      const ranked = [...pm.entries()].sort((x, y) => y[1] - x[1]);
      ranked.forEach(([target, pts], i) => {
        const inside = set.has(target);
        allPts += pts;
        if (inside) internalPts += pts;
        if (i < 3) {
          allTop3++;
          if (inside) internalTop3++;
        }
        if (pts >= r.maxScore) {
          allMax++;
          if (inside) internalMax++;
        }
        if (inside && b.status === "deleted") deletedInternal++;
      });
      if ([...pm.keys()].some((t) => set.has(t))) {
        editions.add(r.editionName);
        rounds.add(r.id);
      }
    }

    const internalEdges = provisional.filter(
      (m) => set.has(m.votingCountry) && set.has(m.targetCountry),
    );
    const externalEdges = provisional.filter(
      (m) => set.has(m.votingCountry) && !set.has(m.targetCountry),
    );
    const avgInternal = mean(internalEdges.map((m) => m.averagePoints));
    const avgExternal = mean(externalEdges.map((m) => m.averagePoints));
    const strongEdges = internalEdges.filter((m) => m.provisionalRisk >= s.cliqueMinEdgeRisk);
    const reciprocity = mean(internalEdges.map((m) => m.reciprocityScore));
    const repeated = internalEdges.filter((m) => m.repeatedAfterModeration).length;

    const internalPointShare = allPts ? internalPts / allPts : 0;
    const internalTopThreeShare = allTop3 ? internalTop3 / allTop3 : 0;
    const internalMaximumShare = allMax ? internalMax / allMax : 0;

    if (
      internalMaximumShare < s.cliqueInternalShareThreshold &&
      internalTopThreeShare < s.cliqueInternalShareThreshold
    )
      continue;
    if (rounds.size < 2) continue;

    const reasons = [
      `${members.length} countries exchange a disproportionate share of their highest scores`,
      `Internal maximum-score share: ${(internalMaximumShare * 100).toFixed(0)}%`,
      `Internal top-three share: ${(internalTopThreeShare * 100).toFixed(0)}%`,
      `Observed across ${editions.size} edition(s) and ${rounds.size} round(s)`,
    ];
    if (repeated > 0)
      reasons.push(`${repeated} internal relationship(s) resumed after moderation`);

    const risk = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          internalMaximumShare * 40 +
            internalTopThreeShare * 25 +
            reciprocity * 15 +
            Math.min(1, strongEdges.length / Math.max(1, members.length)) * 10 +
            Math.min(1, repeated / 2) * 10 -
            (rounds.size < 3 ? 15 : 0),
        ),
      ),
    );

    groups.push({
      label: `Group ${idx++}`,
      members: members.sort(),
      internalPointShare: round2(internalPointShare),
      internalTopThreeShare: round2(internalTopThreeShare),
      internalMaximumShare: round2(internalMaximumShare),
      groupReciprocity: round2(reciprocity),
      editionsObserved: editions.size,
      roundsObserved: rounds.size,
      strongInternalEdges: strongEdges.length,
      averageInternalSupport: round2(avgInternal),
      averageExternalSupport: round2(avgExternal),
      deletedInternalBallots: deletedInternal,
      repeatedAfterModeration: repeated,
      riskScore: risk,
      riskLabel: riskLabelFor(risk, s),
      edges: internalEdges
        .map((m) => ({
          from: m.votingCountry,
          to: m.targetCountry,
          opportunities: m.sharedOpportunities,
          maximumRate: m.maximumScoreFrequency,
          averagePoints: m.averagePoints,
          deletedCases: m.deletedOpportunities,
          risk: m.provisionalRisk,
        }))
        .sort((a, b) => b.risk - a.risk),
      reasons,
    });
  }
  return groups.sort((a, b) => b.riskScore - a.riskScore);
}

function provisionalRisk(m: RelationshipMetrics, s: FriendVotingSettings) {
  const w = s.weights;
  const raw =
    Math.min(1, m.sharedOpportunities / Math.max(1, s.minOpportunities * 2)) * w.confidence +
    m.supportFrequency * w.support +
    m.topThreeFrequency * w.topThree +
    m.maximumScoreFrequency * w.maximum +
    Math.min(1, Math.max(0, (m.preferenceLift - 1) / Math.max(0.001, s.preferenceLiftThreshold - 1))) * w.preferenceLift +
    Math.min(1, Math.max(0, m.normalizedAudienceUplift / 0.5)) * w.audienceUplift +
    Math.min(1, m.longestSupportStreak / Math.max(1, s.streakThreshold)) * w.streak +
    Math.min(1, m.reciprocityScore) * w.reciprocity;
  const maxPossible =
    w.confidence + w.support + w.topThree + w.maximum + w.preferenceLift +
    w.audienceUplift + w.streak + w.reciprocity + w.clique + w.previousDeletion +
    w.repeatedAfterModeration + w.technical;
  return Math.round((raw / maxPossible) * 100);
}

function mean(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
