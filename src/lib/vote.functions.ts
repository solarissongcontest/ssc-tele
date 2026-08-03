// Server wrapper around submit_vote RPC.
// Runs on Cloudflare Worker so we can read cf-ipcountry / cf-* headers,
// hash the caller IP, and pass ip_country + is_vpn into submit_vote.

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { createHash } from "node:crypto";

function sha256(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Very light VPN/proxy heuristic. Cloudflare sets these headers when a request
// looks like it's coming through a known proxy / Warp / Tor exit.
function detectVpn(): boolean {
  const flags = [
    getRequestHeader("cf-warp-tag-id"),
    getRequestHeader("via"),
    getRequestHeader("x-forwarded-proto"),
  ];
  const threat = getRequestHeader("cf-threat-score");
  if (threat && Number(threat) >= 20) return true;
  const proxy = getRequestHeader("x-forwarded-for") ?? "";
  // Multiple hops in x-forwarded-for = likely proxy chain
  if (proxy.split(",").filter(Boolean).length > 1) return true;
  return flags.some((h) => typeof h === "string" && h.length > 0 && h !== "https");
}

export type VoteEntry = { target_country_code: string; points: number };

export const submitVote = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      roundId: string;
      username: string;
      countryCode: string;
      entries: VoteEntry[];
      fingerprintHash?: string | null;
      deviceTokenHash?: string | null;
    }) => {
      if (!data?.roundId) throw new Error("Missing round");
      if (!data?.username?.trim()) throw new Error("Username required");
      if (!data?.countryCode) throw new Error("Home country required");
      if (!Array.isArray(data?.entries) || data.entries.length === 0)
        throw new Error("No entries");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { enforceRateLimit } = await import("@/lib/rate-limit.server");

    let ipHash: string | null = null;
    try {
      const ip = getRequestIP({ xForwardedFor: true });
      if (ip) ipHash = sha256(ip);
    } catch {
      /* ignore */
    }

    // Burst protection in front of the durable duplicate checks in submit_vote.
    enforceRateLimit(`vote:${ipHash ?? data.deviceTokenHash ?? "anon"}`, {
      limit: 8,
      windowMs: 60_000,
      message: "Too many vote attempts from this connection. Please wait a moment.",
    });

    const ipCountry =
      getRequestHeader("cf-ipcountry") ??
      getRequestHeader("x-vercel-ip-country") ??
      null;
    const isVpn = detectVpn();


    const { data: result, error } = await supabaseAdmin.rpc(
      "submit_vote" as any,
      {
        p_round_id: data.roundId,
        p_username: data.username.trim(),
        p_country_code: data.countryCode,
        p_entries: data.entries,
        p_ip_hash: ipHash,
        p_fingerprint_hash: data.fingerprintHash ?? null,
        p_device_token_hash: data.deviceTokenHash ?? null,
        p_ip_country: ipCountry && ipCountry !== "XX" ? ipCountry : null,
        p_is_vpn: isVpn,
      },
    );
    if (error) throw new Error(error.message);
    return result as { id: string; risk_score: number };
  });
