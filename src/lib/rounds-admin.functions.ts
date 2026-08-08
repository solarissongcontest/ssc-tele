// Admin server functions for editions, rounds, and round-country config.
// The app uses a custom admin_sessions cookie (not Supabase auth), so
// auth.uid() is always NULL from the browser and RLS rejects direct writes.
// These functions authenticate against admin_sessions and use supabaseAdmin
// (service role) to bypass RLS after verifying the caller is an admin.

import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash, randomUUID } from "node:crypto";

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


// ================== Generic round entries ==================

type ParticipantMode = "countries" | "custom" | "mixed";

function cleanOptionalText(
  value: unknown,
  maxLength: number,
): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new Error(`Value is too long (maximum ${maxLength} characters)`);
  }
  return text;
}

function cleanImageUrl(value: unknown): string | null {
  const text = cleanOptionalText(value, 1000);
  if (!text) return null;

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("Image URL must be a valid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Image URL must use http or https");
  }

  return parsed.toString();
}

export const setRoundParticipantMode = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      roundId: string;
      participantMode: ParticipantMode;
    }) => {
      if (!data?.roundId) throw new Error("Missing round");

      if (
        !["countries", "custom", "mixed"].includes(
          data.participantMode,
        )
      ) {
        throw new Error("Invalid participant mode");
      }

      return data;
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: round, error: roundError } = await supabaseAdmin
      .from("rounds" as any)
      .select("id,status,participant_mode")
      .eq("id", data.roundId)
      .maybeSingle();

    if (roundError) throw new Error(roundError.message);
    if (!round) throw new Error("Round not found");

    if ((round as any).status === "open") {
      throw new Error("Close the round before changing its participant mode");
    }

    const { data: before, error: beforeError } = await supabaseAdmin
      .from("round_entries" as any)
      .select(
        "id,entry_type,entry_key,country_code,custom_name,short_name,entry_code,subtitle,image_url,description,display_order",
      )
      .eq("round_id", data.roundId)
      .order("display_order");

    if (beforeError) throw new Error(beforeError.message);

    if (data.participantMode === "countries") {
      const { error } = await supabaseAdmin
        .from("round_entries" as any)
        .delete()
        .eq("round_id", data.roundId)
        .eq("entry_type", "custom");

      if (error) throw new Error(error.message);
    }

    if (data.participantMode === "custom") {
      const { error } = await supabaseAdmin
        .from("round_entries" as any)
        .delete()
        .eq("round_id", data.roundId)
        .eq("entry_type", "country");

      if (error) throw new Error(error.message);
    }

    const { data: remaining, error: remainingError } = await supabaseAdmin
      .from("round_entries" as any)
      .select("id")
      .eq("round_id", data.roundId)
      .order("display_order");

    if (remainingError) throw new Error(remainingError.message);

    for (let index = 0; index < (remaining ?? []).length; index += 1) {
      const row = (remaining ?? [])[index] as any;

      const { error } = await supabaseAdmin
        .from("round_entries" as any)
        .update({ display_order: index + 1 })
        .eq("id", row.id);

      if (error) throw new Error(error.message);
    }

    const { error: updateError } = await supabaseAdmin
      .from("rounds" as any)
      .update({
        participant_mode: data.participantMode,
      })
      .eq("id", data.roundId);

    if (updateError) throw new Error(updateError.message);

    const { data: after } = await supabaseAdmin
      .from("round_entries" as any)
      .select(
        "id,entry_type,entry_key,country_code,custom_name,short_name,entry_code,subtitle,image_url,description,display_order",
      )
      .eq("round_id", data.roundId)
      .order("display_order");

    await audit(actor, "set_round_participant_mode", {
      target_type: "round",
      target_id: data.roundId,
      old_values: {
        participant_mode: (round as any).participant_mode,
        entries: before,
      },
      new_values: {
        participant_mode: data.participantMode,
        entries: after,
      },
    });

    return {
      ok: true,
      participantMode: data.participantMode,
    };
  });

export const saveCustomRoundEntry = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      roundId: string;
      id?: string | null;
      customName: string;
      shortName?: string | null;
      entryCode?: string | null;
      subtitle?: string | null;
      imageUrl?: string | null;
      description?: string | null;
    }) => {
      if (!data?.roundId) throw new Error("Missing round");

      const customName = String(data?.customName ?? "").trim();
      if (!customName) throw new Error("Display name is required");
      if (customName.length > 120) {
        throw new Error("Display name is too long");
      }

      return {
        roundId: data.roundId,
        id: data.id || null,
        customName,
        shortName: cleanOptionalText(data.shortName, 60),
        entryCode: cleanOptionalText(data.entryCode, 24),
        subtitle: cleanOptionalText(data.subtitle, 120),
        imageUrl: cleanImageUrl(data.imageUrl),
        description: cleanOptionalText(data.description, 1000),
      };
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: round, error: roundError } = await supabaseAdmin
      .from("rounds" as any)
      .select("id,status,participant_mode")
      .eq("id", data.roundId)
      .maybeSingle();

    if (roundError) throw new Error(roundError.message);
    if (!round) throw new Error("Round not found");

    if ((round as any).status === "open") {
      throw new Error("Close the round before changing its participants");
    }

    if (data.id) {
      const { data: before, error: beforeError } = await supabaseAdmin
        .from("round_entries" as any)
        .select("*")
        .eq("id", data.id)
        .eq("round_id", data.roundId)
        .eq("entry_type", "custom")
        .maybeSingle();

      if (beforeError) throw new Error(beforeError.message);
      if (!before) throw new Error("Custom entry not found");

      const { data: updated, error: updateError } = await supabaseAdmin
        .from("round_entries" as any)
        .update({
          custom_name: data.customName,
          short_name: data.shortName,
          entry_code: data.entryCode,
          subtitle: data.subtitle,
          image_url: data.imageUrl,
          description: data.description,
        })
        .eq("id", data.id)
        .eq("round_id", data.roundId)
        .select("*")
        .single();

      if (updateError) throw new Error(updateError.message);

      await audit(actor, "update_custom_round_entry", {
        target_type: "round_entry",
        target_id: data.id,
        old_values: before,
        new_values: updated,
      });

      return {
        ok: true,
        entry: updated,
      };
    }

    const { count, error: countError } = await supabaseAdmin
      .from("round_entries" as any)
      .select("id", { count: "exact", head: true })
      .eq("round_id", data.roundId);

    if (countError) throw new Error(countError.message);

    if ((count ?? 0) >= 50) {
      throw new Error("A round can have at most 50 entries");
    }

    const { data: lastRows, error: lastError } = await supabaseAdmin
      .from("round_entries" as any)
      .select("display_order")
      .eq("round_id", data.roundId)
      .order("display_order", { ascending: false })
      .limit(1);

    if (lastError) throw new Error(lastError.message);

    const nextOrder =
      Number((lastRows?.[0] as any)?.display_order ?? 0) + 1;

    const entryKey = `x_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("round_entries" as any)
      .insert({
        round_id: data.roundId,
        entry_type: "custom",
        entry_key: entryKey,
        country_code: null,
        custom_name: data.customName,
        short_name: data.shortName,
        entry_code: data.entryCode,
        subtitle: data.subtitle,
        image_url: data.imageUrl,
        description: data.description,
        display_order: nextOrder,
      })
      .select("*")
      .single();

    if (insertError) throw new Error(insertError.message);

    const { count: countryCount, error: countryCountError } =
      await supabaseAdmin
        .from("round_entries" as any)
        .select("id", { count: "exact", head: true })
        .eq("round_id", data.roundId)
        .eq("entry_type", "country");

    if (countryCountError) throw new Error(countryCountError.message);

    const participantMode =
      (countryCount ?? 0) > 0 ? "mixed" : "custom";

    const { error: modeError } = await supabaseAdmin
      .from("rounds" as any)
      .update({
        participant_mode: participantMode,
      })
      .eq("id", data.roundId);

    if (modeError) throw new Error(modeError.message);

    await audit(actor, "create_custom_round_entry", {
      target_type: "round_entry",
      target_id: (inserted as any).id,
      new_values: inserted,
    });

    return {
      ok: true,
      entry: inserted,
      participantMode,
    };
  });

export const deleteCustomRoundEntry = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      roundId: string;
      entryId: string;
    }) => {
      if (!data?.roundId) throw new Error("Missing round");
      if (!data?.entryId) throw new Error("Missing entry");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: round, error: roundError } = await supabaseAdmin
      .from("rounds" as any)
      .select("id,status,participant_mode")
      .eq("id", data.roundId)
      .maybeSingle();

    if (roundError) throw new Error(roundError.message);
    if (!round) throw new Error("Round not found");

    if ((round as any).status === "open") {
      throw new Error("Close the round before changing its participants");
    }

    const { data: before, error: beforeError } = await supabaseAdmin
      .from("round_entries" as any)
      .select("*")
      .eq("id", data.entryId)
      .eq("round_id", data.roundId)
      .eq("entry_type", "custom")
      .maybeSingle();

    if (beforeError) throw new Error(beforeError.message);
    if (!before) throw new Error("Custom entry not found");

    const { error: deleteError } = await supabaseAdmin
      .from("round_entries" as any)
      .delete()
      .eq("id", data.entryId)
      .eq("round_id", data.roundId);

    if (deleteError) throw new Error(deleteError.message);

    const { data: remaining, error: remainingError } = await supabaseAdmin
      .from("round_entries" as any)
      .select("id,entry_type")
      .eq("round_id", data.roundId)
      .order("display_order");

    if (remainingError) throw new Error(remainingError.message);

    for (let index = 0; index < (remaining ?? []).length; index += 1) {
      const row = (remaining ?? [])[index] as any;

      const { error } = await supabaseAdmin
        .from("round_entries" as any)
        .update({
          display_order: index + 1,
        })
        .eq("id", row.id);

      if (error) throw new Error(error.message);
    }

    const hasCountry = (remaining ?? []).some(
      (row: any) => row.entry_type === "country",
    );

    const hasCustom = (remaining ?? []).some(
      (row: any) => row.entry_type === "custom",
    );

    let participantMode = (round as any)
      .participant_mode as ParticipantMode;

    if (hasCountry && hasCustom) participantMode = "mixed";
    else if (hasCountry) participantMode = "countries";
    else if (hasCustom) participantMode = "custom";

    const { error: modeError } = await supabaseAdmin
      .from("rounds" as any)
      .update({
        participant_mode: participantMode,
      })
      .eq("id", data.roundId);

    if (modeError) throw new Error(modeError.message);

    await audit(actor, "delete_custom_round_entry", {
      target_type: "round_entry",
      target_id: data.entryId,
      old_values: before,
      new_values: null,
    });

    return {
      ok: true,
      participantMode,
    };
  });

export const reorderRoundEntries = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      roundId: string;
      entryIds: string[];
    }) => {
      if (!data?.roundId) throw new Error("Missing round");

      if (!Array.isArray(data?.entryIds)) {
        throw new Error("Invalid entry order");
      }

      if (new Set(data.entryIds).size !== data.entryIds.length) {
        throw new Error("Duplicate entry in order");
      }

      return data;
    },
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: round, error: roundError } = await supabaseAdmin
      .from("rounds" as any)
      .select("id,status")
      .eq("id", data.roundId)
      .maybeSingle();

    if (roundError) throw new Error(roundError.message);
    if (!round) throw new Error("Round not found");

    if ((round as any).status === "open") {
      throw new Error("Close the round before reordering entries");
    }

    const { data: before, error: beforeError } = await supabaseAdmin
      .from("round_entries" as any)
      .select("id,entry_key,display_order")
      .eq("round_id", data.roundId)
      .order("display_order");

    if (beforeError) throw new Error(beforeError.message);

    const existingIds = ((before ?? []) as any[]).map(
      (row) => String(row.id),
    );

    if (existingIds.length !== data.entryIds.length) {
      throw new Error("Entry list changed. Refresh and try again.");
    }

    const expected = new Set(existingIds);

    for (const id of data.entryIds) {
      if (!expected.has(id)) {
        throw new Error("Entry list changed. Refresh and try again.");
      }
    }

    for (let index = 0; index < data.entryIds.length; index += 1) {
      const { error } = await supabaseAdmin
        .from("round_entries" as any)
        .update({
          display_order: index + 1,
        })
        .eq("id", data.entryIds[index])
        .eq("round_id", data.roundId);

      if (error) throw new Error(error.message);
    }

    const after = data.entryIds.map((id, index) => ({
      id,
      display_order: index + 1,
    }));

    await audit(actor, "reorder_round_entries", {
      target_type: "round",
      target_id: data.roundId,
      old_values: before,
      new_values: after,
    });

    return {
      ok: true,
      count: data.entryIds.length,
    };
  });
