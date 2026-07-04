import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

export function useRoundResults(roundId: string | null) {
  const qc = useQueryClient();

  const subs = useQuery({
    queryKey: ["results.subs", roundId],
    queryFn: async () => {
      if (!roundId) return [];
      const { data, error } = await supabase
        .from("vote_submissions")
        .select("*")
        .eq("round_id", roundId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Submission[];
    },
    enabled: !!roundId,
  });

  const subIds = (subs.data ?? []).map((s) => s.id);

  const entries = useQuery({
    queryKey: ["results.entries", roundId, subIds.length],
    queryFn: async () => {
      if (subIds.length === 0) return [];
      const { data, error } = await supabase
        .from("vote_entries")
        .select("*")
        .in("submission_id", subIds);
      if (error) throw error;
      return data as Entry[];
    },
    enabled: subIds.length > 0,
  });

  const roundCountries = useQuery({
    queryKey: ["results.round_countries", roundId],
    queryFn: async () => {
      if (!roundId) return [];
      const { data, error } = await supabase
        .from("round_countries")
        .select("country_code,display_order")
        .eq("round_id", roundId)
        .order("display_order");
      if (error) throw error;
      return data as { country_code: string; display_order: number }[];
    },
    enabled: !!roundId,
  });

  // Realtime: invalidate on any vote insert for this round
  useEffect(() => {
    if (!roundId) return;
    const channel = supabase
      .channel(`results-${roundId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vote_submissions", filter: `round_id=eq.${roundId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["results.subs", roundId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vote_entries" },
        () => {
          qc.invalidateQueries({ queryKey: ["results.entries", roundId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roundId, qc]);

  return { subs, entries, roundCountries };
}
