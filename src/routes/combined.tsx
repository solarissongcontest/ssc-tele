import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublicShell } from "@/components/public-shell";
import { CountryFlag, countryName } from "@/components/country-flag";
import { useAllCountries } from "@/hooks/use-round-results";
import {
  listPublishedCombined,
  getPublishedCombined,
} from "@/lib/combined.functions";

export const Route = createFileRoute("/combined")({
  head: () => ({
    meta: [
      { title: "Combined Televote Result — Solaris Song Contest" },
      {
        name: "description",
        content:
          "Official Solaris combined televote: converted televote points, bonus points and the final televote score across every voting source.",
      },
      {
        property: "og:title",
        content: "Combined Televote Result — Solaris Song Contest",
      },
      {
        property: "og:description",
        content:
          "Converted televote points, bonus points and final televote scores for the Solaris Song Contest.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CombinedResultsPage,
});

function CombinedResultsPage() {
  const listFn = useServerFn(listPublishedCombined);
  const getFn = useServerFn(getPublishedCombined);
  const { data: countries } = useAllCountries();
  const [id, setId] = useState<string | undefined>(undefined);

  const list = useQuery({
    queryKey: ["public-combined-list"],
    queryFn: async () => await listFn(),
    refetchInterval: 20_000,
  });
  const data = useQuery({
    queryKey: ["public-combined", id],
    queryFn: async () => await getFn({ data: { id } }),
    refetchInterval: 15_000,
  });

  const byCode = useMemo(() => {
    const m = new Map<string, any>();
    (countries ?? []).forEach((c) => m.set(c.code, c));
    return m;
  }, [countries]);

  const agg = data.data?.aggregation ?? null;
  const rows = data.data?.rows ?? [];
  const cols = agg?.columns;

  return (
    <PublicShell>
      <div className="space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-primary">
            Official result
          </p>
          <h1 className="text-2xl font-semibold">
            {agg ? agg.name : "Combined televote"}
          </h1>
          {agg && (
            <p className="text-xs text-muted-foreground">
              {agg.edition ? agg.edition + " · " : ""}
              {agg.total_points} televote points distributed · v{agg.version}
            </p>
          )}
        </header>

        {(list.data ?? []).length > 1 && (
          <div className="flex flex-wrap justify-center gap-2">
            {(list.data ?? []).map((a: any) => (
              <button
                key={a.id}
                onClick={() => setId(a.id)}
                className={`rounded-full border px-4 py-2 text-xs ${
                  (id ?? (list.data ?? [])[0]?.id) === a.id
                    ? "border-primary/60 text-foreground"
                    : "border-white/10 text-muted-foreground"
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}

        {!agg && !data.isLoading && (
          <div className="glass rounded-3xl p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No combined result has been published yet. Check back after the show.
            </p>
          </div>
        )}

        {agg && (
          <div className="glass rounded-3xl p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Country</th>
                  {cols?.combined_original && (
                    <th className="py-2 pr-3 text-right">Combined original</th>
                  )}
                  {cols?.converted && (
                    <th className="py-2 pr-3 text-right">Televote points</th>
                  )}
                  {cols?.bonus && <th className="py-2 pr-3 text-right">Bonus</th>}
                  {cols?.final && <th className="py-2 pr-3 text-right">Final</th>}
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
                          {countryName(c) || r.country_code}
                        </span>
                      </td>
                      {cols?.combined_original && (
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {Number(r.combined_original_score).toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                        </td>
                      )}
                      {cols?.converted && (
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.converted_points}
                        </td>
                      )}
                      {cols?.bonus && (
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {Number(r.bonus_points)}
                        </td>
                      )}
                      {cols?.final && (
                        <td className="py-2 pr-3 text-right text-base font-semibold tabular-nums">
                          {Number(r.final_televote_score)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
