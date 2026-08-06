import { describe, expect, it } from "vitest";
import {
  computeCombined,
  allocateComponentPools,
  methodForInputMode,
  resolveInputMode,
  type ComponentSourceInput,
} from "@/lib/combined-televote-math";

const base = {
  enabled: true,
  displayOrder: 0,
  percentageWeight: 100,
  type: "round",
};

function src(p: Partial<ComponentSourceInput> & { id: string }): ComponentSourceInput {
  return { name: p.id, values: {}, ...base, ...p } as ComponentSourceInput;
}

describe("input modes", () => {
  it("maps every mode to its calculation method", () => {
    expect(methodForInputMode("raw_results")).toBe("rank_weighted");
    expect(methodForInputMode("converted_points")).toBe("rescaled");
    expect(methodForInputMode("activity_points")).toBe("proportional");
    expect(methodForInputMode("correction")).toBe("adjustment");
  });

  it("falls back to the legacy source type when input_mode is missing", () => {
    expect(resolveInputMode({ type: "activity" })).toBe("activity_points");
    expect(resolveInputMode({ type: "correction" })).toBe("correction");
    expect(resolveInputMode({ type: "round" })).toBe("raw_results");
    expect(resolveInputMode({ type: "round", inputMode: "converted_points" })).toBe(
      "converted_points",
    );
  });
});

describe("component pools", () => {
  it("splits the overall pool by percentage with largest remainder", () => {
    const pools = allocateComponentPools(
      [
        src({ id: "a", percentageWeight: 60, inputMode: "raw_results" }),
        src({ id: "b", percentageWeight: 40, inputMode: "activity_points" }),
      ],
      101,
    );
    expect(pools.map((p) => p.finalPool).reduce((a, b) => a + b, 0)).toBe(101);
    expect(pools.find((p) => p.sourceId === "a")!.finalPool).toBe(61);
    expect(pools.find((p) => p.sourceId === "b")!.finalPool).toBe(40);
  });
});

describe("computeCombined", () => {
  const participants = ["AAA", "BBB", "CCC", "DDD"];

  it("rank-weights raw results and allocates the exact pool", () => {
    const r = computeCombined({
      participants,
      totalPoints: 100,
      sources: [
        src({
          id: "raw",
          inputMode: "raw_results",
          values: { AAA: 100, BBB: 60, CCC: 30, DDD: 10 },
        }),
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.allocatedTotal).toBe(100);
    expect(r.rows[0]!.code).toBe("AAA");
    expect(r.rows.every((row) => row.componentResults[0]!.method === "rank_weighted")).toBe(
      true,
    );
    expect(r.rows[0]!.componentResults[0]!.rankFactor).toBeGreaterThan(0);
  });

  it("rescales converted points proportionally without rank weighting", () => {
    const r = computeCombined({
      participants,
      totalPoints: 50,
      sources: [
        src({
          id: "conv",
          inputMode: "converted_points",
          values: { AAA: 12, BBB: 10, CCC: 8, DDD: 0 },
        }),
      ],
    });
    expect(r.errors).toEqual([]);
    const comp = (code: string) =>
      r.rows.find((x) => x.code === code)!.componentResults[0]!;
    expect(comp("AAA").method).toBe("rescaled");
    expect(comp("AAA").rankFactor).toBeNull();
    expect(comp("AAA").weightedScore).toBeNull();
    expect(comp("AAA").rankBase).toBeNull();
    // proportional: 12/30*50 = 20, 10/30*50 = 16.67, 8/30*50 = 13.33
    expect(comp("AAA").finalAllocatedPoints).toBe(20);
    expect(comp("BBB").finalAllocatedPoints).toBe(17);
    expect(comp("CCC").finalAllocatedPoints).toBe(13);
    expect(r.allocatedTotal).toBe(50);
  });

  it("allocates activity points proportionally", () => {
    const r = computeCombined({
      participants,
      totalPoints: 20,
      sources: [
        src({
          id: "act",
          type: "activity",
          inputMode: "activity_points",
          values: { AAA: 5, BBB: 5, CCC: 5, DDD: 5 },
        }),
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.rows.every((row) => row.totalActivityPoints === 5)).toBe(true);
    expect(r.rows.every((row) => row.totalVotingPoints === 0)).toBe(true);
  });

  it("calculates every source independently and never re-converts", () => {
    const r = computeCombined({
      participants,
      totalPoints: 100,
      sources: [
        src({
          id: "raw",
          percentageWeight: 50,
          inputMode: "raw_results",
          values: { AAA: 40, BBB: 30, CCC: 20, DDD: 10 },
        }),
        src({
          id: "conv",
          percentageWeight: 30,
          displayOrder: 1,
          inputMode: "converted_points",
          values: { AAA: 1, BBB: 1, CCC: 1, DDD: 0 },
        }),
        src({
          id: "act",
          percentageWeight: 20,
          displayOrder: 2,
          type: "activity",
          inputMode: "activity_points",
          values: { AAA: 1, BBB: 1, CCC: 1, DDD: 1 },
        }),
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.pools.map((p) => p.finalPool)).toEqual([50, 30, 20]);
    expect(r.allocatedTotal).toBe(100);
    expect(r.finalTotal).toBe(100);
    for (const row of r.rows) {
      const sum = row.componentResults.reduce(
        (a, c) => a + c.finalAllocatedPoints,
        0,
      );
      expect(row.finalCombinedPoints).toBe(sum);
    }
  });

  it("blocks calculation when weights do not total 100%", () => {
    const r = computeCombined({
      participants,
      totalPoints: 100,
      sources: [src({ id: "a", percentageWeight: 70, values: { AAA: 1 } })],
    });
    expect(r.errors.some((e) => /must total exactly 100%/.test(e))).toBe(true);
  });

  it("is deterministic for tied raw scores", () => {
    const opts = {
      participants,
      totalPoints: 40,
      sources: [
        src({
          id: "raw",
          inputMode: "raw_results" as const,
          values: { AAA: 10, BBB: 10, CCC: 10, DDD: 10 },
        }),
      ],
    };
    const a = computeCombined(opts).rows.map((r) => r.code);
    const b = computeCombined(opts).rows.map((r) => r.code);
    expect(a).toEqual(b);
  });

  it("works for custom (non-country) entry keys", () => {
    const custom = ["x_a1", "x_b2", "x_c3", "SOL"];
    const r = computeCombined({
      participants: custom,
      totalPoints: 60,
      sources: [
        src({
          id: "raw",
          percentageWeight: 50,
          inputMode: "raw_results",
          values: { x_a1: 30, x_b2: 20, x_c3: 10, SOL: 5 },
        }),
        src({
          id: "conv",
          percentageWeight: 50,
          displayOrder: 1,
          inputMode: "converted_points",
          values: { x_a1: 12, x_b2: 10, x_c3: 8, SOL: 0 },
        }),
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.allocatedTotal).toBe(60);
    expect(r.rows.map((x) => x.code).sort()).toEqual([...custom].sort());
  });

  it("applies final corrections without breaking allocation", () => {
    const r = computeCombined({
      participants,
      totalPoints: 40,
      sources: [
        src({
          id: "raw",
          inputMode: "raw_results",
          values: { AAA: 10, BBB: 8, CCC: 6, DDD: 4 },
        }),
        src({
          id: "corr",
          type: "correction",
          inputMode: "correction",
          percentageWeight: 0,
          displayOrder: 9,
          correctionScope: "final",
          values: { DDD: 3 },
        }),
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.allocatedTotal).toBe(40);
    expect(r.rows.find((x) => x.code === "DDD")!.finalCorrection).toBe(3);
  });
});
