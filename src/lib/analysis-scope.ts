export type AnalysisScope =
  | {
      mode: "all_editions";
    }
  | {
      mode: "edition";
      editionId: string;
    }
  | {
      mode: "edition_range";
      fromEditionId: string;
      toEditionId: string;
    }
  | {
      mode: "round";
      roundId: string;
    };

export const DEFAULT_ANALYSIS_SCOPE: AnalysisScope = {
  mode: "all_editions",
};

export function analysisScopeKey(scope: AnalysisScope) {
  switch (scope.mode) {
    case "all_editions":
      return "all";
    case "edition":
      return `edition:${scope.editionId}`;
    case "edition_range":
      return `range:${scope.fromEditionId}:${scope.toEditionId}`;
    case "round":
      return `round:${scope.roundId}`;
  }
}

export function validateAnalysisScope(input: AnalysisScope): AnalysisScope {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid analysis scope");
  }

  switch (input.mode) {
    case "all_editions":
      return { mode: "all_editions" };

    case "edition":
      if (!input.editionId) throw new Error("Missing edition");
      return {
        mode: "edition",
        editionId: String(input.editionId),
      };

    case "edition_range":
      if (!input.fromEditionId || !input.toEditionId) {
        throw new Error("Missing edition range");
      }

      return {
        mode: "edition_range",
        fromEditionId: String(input.fromEditionId),
        toEditionId: String(input.toEditionId),
      };

    case "round":
      if (!input.roundId) throw new Error("Missing round");
      return {
        mode: "round",
        roundId: String(input.roundId),
      };

    default:
      throw new Error("Unsupported analysis scope");
  }
}
