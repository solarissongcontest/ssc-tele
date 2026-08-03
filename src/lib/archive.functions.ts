// Public archive endpoints. These are intentionally unauthenticated, and
// therefore only ever expose rounds whose results_status is 'published'.
import { createServerFn } from "@tanstack/react-start";

export type ArchiveEdition = {
  id: string;
  name: string;
  is_active: boolean;
  is_archived: boolean;
  published_rounds: number;
};

/** Every edition that has at least one published round. */
export const listPublicEditions = createServerFn({ method: "POST" }).handler(
  async (): Promise<ArchiveEdition[]> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: rounds, error } = await supabaseAdmin
      .from("rounds")
      .select("edition_id")
      .eq("results_status", "published");
    if (error) throw new Error(error.message);

    const counts = new Map<string, number>();
    (rounds ?? []).forEach((r: any) => {
      counts.set(r.edition_id, (counts.get(r.edition_id) ?? 0) + 1);
    });
    const ids = [...counts.keys()];
    if (ids.length === 0) return [];

    const { data: editions, error: edErr } = await supabaseAdmin
      .from("editions")
      .select("id,name,is_active,is_archived,created_at")
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (edErr) throw new Error(edErr.message);

    return (editions ?? []).map((e: any) => ({
      id: e.id,
      name: e.name,
      is_active: !!e.is_active,
      is_archived: !!e.is_archived,
      published_rounds: counts.get(e.id) ?? 0,
    }));
  },
);

export type ArchiveRow = {
  country_code: string;
  original_votes: number;
  final_points: number;
};

export type ArchiveRound = {
  id: string;
  name: string;
  closed_at: string | null;
  total_points: number | null;
  rows: ArchiveRow[];
};

/** One edition plus every published round scoreboard inside it. */
export const getPublicEdition = createServerFn({ method: "POST" })
  .inputValidator((data: { editionId: string }) => {
    if (!data?.editionId) throw new Error("Missing edition");
    return { editionId: data.editionId };
  })
  .handler(
    async ({
      data,
    }): Promise<{ edition: { id: string; name: string } | null; rounds: ArchiveRound[] }> => {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );

      const { data: edition } = await supabaseAdmin
        .from("editions")
        .select("id,name")
        .eq("id", data.editionId)
        .maybeSingle();
      if (!edition) return { edition: null, rounds: [] };

      const { data: rounds } = await supabaseAdmin
        .from("rounds")
        .select("id,name,closed_at,total_points_to_distribute")
        .eq("edition_id", data.editionId)
        .eq("results_status", "published")
        .order("closed_at", { ascending: true });

      const roundIds = (rounds ?? []).map((r: any) => r.id);
      let resultsByRound = new Map<string, ArchiveRow[]>();
      if (roundIds.length > 0) {
        const { data: results } = await supabaseAdmin
          .from("round_results" as any)
          .select("round_id,country_code,original_votes,final_points")
          .in("round_id", roundIds)
          .order("final_points", { ascending: false });
        ((results ?? []) as any[]).forEach((r) => {
          const list = resultsByRound.get(r.round_id) ?? [];
          list.push({
            country_code: r.country_code,
            original_votes: r.original_votes,
            final_points: r.final_points,
          });
          resultsByRound.set(r.round_id, list);
        });
      }

      return {
        edition: { id: (edition as any).id, name: (edition as any).name },
        rounds: (rounds ?? []).map((r: any) => ({
          id: r.id,
          name: r.name,
          closed_at: r.closed_at,
          total_points: r.total_points_to_distribute,
          rows: resultsByRound.get(r.id) ?? [],
        })),
      };
    },
  );
