// Server functions for the custom Super-Admin authentication system.
// All privileged access to admin_* tables goes through here.
//
// Session model: an opaque random token stored in an encrypted httpOnly cookie
// (via useSession). Its SHA-256 hash is stored in admin_sessions, so the
// Super Admin can revoke sessions at any time.

import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  useSession,
  getRequestIP,
} from "@tanstack/react-start/server";
import { createHash, randomBytes } from "node:crypto";

type SessionData = { token?: string };

const SESSION_COOKIE_NAME = "solaris-admin";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

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

function sha256(input: string) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

async function loadAdminFromCookie() {
  const session = await useSession<SessionData>(sessionConfig());
  const token = session.data.token;
  if (!token) return { session, admin: null as null | AdminRow };
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const tokenHash = sha256(token);
  const nowIso = new Date().toISOString();
  const { data: sess } = await supabaseAdmin
    .from("admin_sessions" as any)
    .select("id, admin_id, expires_at")
    .eq("token_hash", tokenHash)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (!sess) return { session, admin: null as null | AdminRow };
  const { data: admin } = await supabaseAdmin
    .from("admin_accounts" as any)
    .select("id, username, is_super_admin, disabled, last_login_at, created_at")
    .eq("id", (sess as any).admin_id)
    .maybeSingle();
  if (!admin || (admin as any).disabled) {
    return { session, admin: null as null | AdminRow };
  }
  return { session, admin: admin as unknown as AdminRow };
}

type AdminRow = {
  id: string;
  username: string;
  is_super_admin: boolean;
  disabled: boolean;
  last_login_at: string | null;
  created_at: string;
};

async function requireAdmin() {
  const ctx = await loadAdminFromCookie();
  if (!ctx.admin) {
    throw new Error("Not authenticated");
  }
  return ctx.admin;
}

async function requireSuperAdmin() {
  const admin = await requireAdmin();
  if (!admin.is_super_admin) {
    throw new Error("Super Admin required");
  }
  return admin;
}

async function writeAudit(
  actor: AdminRow | null,
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
    actor_admin_id: actor?.id ?? null,
    actor_username: actor?.username ?? null,
    action,
    target_type: opts.target_type ?? null,
    target_id: opts.target_id ?? null,
    old_values: opts.old_values ?? null,
    new_values: opts.new_values ?? null,
    reason: opts.reason ?? null,
  });
}

// ============ Public: login / logout / me ============

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; password: string }) => {
    if (!data?.username || !data?.password) throw new Error("Missing credentials");
    return data;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: rows, error } = await supabaseAdmin.rpc(
      "admin_verify_credentials" as any,
      { _username: data.username.trim(), _password: data.password },
    );
    if (error) throw new Error("Login failed");
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("Invalid username or password");

    const token = randomBytes(32).toString("hex");
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

    const ua = getRequestHeader("user-agent") ?? null;
    let ipHash: string | null = null;
    try {
      const ip = getRequestIP({ xForwardedFor: true });
      if (ip) ipHash = sha256(ip);
    } catch {
      /* ignore */
    }

    await supabaseAdmin.from("admin_sessions" as any).insert({
      admin_id: (row as any).id,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      user_agent: ua,
      ip_hash: ipHash,
    });

    await supabaseAdmin
      .from("admin_accounts" as any)
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", (row as any).id);

    const session = await useSession<SessionData>(sessionConfig());
    await session.update({ token });

    await writeAudit(
      {
        id: (row as any).id,
        username: (row as any).username,
        is_super_admin: (row as any).is_super_admin,
        disabled: false,
        last_login_at: null,
        created_at: "",
      },
      "login",
      { target_type: "admin_account", target_id: (row as any).id },
    );

    return {
      id: (row as any).id as string,
      username: (row as any).username as string,
      is_super_admin: (row as any).is_super_admin as boolean,
    };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(
  async () => {
    const session = await useSession<SessionData>(sessionConfig());
    const token = session.data.token;
    if (token) {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      await supabaseAdmin
        .from("admin_sessions" as any)
        .delete()
        .eq("token_hash", sha256(token));
    }
    await session.clear();
    return { ok: true };
  },
);

export const getCurrentAdmin = createServerFn({ method: "GET" }).handler(
  async () => {
    const { admin } = await loadAdminFromCookie();
    if (!admin) return null;
    return {
      id: admin.id,
      username: admin.username,
      is_super_admin: admin.is_super_admin,
      last_login_at: admin.last_login_at,
    };
  },
);

// ============ Super Admin: manage administrator accounts ============

export const listAdmins = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireSuperAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("admin_accounts" as any)
      .select(
        "id, username, is_super_admin, disabled, last_login_at, created_at, created_by",
      )
      .order("created_at", { ascending: true });
    if (error) throw error;
    const map = new Map<string, string>();
    (data as any[]).forEach((r) => map.set(r.id, r.username));
    return (data as any[]).map((r) => ({
      ...r,
      created_by_username: r.created_by ? (map.get(r.created_by) ?? null) : null,
    }));
  },
);

export const createAdminAccount = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; password: string }) => {
    const username = String(data?.username ?? "").trim();
    const password = String(data?.password ?? "");
    if (username.length < 2) throw new Error("Username too short");
    if (password.length < 8)
      throw new Error("Password must be at least 8 characters");
    return { username, password };
  })
  .handler(async ({ data }) => {
    const actor = await requireSuperAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: hashData, error: hashErr } = await supabaseAdmin.rpc(
      "admin_hash_password" as any,
      { _password: data.password },
    );
    if (hashErr) throw hashErr;
    const { data: inserted, error } = await supabaseAdmin
      .from("admin_accounts" as any)
      .insert({
        username: data.username,
        password_hash: hashData as unknown as string,
        is_super_admin: false,
        created_by: actor.id,
      })
      .select("id, username")
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(actor, "create_admin", {
      target_type: "admin_account",
      target_id: (inserted as any).id,
      new_values: { username: (inserted as any).username },
    });
    return inserted;
  });

export const updateAdminUsername = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; username: string }) => {
    if (!data?.id) throw new Error("Missing id");
    const username = String(data?.username ?? "").trim();
    if (username.length < 2) throw new Error("Username too short");
    return { id: data.id, username };
  })
  .handler(async ({ data }) => {
    const actor = await requireSuperAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: before } = await supabaseAdmin
      .from("admin_accounts" as any)
      .select("id, username")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("admin_accounts" as any)
      .update({ username: data.username })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(actor, "rename_admin", {
      target_type: "admin_account",
      target_id: data.id,
      old_values: before,
      new_values: { username: data.username },
    });
    return { ok: true };
  });

export const resetAdminPassword = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; password: string }) => {
    if (!data?.id) throw new Error("Missing id");
    if (!data?.password || data.password.length < 8)
      throw new Error("Password must be at least 8 characters");
    return data;
  })
  .handler(async ({ data }) => {
    const actor = await requireSuperAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: hashData, error: hashErr } = await supabaseAdmin.rpc(
      "admin_hash_password" as any,
      { _password: data.password },
    );
    if (hashErr) throw hashErr;
    const { error } = await supabaseAdmin
      .from("admin_accounts" as any)
      .update({ password_hash: hashData as unknown as string })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    // Invalidate every existing session for that admin.
    await supabaseAdmin
      .from("admin_sessions" as any)
      .delete()
      .eq("admin_id", data.id);
    await writeAudit(actor, "reset_password", {
      target_type: "admin_account",
      target_id: data.id,
    });
    return { ok: true };
  });

export const setAdminDisabled = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; disabled: boolean }) => {
    if (!data?.id) throw new Error("Missing id");
    return { id: data.id, disabled: Boolean(data.disabled) };
  })
  .handler(async ({ data }) => {
    const actor = await requireSuperAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("admin_accounts" as any)
      .update({ disabled: data.disabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    if (data.disabled) {
      await supabaseAdmin
        .from("admin_sessions" as any)
        .delete()
        .eq("admin_id", data.id);
    }
    await writeAudit(actor, data.disabled ? "disable_admin" : "enable_admin", {
      target_type: "admin_account",
      target_id: data.id,
    });
    return { ok: true };
  });

export const deleteAdminAccount = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("Missing id");
    return data;
  })
  .handler(async ({ data }) => {
    const actor = await requireSuperAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: before } = await supabaseAdmin
      .from("admin_accounts" as any)
      .select("id, username, is_super_admin")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("admin_accounts" as any)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(actor, "delete_admin", {
      target_type: "admin_account",
      target_id: data.id,
      old_values: before,
    });
    return { ok: true };
  });

export const listAdminAuditLog = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireSuperAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("admin_audit_log" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return data ?? [];
  },
);
