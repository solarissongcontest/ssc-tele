## Solaris Televote — Improvement Plan

All four directions, sequenced so each phase ships something usable on its own.

---

### Phase 1 — Visual & UX polish

- **Mobile-first pass** over every admin page. The admin tables (results, anti-abuse, detection, audit log, combined) are dense; on narrow screens they become card lists with the key fields stacked, instead of horizontally scrolling tables.
- **Loading states**: no route currently renders skeletons (`Skeleton` / `animate-pulse` appears nowhere in `src/routes`). Add glass skeleton placeholders for every data panel so pages don't flash empty.
- **Empty states**: a dedicated illustrated empty panel (no rounds yet, no votes yet, no flagged submissions) with a clear next action, instead of blank tables.
- **Micro-animations**: staggered fade-in for lists, animated number counters on dashboard KPIs, smooth transitions on stage changes in the voting booth, and a subtle press/refract animation on the water-drop buttons.
- **Consistency sweep**: unify panel radii, spacing scale, heading sizes, and button sizes across public and admin so nothing looks bolted on.

### Phase 2 — Voter experience

- **Voting booth upgrades**: sticky points-remaining bar on mobile, quick +1/-1 tap targets, a "distribute evenly" helper, inline validation messaging (needs 5+ countries, 20 points exactly) rather than error-on-submit.
- **Search + filter** in the country list for large lineups (up to 50).
- **Confirmation screen**: show the voter's final allocation as a shareable summary card (image-style panel), plus what happens next and when results appear.
- **Round context on the public page**: edition name, round name, how many countries, and a closed/open state banner.
- **Accessibility**: keyboard operable point steppers, focus rings visible on glass, aria labels on flags and steppers, respect `prefers-reduced-motion`.

### Phase 3 — Admin power & reliability

- **Bulk moderation**: multi-select rows on anti-abuse/detection, bulk approve / flag / reject with one confirmation and one audit entry per action.
- **Shared data table**: one reusable table component with sorting, column filters, pagination, and CSV/XLSX/JSON export wired in — replacing the per-page ad-hoc tables.
- **Global search** across submissions by username, IP hash, or country.
- **Rate limiting** on vote submission at the server-function layer (per IP hash and per device token, short window) to blunt scripted flooding.
- **Error handling**: toast + retry on every mutation, an error boundary per admin route, and clearer failure messages from the server functions.
- **Ops panel**: last calculation time, results status per round, and an "everything consistent?" health strip on `/admin`.

### Phase 4 — Public content & discovery

- **Archive**: `/editions` listing past editions and `/editions/$slug` with the final scoreboard per round, driven by the existing archived-edition flag.
- **Live results**: opt-in public live scoreboard while a round is open (organizer toggle), otherwise the published results only.
- **How to vote** page explaining the rules and the rank-weighted conversion in plain language.
- **SEO**: `public/robots.txt` and `public/sitemap.xml` do not exist yet — add both, plus unique canonical tags per public route and JSON-LD (`Event` / `ItemList`) on results pages. Public routes already define `head()`; audit each for a unique title/description and og image.

---

### Technical notes

- New public routes follow the existing file-based pattern (`src/routes/editions.tsx`, `editions.$slug.tsx`, `how-to-vote.tsx`), each with its own `head()`.
- Reusable pieces land in `src/components/` (`data-table.tsx`, `empty-state.tsx`, `panel-skeleton.tsx`, `stat-counter.tsx`) so admin pages shrink rather than grow.
- Rate limiting and bulk actions extend the existing server functions (`vote.functions.ts`, `moderation.functions.ts`) and reuse `supabaseAdmin`, keeping the current custom-admin auth path.
- Archive and live-results reads use the public-safe client with narrow read policies; no new privileged surface.
- No changes to the televote or combined-aggregation math — those stay exactly as they are.

Phases are independent; I can start at Phase 1 or reorder if you'd rather see one area first.
