// Rank-weighted televote conversion — the single source of truth for the
// formula. Used by the backend (official, stored) and by the browser preview
// (unofficial, never stored).
//
//   n            = number of eligible participants in the round
//   B            = n + 2                         (rank base, never hard-coded)
//   rankFactor_i = (B - r_i) ^ e                 (e defaults to 1.33)
//   weighted_i   = P_i * rankFactor_i
//   exact_i      = weighted_i / sum(weighted) * T
//   floored_i    = floor(exact_i)
//   L            = T - sum(floored)
//   bonus        = 1 for the L largest decimal remainders (deterministic ties)
//   final_i      = floored_i + bonus_i           and sum(final) === T exactly

export const DEFAULT_RANK_EXPONENT = 1.33;
export const CALC_ENGINE_VERSION = "rank-weighted-v1";

export type ConversionInput = {
  /** stable country id / code — final technical tie-break */
  code: string;
  /** original valid votes or original points */
  originalVotes: number;
  /** number of distinct voters, used as the configured tie-break rule */
  originalVoters?: number;
};

export type ConversionRow = {
  code: string;
  originalVotes: number;
  originalVoters: number;
  originalRank: number;
  originalShare: number;
  participantCount: number;
  rankBase: number;
  rankExponent: number;
  rankFactor: number;
  weightedScore: number;
  exactPoints: number;
  flooredPoints: number;
  decimalRemainder: number;
  remainderBonus: number;
  finalPoints: number;
};

export type ConversionResult = {
  rows: ConversionRow[];
  participantCount: number;
  rankBase: number;
  rankExponent: number;
  totalPoints: number;
  totalOriginalVotes: number;
  totalWeighted: number;
  leftover: number;
  distributedTotal: number;
  zeroWeight: boolean;
};

/**
 * Deterministic original ranking.
 * Tie-break order: higher original votes → more distinct voters → country code.
 */
export function rankParticipants(items: ConversionInput[]): ConversionInput[] {
  return [...items].sort(
    (a, b) =>
      b.originalVotes - a.originalVotes ||
      (b.originalVoters ?? 0) - (a.originalVoters ?? 0) ||
      a.code.localeCompare(b.code),
  );
}

export function convertRound(
  items: ConversionInput[],
  totalPoints: number,
  rankExponent: number = DEFAULT_RANK_EXPONENT,
): ConversionResult {
  const n = items.length;
  const rankBase = n + 2;
  const T = Math.max(0, Math.trunc(totalPoints));
  const ordered = rankParticipants(items);
  const totalOriginalVotes = ordered.reduce((a, b) => a + b.originalVotes, 0);

  const base = ordered.map((item, idx) => {
    const originalRank = idx + 1;
    const rankFactor = Math.pow(rankBase - originalRank, rankExponent);
    const weightedScore = item.originalVotes * rankFactor;
    return {
      code: item.code,
      originalVotes: item.originalVotes,
      originalVoters: item.originalVoters ?? 0,
      originalRank,
      originalShare: totalOriginalVotes > 0 ? item.originalVotes / totalOriginalVotes : 0,
      participantCount: n,
      rankBase,
      rankExponent,
      rankFactor,
      weightedScore,
    };
  });

  const totalWeighted = base.reduce((a, b) => a + b.weightedScore, 0);
  const zeroWeight = totalWeighted <= 0;

  const rows: ConversionRow[] = base.map((r) => {
    const exactPoints = zeroWeight ? 0 : (r.weightedScore / totalWeighted) * T;
    const flooredPoints = Math.floor(exactPoints);
    return {
      ...r,
      exactPoints,
      flooredPoints,
      decimalRemainder: exactPoints - flooredPoints,
      remainderBonus: 0,
      finalPoints: flooredPoints,
    };
  });

  let leftover = 0;
  if (!zeroWeight) {
    const flooredSum = rows.reduce((a, b) => a + b.flooredPoints, 0);
    leftover = T - flooredSum;

    // Deterministic leftover allocation: largest remainder, then higher
    // original votes, then better original rank, then stable country code.
    const order = [...rows].sort(
      (a, b) =>
        b.decimalRemainder - a.decimalRemainder ||
        b.originalVotes - a.originalVotes ||
        a.originalRank - b.originalRank ||
        a.code.localeCompare(b.code),
    );
    for (let i = 0; i < leftover && i < order.length; i++) {
      order[i]!.remainderBonus = 1;
    }
    for (const r of rows) r.finalPoints = r.flooredPoints + r.remainderBonus;
  }

  rows.sort(
    (a, b) =>
      b.finalPoints - a.finalPoints ||
      a.originalRank - b.originalRank ||
      a.code.localeCompare(b.code),
  );

  return {
    rows,
    participantCount: n,
    rankBase,
    rankExponent,
    totalPoints: T,
    totalOriginalVotes,
    totalWeighted,
    leftover,
    distributedTotal: rows.reduce((a, b) => a + b.finalPoints, 0),
    zeroWeight,
  };
}

export function formulaPreview(n: number, exponent = DEFAULT_RANK_EXPONENT) {
  return `P_i × (${n + 2} − r_i)^${exponent}`;
}
