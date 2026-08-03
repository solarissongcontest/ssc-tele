// Lightweight in-memory rate limiter for server functions.
//
// State lives per Worker isolate, so this is a best-effort throttle in front of
// the durable, database-level duplicate checks — not a replacement for them.
// It exists to absorb bursts (scripted retries, refresh-spam) cheaply.

type Bucket = { hits: number[]; };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0]!;
    buckets.set(key, bucket);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  // Cheap eviction so a long-lived isolate can't grow without bound.
  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => now - t >= windowMs)) buckets.delete(k);
      if (buckets.size <= MAX_KEYS) break;
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Throws a user-facing error when the caller is over the limit. */
export function enforceRateLimit(
  key: string,
  opts: { limit: number; windowMs: number; message?: string },
) {
  const res = rateLimit(key, opts);
  if (!res.allowed) {
    throw new Error(
      opts.message ??
        `Too many attempts. Please wait ${res.retryAfterSeconds}s and try again.`,
    );
  }
}
