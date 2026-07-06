import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Vote, Loader2 } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { VotingBooth } from "@/components/voting-booth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Solaris Song Contest 21 — Televote" },
      { name: "description", content: "Cast your votes in the Solaris Song Contest televote." },
      { property: "og:title", content: "Solaris Song Contest 21 — Televote" },
      { property: "og:description", content: "Cast your televote in the official Solaris contest." },
    ],
  }),
  component: PublicHome,
});

type OpenRound = {
  id: string;
  name: string;
  edition: { name: string } | null;
  countries: {
    display_order: number;
    country: { code: string; name: string; flag: string; flag_url: string | null };
  }[];
};

function PublicHome() {
  const { data, isLoading } = useQuery({
    queryKey: ["public-open-round"],
    queryFn: async (): Promise<OpenRound | null> => {
      const { data: round, error } = await supabase
        .from("rounds")
        .select("id,name,editions(name)")
        .eq("status", "open")
        .maybeSingle();
      if (error) throw error;
      if (!round) return null;

      const { data: rc, error: rcErr } = await supabase
        .from("round_countries")
        .select("display_order, countries(code,name,flag,flag_url)")
        .eq("round_id", round.id)
        .order("display_order");
      if (rcErr) throw rcErr;

      return {
        id: round.id,
        name: round.name,
        edition: (round as any).editions ?? null,
        countries: (rc ?? []).map((r: any) => ({
          display_order: r.display_order,
          country: r.countries,
        })),
      };
    },
    refetchOnWindowFocus: true,
  });

  return (
    <PublicShell>
      <section className="relative text-center pt-6 pb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs uppercase tracking-widest bg-card border border-border text-muted-foreground mb-5">
          <Sparkles className="h-3 w-3 text-primary" />
          #GETTINGHIGH
        </div>
        <h1 className="text-4xl sm:text-6xl font-black tracking-tight">
          <span className="text-gradient">Solaris</span>
          <br />
          <span className="text-foreground">Televote</span>
        </h1>
        <p className="mt-4 text-muted-foreground max-w-md mx-auto text-sm sm:text-base">
          Your voice decides who shines on the Solaris stage. Distribute your 20 votes across the
          competing nations.
        </p>
      </section>

      {isLoading ? (
        <div className="glass-strong rounded-2xl p-10 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : !data ? (
        <ClosedCard />
      ) : data.countries.length === 0 ? (
        <EmptyRoundCard roundName={data.name} />
      ) : (
        <OpenRoundView round={data} />
      )}
    </PublicShell>
  );
}

function ClosedCard() {
  return (
    <section className="glass-strong rounded-2xl p-8 sm:p-12 text-center space-y-4">
      <div className="mx-auto h-14 w-14 rounded-2xl bg-hero grid place-items-center shadow-glow">
        <Vote className="h-7 w-7 text-primary-foreground" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold">Voting is currently closed</h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        The televote booth opens when a round goes live. Check back here when the next show starts.
      </p>
    </section>
  );
}

function EmptyRoundCard({ roundName }: { roundName: string }) {
  return (
    <section className="glass-strong rounded-2xl p-8 sm:p-12 text-center space-y-4">
      <div className="mx-auto h-14 w-14 rounded-2xl bg-hero grid place-items-center shadow-glow">
        <Vote className="h-7 w-7 text-primary-foreground" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold">{roundName}</h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        This round has no countries configured yet. Please check back shortly.
      </p>
    </section>
  );
}

function OpenRoundView({ round }: { round: OpenRound }) {
  return (
    <VotingBooth
      roundId={round.id}
      roundName={round.name}
      editionName={round.edition?.name ?? null}
      countries={round.countries}
    />
  );
}
