// Phase 4: advanced abuse detection.
// - Similar-ballot detection (cosine similarity on ballots in a round)
// - Cluster detection (union-find over shared IP/fingerprint/device + similar ballots)
// - Voting-bloc detection (country A -> B mean points, with z-score)
// Also exposes audit-log listing for Phase 5.

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

async function requireSuperAdmin(): Promise<Actor> {
  const a = await requireAdmin();
  if (!a.is_super_admin) throw new Error("Super Admin only");
  return a;
}

// ============ Similar Ballots ============

export type SimilarPair = {
  a: { id: string; username: string; country_code: string; created_at: string };
  b: { id: string; username: string; country_code: string; created_at: string };
  score: number;
  timeDeltaSec: number;
  sharedIp: boolean;
  sharedFingerprint: boolean;
};

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  for (const [k, v] of a) {
    const bv = b.get(k);
    if (bv) dot += v * bv;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export const getSimilarBallots = createServerFn({ method: "POST" })
  .inputValidator((d: { roundId: string; threshold?: number }) => {
    if (!d?.roundId) throw new Error("Missing roundId");
    return { roundId: d.roundId, threshold: d.threshold ?? 0.9 };
  })
  .handler(async ({ data }): Promise<SimilarPair[]> => {
    await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: subs } = await supabaseAdmin
      .from("vote_submissions" as any)
      .select(
        "id, username, country_code, created_at, ip_hash, fingerprint_hash, vote_entries(target_country_code, points)",
      )
      .eq("round_id", data.roundId)
      .neq("status", "deleted");
    const list = (subs ?? []) as any[];
    const vecs = list.map((s) => {
      const m = new Map<string, number>();
      for (const e of s.vote_entries ?? []) m.set(e.target_country_code, e.points);
      return m;
    });
    const pairs: SimilarPair[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const s = cosine(vecs[i], vecs[j]);
        if (s >= data.threshold) {
          const a = list[i];
          const b = list[j];
          pairs.push({
            a: { id: a.id, username: a.username, country_code: a.country_code, created_at: a.created_at },
            b: { id: b.id, username: b.username, country_code: b.country_code, created_at: b.created_at },
            score: Number(s.toFixed(4)),
            timeDeltaSec: Math.round(
              Math.abs(
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
              ) / 1000,
            ),
            sharedIp: !!(a.ip_hash && a.ip_hash === b.ip_hash),
            sharedFingerprint: !!(a.fingerprint_hash && a.fingerprint_hash === b.fingerprint_hash),
          });
        }
      }
    }
    return pairs.sort((x, y) => y.score - x.score).slice(0, 200);
  });

// ============ Clusters (union-find) ============

export type Cluster = {
  id: number;
  members: {
    id: string;
    username: string;
    country_code: string;
    ip_country: string | null;
    is_vpn: boolean;
    risk_score: number;
    status: string;
    created_at: string;
  }[];
  reasons: string[];
  combinedRisk: number;
};

export const getClusters = createServerFn({ method: "POST" })
  .inputValidator((d: { roundId: string; similarityThreshold?: number }) => {
    if (!d?.roundId) throw new Error("Missing roundId");
    return { roundId: d.roundId, similarityThreshold: d.similarityThreshold ?? 0.9 };
  })
  .handler(async ({ data }): Promise<Cluster[]> => {
    await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: subs } = await supabaseAdmin
      .from("vote_submissions" as any)
      .select(
        "id, username, country_code, ip_country, ip_hash, fingerprint_hash, device_token_hash, is_vpn, risk_score, status, created_at, vote_entries(target_country_code, points)",
      )
      .eq("round_id", data.roundId)
      .neq("status", "deleted");
    const list = (subs ?? []) as any[];

    // Union-find
    const parent = list.map((_, i) => i);
    const find = (x: number): number =>
      parent[x] === x ? x : (parent[x] = find(parent[x]));
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    const reasonMap = new Map<string, Set<string>>();
    const addReason = (key: string, reason: string) => {
      const s = reasonMap.get(key) ?? new Set<string>();
      s.add(reason);
      reasonMap.set(key, s);
    };

    // Shared identifiers
    const byIp = new Map<string, number[]>();
    const byFp = new Map<string, number[]>();
    const byDev = new Map<string, number[]>();
    list.forEach((s, i) => {
      if (s.ip_hash) (byIp.get(s.ip_hash) ?? byIp.set(s.ip_hash, []).get(s.ip_hash)!).push(i);
      if (s.fingerprint_hash)
        (byFp.get(s.fingerprint_hash) ?? byFp.set(s.fingerprint_hash, []).get(s.fingerprint_hash)!).push(i);
      if (s.device_token_hash)
        (byDev.get(s.device_token_hash) ?? byDev.set(s.device_token_hash, []).get(s.device_token_hash)!).push(i);
    });
    const groupUnion = (m: Map<string, number[]>, reason: string) => {
      for (const idxs of m.values()) {
        if (idxs.length < 2) continue;
        for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k]);
        idxs.forEach((i) => addReason(String(find(i)), reason));
      }
    };
    groupUnion(byIp, "shared IP");
    groupUnion(byFp, "shared device fingerprint");
    groupUnion(byDev, "shared device token");

    // Similar ballots
    const vecs = list.map((s) => {
      const m = new Map<string, number>();
      for (const e of s.vote_entries ?? []) m.set(e.target_country_code, e.points);
      return m;
    });
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (cosine(vecs[i], vecs[j]) >= data.similarityThreshold) {
          union(i, j);
          const r = String(find(i));
          addReason(r, "near-identical ballots");
        }
      }
    }

    // Collect groups of size >= 2
    const groups = new Map<number, number[]>();
    list.forEach((_, i) => {
      const r = find(i);
      (groups.get(r) ?? groups.set(r, []).get(r)!).push(i);
    });

    const out: Cluster[] = [];
    let cid = 1;
    for (const [root, idxs] of groups) {
      if (idxs.length < 2) continue;
      const members = idxs.map((i) => list[i]);
      const combined = Math.min(
        100,
        Math.round(
          members.reduce((a, m) => a + (m.risk_score || 0), 0) / members.length +
            (idxs.length - 1) * 10,
        ),
      );
      out.push({
        id: cid++,
        members: members.map((m) => ({
          id: m.id,
          username: m.username,
          country_code: m.country_code,
          ip_country: m.ip_country ?? null,
          is_vpn: !!m.is_vpn,
          risk_score: m.risk_score || 0,
          status: m.status,
          created_at: m.created_at,
        })),
        reasons: Array.from(reasonMap.get(String(root)) ?? []),
        combinedRisk: combined,
      });
    }
    return out.sort((a, b) => b.combinedRisk - a.combinedRisk);
  });

// ============ Voting Blocs ============

export type BlocPair = {
  from: string;
  to: string;
  mean: number;
  count: number;
  z: number;
};

export const getVotingBlocs = createServerFn({ method: "POST" })
  .inputValidator((d: { roundId?: string | null } = {}) => ({
    roundId: d?.roundId ?? null,
  }))
  .handler(async ({ data }): Promise<BlocPair[]> => {
    await requireAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    let q = supabaseAdmin
      .from("vote_submissions" as any)
      .select("id, country_code, round_id, status, vote_entries(target_country_code, points)")
      .neq("status", "deleted");
    if (data.roundId) q = q.eq("round_id", data.roundId);
    const { data: subs } = await q;
    const list = (subs ?? []) as any[];

    // aggregate (from -> to -> {sum, count})
    const agg = new Map<string, Map<string, { sum: number; count: number }>>();
    for (const s of list) {
      const inner = agg.get(s.country_code) ?? new Map();
      for (const e of s.vote_entries ?? []) {
        const cur = inner.get(e.target_country_code) ?? { sum: 0, count: 0 };
        cur.sum += e.points;
        cur.count += 1;
        inner.set(e.target_country_code, cur);
      }
      agg.set(s.country_code, inner);
    }

    const pairs: BlocPair[] = [];
    for (const [from, inner] of agg) {
      const means: number[] = [];
      for (const v of inner.values()) means.push(v.sum / v.count);
      const mu = means.reduce((a, b) => a + b, 0) / (means.length || 1);
      const variance =
        means.reduce((a, b) => a + (b - mu) ** 2, 0) / (means.length || 1);
      const sd = Math.sqrt(variance) || 1;
      for (const [to, v] of inner) {
        const mean = v.sum / v.count;
        const z = (mean - mu) / sd;
        if (v.count >= 2 && z >= 1.5) {
          pairs.push({ from, to, mean: Number(mean.toFixed(2)), count: v.count, z: Number(z.toFixed(2)) });
        }
      }
    }
    return pairs.sort((a, b) => b.z - a.z).slice(0, 200);
  });

// ============ Audit Log ============

export type AuditLogRow = {
  id: string;
  actor_admin_id: string | null;
  actor_username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  old_values: unknown;
  new_values: unknown;
  reason: string | null;
  created_at: string;
};

export const listAuditLog = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { limit?: number; action?: string | null; actor?: string | null } = {}) => ({
      limit: Math.min(500, Math.max(10, d?.limit ?? 200)),
      action: d?.action?.trim() || null,
      actor: d?.actor?.trim() || null,
    }),
  )
  .handler(async ({ data }): Promise<AuditLogRow[]> => {
    await requireSuperAdmin();
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    let q = supabaseAdmin
      .from("admin_audit_log" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.action) q = q.eq("action", data.action);
    if (data.actor) q = q.ilike("actor_username", `%${data.actor}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as AuditLogRow[];
  });
