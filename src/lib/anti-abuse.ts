// Lightweight client-side fingerprint + persistent device token helpers.
// These are best-effort identifiers. The real duplicate enforcement happens
// inside the `submit_vote` Postgres function.

const DEVICE_KEY = "solaris.device_token.v1";

async function sha256(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getOrCreateDeviceToken(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const fresh =
      crypto.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
        .toString(36)
        .slice(2)}`;
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return `ephemeral-${Math.random().toString(36).slice(2)}`;
  }
}

function buildFingerprintSeed(): string {
  const n = typeof navigator !== "undefined" ? navigator : ({} as Navigator);
  const s = typeof screen !== "undefined" ? screen : ({} as Screen);
  return [
    n.userAgent ?? "",
    n.language ?? "",
    (n as any).languages?.join(",") ?? "",
    (n as any).hardwareConcurrency ?? "",
    (n as any).deviceMemory ?? "",
    s.width ?? "",
    s.height ?? "",
    s.colorDepth ?? "",
    Intl.DateTimeFormat?.().resolvedOptions?.().timeZone ?? "",
  ].join("|");
}

export type ClientIdentity = {
  fingerprint_hash: string;
  device_token_hash: string;
};

export async function buildClientIdentity(): Promise<ClientIdentity> {
  const [fingerprint_hash, device_token_hash] = await Promise.all([
    sha256("solaris-fp:" + buildFingerprintSeed()),
    sha256("solaris-dev:" + getOrCreateDeviceToken()),
  ]);
  return { fingerprint_hash, device_token_hash };
}

const SUBMITTED_KEY = "solaris.submitted_rounds.v1";

export function markRoundSubmitted(roundId: string) {
  try {
    const raw = localStorage.getItem(SUBMITTED_KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    if (!arr.includes(roundId)) arr.push(roundId);
    localStorage.setItem(SUBMITTED_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

export function hasSubmittedRound(roundId: string): boolean {
  try {
    const raw = localStorage.getItem(SUBMITTED_KEY);
    if (!raw) return false;
    const arr: string[] = JSON.parse(raw);
    return arr.includes(roundId);
  } catch {
    return false;
  }
}
