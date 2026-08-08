import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAllRounds } from "@/hooks/use-round-results";
import {
  DEFAULT_ANALYSIS_SCOPE,
  type AnalysisScope,
} from "@/lib/analysis-scope";

type EditionOption = {
  id: string;
  name: string;
  created_at: string;
};

export function AnalysisScopePicker({
  value = DEFAULT_ANALYSIS_SCOPE,
  onChange,
  className = "",
}: {
  value?: AnalysisScope;
  onChange: (scope: AnalysisScope) => void;
  className?: string;
}) {
  const { data: rounds = [] } = useAllRounds();

  const { data: editions = [] } = useQuery({
    queryKey: ["analysis-editions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("editions")
        .select("id,name,created_at")
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as EditionOption[];
    },
    staleTime: 60_000,
  });

  const orderedRounds = useMemo(
    () =>
      [...rounds].sort((a, b) => {
        const aEdition = editions.findIndex((e) => e.id === a.edition_id);
        const bEdition = editions.findIndex((e) => e.id === b.edition_id);

        if (aEdition !== bEdition) return aEdition - bEdition;

        return (a.opened_at ?? "").localeCompare(b.opened_at ?? "");
      }),
    [rounds, editions],
  );

  const mode = value.mode;

  return (
    <section className={`glass-strong rounded-2xl p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <CalendarRange className="h-4 w-4 text-primary" />

        <div>
          <p className="text-xs uppercase tracking-widest text-primary">
            Analysis period
          </p>
          <p className="text-xs text-muted-foreground">
            Use one round, one edition, an inclusive edition range, or the
            complete contest history.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Scope</label>

          <Select
            value={mode}
            onValueChange={(next) => {
              if (next === "all_editions") {
                onChange({ mode: "all_editions" });
                return;
              }

              if (next === "edition") {
                const editionId = editions.at(-1)?.id ?? editions[0]?.id ?? "";
                onChange({ mode: "edition", editionId });
                return;
              }

              if (next === "edition_range") {
                const first = editions[0]?.id ?? "";
                const last = editions.at(-1)?.id ?? first;

                onChange({
                  mode: "edition_range",
                  fromEditionId: first,
                  toEditionId: last,
                });
                return;
              }

              const roundId =
                rounds.find((round) => round.status === "open")?.id ??
                rounds[0]?.id ??
                "";

              onChange({ mode: "round", roundId });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="all_editions">All editions</SelectItem>
              <SelectItem value="edition">One edition</SelectItem>
              <SelectItem value="edition_range">Edition range</SelectItem>
              <SelectItem value="round">One round</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === "edition" ? (
          <div className="space-y-1.5 md:col-span-1 xl:col-span-2">
            <label className="text-xs text-muted-foreground">Edition</label>

            <Select
              value={value.editionId}
              onValueChange={(editionId) =>
                onChange({
                  mode: "edition",
                  editionId,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select edition" />
              </SelectTrigger>

              <SelectContent>
                {editions.map((edition) => (
                  <SelectItem key={edition.id} value={edition.id}>
                    {edition.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {mode === "edition_range" ? (
          <>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">From</label>

              <Select
                value={value.fromEditionId}
                onValueChange={(fromEditionId) =>
                  onChange({
                    ...value,
                    fromEditionId,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="First edition" />
                </SelectTrigger>

                <SelectContent>
                  {editions.map((edition) => (
                    <SelectItem key={edition.id} value={edition.id}>
                      {edition.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">To</label>

              <Select
                value={value.toEditionId}
                onValueChange={(toEditionId) =>
                  onChange({
                    ...value,
                    toEditionId,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Last edition" />
                </SelectTrigger>

                <SelectContent>
                  {editions.map((edition) => (
                    <SelectItem key={edition.id} value={edition.id}>
                      {edition.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}

        {mode === "round" ? (
          <div className="space-y-1.5 md:col-span-1 xl:col-span-2">
            <label className="text-xs text-muted-foreground">Round</label>

            <Select
              value={value.roundId}
              onValueChange={(roundId) =>
                onChange({
                  mode: "round",
                  roundId,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select round" />
              </SelectTrigger>

              <SelectContent>
                {orderedRounds.map((round) => (
                  <SelectItem key={round.id} value={round.id}>
                    {round.edition_name
                      ? `${round.edition_name} · `
                      : ""}
                    {round.name}
                    {round.status === "open" ? " · Open" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    </section>
  );
}
