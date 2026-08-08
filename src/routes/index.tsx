import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Vote } from "lucide-react";

import { PanelSkeleton, TableSkeleton } from "@/components/panel-skeleton";
import { PublicShell } from "@/components/public-shell";
import { VotingBooth } from "@/components/voting-booth";
import { supabase } from "@/integrations/supabase/client";

import {
  resolveEntry,
  type CountryRecord,
  type ResolvedEntry,
} from "@/lib/round-entries";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "Solaris Song Contest — Televote",
      },
      {
        name: "description",
        content: "Cast your votes in the Solaris Song Contest televote.",
      },
      {
        property: "og:title",
        content: "Solaris Song Contest — Televote",
      },
      {
        property: "og:description",
        content: "Cast your televote in the official Solaris contest.",
      },
    ],
  }),
  component: PublicHome,
});

type OpenRound = {
  id: string;
  name: string;

  edition: {
    name: string;
  } | null;

  participantMode: "countries" | "custom" | "mixed";

  selfVotingMode:
    | "country_match"
    | "linked_identity"
    | "disabled"
    | "unrestricted";

  entries: ResolvedEntry[];
};

function PublicHome() {
  const queryClient = useQueryClient();

  const {
    data: round,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["public-open-round"],

    queryFn: async (): Promise<OpenRound | null> => {
      const { data: roundRow, error: roundError } = await supabase
        .from("rounds")
        .select(
          `
            id,
            name,
            participant_mode,
            self_voting_mode,
            editions(name)
          `,
        )
        .eq("status", "open")
        .maybeSingle();

      if (roundError) {
        throw roundError;
      }

      if (!roundRow) {
        return null;
      }

      const { data: entryRows, error: entriesError } = await supabase
        .from("round_entries" as any)
        .select(
          `
            id,
            round_id,
            entry_type,
            entry_key,
            country_code,
            custom_name,
            short_name,
            entry_code,
            subtitle,
            image_url,
            description,
            display_order
          `,
        )
        .eq("round_id", roundRow.id)
        .order("display_order", {
          ascending: true,
        });

      if (entriesError) {
        throw entriesError;
      }

      const countryCodes = Array.from(
        new Set(
          (entryRows ?? [])
            .map((entry: any) => entry.country_code as string | null)
            .filter((code): code is string => Boolean(code)),
        ),
      );

      const countryMap = new Map<string, CountryRecord>();

      if (countryCodes.length > 0) {
        const { data: countryRows, error: countriesError } = await supabase
          .from("countries")
          .select("code,name,flag,flag_url")
          .in("code", countryCodes);

        if (countriesError) {
          throw countriesError;
        }

        for (const country of countryRows ?? []) {
          countryMap.set(country.code, {
            code: country.code,
            name: country.name,
            flag: country.flag,
            flag_url: country.flag_url,
          });
        }
      }

      const entries: ResolvedEntry[] = (entryRows ?? []).map((entry: any) =>
        resolveEntry(
          {
            id: entry.id,
            round_id: entry.round_id,
            entry_type: entry.entry_type,
            entry_key: entry.entry_key,
            country_code: entry.country_code,
            custom_name: entry.custom_name,
            short_name: entry.short_name,
            entry_code: entry.entry_code,
            subtitle: entry.subtitle,
            image_url: entry.image_url,
            description: entry.description,
            display_order: entry.display_order,
          },
          countryMap,
        ),
      );

      return {
        id: roundRow.id,
        name: roundRow.name,
        edition: (roundRow as any).editions ?? null,
        participantMode:
          ((roundRow as any).participant_mode as
            | "countries"
            | "custom"
            | "mixed") ?? "countries",
        selfVotingMode:
          ((roundRow as any).self_voting_mode as
            | "country_match"
            | "linked_identity"
            | "disabled"
            | "unrestricted") ?? "country_match",
        entries,
      };
    },

    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const invalidateOpenRound = () => {
      void queryClient.invalidateQueries({
        queryKey: ["public-open-round"],
      });
    };

    const channel = supabase
      .channel("public-open-round")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rounds",
        },
        invalidateOpenRound,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "round_entries",
        },
        invalidateOpenRound,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "round_countries",
        },
        invalidateOpenRound,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <PublicShell>
      <section className="relative pt-6 pb-10 text-center animate-fade-in">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />

          #GETTINGHIGH
        </div>

        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
          <span className="text-gradient">Solaris</span>

          <br />

          <span className="text-foreground">Televote</span>
        </h1>

        <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground sm:text-base">
          Your voice decides who shines on the Solaris stage. Distribute your
          points across the competing entries.
        </p>
      </section>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorCard error={error} />
      ) : !round ? (
        <ClosedCard />
      ) : round.entries.length === 0 ? (
        <EmptyRoundCard roundName={round.name} />
      ) : (
        <OpenRoundView round={round} />
      )}
    </PublicShell>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <PanelSkeleton lines={2} />

      <TableSkeleton rows={6} />
    </div>
  );
}

function ClosedCard() {
  return (
    <section className="glass-strong space-y-4 rounded-2xl p-8 text-center sm:p-12">
      <div className="bg-hero shadow-glow mx-auto grid h-14 w-14 place-items-center rounded-2xl">
        <Vote className="h-7 w-7 text-primary-foreground" />
      </div>

      <h2 className="text-xl font-bold sm:text-2xl">
        Voting is currently closed
      </h2>

      <p className="mx-auto max-w-sm text-sm text-muted-foreground">
        The televote booth opens when a round goes live. Check back when the
        next voting round starts.
      </p>
    </section>
  );
}

function EmptyRoundCard({
  roundName,
}: {
  roundName: string;
}) {
  return (
    <section className="glass-strong space-y-4 rounded-2xl p-8 text-center sm:p-12">
      <div className="bg-hero shadow-glow mx-auto grid h-14 w-14 place-items-center rounded-2xl">
        <Vote className="h-7 w-7 text-primary-foreground" />
      </div>

      <h2 className="text-xl font-bold sm:text-2xl">{roundName}</h2>

      <p className="mx-auto max-w-sm text-sm text-muted-foreground">
        This round has no voting entries configured yet. Please check back
        shortly.
      </p>
    </section>
  );
}

function ErrorCard({
  error,
}: {
  error: unknown;
}) {
  const message =
    error instanceof Error
      ? error.message
      : "The voting round could not be loaded.";

  return (
    <section className="glass-strong space-y-4 rounded-2xl p-8 text-center sm:p-12">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-destructive/15">
        <Vote className="h-7 w-7 text-destructive" />
      </div>

      <h2 className="text-xl font-bold sm:text-2xl">
        Voting could not be loaded
      </h2>

      <p className="mx-auto max-w-lg text-sm text-muted-foreground">
        {message}
      </p>
    </section>
  );
}

function OpenRoundView({
  round,
}: {
  round: OpenRound;
}) {
  return (
    <VotingBooth
      roundId={round.id}
      roundName={round.name}
      editionName={round.edition?.name ?? null}
      entries={round.entries}
      selfVotingMode={round.selfVotingMode}
    />
  );
}
