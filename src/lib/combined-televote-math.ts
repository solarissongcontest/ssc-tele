// Combined televote aggregation maths — shared by the server (official,
// stored) and the admin preview (unofficial, never stored).
//
// Pre-conversion sources feed the combined original score, which is re-ranked
// from scratch and then run through the existing rank-weighted conversion.
// Post-conversion sources are added straight onto the converted points and
// never influence the distribution of T.

import { convertRound, type ConversionRow } from "@/lib/televote-math";

export type CombinationMethod = "raw" | "normalized";
export type CalculationStage = "pre_conversion" | "post_conversion";

export type SourceInput = {
  id: string;
  name: string;
  type: string;
  stage: CalculationStage;
  weight: number;
  enabled: boolean;
  /** country code → raw value contributed by this source */
  values: Record<string, number>;
};

export type SourceContribution = {
  source_id: string;
  source_name: string;
  source_type: string;
  stage: CalculationStage;
  weight: number;
  raw_value: number;
  share: number;
  contribution: number;
};

export type CombinedRow = {
  code: string;
  contributions: SourceContribution[];
  preConversionTotal: number;
  manualPreConversionAdjustment: number;
  combinedOriginalScore: number;
  combinedOriginalRank: number;
  participantCount: number;
  rankBase: number;
  rankExponent: number;
  rankFactor: number;
  weightedScore: number;
  exactConvertedPoints: number;
  flooredPoints: number;
  decimalRemainder: number;
  remainderBonus: number;
  convertedPoints: number;
  postConversionBonus: number;
  postConversionAdjustment: number;
  finalTelevoteScore: number;
};

export type CombinedResult = {
  rows: CombinedRow[];
  participantCount: number;
  rankBase: number;
  rankExponent: number;
  totalPoints: number;
  distributedConverted: number;
  finalTotal: number;
  zeroWeight: boolean;
  warnings: string[];
};

/** Correction-type sources are treated as explicit manual adjustments. */
export function isAdjustmentType(type: string) {
  return type === "correction";
}

export function computeCombined(opts: {
  participants: string[];
  sources: SourceInput[];
  method: CombinationMethod;
  totalPoints: number;
  rankExponent: number;
}): CombinedResult {
  const { participants, method, totalPoints, rankExponent } = opts;
  const sources = opts.sources.filter((s) => s.enabled);
  const warnings: string[] = [];

  const eligible = new Set(participants);
  for (const s of sources) {
    for (const code of Object.keys(s.values)) {
      if (!eligible.has(code) && Number(s.values[code] ?? 0) !== 0) {
        warnings.push(
          `“${s.name}” contains ${code}, which is not eligible for this combined result — excluded.`,
        );
      }
    }
  }

  const contribMap = new Map<string, SourceContribution[]>();
  const pre = new Map<string, number>();
  const preAdj = new Map<string, number>();
  const postBonus = new Map<string, number>();
  const postAdj = new Map<string, number>();
  participants.forEach((c) => {
    contribMap.set(c, []);
    pre.set(c, 0);
    preAdj.set(c, 0);
    postBonus.set(c, 0);
    postAdj.set(c, 0);
  });

  for (const s of sources) {
    const weight = Number.isFinite(s.weight) ? Number(s.weight) : 1;
    const eligibleValues = participants.map((c) => Number(s.values[c] ?? 0));
    const positiveTotal = eligibleValues.reduce((a, v) => a + Math.max(0, v), 0);

    participants.forEach((code, i) => {
      const raw = eligibleValues[i] ?? 0;
      const adjustment = isAdjustmentType(s.type);
      const share = positiveTotal > 0 ? raw / positiveTotal : 0;
      // Normalized-share mode only applies to ordinary pre-conversion sources.
      // Corrections and post-conversion points are always literal values.
      const useShare =
        method === "normalized" && s.stage === "pre_conversion" && !adjustment;
      const contribution = useShare ? share * weight : raw * weight;

      if (raw !== 0 || contribution !== 0) {
        contribMap.get(code)!.push({
          source_id: s.id,
          source_name: s.name,
          source_type: s.type,
          stage: s.stage,
          weight,
          raw_value: raw,
          share,
          contribution,
        });
      }

      if (s.stage === "pre_conversion") {
        if (adjustment) preAdj.set(code, preAdj.get(code)! + contribution);
        else pre.set(code, pre.get(code)! + contribution);
      } else {
        if (adjustment) postAdj.set(code, postAdj.get(code)! + contribution);
        else postBonus.set(code, postBonus.get(code)! + contribution);
      }
    });
  }

  // Combined original score — never allowed below zero.
  const combined = new Map<string, number>();
  participants.forEach((c) => {
    combined.set(c, Math.max(0, pre.get(c)! + preAdj.get(c)!));
  });

  const conversion = convertRound(
    participants.map((c) => ({ code: c, originalVotes: combined.get(c)! })),
    totalPoints,
    rankExponent,
  );
  const byCode = new Map<string, ConversionRow>(
    conversion.rows.map((r) => [r.code, r]),
  );

  const rows: CombinedRow[] = participants.map((code) => {
    const c = byCode.get(code)!;
    const bonus = postBonus.get(code)!;
    const adj = postAdj.get(code)!;
    const final = Math.max(0, c.finalPoints + bonus + adj);
    return {
      code,
      contributions: contribMap.get(code)!,
      preConversionTotal: pre.get(code)!,
      manualPreConversionAdjustment: preAdj.get(code)!,
      combinedOriginalScore: combined.get(code)!,
      combinedOriginalRank: c.originalRank,
      participantCount: c.participantCount,
      rankBase: c.rankBase,
      rankExponent: c.rankExponent,
      rankFactor: c.rankFactor,
      weightedScore: c.weightedScore,
      exactConvertedPoints: c.exactPoints,
      flooredPoints: c.flooredPoints,
      decimalRemainder: c.decimalRemainder,
      remainderBonus: c.remainderBonus,
      convertedPoints: c.finalPoints,
      postConversionBonus: bonus,
      postConversionAdjustment: adj,
      finalTelevoteScore: final,
    };
  });

  rows.sort(
    (a, b) =>
      b.finalTelevoteScore - a.finalTelevoteScore ||
      b.convertedPoints - a.convertedPoints ||
      a.combinedOriginalRank - b.combinedOriginalRank ||
      a.code.localeCompare(b.code),
  );

  return {
    rows,
    participantCount: conversion.participantCount,
    rankBase: conversion.rankBase,
    rankExponent: conversion.rankExponent,
    totalPoints: conversion.totalPoints,
    distributedConverted: rows.reduce((a, r) => a + r.convertedPoints, 0),
    finalTotal: rows.reduce((a, r) => a + r.finalTelevoteScore, 0),
    zeroWeight: conversion.zeroWeight,
    warnings: Array.from(new Set(warnings)),
  };
}
