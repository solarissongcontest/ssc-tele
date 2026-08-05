// Combined televote — component-pool calculation engine.
//
// Model:
//   1. The overall combined pool G is split into whole-number component pools
//      by percentage weight (largest remainder).
//   2. Every voting component is ranked and rank-weighted INDEPENDENTLY inside
//      its own pool.
//   3. Every activity component is distributed proportionally inside its pool.
//   4. Finished whole-number allocations are added together. No second
//      rank-weighted pass is ever performed.
//
// Pure, dependency-free and unit-testable.

import { DEFAULT_RANK_EXPONENT } from "@/lib/televote-math";

export const COMBINED_ENGINE_VERSION = "component-pool-v1";
export const WEIGHT_TOLERANCE = 1e-6;

export type CalculationMethod = "rank_weighted" | "proportional" | "adjustment";
export type CorrectionScope = "source" | "final";

/** Source types that are calculated as ordinary rank-weighted voting sources. */
export const VOTING_SOURCE_TYPES = [
  "round",
  "instagram",
  "external_televote",
  "imported",
  "other",
];

export function methodForSourceType(type: string): CalculationMethod {
  if (type === "activity") return "proportional";
  if (type === "correction") return "adjustment";
  return "rank_weighted";
}

export type ComponentSourceInput = {
  id: string;
  name: string;
  type: string;
  percentageWeight: number;
  enabled: boolean;
  displayOrder: number;
  /** country code → raw value in this source */
  values: Record<string, number>;
  /** country code → individual submitted scores, sorted later. Optional. */
  distributions?: Record<string, number[]>;
  /** correction sources only */
  correctionTargetSourceId?: string | null;
  correctionScope?: CorrectionScope;
};

export type ComponentPool = {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  method: CalculationMethod;
  displayOrder: number;
  percentageWeight: number;
  exactPool: number;
  flooredPool: number;
  poolRemainder: number;
  poolBonus: 0 | 1;
  finalPool: number;
};

export type ComponentCountryResult = {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  countryCode: string;
  method: CalculationMethod;
  rawScore: number;
  rawRank: number | null;
  participantCount: number;
  rankBase: number | null;
  rankExponent: number | null;
  rankFactor: number | null;
  weightedScore: number | null;
  sourceWeightedTotal: number | null;
  sourceRawTotal: number;
  exactAllocation: number;
  flooredAllocation: number;
  decimalRemainder: number;
  remainderBonus: 0 | 1;
  finalAllocatedPoints: number;
  tieBreakData: TieBreakData;
};

export type TieBreakData = {
  /** true when another country had the same raw score in this source */
  rawTie: boolean;
  /** how the raw rank tie was resolved */
  rankResolvedBy?: "raw_score" | "score_distribution" | "running_order" | "country_id";
  /** true when no score distribution was available for a stronger tie-break */
  distributionUnavailable: boolean;
  distribution?: number[];
  remainderResolvedBy?:
    | "remainder"
    | "raw_score"
    | "raw_rank"
    | "score_distribution"
    | "running_order"
    | "country_id";
};

export type CombinedCountryResult = {
  code: string;
  componentResults: ComponentCountryResult[];
  totalVotingPoints: number;
  totalActivityPoints: number;
  finalCorrection: number;
  finalCombinedPoints: number;
  finalRank: number;
  finalTieBreakData: {
    tied: boolean;
    resolvedBy?: string;
    decidingSourceId?: string | null;
    comparedValues?: Record<string, number>;
  };
};

export type CombinedResult = {
  pools: ComponentPool[];
  rows: CombinedCountryResult[];
  totalPoints: number;
  totalPercentage: number;
  allocatedTotal: number;
  finalTotal: number;
  corrections: {
    sourceId: string;
    sourceName: string;
    scope: CorrectionScope;
    targetSourceId: string | null;
    values: Record<string, number>;
  }[];
  errors: string[];
  warnings: string[];
};

/* ------------------------------------------------------------------ */
/* Generic largest-remainder helper                                    */
/* ------------------------------------------------------------------ */

export type RemainderRow<T> = {
  item: T;
  exact: number;
  floored: number;
  remainder: number;
  bonus: 0 | 1;
  final: number;
};

/**
 * Distributes `total` whole points across `items` by their exact quotas using
 * the largest remainder method. `tieBreak` orders equal remainders (return < 0
 * when `a` should receive the extra point first).
 */
export function largestRemainder<T>(
  items: T[],
  exactOf: (item: T) => number,
  total: number,
  tieBreak: (a: T, b: T) => number = () => 0,
): RemainderRow<T>[] {
  const rows: RemainderRow<T>[] = items.map((item) => {
    const exact = exactOf(item);
    const floored = Math.floor(exact + 1e-9);
    return {
      item,
      exact,
      floored,
      remainder: exact - floored,
      bonus: 0 as 0 | 1,
      final: floored,
    };
  });
  const leftover = Math.round(total - rows.reduce((a, r) => a + r.floored, 0));
  if (leftover > 0) {
    const order = [...rows].sort(
      (a, b) => b.remainder - a.remainder || tieBreak(a.item, b.item),
    );
    for (let i = 0; i < leftover && i < order.length; i++) {
      order[i]!.bonus = 1;
      order[i]!.final = order[i]!.floored + 1;
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Score-distribution comparison                                       */
/* ------------------------------------------------------------------ */

/** Compares two score distributions highest-first. Negative → `a` ranks higher. */
export function compareDistributions(a?: number[], b?: number[]): number {
  if (!a?.length || !b?.length) return 0;
  const A = [...a].sort((x, y) => y - x);
  const B = [...b].sort((x, y) => y - x);
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const av = A[i] ?? -Infinity;
    const bv = B[i] ?? -Infinity;
    if (av !== bv) return bv - av; // higher value ranks first
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Rank-weighted allocation for a single voting source                 */
/* ------------------------------------------------------------------ */

export type SourceAllocationInput = {
  source: { id: string; name: string; type: string };
  participants: string[];
  /** index in the configured running order, by country code */
  runningOrder: Record<string, number>;
  values: Record<string, number>;
  distributions?: Record<string, number[]>;
  pool: number;
  rankExponent: number;
};

export function allocateRankWeightedSource(
  input: SourceAllocationInput,
): { rows: ComponentCountryResult[]; totalWeighted: number; rawTotal: number } {
  const { participants, values, distributions, pool, rankExponent, source } = input;
  const n = participants.length;
  const rankBase = n + 2;
  const raw = (c: string) => Number(values[c] ?? 0);
  const rawTotal = participants.reduce((a, c) => a + raw(c), 0);

  const rankCompare = (a: string, b: string) => {
    if (raw(a) !== raw(b)) return raw(b) - raw(a);
    const d = compareDistributions(distributions?.[a], distributions?.[b]);
    if (d !== 0) return d;
    const ro = (input.runningOrder[a] ?? 0) - (input.runningOrder[b] ?? 0);
    if (ro !== 0) return ro;
    return a.localeCompare(b);
  };

  const ordered = [...participants].sort(rankCompare);
  const rankOf = new Map<string, number>();
  ordered.forEach((c, i) => rankOf.set(c, i + 1));

  const tieBreakOf = (code: string): TieBreakData => {
    const peers = participants.filter((p) => p !== code && raw(p) === raw(code));
    const rawTie = peers.length > 0;
    const dist = distributions?.[code];
    let rankResolvedBy: TieBreakData["rankResolvedBy"] = "raw_score";
    if (rawTie) {
      const decided = peers.some(
        (p) => compareDistributions(dist, distributions?.[p]) !== 0,
      );
      rankResolvedBy = decided
        ? "score_distribution"
        : input.runningOrder[code] !== undefined
          ? "running_order"
          : "country_id";
    }
    return {
      rawTie,
      rankResolvedBy,
      distributionUnavailable: rawTie && !dist?.length,
      ...(dist?.length ? { distribution: [...dist].sort((x, y) => y - x) } : {}),
    };
  };

  const weightedOf = (code: string) => {
    const r = rankOf.get(code)!;
    const factor = Math.pow(rankBase - r, rankExponent);
    return { factor, weighted: raw(code) * factor };
  };

  const totalWeighted = participants.reduce(
    (a, c) => a + weightedOf(c).weighted,
    0,
  );

  const allocation = largestRemainder(
    participants,
    (c) => (totalWeighted > 0 ? (weightedOf(c).weighted / totalWeighted) * pool : 0),
    totalWeighted > 0 ? pool : 0,
    (a, b) =>
      raw(b) - raw(a) ||
      rankOf.get(a)! - rankOf.get(b)! ||
      compareDistributions(distributions?.[a], distributions?.[b]) ||
      (input.runningOrder[a] ?? 0) - (input.runningOrder[b] ?? 0) ||
      a.localeCompare(b),
  );

  const rows = allocation.map((row) => {
    const code = row.item;
    const { factor, weighted } = weightedOf(code);
    const tb = tieBreakOf(code);
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      countryCode: code,
      method: "rank_weighted" as const,
      rawScore: raw(code),
      rawRank: rankOf.get(code)!,
      participantCount: n,
      rankBase,
      rankExponent,
      rankFactor: factor,
      weightedScore: weighted,
      sourceWeightedTotal: totalWeighted,
      sourceRawTotal: rawTotal,
      exactAllocation: row.exact,
      flooredAllocation: row.floored,
      decimalRemainder: row.remainder,
      remainderBonus: row.bonus,
      finalAllocatedPoints: row.final,
      tieBreakData: {
        ...tb,
        remainderResolvedBy: row.bonus ? ("remainder" as const) : undefined,
      },
    };
  });

  return { rows, totalWeighted, rawTotal };
}

/* ------------------------------------------------------------------ */
/* Proportional allocation for an activity source                      */
/* ------------------------------------------------------------------ */

export function allocateProportionalSource(input: {
  source: { id: string; name: string; type: string };
  participants: string[];
  runningOrder: Record<string, number>;
  values: Record<string, number>;
  pool: number;
}): { rows: ComponentCountryResult[]; rawTotal: number } {
  const { participants, values, pool, source } = input;
  const raw = (c: string) => Math.max(0, Number(values[c] ?? 0));
  const rawTotal = participants.reduce((a, c) => a + raw(c), 0);

  const allocation = largestRemainder(
    participants,
    (c) => (rawTotal > 0 ? (raw(c) / rawTotal) * pool : 0),
    rawTotal > 0 ? pool : 0,
    (a, b) =>
      raw(b) - raw(a) ||
      (input.runningOrder[a] ?? 0) - (input.runningOrder[b] ?? 0) ||
      a.localeCompare(b),
  );

  const rows = allocation.map((row) => ({
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    countryCode: row.item,
    method: "proportional" as const,
    rawScore: raw(row.item),
    rawRank: null,
    participantCount: participants.length,
    rankBase: null,
    rankExponent: null,
    rankFactor: null,
    weightedScore: null,
    sourceWeightedTotal: null,
    sourceRawTotal: rawTotal,
    exactAllocation: row.exact,
    flooredAllocation: row.floored,
    decimalRemainder: row.remainder,
    remainderBonus: row.bonus,
    finalAllocatedPoints: row.final,
    tieBreakData: { rawTie: false, distributionUnavailable: false } as TieBreakData,
  }));

  return { rows, rawTotal };
}

/* ------------------------------------------------------------------ */
/* Component pools                                                     */
/* ------------------------------------------------------------------ */

export function allocateComponentPools(
  components: ComponentSourceInput[],
  totalPoints: number,
): ComponentPool[] {
  const G = Math.max(0, Math.trunc(totalPoints));
  const rows = largestRemainder(
    components,
    (s) => (G * Number(s.percentageWeight || 0)) / 100,
    G,
    (a, b) =>
      Number(b.percentageWeight) - Number(a.percentageWeight) ||
      a.displayOrder - b.displayOrder ||
      a.id.localeCompare(b.id),
  );
  return rows.map((r) => ({
    sourceId: r.item.id,
    sourceName: r.item.name,
    sourceType: r.item.type,
    method: methodForSourceType(r.item.type),
    displayOrder: r.item.displayOrder,
    percentageWeight: Number(r.item.percentageWeight || 0),
    exactPool: r.exact,
    flooredPool: r.floored,
    poolRemainder: r.remainder,
    poolBonus: r.bonus,
    finalPool: r.final,
  }));
}

/* ------------------------------------------------------------------ */
/* Full combined calculation                                           */
/* ------------------------------------------------------------------ */

export function computeCombined(opts: {
  participants: string[];
  sources: ComponentSourceInput[];
  totalPoints: number;
  rankExponent?: number;
}): CombinedResult {
  const participants = [...opts.participants];
  const rankExponent = Number(opts.rankExponent ?? DEFAULT_RANK_EXPONENT);
  const G = Math.max(0, Math.trunc(opts.totalPoints));
  const errors: string[] = [];
  const warnings: string[] = [];

  const runningOrder: Record<string, number> = {};
  participants.forEach((c, i) => (runningOrder[c] = i));
  const eligible = new Set(participants);

  const enabled = opts.sources.filter((s) => s.enabled);
  const corrections = enabled.filter((s) => s.type === "correction");
  const components = enabled
    .filter((s) => s.type !== "correction")
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));

  // Ineligible values → warning + exclusion.
  for (const s of enabled) {
    for (const [code, v] of Object.entries(s.values)) {
      if (!eligible.has(code) && Number(v) !== 0) {
        warnings.push(
          `“${s.name}” contains ${code}, which is not eligible for this combined result — excluded.`,
        );
      }
    }
  }

  // Corrections applied to a specific source's raw values, before calculation.
  const adjustedValues = new Map<string, Record<string, number>>();
  for (const c of components) adjustedValues.set(c.id, { ...c.values });
  const finalCorrections: Record<string, number> = {};
  for (const corr of corrections) {
    const scope: CorrectionScope = corr.correctionScope ?? "final";
    if (scope === "source") {
      const target = corr.correctionTargetSourceId;
      if (!target || !adjustedValues.has(target)) {
        errors.push(
          `Correction “${corr.name}” targets a source that no longer exists — pick a target or switch it to a final correction.`,
        );
        continue;
      }
      const bucket = adjustedValues.get(target)!;
      for (const c of participants)
        bucket[c] = Number(bucket[c] ?? 0) + Number(corr.values[c] ?? 0);
    } else {
      for (const c of participants)
        finalCorrections[c] = (finalCorrections[c] ?? 0) + Number(corr.values[c] ?? 0);
    }
  }

  const totalPercentage = components.reduce(
    (a, s) => a + Number(s.percentageWeight || 0),
    0,
  );
  if (components.length === 0) errors.push("Enable at least one component source.");
  if (participants.length === 0) errors.push("Select at least one eligible country.");
  if (
    components.length > 0 &&
    Math.abs(totalPercentage - 100) > WEIGHT_TOLERANCE * 100
  )
    errors.push(
      `Enabled component weights total ${round(totalPercentage, 4)}% — they must total exactly 100%.`,
    );

  const pools = allocateComponentPools(components, G);
  const poolById = new Map(pools.map((p) => [p.sourceId, p]));

  const componentRows: ComponentCountryResult[] = [];
  for (const s of components) {
    const pool = poolById.get(s.id)!;
    const values = adjustedValues.get(s.id)!;
    const method = methodForSourceType(s.type);

    if (method === "proportional") {
      const { rows, rawTotal } = allocateProportionalSource({
        source: { id: s.id, name: s.name, type: s.type },
        participants,
        runningOrder,
        values,
        pool: pool.finalPool,
      });
      if (rawTotal <= 0 && pool.finalPool > 0)
        errors.push(
          `“${s.name}” has no activity values — add data, disable the source or set its weight to 0%.`,
        );
      componentRows.push(...rows);
    } else {
      const { rows, totalWeighted } = allocateRankWeightedSource({
        source: { id: s.id, name: s.name, type: s.type },
        participants,
        runningOrder,
        values,
        distributions: s.distributions,
        pool: pool.finalPool,
        rankExponent,
      });
      if (totalWeighted <= 0 && pool.finalPool > 0)
        errors.push(
          `“${s.name}” has no scores — add data, disable the source or set its weight to 0%.`,
        );
      if (rows.some((r) => r.tieBreakData.distributionUnavailable))
        warnings.push(
          `“${s.name}” has tied raw scores but no score distribution — running order was used to break the tie.`,
        );
      const missing = participants.filter((c) => values[c] === undefined);
      if (missing.length)
        warnings.push(
          `${missing.length} eligible ${missing.length === 1 ? "country is" : "countries are"} missing from “${s.name}” and counted as zero.`,
        );
      componentRows.push(...rows);
    }

    // Component allocation integrity
    const sum = componentRows
      .filter((r) => r.sourceId === s.id)
      .reduce((a, r) => a + r.finalAllocatedPoints, 0);
    if (sum !== pool.finalPool && pool.finalPool > 0 && sum !== 0)
      errors.push(
        `“${s.name}” allocated ${sum} points but its pool is ${pool.finalPool}.`,
      );
  }

  const byCountry = new Map<string, ComponentCountryResult[]>();
  participants.forEach((c) => byCountry.set(c, []));
  for (const r of componentRows) byCountry.get(r.countryCode)?.push(r);

  const votingPoolOrder = pools
    .filter((p) => p.method === "rank_weighted")
    .sort(
      (a, b) =>
        b.percentageWeight - a.percentageWeight ||
        a.displayOrder - b.displayOrder ||
        a.sourceId.localeCompare(b.sourceId),
    );

  const rows: CombinedCountryResult[] = participants.map((code) => {
    const comps = byCountry.get(code)!;
    const totalVotingPoints = comps
      .filter((c) => c.method === "rank_weighted")
      .reduce((a, c) => a + c.finalAllocatedPoints, 0);
    const totalActivityPoints = comps
      .filter((c) => c.method === "proportional")
      .reduce((a, c) => a + c.finalAllocatedPoints, 0);
    const correction = Number(finalCorrections[code] ?? 0);
    return {
      code,
      componentResults: comps,
      totalVotingPoints,
      totalActivityPoints,
      finalCorrection: correction,
      finalCombinedPoints: Math.max(
        0,
        totalVotingPoints + totalActivityPoints + correction,
      ),
      finalRank: 0,
      finalTieBreakData: { tied: false },
    };
  });

  // Dynamic final tie-break.
  const alloc = (r: CombinedCountryResult, sourceId: string) =>
    r.componentResults.find((c) => c.sourceId === sourceId)?.finalAllocatedPoints ?? 0;
  const rawIn = (r: CombinedCountryResult, sourceId: string) =>
    r.componentResults.find((c) => c.sourceId === sourceId)?.rawScore ?? 0;
  const distIn = (r: CombinedCountryResult, sourceId: string) =>
    r.componentResults.find((c) => c.sourceId === sourceId)?.tieBreakData.distribution;

  type Step = {
    label: string;
    sourceId: string | null;
    cmp: (a: CombinedCountryResult, b: CombinedCountryResult) => number;
  };
  const steps: Step[] = [
    ...votingPoolOrder.map((p) => ({
      label: `allocated points in ${p.sourceName}`,
      sourceId: p.sourceId,
      cmp: (a: CombinedCountryResult, b: CombinedCountryResult) =>
        alloc(b, p.sourceId) - alloc(a, p.sourceId),
    })),
    {
      label: "total voting points",
      sourceId: null,
      cmp: (a, b) => b.totalVotingPoints - a.totalVotingPoints,
    },
    {
      label: "activity points",
      sourceId: null,
      cmp: (a, b) => b.totalActivityPoints - a.totalActivityPoints,
    },
    ...votingPoolOrder.map((p) => ({
      label: `raw score in ${p.sourceName}`,
      sourceId: p.sourceId,
      cmp: (a: CombinedCountryResult, b: CombinedCountryResult) =>
        rawIn(b, p.sourceId) - rawIn(a, p.sourceId),
    })),
    ...votingPoolOrder.map((p) => ({
      label: `score distribution in ${p.sourceName}`,
      sourceId: p.sourceId,
      cmp: (a: CombinedCountryResult, b: CombinedCountryResult) =>
        compareDistributions(distIn(a, p.sourceId), distIn(b, p.sourceId)),
    })),
    {
      label: "running order",
      sourceId: null,
      cmp: (a, b) => (runningOrder[a.code] ?? 0) - (runningOrder[b.code] ?? 0),
    },
    {
      label: "country id",
      sourceId: null,
      cmp: (a, b) => a.code.localeCompare(b.code),
    },
  ];

  rows.sort((a, b) => {
    const diff = b.finalCombinedPoints - a.finalCombinedPoints;
    if (diff !== 0) return diff;
    for (const step of steps) {
      const c = step.cmp(a, b);
      if (c !== 0) {
        for (const r of [a, b]) {
          r.finalTieBreakData = {
            tied: true,
            resolvedBy: step.label,
            decidingSourceId: step.sourceId,
            comparedValues: {
              [a.code]: a.finalCombinedPoints,
              [b.code]: b.finalCombinedPoints,
            },
          };
        }
        return c;
      }
    }
    return 0;
  });
  rows.forEach((r, i) => (r.finalRank = i + 1));

  const allocatedTotal = componentRows.reduce(
    (a, r) => a + r.finalAllocatedPoints,
    0,
  );
  const finalTotal = rows.reduce((a, r) => a + r.finalCombinedPoints, 0);
  const correctionTotal = rows.reduce((a, r) => a + r.finalCorrection, 0);
  if (errors.length === 0 && allocatedTotal !== G)
    errors.push(`Allocated component points total ${allocatedTotal} but the overall pool is ${G}.`);
  if (errors.length === 0 && correctionTotal === 0 && finalTotal !== G)
    errors.push(`Final country totals add up to ${finalTotal} but the overall pool is ${G}.`);

  return {
    pools,
    rows,
    totalPoints: G,
    totalPercentage,
    allocatedTotal,
    finalTotal,
    corrections: corrections.map((c) => ({
      sourceId: c.id,
      sourceName: c.name,
      scope: c.correctionScope ?? "final",
      targetSourceId: c.correctionTargetSourceId ?? null,
      values: c.values,
    })),
    errors: Array.from(new Set(errors)),
    warnings: Array.from(new Set(warnings)),
  };
}

function round(n: number, d: number) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}
