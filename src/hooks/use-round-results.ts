import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { getRoundResults } from "@/lib/admin-data.functions";
import {
  resolveEntry,
  sortEntries,
  type CountryRecord,
  type ParticipantMode,
  type ResolvedEntry,
  type RoundEntry,
  type SelfVotingMode,
} from "@/lib/round-entries";

export type Country = {
  code: string;
  name: string;
  flag: string;
  flag_url: string | null;
};

export type Submission = {
  id: string;
  round_id: string;
  username: string;
  username_normalized: string;
  country_code: string;
  created_at: string;
  risk_score: number;
  status?: string;
  ip_country?: string | null;
  is_vpn?: boolean;
};

/**
 * target_country_code is a legacy database column name.
 * Its value is now the stable round entry_key.
 */
export type Entry = {
  id: string;
  submission_id: string;
  target_country_code: string;
  points: number;
};

export type RoundOption = {
  id: string;
  name: string;
  status: "draft" | "open" | "closed";
  edition_id: string;
  opened_at: string | null;
  closed_at: string | null;
  edition_name?: string | null;
  participant_mode: ParticipantMode;
  self_voting_mode: SelfVotingMode;
};

export function useAllRounds() {
  return useQuery({
    queryKey: ["all-rounds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rounds")
        .select(
          "id,name,status,edition_id,opened_at,closed_at,participant_mode,self_voting_mode,editions(name)",
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((row: any) => ({
        ...row,
        edition_name: row.editions?.name ?? null,
        participant_mode: row.participant_mode ?? "countries",
        self_voting_mode: row.self_voting_mode ?? "country_match",
      })) as RoundOption[];
    },
  });
}

export function useAllCountries() {
  return useQuery({
    queryKey: ["countries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("countries")
        .select("code,name,flag,flag_url")
        .order("name");

      if (error) throw error;

      return data as Country[];
    },
    staleTime: 60_000,
  });
}

/**
 * Resolve the configured line-up for a round.
 *
 * Country entries get their country metadata attached; custom entries keep
 * their own name/code/image fields. Every consumer should use entry_key as
 * the stable result/vote identity.
 */
export function useRoundEntries(roundId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["round-entries-resolved", roundId],
    queryFn: async (): Promise<ResolvedEntry[]> => {
      if (!roundId) return [];

      const { data: rows, error: entryError } = await supabase
        .from("round_entries" as any)
        .select(
          "id,round_id,entry_type,entry_key,country_code,custom_name,short_name,entry_code,subtitle,image_url,description,display_order",
        )
        .eq("round_id", roundId)
        .order("display_order");

      if (entryError) throw entryError;

      const rawEntries = (rows ?? []) as unknown as RoundEntry[];

      const countryCodes = Array.from(
        new Set(
          rawEntries
            .map((entry) => entry.country_code)
            .filter((code): code is string => Boolean(code)),
        ),
      );

      const countries = new Map<string, CountryRecord>();

      if (countryCodes.length > 0) {
        const { data: countryRows, error: countryError } = await supabase
          .from("countries")
          .select("code,name,flag,flag_url")
          .in("code", countryCodes);

        if (countryError) throw countryError;

        for (const country of countryRows ?? []) {
          countries.set(country.code, country);
        }
      }

      return sortEntries(
        rawEntries.map((entry) => resolveEntry(entry, countries)),
      );
    },
    enabled: Boolean(roundId),
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!roundId) return;

    const channel = supabase
      .channel(`round-entries-${roundId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "round_entries",
          filter: `round_id=eq.${roundId}`,
        },
        () => {
          void qc.invalidateQueries({
            queryKey: ["round-entries-resolved", roundId],
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roundId, qc]);

  return query;
}

export function useRoundResults(
  roundId: string | null,
  includeDeleted = false,
) {
  const qc = useQueryClient();
  const fetchResults = useServerFn(getRoundResults);
  const resolvedEntries = useRoundEntries(roundId);

  const bundle = useQuery({
    queryKey: ["round-results", roundId, includeDeleted],
    queryFn: async () => {
      if (!roundId) return null;

      return (await fetchResults({
        data: { roundId, includeDeleted },
      })) as {
        submissions: Submission[];
        entries: Entry[];
      };
    },
    enabled: Boolean(roundId),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!roundId) return;

    const channel = supabase
      .channel(`round-status-${roundId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rounds",
          filter: `id=eq.${roundId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["all-rounds"] });
          void qc.invalidateQueries({
            queryKey: ["round-results", roundId],
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roundId, qc]);

  return {
    subs: {
      data: bundle.data?.submissions ?? [],
      isLoading: bundle.isLoading,
    },
    entries: {
      data: bundle.data?.entries ?? [],
      isLoading: bundle.isLoading,
    },

    roundEntries: {
      data: resolvedEntries.data ?? [],
      isLoading: resolvedEntries.isLoading,
    },

    // Compatibility only. This is derived from round_entries and never reads
    // the legacy round_countries table.
    roundCountries: {
      data: (resolvedEntries.data ?? [])
        .filter((entry) => entry.entry_type === "country" && entry.country_code)
        .map((entry) => ({
          country_code: entry.country_code as string,
          display_order: entry.display_order,
        })),
      isLoading: resolvedEntries.isLoading,
    },

    refetch: bundle.refetch,
    isLoading: bundle.isLoading,
  };
}
