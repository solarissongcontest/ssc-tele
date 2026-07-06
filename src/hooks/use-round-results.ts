import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getRoundResults } from "@/lib/admin-data.functions";

export type Country = { code: string; name: string; flag: string; flag_url: string | null };

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
};

export function useAllRounds() {
  return useQuery({
    queryKey: ["all-rounds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rounds")
        .select("id,name,status,edition_id,opened_at,closed_at,editions(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        edition_name: r.editions?.name ?? null,
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

export function useRoundResults(roundId: string | null, includeDeleted = false) {
  const qc = useQueryClient();
  const fetchResults = useServerFn(getRoundResults);

  const bundle = useQuery({
    queryKey: ["round-results", roundId, includeDeleted],
    queryFn: async () => {
      if (!roundId) return null;
      return (await fetchResults({
        data: { roundId, includeDeleted },
      })) as {
        submissions: Submission[];
        entries: Entry[];
        roundCountries: { country_code: string; display_order: number }[];
      };
    },
    enabled: !!roundId,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  // Also invalidate on any realtime signal for the round (rounds table updates
  // e.g. status flips, so admins see the round move to closed instantly).
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
          qc.invalidateQueries({ queryKey: ["all-rounds"] });
          qc.invalidateQueries({ queryKey: ["round-results", roundId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roundId, qc]);

  // Compatibility shims so existing consumers using `subs`, `entries`,
  // `roundCountries` keep working.
  return {
    subs: {
      data: bundle.data?.submissions ?? [],
      isLoading: bundle.isLoading,
    },
    entries: {
      data: bundle.data?.entries ?? [],
      isLoading: bundle.isLoading,
    },
    roundCountries: {
      data: bundle.data?.roundCountries ?? [],
      isLoading: bundle.isLoading,
    },
    refetch: bundle.refetch,
    isLoading: bundle.isLoading,
  };
}
