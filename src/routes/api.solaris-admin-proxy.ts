import { createFileRoute } from "@tanstack/react-router";

const SOLARIS_URL = "https://oxtbskojiexkaspputvo.supabase.co";
const SOLARIS_PUBLISHABLE_KEY = "sb_publishable_HlFRpOFUHzotkO609JPXgQ_ZWi8DSCj";
const TELEVOTING_HOST = "nyzmftjbuaegmrjyypqv.supabase.co";

const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-profile",
  "content-profile",
  "content-type",
  "prefer",
  "range",
  "range-unit",
  "x-client-info",
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-range",
  "content-type",
  "location",
  "preference-applied",
  "range-unit",
]);

function isOpaqueSupabaseKey(value: string) {
  return value.startsWith("sb_secret_") || value.startsWith("sb_publishable_");
}

async function verifySolarisOrganizer(accessToken: string) {
  const userResponse = await fetch(`${SOLARIS_URL}/auth/v1/user`, {
    headers: {
      apikey: SOLARIS_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!userResponse.ok) return false;
  const user = (await userResponse.json()) as { id?: string };
  if (!user.id) return false;

  const roleResponse = await fetch(
    `${SOLARIS_URL}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(user.id)}&role=eq.organizer&limit=1`,
    {
      headers: {
        apikey: SOLARIS_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  if (!roleResponse.ok) return false;
  const roles = (await roleResponse.json()) as Array<{ role?: string }>;
  return roles.some((row) => row.role === "organizer");
}

function serviceHeaders(serviceKey: string, forwarded?: Record<string, string>) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(forwarded ?? {})) {
    if (REQUEST_HEADER_ALLOWLIST.has(key.toLowerCase())) headers.set(key, value);
  }

  headers.set("apikey", serviceKey);
  if (!isOpaqueSupabaseKey(serviceKey)) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }

  return headers;
}

function filteredResponseHeaders(source: Headers) {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (RESPONSE_HEADER_ALLOWLIST.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function getRuntimeConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Lovable Televoting backend credentials are unavailable.");
  }

  const parsed = new URL(url);
  if (parsed.hostname !== TELEVOTING_HOST) {
    throw new Error("Lovable Televoting backend points at an unexpected database.");
  }

  return { url, serviceKey };
}

function readSolarisToken(request: Request) {
  const explicit = request.headers.get("x-solaris-access-token")?.trim();
  if (explicit) return explicit;

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return "";
}

export const Route = createFileRoute("/api/solaris-admin-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const accessToken = readSolarisToken(request);
          if (!accessToken || !(await verifySolarisOrganizer(accessToken))) {
            return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
          }

          const { url, serviceKey } = getRuntimeConfig();
          const health = await fetch(`${url}/rest/v1/admin_accounts?select=id&limit=1`, {
            headers: serviceHeaders(serviceKey),
          });

          if (!health.ok) {
            return Response.json(
              { ok: false, error: "Televoting backend is not ready" },
              { status: 503 },
            );
          }

          return Response.json(
            { ok: true },
            { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
          );
        } catch (error) {
          console.error("Solaris Televoting bridge health failed:", error);
          return Response.json({ ok: false, error: "Bridge unavailable" }, { status: 503 });
        }
      },

      POST: async ({ request }) => {
        try {
          const accessToken = readSolarisToken(request);
          if (!accessToken || !(await verifySolarisOrganizer(accessToken))) {
            return Response.json({ error: "Forbidden" }, { status: 403 });
          }

          const payload = (await request.json()) as {
            url?: string;
            method?: string;
            headers?: Record<string, string>;
            body?: string | null;
          };

          if (!payload.url) {
            return Response.json({ error: "Missing target URL" }, { status: 400 });
          }

          const target = new URL(payload.url);
          if (
            target.protocol !== "https:" ||
            target.hostname !== TELEVOTING_HOST ||
            !target.pathname.startsWith("/rest/v1/")
          ) {
            return Response.json({ error: "Target is not allowed" }, { status: 400 });
          }

          const method = (payload.method ?? "GET").toUpperCase();
          if (!["GET", "POST", "PATCH", "DELETE", "HEAD"].includes(method)) {
            return Response.json({ error: "Method is not allowed" }, { status: 405 });
          }

          const { serviceKey } = getRuntimeConfig();
          const upstream = await fetch(target.toString(), {
            method,
            headers: serviceHeaders(serviceKey, payload.headers),
            body: method === "GET" || method === "HEAD" ? undefined : payload.body ?? undefined,
          });

          return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: filteredResponseHeaders(upstream.headers),
          });
        } catch (error) {
          console.error("Solaris Televoting admin proxy failed:", error);
          return Response.json({ error: "Bridge request failed" }, { status: 500 });
        }
      },
    },
  },
});
