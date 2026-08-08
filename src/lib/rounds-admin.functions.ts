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
    const patch: { is_archived: boolean; is_active?: boolean } = {
      is_archived: data.archived,
    };
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
      const { count, error: entryCountError } = await supabaseAdmin
        .from("round_entries" as any)
        .select("id", { count: "exact", head: true })
        .eq("round_id", data.id);

      if (entryCountError) throw new Error(entryCountError.message);

      const c = count ?? 0;
      if (c < 2 || c > 50) {
        throw new Error(
          `Round must have between 2 and 50 entries (has ${c})`,
        );
      }
    }

    const patch: {
      status: "draft" | "open" | "closed";
      opened_at?: string;
      closed_at?: string;
    } = { status: data.status };
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
    for (const rawCode of data.countryCodes) {
      if (!rawCode || typeof rawCode !== "string")
        throw new Error("Invalid country code");

      const code = rawCode.trim();
      if (!code) throw new Error("Invalid country code");
      if (seen.has(code)) throw new Error("Duplicate country in selection");
      seen.add(code);
    }

    return {
      roundId: data.roundId,
      countryCodes: data.countryCodes.map((code) => code.trim()),
    };
  })
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Verify the round exists before changing its line-up.
    const { data: round, error: roundError } = await supabaseAdmin
      .from("rounds")
      .select("id,status,participant_mode")
      .eq("id", data.roundId)
      .maybeSingle();

    if (roundError) throw new Error(roundError.message);
    if (!round) throw new Error("Round not found");

    // Do not silently rewrite an actively voting round.
    if ((round as any).status === "open") {
      throw new Error("Close the round before changing its participants");
    }

    // Every selected code must still correspond to a real Solaris country.
    const { data: validCountries, error: countryError } = await supabaseAdmin
      .from("countries")
      .select("code")
      .in("code", data.countryCodes);

    if (countryError) throw new Error(countryError.message);

    const validCodes = new Set(
      ((validCountries ?? []) as { code: string }[]).map((row) => row.code),
    );

    const unknownCodes = data.countryCodes.filter(
      (code) => !validCodes.has(code),
    );

    if (unknownCodes.length > 0) {
      throw new Error(
        `Unknown country ${unknownCodes.length === 1 ? "code" : "codes"}: ${unknownCodes.join(", ")}`,
      );
    }

    // round_entries is now the authoritative participant table.
    // Existing custom entries are intentionally preserved.
    const { data: before, error: beforeError } = await supabaseAdmin
      .from("round_entries" as any)
      .select(
        "id,entry_type,entry_key,country_code,custom_name,display_order",
      )
      .eq("round_id", data.roundId)
      .order("display_order");

    if (beforeError) throw new Error(beforeError.message);

    const existingCustomEntries = ((before ?? []) as any[])
      .filter((entry) => entry.entry_type === "custom")
      .sort(
        (a, b) =>
          Number(a.display_order ?? 0) - Number(b.display_order ?? 0),
      );

    // Remove only the country entries. Custom entries must survive when a
    // mixed round's country selection is edited.
    const { error: deleteError } = await supabaseAdmin
      .from("round_entries" as any)
      .delete()
      .eq("round_id", data.roundId)
      .eq("entry_type", "country");

    if (deleteError) throw new Error(deleteError.message);

    // Country entries keep their country code as entry_key. This preserves
    // compatibility with historical vote/result rows while giving every
    // participant a stable generic identity.
    const countryRows = data.countryCodes.map((code, index) => ({
      round_id: data.roundId,
      entry_type: "country",
      entry_key: code,
      country_code: code,
      custom_name: null,
      short_name: null,
      entry_code: null,
      subtitle: null,
      image_url: null,
      description: null,
      display_order: index + 1,
    }));

    if (countryRows.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("round_entries" as any)
        .insert(countryRows);

      if (insertError) throw new Error(insertError.message);
    }

    // If this round already contains custom entries, keep their relative order
    // but place them after the country entries so display_order remains unique
    // and deterministic until the generic entry editor takes over ordering.
    if (existingCustomEntries.length > 0) {
      for (let index = 0; index < existingCustomEntries.length; index += 1) {
        const custom = existingCustomEntries[index];
        const { error: reorderError } = await supabaseAdmin
          .from("round_entries" as any)
          .update({
            display_order: countryRows.length + index + 1,
          })
          .eq("id", custom.id);

        if (reorderError) throw new Error(reorderError.message);
      }
    }

    // Keep participant_mode truthful. If custom entries already exist, the
    // round is mixed. Otherwise this editor is configuring a country round.
    const participantMode =
      existingCustomEntries.length > 0 ? "mixed" : "countries";

    const { error: modeError } = await supabaseAdmin
      .from("rounds")
      .update({ participant_mode: participantMode })
      .eq("id", data.roundId);

    if (modeError) throw new Error(modeError.message);

    const after = [
      ...countryRows,
      ...existingCustomEntries.map((entry, index) => ({
        ...entry,
        display_order: countryRows.length + index + 1,
      })),
    ];

    await audit(actor, "configure_round_entries", {
      target_type: "round",
      target_id: data.roundId,
      old_values: before,
      new_values: {
        participant_mode: participantMode,
        entries: after,
      },
    });

    return {
      ok: true,
      count: after.length,
      countryCount: countryRows.length,
      customCount: existingCustomEntries.length,
    };
  });
