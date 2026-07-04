// Moderation server functions. All actions are admin-gated (custom
// admin_sessions cookie) and audit-logged.
//
// Reads and writes go through the service-role Supabase client so we don't
// need to mirror admin identity into RLS on the vote tables.

import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  useSession,
  getRequestIP,
} from "@tanstack/react-start/server";
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

type Actor = { id: string; username: string; is_super_admin: boolean };

async function requireAdmin(): Promise<Actor> {
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
  const { data: admin } = await supabaseAdmin
    .from("admin_accounts" as any)
    .select("id, username, is_super_admin, disabled")
    .eq("id", (sess as any).admin_id)
    .maybeSingle();
  if (!admin || (admin as any).disabled) throw new Error("Not authenticated");
  return {
    id: (admin as any).id,
    username: (admin as any).username,
    is_super_admin: (admin as any).is_super_admin,
  };
}

async function audit(
  actor: Actor,
  action: string,
  opts: {
    target_type?: string;
    target_id?: string;
    old_values?: unknown;
    new_values?: unknown;
    reason?: string;
  } = {},
) {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  await supabaseAdmin.from("admin_audit_log" as any).insert({
    actor_admin_id: actor.id,
    actor_username: actor.username,
    action,
    target_type: opts.target_type ?? null,
    target_id: opts.target_id ?? null,
    old_values: opts.old_values ?? null,
    new_values: opts.new_values ?? null,
    reason: opts.reason ?? null,
  });
}

// ============ Listing ============

export type ModerationSubmission = {
  id: string;
  round_id: string;
  username: string;
  username_normalized: string;
  country_code: string;
  ip_country: string | null;
  is_vpn: boolean;
  risk_score: number;
  status: "active" | "suspicious" | "verified" | "deleted";
  moderator_note: string | null;
  verified_at: string | null;
  verified_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  created_at: string;
  entries: { target_country_code: string; points: number }[];
};

export const listModerationSubmissions = createServerFn({ method: "POST" })
  .inputValidator((data: { roundId?: string | null } = {}) => ({
    roundId: data?.roundId ?? null,
  }))
  .handler(async ({ data }): Promise<ModerationSubmission[]> => {
    await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    let q = supabaseAdmin
      .from("vote_submissions" as any)
      .select(
        "id, round_id, username, username_normalized, country_code, ip_country, is_vpn, risk_score, status, moderator_note, verified_at, verified_by, deleted_at, deleted_by, edited_at, edited_by, created_at, vote_entries(target_country_code, points)",
      )
      .order("created_at", { ascending: false })
      .limit(1000);
    if (data.roundId) q = q.eq("round_id", data.roundId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      ...r,
      entries: r.vote_entries ?? [],
    })) as ModerationSubmission[];
  });

// ============ Actions ============

export const setSubmissionStatus = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      status: "active" | "suspicious" | "verified";
      reason?: string;
    }) => {
      if (!data?.id) throw new Error("Missing id");
      if (!["active", "suspicious", "verified"].includes(data.status))
        throw new Error("Invalid status");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: before } = await supabaseAdmin
      .from("vote_submissions" as any)
      .select("id, status")
      .eq("id", data.id)
      .maybeSingle();
    const patch: Record<string, any> = { status: data.status };
    if (data.status === "verified") {
      patch.verified_at = new Date().toISOString();
      patch.verified_by = actor.id;
    } else {
      patch.verified_at = null;
      patch.verified_by = null;
    }
    const { error } = await supabaseAdmin
      .from("vote_submissions" as any)
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "moderate_vote_status", {
      target_type: "vote_submission",
      target_id: data.id,
      old_values: before,
      new_values: { status: data.status },
      reason: data.reason,
    });
    return { ok: true };
  });

export const softDeleteSubmission = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; reason: string }) => {
    if (!data?.id) throw new Error("Missing id");
    if (!data?.reason?.trim())
      throw new Error("A reason is required to delete a vote");
    return data;
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: before } = await supabaseAdmin
      .from("vote_submissions" as any)
      .select("id, status, moderator_note")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("vote_submissions" as any)
      .update({
        status: "deleted",
        deleted_at: new Date().toISOString(),
        deleted_by: actor.id,
        moderator_note: data.reason,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "delete_vote", {
      target_type: "vote_submission",
      target_id: data.id,
      old_values: before,
      new_values: { status: "deleted" },
      reason: data.reason,
    });
    return { ok: true };
  });

export const restoreSubmission = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; reason?: string }) => {
    if (!data?.id) throw new Error("Missing id");
    return data;
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("vote_submissions" as any)
      .update({
        status: "active",
        deleted_at: null,
        deleted_by: null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "restore_vote", {
      target_type: "vote_submission",
      target_id: data.id,
      new_values: { status: "active" },
      reason: data.reason,
    });
    return { ok: true };
  });

export const updateSubmissionNote = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; note: string }) => {
    if (!data?.id) throw new Error("Missing id");
    return { id: data.id, note: String(data.note ?? "").slice(0, 2000) };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: before } = await supabaseAdmin
      .from("vote_submissions" as any)
      .select("moderator_note")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("vote_submissions" as any)
      .update({ moderator_note: data.note })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "update_vote_note", {
      target_type: "vote_submission",
      target_id: data.id,
      old_values: before,
      new_values: { moderator_note: data.note },
    });
    return { ok: true };
  });

export const editSubmissionEntries = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      entries: { target_country_code: string; points: number }[];
      reason: string;
    }) => {
      if (!data?.id) throw new Error("Missing id");
      if (!data?.reason?.trim()) throw new Error("A reason is required");
      if (!Array.isArray(data?.entries)) throw new Error("Invalid entries");
      const total = data.entries.reduce((a, b) => a + (b.points || 0), 0);
      if (total !== 20)
        throw new Error(`Total points must equal 20 (got ${total})`);
      if (data.entries.length < 5)
        throw new Error("At least 5 countries required");
      for (const e of data.entries) {
        if (!e.target_country_code) throw new Error("Missing target");
        if (!e.points || e.points < 1 || e.points > 10)
          throw new Error("Points must be 1–10");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Snapshot old entries for audit
    const { data: before } = await supabaseAdmin
      .from("vote_entries" as any)
      .select("target_country_code, points")
      .eq("submission_id", data.id);

    const { error: delErr } = await supabaseAdmin
      .from("vote_entries" as any)
      .delete()
      .eq("submission_id", data.id);
    if (delErr) throw new Error(delErr.message);

    const { error: insErr } = await supabaseAdmin
      .from("vote_entries" as any)
      .insert(
        data.entries.map((e) => ({
          submission_id: data.id,
          target_country_code: e.target_country_code,
          points: e.points,
        })),
      );
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin
      .from("vote_submissions" as any)
      .update({
        edited_at: new Date().toISOString(),
        edited_by: actor.id,
      })
      .eq("id", data.id);

    await audit(actor, "edit_vote_entries", {
      target_type: "vote_submission",
      target_id: data.id,
      old_values: before,
      new_values: data.entries,
      reason: data.reason,
    });
    return { ok: true };
  });

// ============ Alerts count for sidebar badge ============

export const getModerationAlertsCount = createServerFn({
  method: "GET",
}).handler(async () => {
  try {
    await requireAdmin();
  } catch {
    return 0;
  }
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { count } = await supabaseAdmin
    .from("vote_submissions" as any)
    .select("id", { count: "exact", head: true })
    .eq("status", "suspicious");
  const { count: ev } = await supabaseAdmin
    .from("anti_abuse_events" as any)
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return (count ?? 0) + (ev ?? 0);
});
