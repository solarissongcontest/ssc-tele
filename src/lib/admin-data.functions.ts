// Server-side reads for admin views. Uses supabaseAdmin (service role) to
// bypass public RLS after verifying the custom Solaris admin session.

import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

type SessionData = { token?: string };

const SESSION_COOKIE_NAME = "solaris-admin";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function sessionConfig() {
  const password = process.env.ADMIN_SESSION_SECRET;

  if (!password) {
    throw new Error("ADMIN_SESSION_SECRET is not set");
  }

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

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

async function requireAdmin() {
  const session = await useSession<SessionData>(sessionConfig());
  const token = session.data.token;

  if (!token) {
    throw new Error("Not authenticated");
  }

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const { data: sessionRow, error: sessionError } = await supabaseAdmin
    .from("admin_sessions" as any)
    .select("admin_id")
    .eq("token_hash", sha256(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (!sessionRow) {
    throw new Error("Session expired");
  }

  const { data: adminRow, error: adminError } = await supabaseAdmin
    .from("admin_accounts" as any)
    .select("id,disabled")
    .eq("id", (sessionRow as any).admin_id)
    .maybeSingle();

  if (adminError) {
    throw new Error(adminError.message);
  }

  if (!adminRow || (adminRow as any).disabled) {
    throw new Error("Admin account is unavailable");
  }

  return true;
}

export type ResultsSubmission = {
  id: string;
  round_id: string;
  username: string;
  username_normalized: string;
  country_code: string;
  created_at: string;
  risk_score: number;
  status: string | null;
  ip_country: string | null;
  is_vpn: boolean | null;
};

/**
 * target_country_code is a legacy database column name.
 * Its value is semantically the stable target entry_key.
 */
export type ResultsEntry = {
  id: string;
  submission_id: string;
  target_country_code: string;
  points: number;
};

export const getRoundResults = createServerFn({
  method: "POST",
})
  .inputValidator(
    (data: {
      roundId: string;
      includeDeleted?: boolean;
    }) => {
      if (!data?.roundId) {
        throw new Error("Missing round");
      }

      return {
        roundId: data.roundId,
        includeDeleted: Boolean(data.includeDeleted),
      };
    },
  )
  .handler(async ({ data }): Promise<{
    submissions: ResultsSubmission[];
    entries: ResultsEntry[];
  }> => {
    await requireAdmin();

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    let submissionsQuery = supabaseAdmin
      .from("vote_submissions" as any)
      .select(
        "id,round_id,username,username_normalized,country_code,created_at,risk_score,status,ip_country,is_vpn",
      )
      .eq("round_id", data.roundId)
      .order("created_at", { ascending: true });

    /*
     * Older ballots can have status = NULL. SQL `status <> 'deleted'` does
     * NOT include NULL rows, which made perfectly valid historical ballots
     * disappear from the admin results page. Treat NULL as active.
     */
    if (!data.includeDeleted) {
      submissionsQuery = submissionsQuery.or(
        "status.is.null,status.neq.deleted",
      );
    }

    const {
      data: submissionRows,
      error: submissionError,
    } = await submissionsQuery;

    if (submissionError) {
      throw new Error(
        `Could not load vote submissions: ${submissionError.message}`,
      );
    }

    const submissions = (submissionRows ?? []).map((row: any) => ({
      id: String(row.id),
      round_id: String(row.round_id),
      username: String(row.username ?? ""),
      username_normalized: String(
        row.username_normalized ?? row.username ?? "",
      ),
      country_code: String(row.country_code ?? ""),
      created_at: String(row.created_at ?? ""),
      risk_score: Number(row.risk_score ?? 0),
      status: row.status ?? null,
      ip_country: row.ip_country ?? null,
      is_vpn: row.is_vpn ?? null,
    })) as ResultsSubmission[];

    const submissionIds = submissions.map((submission) => submission.id);

    if (submissionIds.length === 0) {
      return {
        submissions,
        entries: [],
      };
    }

    /*
     * Keep batches modest so a round with many ballots cannot create an
     * absurdly long PostgREST URL for `.in(submission_id, ...)`.
     */
    const entries: ResultsEntry[] = [];
    const batchSize = 250;

    for (let index = 0; index < submissionIds.length; index += batchSize) {
      const batch = submissionIds.slice(index, index + batchSize);

      const {
        data: entryRows,
        error: entryError,
      } = await supabaseAdmin
        .from("vote_entries" as any)
        .select("id,submission_id,target_country_code,points")
        .in("submission_id", batch);

      if (entryError) {
        throw new Error(
          `Could not load ballot entries: ${entryError.message}`,
        );
      }

      for (const row of entryRows ?? []) {
        entries.push({
          id: String((row as any).id),
          submission_id: String((row as any).submission_id),
          // Legacy DB name, stable generic entry_key value.
          target_country_code: String(
            (row as any).target_country_code ?? "",
          ),
          points: Number((row as any).points ?? 0),
        });
      }
    }

    return {
      submissions,
      entries,
    };
  });

// ============ Overview stats ============

export const getOverviewStats = createServerFn({
  method: "GET",
}).handler(async () => {
  await requireAdmin();

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const [
    editions,
    rounds,
    openRounds,
    submissions,
    events,
    activeEdition,
  ] = await Promise.all([
    supabaseAdmin
      .from("editions" as any)
      .select("id", {
        count: "exact",
        head: true,
      }),

    supabaseAdmin
      .from("rounds" as any)
      .select("id", {
        count: "exact",
        head: true,
      }),

    supabaseAdmin
      .from("rounds" as any)
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("status", "open"),

    supabaseAdmin
      .from("vote_submissions" as any)
      .select("id", {
        count: "exact",
        head: true,
      })
      .or("status.is.null,status.neq.deleted"),

    supabaseAdmin
      .from("anti_abuse_events" as any)
      .select("id", {
        count: "exact",
        head: true,
      }),

    supabaseAdmin
      .from("editions" as any)
      .select("name")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  return {
    editions: editions.count ?? 0,
    rounds: rounds.count ?? 0,
    openRounds: openRounds.count ?? 0,
    submissions: submissions.count ?? 0,
    blocked: events.count ?? 0,
    activeEdition: (activeEdition.data as any)?.name ?? null,
  };
});
