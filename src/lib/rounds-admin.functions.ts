// Admin server functions for editions, rounds, and round-country config.
// The app uses a custom admin_sessions cookie (not Supabase auth), so
// auth.uid() is always NULL from the browser and RLS rejects direct writes.
// These functions authenticate against admin_sessions and use supabaseAdmin
// (service role) to bypass RLS after verifying the caller is an admin.

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

type Actor = { id: string; username: string };

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
  if (!sess) throw new Error("Session expired — sign in again");
  const { data: admin } = await supabaseAdmin
    .from("admin_accounts" as any)
    .select("id, username, disabled")
    .eq("id", (sess as any).admin_id)
    .maybeSingle();
  if (!admin || (admin as any).disabled) throw new Error("Not authenticated");
  return {
    id: (admin as any).id,
    username: (admin as any).username,
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

// ================== Editions ==================

export const createEdition = createServerFn({ method: "POST" })
  .inputValidator((data: { name: string }) => {
    const name = String(data?.name ?? "").trim();
    if (name.length < 2) throw new Error("Edition name too short");
    return { name };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: row, error } = await supabaseAdmin
      .from("editions")
      .insert({ name: data.name })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    await audit(actor, "create_edition", {
      target_type: "edition",
      target_id: row.id,
      new_values: { name: data.name },
    });
    return row;
  });

export const renameEdition = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; name: string }) => {
    if (!data?.id) throw new Error("Missing id");
    const name = String(data?.name ?? "").trim();
    if (name.length < 2) throw new Error("Edition name too short");
    return { id: data.id, name };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: before } = await supabaseAdmin
      .from("editions")
      .select("name")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("editions")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "rename_edition", {
      target_type: "edition",
      target_id: data.id,
      old_values: before,
      new_values: { name: data.name },
    });
    return { ok: true };
  });

export const setEditionArchived = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; archived: boolean }) => {
    if (!data?.id) throw new Error("Missing id");
    return { id: data.id, archived: !!data.archived };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const patch: Record<string, unknown> = { is_archived: data.archived };
    if (data.archived) patch.is_active = false;
    const { error } = await supabaseAdmin
      .from("editions")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, data.archived ? "archive_edition" : "unarchive_edition", {
      target_type: "edition",
      target_id: data.id,
      new_values: patch,
    });
    return { ok: true };
  });

export const activateEdition = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("Missing id");
    return data;
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error: e1 } = await supabaseAdmin
      .from("editions")
      .update({ is_active: false })
      .neq("id", data.id);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await supabaseAdmin
      .from("editions")
      .update({ is_active: true, is_archived: false })
      .eq("id", data.id);
    if (e2) throw new Error(e2.message);
    await audit(actor, "activate_edition", {
      target_type: "edition",
      target_id: data.id,
    });
    return { ok: true };
  });

// ================== Rounds ==================

export const createRound = createServerFn({ method: "POST" })
  .inputValidator((data: { editionId: string; name: string }) => {
    if (!data?.editionId) throw new Error("Missing edition");
    const name = String(data?.name ?? "").trim();
    if (name.length < 1) throw new Error("Round name required");
    return { editionId: data.editionId, name };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: row, error } = await supabaseAdmin
      .from("rounds")
      .insert({ edition_id: data.editionId, name: data.name, status: "draft" })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    await audit(actor, "create_round", {
      target_type: "round",
      target_id: row.id,
      new_values: { name: data.name, edition_id: data.editionId },
    });
    return row;
  });

export const renameRound = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; name: string }) => {
    if (!data?.id) throw new Error("Missing id");
    const name = String(data?.name ?? "").trim();
    if (name.length < 1) throw new Error("Round name required");
    return { id: data.id, name };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: before } = await supabaseAdmin
      .from("rounds")
      .select("name")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("rounds")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "rename_round", {
      target_type: "round",
      target_id: data.id,
      old_values: before,
      new_values: { name: data.name },
    });
    return { ok: true };
  });

export const setRoundStatus = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; status: "draft" | "open" | "closed" }) => {
      if (!data?.id) throw new Error("Missing id");
      if (!["draft", "open", "closed"].includes(data.status))
        throw new Error("Invalid status");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    if (data.status === "open") {
      const { count } = await supabaseAdmin
        .from("round_countries")
        .select("round_id", { count: "exact", head: true })
        .eq("round_id", data.id);
      const c = count ?? 0;
      if (c < 2 || c > 50)
        throw new Error(
          `Round must have between 2 and 50 countries (has ${c})`,
        );
    }

    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "open") patch.opened_at = new Date().toISOString();
    if (data.status === "closed") patch.closed_at = new Date().toISOString();

    const { data: before } = await supabaseAdmin
      .from("rounds")
      .select("status")
      .eq("id", data.id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("rounds")
      .update(patch)
      .eq("id", data.id);
    if (error) {
      if ((error as any).code === "23505") {
        throw new Error("Another round is already open. Close it first.");
      }
      throw new Error(error.message);
    }
    await audit(actor, `round_${data.status}`, {
      target_type: "round",
      target_id: data.id,
      old_values: before,
      new_values: { status: data.status },
    });
    return { ok: true };
  });

export const deleteRound = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("Missing id");
    return data;
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: before } = await supabaseAdmin
      .from("rounds")
      .select("id, name, status, edition_id")
      .eq("id", data.id)
      .maybeSingle();
    if (before && (before as any).status !== "draft") {
      throw new Error("Only draft rounds can be deleted");
    }
    const { error } = await supabaseAdmin
      .from("rounds")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(actor, "delete_round", {
      target_type: "round",
      target_id: data.id,
      old_values: before,
    });
    return { ok: true };
  });

// ================== Round countries ==================

export const saveRoundCountries = createServerFn({ method: "POST" })
  .inputValidator((data: { roundId: string; countryCodes: string[] }) => {
    if (!data?.roundId) throw new Error("Missing round");
    if (!Array.isArray(data?.countryCodes))
      throw new Error("Invalid countries");
    if (data.countryCodes.length < 2 || data.countryCodes.length > 50)
      throw new Error("Pick between 2 and 50 countries");
    const seen = new Set<string>();
    for (const c of data.countryCodes) {
      if (!c || typeof c !== "string") throw new Error("Invalid country code");
      if (seen.has(c)) throw new Error("Duplicate country in selection");
      seen.add(c);
    }
    return data;
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: before } = await supabaseAdmin
      .from("round_countries")
      .select("country_code, display_order")
      .eq("round_id", data.roundId)
      .order("display_order");

    const { error: delErr } = await supabaseAdmin
      .from("round_countries")
      .delete()
      .eq("round_id", data.roundId);
    if (delErr) throw new Error(delErr.message);

    const rows = data.countryCodes.map((code, i) => ({
      round_id: data.roundId,
      country_code: code,
      display_order: i + 1,
    }));
    const { error: insErr } = await supabaseAdmin
      .from("round_countries")
      .insert(rows);
    if (insErr) throw new Error(insErr.message);

    await audit(actor, "configure_round_countries", {
      target_type: "round",
      target_id: data.roundId,
      old_values: before,
      new_values: rows.map((r) => ({
        country_code: r.country_code,
        display_order: r.display_order,
      })),
    });
    return { ok: true, count: rows.length };
  });
