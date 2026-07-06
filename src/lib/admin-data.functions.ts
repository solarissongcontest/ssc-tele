// Server-side reads for admin views. Uses supabaseAdmin (service role) to
// bypass RLS after verifying an admin session, so results, analytics and
// the overview refresh reliably without needing Supabase auth on the client.

import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash } from "node:crypto";

type SessionData = { token?: string };
const SESSION_COOKIE_NAME = "solaris-admin";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function sessionConfig() {
  const password = process.env.ADMIN_SESSION_SECRET;
  if (!password) throw new Error("ADMIN_SESSION_SECRET is not set");
  return {
    password,
    name: SESSION_COOKIE_NAME,
    maxAge: SESSION_TTL_SECONDS,
    cookie: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: true,
      path: "/",
    },
  };
}

function sha256(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

async function requireAdmin() {
  const session = await useSession<SessionData>(sessionConfig());
  const token = session.data.token;
  if (!token) throw new Error("Not authenticated");
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { data: sess } = await supabaseAdmin
    .from("admin_sessions" as any)
    .select("admin_id")
    .eq("token_hash", sha256(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!sess) throw new Error("Session expired");
  return true;
}

// ============ Round results (submissions + entries) ============

export type ResultsSubmission = {
  id: string;
  round_id: string;
  username: string;
  username_normalized: string;
  country_code: string;
  created_at: string;
  risk_score: number;
  status: string;
  ip_country: string | null;
  is_vpn: boolean;
};

export type ResultsEntry = {
  id: string;
  submission_id: string;
  target_country_code: string;
  points: number;
};

export const getRoundResults = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { roundId: string; includeDeleted?: boolean }) => {
      if (!data?.roundId) throw new Error("Missing round");
      return { roundId: data.roundId, includeDeleted: !!data.includeDeleted };
    },
  )
  .handler(
    async ({
      data,
    }): Promise<{
      submissions: ResultsSubmission[];
      entries: ResultsEntry[];
      roundCountries: { country_code: string; display_order: number }[];
    }> => {
      await requireAdmin();
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      let sq = supabaseAdmin
        .from("vote_submissions" as any)
        .select(
          "id, round_id, username, username_normalized, country_code, created_at, risk_score, status, ip_country, is_vpn",
        )
        .eq("round_id", data.roundId)
        .order("created_at", { ascending: true });
      if (!data.includeDeleted) sq = sq.neq("status", "deleted");
      const { data: subs, error: e1 } = await sq;
      if (e1) throw new Error(e1.message);
      const submissions = (subs ?? []) as unknown as ResultsSubmission[];
      const ids = submissions.map((s) => s.id);
      let entries: ResultsEntry[] = [];
      if (ids.length > 0) {
        const { data: ents, error: e2 } = await supabaseAdmin
          .from("vote_entries" as any)
          .select("id, submission_id, target_country_code, points")
          .in("submission_id", ids);
        if (e2) throw new Error(e2.message);
        entries = (ents ?? []) as unknown as ResultsEntry[];
      }
      const { data: rc } = await supabaseAdmin
        .from("round_countries" as any)
        .select("country_code, display_order")
        .eq("round_id", data.roundId)
        .order("display_order");
      return {
        submissions,
        entries,
        roundCountries: (rc ?? []) as {
          country_code: string;
          display_order: number;
        }[],
      };
    },
  );

// ============ Overview stats ============

export const getOverviewStats = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const [ed, rd, op, sub, ev, act] = await Promise.all([
      supabaseAdmin
        .from("editions" as any)
        .select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("rounds" as any)
        .select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("rounds" as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      supabaseAdmin
        .from("vote_submissions" as any)
        .select("id", { count: "exact", head: true })
        .neq("status", "deleted"),
      supabaseAdmin
        .from("anti_abuse_events" as any)
        .select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("editions" as any)
        .select("name")
        .eq("is_active", true)
        .maybeSingle(),
    ]);
    return {
      editions: ed.count ?? 0,
      rounds: rd.count ?? 0,
      openRounds: op.count ?? 0,
      submissions: sub.count ?? 0,
      blocked: ev.count ?? 0,
      activeEdition: (act.data as any)?.name ?? null,
    };
  },
);
