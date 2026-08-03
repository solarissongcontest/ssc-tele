import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Trophy } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { EmptyState } from "@/components/empty-state";
import { TableSkeleton } from "@/components/panel-skeleton";
import { CountryFlag, countryName } from "@/components/country-flag";
import { useAllCountries } from "@/hooks/use-round-results";
import { getPublicEdition } from "@/lib/archive.functions";

export const Route = createFileRoute("/editions/$editionId")({
  head: () => ({
    meta: [
      { title: "Edition Results — Solaris Song Contest Televote" },
      {
        name: "description",
        content:
          "Published televote scoreboards for every round of this Solaris Song Contest edition.",
      },
      { property: "og:title", content: "Edition Results — Solaris Song Contest" },
      {
        property: "og:description",
        content: "Round-by-round published televote scoreboards for this Solaris edition.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditionArchivePage,
});

function EditionArchivePage() {
  const { editionId } = Route.useParams();
  const getFn = useServerFn(getPublicEdition);
  const { data: countries } = useAllCountries();

  const { data, isLoading } = useQuery({
    queryKey: ["public-edition", editionId],
    queryFn: async () => await getFn({ data: { editionId } }),
  });

  const byCode = useMemo(() => {
    const m = new Map<string, any>();
    (countries ?? []).forEach((c) => m.set(c.code, c));
    return m;
  }, [countries]);

  const rounds = data?.rounds ?? [];

  return (
    <PublicShell>
      <div className="space-y-6">
        <Link
          to="/editions"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All editions
        </Link>

        <header className="text-center space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-primary">Archive</p>
          <h1 className="text-2xl sm:text-3xl font-bold">
            {data?.edition?.name ?? "Edition"}
          </h1>
        </header>

        {isLoading && <TableSkeleton rows={8} />}

        {!isLoading && rounds.length === 0 && (
          <EmptyState
            icon={Trophy}
            title="Nothing published for this edition"
            description="Results appear here as soon as the organizers publish a round."
          />
        )}

        {rounds.map((r) => (
          <section key={r.id} className="glass rounded-3xl p-4 sm:p-5 space-y-3">
            <header className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold truncate">{r.name}</h2>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {r.total_points ? `${r.total_points} pts` : ""}
                {r.closed_at
                  ? ` · ${new Date(r.closed_at).toLocaleDateString()}`
                  : ""}
              </span>
            </header>
            <ol className="space-y-1.5">
              {r.rows.map((row, i) => {
                const c = byCode.get(row.country_code);
                return (
                  <li
                    key={row.country_code}
                    className="flex items-center gap-3 px-3 py-2 rounded-2xl bg-white/5"
                  >
                    <span className="w-6 text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <CountryFlag country={c} size={24} />
                    <span className="flex-1 text-sm truncate">
                      {countryName(c) || row.country_code}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {row.original_votes} votes
                    </span>
                    <span className="font-bold tabular-nums text-primary w-10 text-right">
                      {row.final_points}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </PublicShell>
  );
}
