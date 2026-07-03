
# Solaris Admin Overhaul — Staged Plan

The full request is very large. Shipping it in one pass would leave half-broken pieces (auth swap, realtime, geolocation, similarity/cluster ML, exports, audit log, alerts). I'll deliver it in 5 phases. Each phase is independently usable and reviewable. You approve before I start the next.

---

## Phase 1 — Panel Opacity slider (Theme Editor)

Small, immediate win.

- Add `panelOpacity` (0.00–0.60, default 0.10) to the theme in `src/lib/theme.ts`.
- Apply as CSS variable `--panel-alpha` on `<html>` via `theme-applier.tsx`.
- Rewrite the frosted-surface rules in `src/styles.css` so every panel/card/modal/dropdown/sidebar uses `rgba(10, 20, 40, var(--panel-alpha))` instead of hard-coded `transparent`. Blur stays untouched.
- Add a slider row in `src/routes/admin.theme.tsx` with live preview and reset.

Deliverable: one slider globally controls transparency of ALL frosted surfaces.

---

## Phase 2 — Custom Super Admin auth (replaces Sign Up / Google)

Removes Supabase email/password and Google OAuth flow from the UI and builds an internal admin-account system.

### DB migration
- `admin_accounts(id, username unique citext, password_hash, is_super_admin bool, disabled bool, created_by uuid, last_login_at, created_at, updated_at)`
- `admin_sessions(id, admin_id, token_hash, expires_at, created_at, user_agent, ip_hash)`
- `admin_audit_log(id, actor_admin_id, action, target_type, target_id, old_values jsonb, new_values jsonb, reason, created_at)` — insert-only, RLS blocks non-super updates/deletes.
- Seed row: `Arthur` with bcrypt hash of `SuomenParas67!`, `is_super_admin=true`. Password computed server-side in the migration via `crypt()` + `pgcrypto`, never in client code.
- RLS: all three tables only readable via SECURITY DEFINER RPCs.

### Server functions (`src/lib/admin-auth.functions.ts`)
- `adminLogin({username, password})` → verifies bcrypt via `pgcrypto`, issues opaque session token stored as httpOnly cookie via `useSession`.
- `adminLogout()`, `getCurrentAdmin()`, `listAdmins()`, `createAdmin()`, `updateAdmin()`, `resetAdminPassword()`, `disableAdmin()`, `deleteAdmin()` — the last five gated to super-admin only. Every mutation writes to `admin_audit_log`.
- Sessions use `@tanstack/react-start/server` `useSession` with `SESSION_SECRET` (auto-generated secret).

### Routes
- Replace `src/routes/auth.tsx` with a single Username + Password + Log In form. Remove tabs, Google button, sign-up.
- New `src/routes/admin.accounts.tsx` (super-admin only). Sidebar entry in `admin-shell.tsx`.
- New `_authenticated` gate switches from `supabase.auth.getUser()` to the new session check.

### Sunset
- Keep existing Supabase `auth.users` for now (moderation-vote tables reference nothing there), but the UI no longer surfaces sign-up or Google.

---

## Phase 3 — Moderation core

### DB migration
- Add columns to `vote_submissions`: `status` (`accepted|suspicious|deleted|whitelisted`), `risk_score`, `ip_country`, `is_vpn`, `moderator_note`, `verified_at`, `verified_by`, `deleted_at`, `deleted_by`.
- Enforce `UNIQUE(round_id, country_code) WHERE status <> 'deleted'` — one vote per Terra Solaris country per round (objective rule from your spec).
- `moderator_actions` audit table.
- Update `submit_vote()` RPC: reject if same `country_code` already voted this round; store `ip_country`, `is_vpn`, `risk_score` computed via new helper.
- Add view `v_active_votes` filtering out `deleted` — results/analytics read from it.

### IP geolocation (country only, never raw IP)
- Server function calls Cloudflare's `request.cf.country` (free, already available in the Worker runtime) — no external API needed. Store 2-letter country code + hash of IP. Raw IP is never persisted.
- VPN heuristic: compare `cf.country` vs claimed country and check `cf.asn` against a small hosted-provider list (Cloudflare, DigitalOcean, AWS, OVH, Hetzner) → `is_vpn` boolean.

### Risk scoring
Server-side pure function combining the factors you listed. Recomputed on insert and whenever moderator changes status.

### Live moderation dashboard (`admin.anti-abuse.tsx` rebuild)
- Table with: username, claimed country + flag, estimated IP country + flag, match icon, VPN badge, timestamp, fp hash (short), ip hash (short), risk pill (green/yellow/orange/red), status pill, round, edition.
- Row actions: Approve, Delete, Restore, Mark Suspicious, Whitelist, Ban fp/username/ip-hash, Add note, Edit vote (opens modal reusing voting-booth logic).
- Filters: edition, round, country, claimed vs estimated mismatch, risk level, status, username, date range, VPN, deleted.
- Search bar (server-side ilike).
- Supabase realtime subscription on `vote_submissions` + `anti_abuse_events` → auto-refresh.
- CSV + JSON export of the filtered view.

### Results page updates
- Per-voter expandable row showing full breakdown + risk + status + note.
- "Include deleted votes" toggle.
- All rankings/analytics recompute automatically because they read `v_active_votes`.

---

## Phase 4 — Advanced detection

- Similar-ballot detection: nightly + on-demand cosine similarity between ballots in the same round; store `ballot_similarity(a, b, score)`; UI surfaces pairs >0.90 with time delta.
- Cluster detection: union-find over similar-ballot edges + shared fingerprint/ip-hash; UI groups them with combined risk.
- Friend-voting / voting-bloc: per country pair, mean points given across editions, z-score outliers highlighted.
- Alerts badge in sidebar driven by counts of suspicious/blocked/VPN in the last 24h.

---

## Phase 5 — Analytics expansion & polish

- New Analytics tiles: avg points received/given per country, top destinations by voter country, point distribution, submissions-over-time chart, risk distribution, participation, unique voters, deleted/accepted/suspicious/whitelisted counts.
- Excel-friendly XLSX export in addition to CSV (using the xlsx skill).
- Moderator audit-log viewer (super-admin only) with filters and export.

---

## Technical notes

- Passwords: `pgcrypto` `crypt(password, gen_salt('bf', 12))` — bcrypt equivalent, hash never leaves the DB. No JS bcrypt dependency needed.
- IP handling: only `sha256(ip + per-round salt)` and 2-letter country code stored. Raw IP never persisted or logged.
- Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE public.vote_submissions, public.anti_abuse_events, public.moderator_actions;`
- Auth model swap does not touch Supabase RLS on data tables — server functions use `supabaseAdmin` after verifying the admin session cookie server-side. Regular voting endpoints stay anonymous (as today).
- Vote edits go through a single `moderator_edit_vote` RPC that revalidates the 20-point / ≥5-country / no-self-vote rules and writes before/after JSON to `moderator_actions`.

---

## What I need from you

1. Approve this staged plan (or tell me to reorder / drop phases).
2. Confirm I should proceed with **Phase 1 immediately** after approval, then pause for review before Phase 2.
3. Confirm you're OK with Cloudflare's built-in `request.cf.country` for IP geolocation (free, no external API key). If you'd rather use ipinfo.io / MaxMind, I'll wire that instead in Phase 3.

