import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, ChevronRight } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { EmptyState } from "@/components/empty-state";
import { PanelSkeleton } from "@/components/panel-skeleton";
import { listPublicEditions } from "@/lib/archive.functions";

export const Route = createFileRoute("/editions")({
  head: () => ({
    meta: [
      { title: "Contest Archive — Solaris Song Contest Televote" },
      {
        name: "description",
        content:
          "Browse every Solaris Song Contest edition with published televote results, semi-final by semi-final.",
      },
      { property: "og:title", content: "Contest Archive — Solaris Song Contest" },
      {
        property: "og:description",
        content: "Every Solaris edition with published televote scoreboards.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/editions" }],
  }),
  component: EditionsArchive,
});

function EditionsArchive() {
  const listFn = useServerFn(listPublicEditions);
  const { data, isLoading } = useQuery({
    queryKey: ["public-editions"],
    queryFn: async () => await listFn(),
    refetchInterval: 60_000,
  });

  return (
    <PublicShell>
      <div className="space-y-6">
        <header className="text-center space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-primary">Archive</p>
          <h1 className="text-2xl sm:text-3xl font-bold">Contest editions</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Every Solaris edition with published televote results.
          </p>
        </header>

        {isLoading && <PanelSkeleton lines={3} />}

        {!isLoading && (data ?? []).length === 0 && (
          <EmptyState
            icon={Archive}
            title="No published editions yet"
            description="Once a round's televote result is published, its edition appears here."
          />
        )}

        <ul className="space-y-3">
          {(data ?? []).map((e, i) => (
            <li
              key={e.id}
              className="animate-fade-in"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <Link
                to="/editions/$editionId"
                params={{ editionId: e.id }}
                className="glass rounded-3xl px-5 py-4 flex items-center gap-4 hover:ring-1 hover:ring-primary/40 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.published_rounds} published{" "}
                    {e.published_rounds === 1 ? "round" : "rounds"}
                    {e.is_active ? " · currently running" : ""}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </PublicShell>
  );
}
