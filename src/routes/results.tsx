import { EmptyState } from "@/components/empty-state";
import { TableSkeleton } from "@/components/panel-skeleton";
import { Trophy } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublicShell } from "@/components/public-shell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CountryFlag, countryName } from "@/components/country-flag";
import { useAllCountries } from "@/hooks/use-round-results";
import { getPublishedResults } from "@/lib/televote.functions";

export const Route = createFileRoute("/results")({
  head: () => ({
    meta: [
      { title: "Televote Results — Solaris Song Contest" },
      {
        name: "description",
        content:
          "Official Solaris Song Contest televote results: original vote totals and converted televote points for the latest published round.",
      },
      { property: "og:title", content: "Televote Results — Solaris Song Contest" },
      {
        property: "og:description",
        content:
          "Original vote totals and converted televote points for the latest published Solaris round.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PublicResultsPage,
});

function PublicResultsPage() {
  const fetchResults = useServerFn(getPublishedResults);
  const { data: countries } = useAllCountries();
  const [mode, setMode] = useState<"original" | "converted" | "side">("side");

  const { data, isLoading } = useQuery({
    queryKey: ["public-published-results"],
    queryFn: async () => await fetchResults({ data: {} }),
    refetchInterval: 15_000,
  });

  const byCode = useMemo(() => {
    const m = new Map<string, any>();
    (countries ?? []).forEach((c) => m.set(c.code, c));
    return m;
  }, [countries]);

  const round = data?.round ?? null;
  const rows = data?.rows ?? [];

  return (
    <PublicShell>
      <div className="space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-primary">Official result</p>
          <h1 className="text-2xl font-semibold">
            {round ? `${round.edition ? round.edition + " — " : ""}${round.name}` : "Televote results"}
          </h1>
          {round && (
            <p className="text-xs text-muted-foreground">
              {round.total_points} televote points distributed · v{round.version} ·{" "}
              {round.calculated_at ? new Date(round.calculated_at).toLocaleString() : ""}
            </p>
          )}
        </header>

        {isLoading && <TableSkeleton rows={8} />}

        {!isLoading && !round && (
          <EmptyState
            icon={Trophy}
            title="No results published yet"
            description="Published televote scoreboards appear here right after the show."
          />
        )}

        {round && (
          <>
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
              <TabsList className="w-full">
                <TabsTrigger className="flex-1" value="original">
                  Original
                </TabsTrigger>
                <TabsTrigger className="flex-1" value="converted">
                  Converted
                </TabsTrigger>
                <TabsTrigger className="flex-1" value="side">
                  Side-by-side
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="glass rounded-3xl p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Country</th>
                    {mode !== "converted" && (
                      <th className="py-2 pr-3 text-right">Original votes</th>
                    )}
                    {mode !== "original" && (
                      <th className="py-2 pr-3 text-right">Televote points</th>
                    )}
                    {round.advanced && mode === "side" && (
                      <>
                        <th className="py-2 pr-3 text-right">Rank factor</th>
                        <th className="py-2 pr-3 text-right">Weighted</th>
                        <th className="py-2 pr-3 text-right">Exact quota</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, i: number) => {
                    const c = byCode.get(r.country_code);
                    return (
                      <tr key={r.country_code} className="border-t border-white/5">
                        <td className="py-2 pr-3 tabular-nums">{i + 1}</td>
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-2">
                            <CountryFlag country={c} size={20} />
                            {countryName(c)}
                          </span>
                        </td>
                        {mode !== "converted" && (
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {r.original_votes}
                          </td>
                        )}
                        {mode !== "original" && (
                          <td className="py-2 pr-3 text-right text-base font-semibold tabular-nums">
                            {r.final_points}
                          </td>
                        )}
                        {round.advanced && mode === "side" && (
                          <>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {Number(r.rank_factor).toFixed(3)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {Number(r.weighted_score).toFixed(2)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {Number(r.exact_points).toFixed(4)}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </PublicShell>
  );
}
