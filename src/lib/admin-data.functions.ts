// Server-side reads for admin views. Uses supabaseAdmin (service role) to
// bypass RLS after verifying an admin session, so results, analytics and
// the overview refresh reliably without needing Supabase auth on the client.

import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash } from "node:crypto";

type SessionData = { token?: string };

const SESSION_COOKIE_NAME = "solaris-admin";
const SESSION_TTL_SECONDS =
  60 * 60 * 24 * 7;

function sessionConfig() {
  const password =
    process.env.ADMIN_SESSION_SECRET;

  if (!password) {
    throw new Error(
      "ADMIN_SESSION_SECRET is not set",
    );
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
  const session =
    await useSession<SessionData>(
      sessionConfig(),
    );

  const token = session.data.token;

  if (!token) {
    throw new Error(
      "Not authenticated",
    );
  }

  const { supabaseAdmin } =
    await import(
      "@/integrations/supabase/client.server"
    );

  const { data: sess } =
    await supabaseAdmin
      .from("admin_sessions" as any)
      .select("admin_id")
      .eq(
        "token_hash",
        sha256(token),
      )
      .gt(
        "expires_at",
        new Date().toISOString(),
      )
      .maybeSingle();

  if (!sess) {
    throw new Error(
      "Session expired",
    );
  }

  return true;
}

// ============ Round results (submissions + vote entries) ============

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

/**
 * target_country_code is a legacy column name.
 * The value is the stable target entry_key.
 */
export type ResultsEntry = {
  id: string;
  submission_id: string;
  target_country_code: string;
  points: number;
};

export const getRoundResults =
  createServerFn({
    method: "POST",
  })
    .inputValidator(
      (data: {
        roundId: string;
        includeDeleted?: boolean;
      }) => {
        if (!data?.roundId) {
          throw new Error(
            "Missing round",
          );
        }

        return {
          roundId: data.roundId,
          includeDeleted:
            Boolean(
              data.includeDeleted,
            ),
        };
      },
    )
    .handler(
      async ({
        data,
      }): Promise<{
        submissions: ResultsSubmission[];
        entries: ResultsEntry[];
      }> => {
        await requireAdmin();

        const { supabaseAdmin } =
          await import(
            "@/integrations/supabase/client.server"
          );

        let submissionsQuery =
          supabaseAdmin
            .from(
              "vote_submissions" as any,
            )
            .select(
              "id,round_id,username,username_normalized,country_code,created_at,risk_score,status,ip_country,is_vpn",
            )
            .eq(
              "round_id",
              data.roundId,
            )
            .order("created_at", {
              ascending: true,
            });

        if (
          !data.includeDeleted
        ) {
          submissionsQuery =
            submissionsQuery.neq(
              "status",
              "deleted",
            );
        }

        const {
          data: submissionRows,
          error: submissionError,
        } = await submissionsQuery;

        if (submissionError) {
          throw new Error(
            submissionError.message,
          );
        }

        const submissions =
          (submissionRows ??
            []) as unknown as ResultsSubmission[];

        const submissionIds =
          submissions.map(
            (submission) =>
              submission.id,
          );

        let entries: ResultsEntry[] =
          [];

        if (
          submissionIds.length > 0
        ) {
          const {
            data: entryRows,
            error: entryError,
          } = await supabaseAdmin
            .from(
              "vote_entries" as any,
            )
            .select(
              "id,submission_id,target_country_code,points",
            )
            .in(
              "submission_id",
              submissionIds,
            );

          if (entryError) {
            throw new Error(
              entryError.message,
            );
          }

          entries =
            (entryRows ??
              []) as unknown as ResultsEntry[];
        }

        return {
          submissions,
          entries,
        };
      },
    );

// ============ Overview stats ============

export const getOverviewStats =
  createServerFn({
    method: "GET",
  }).handler(async () => {
    await requireAdmin();

    const { supabaseAdmin } =
      await import(
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
        .from(
          "vote_submissions" as any,
        )
        .select("id", {
          count: "exact",
          head: true,
        })
        .neq(
          "status",
          "deleted",
        ),

      supabaseAdmin
        .from(
          "anti_abuse_events" as any,
        )
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
      editions:
        editions.count ?? 0,

      rounds:
        rounds.count ?? 0,

      openRounds:
        openRounds.count ?? 0,

      submissions:
        submissions.count ?? 0,

      blocked:
        events.count ?? 0,

      activeEdition:
        (activeEdition.data as any)
          ?.name ?? null,
    };
  });
