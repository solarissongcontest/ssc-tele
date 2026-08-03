# Solaris Voting Booth

Build a complete production-ready responsive web app called “Solaris Song Contest Televote” using React + TypeScript + Vite + Tailwind + shadcn/ui + Supabase.

This is not a demo. Build it as a real multi-edition, multi-round televote platform with a polished mobile-first UI, secure admin authentication, anti-duplicate protections, analytics, exports, and a full public voting flow.



1. PRODUCT GOAL

Create a televote platform for Solaris Song Contest 21 where users register with a username and home country, then distribute votes to countries in the currently open round.

The app has two sides:

Public voting side

Visitors go to /

If a round is open, they can register and vote

If no round is open, show a polished “Voting is currently closed” screen

Admin side

Admins log in via Supabase Auth at /auth

Admins can access /admin

Admins manage editions, rounds, country selection, results, analytics, and anti-abuse records



2. DESIGN / BRANDING REQUIREMENTS

The entire app must visually match Solaris Song Contest 21 branding.

Visual style

Use the branding direction of SSC21:

dark luxurious stage-like background

layered blue / teal / green / deep navy gradients

subtle spotlight glow / light bloom / glossy glassmorphism

elegant contest atmosphere, not generic SaaS

refined “Eurovision-style” but specifically inspired by SSC21

Brand inspiration

The UI should reflect:

#GETTINGHIGH concept

geometric layered depth

mountain / diamond / light-center visual energy

cool blue-green Nordic palette

dramatic but readable interface

Layout / UX priority

I want the clarity and smoothness of Base44’s mobile layout, not Lovable’s usual cluttered dashboard feel.

So:

make the interface clean, obvious, and mobile-friendly

use clear cards, large tap targets, simple hierarchy

avoid cramped admin tables

keep spacing generous

make the admin on mobile understandable and easy to navigate



3. TECH STACK REQUIREMENTS

Use:

React

TypeScript

Vite

Tailwind CSS

shadcn/ui

Supabase for database + auth + edge function support

Project must be organized and production-structured.



4. APP ROUTES

Create these routes:

/ → public voting page

/auth → admin login / sign up page

/admin → admin overview dashboard

/admin/editions

/admin/rounds

/admin/results

/admin/analytics

/admin/anti-abuse

Use React Router.



5. CORE CONCEPT: MULTI-EDITION + MULTI-ROUND VOTING

The app must support multiple contest editions and multiple rounds inside an edition.

Examples:

Solaris Song Contest 21



Semi-Final 1

Semi-Final 2

Final

Solaris Song Contest 22



etc.

Important voting rule across rounds

A voter must not be able to vote twice in the same round.

But they must be allowed to vote again when a NEW ROUND opens, even within the same edition.

Example:

User votes in SSC21 Semi-Final 1 → allowed

Same user tries to vote again in SSC21 Semi-Final 1 → blocked

Same user votes in SSC21 Final → allowed

So duplicate protection is per round, not globally per edition.



6. DATABASE ARCHITECTURE

Create a Supabase migration that creates all required tables, enum types, indexes, RLS policies, and helper functions.

All tables should be in public.

6.1 countries

A reusable country library table for the admin.

Columns:

code text primary key

name text not null

flag text not null

Seed it with a large library of real countries, around 250 ISO countries / territories.

Rules:

public can read

only admins can modify



6.2 editions

Columns:

id uuid primary key default gen_random_uuid()

name text not null

is_active boolean not null default false

is_archived boolean not null default false

created_at timestamptz default now()

Rules:

admin write

public read

Only one edition should normally be marked active, but do not hard-crash the app if multiple exist. Admin UI should encourage one active edition.



6.3 rounds

Columns:

id uuid primary key default gen_random_uuid()

edition_id uuid not null references editions(id) on delete cascade

name text not null

status text not null check in (draft, open, closed)

opened_at timestamptz null

closed_at timestamptz null

created_at timestamptz default now()

Rules:

public read

admin write

Important:

only one round globally may have status = ‘open’ at a time

enforce this with a partial unique index on status='open'



6.4 round_countries

This stores the exact 26 countries participating in a specific round and their display order.

Columns:

id uuid primary key default gen_random_uuid()

round_id uuid not null references rounds(id) on delete cascade

country_code text not null references countries(code)

display_order integer not null

Constraints:

unique (round_id, country_code)

unique (round_id, display_order)

Public read, admin write.

Admin UI must enforce exactly 26 countries before a round can be opened.



6.5 vote_submissions

Stores one submission per voter per round.

Columns:

id uuid primary key default gen_random_uuid()

round_id uuid not null references rounds(id) on delete cascade

username text not null

username_normalized text not null

country_code text not null

ip_hash text null

fingerprint_hash text null

device_token_hash text null

risk_score integer not null default 0

created_at timestamptz default now()

Meaning:

country_code = the voter’s own country / home country they vote from

username_normalized = lowercase + trimmed normalized username for duplicate checks

Create unique indexes to block duplicate voting in the same round:

unique (round_id, username_normalized) where username_normalized is used

unique (round_id, ip_hash) if ip_hash is not null

unique (round_id, fingerprint_hash) if fingerprint_hash is not null

unique (round_id, device_token_hash) if device_token_hash is not null

Important:
A person can vote again in a different round, but not again in the same round.

Public should not insert directly into this table. Submissions must go through a protected function / controlled path.



6.6 vote_entries

Stores the points distribution for a submission.

Columns:

id uuid primary key default gen_random_uuid()

submission_id uuid not null references vote_submissions(id) on delete cascade

target_country_code text not null

points integer not null

Constraints:

points must be between 1 and 10

unique (submission_id, target_country_code)



6.7 user roles

Do not store admin role on a profile column.

Create:

app_role enum

Values:

admin

user

user_roles

Columns:

id bigint generated always as identity primary key

user_id uuid not null references auth.users(id) on delete cascade

role app_role not null

unique (user_id, role)

has_role function

Create a SECURITY DEFINER function:
has_role(_user_id uuid, _role app_role) returns boolean

Use this function in RLS policies.



6.8 anti_abuse_events

Create a table for suspicious or blocked attempts.

Columns:

id uuid primary key default gen_random_uuid()

round_id uuid null references rounds(id) on delete set null

username text null

username_normalized text null

country_code text null

ip_hash text null

fingerprint_hash text null

device_token_hash text null

reason text not null

risk_score integer not null default 0

status text not null default ‘blocked’ check in (‘blocked’,‘whitelisted’)

metadata jsonb not null default ‘{}’::jsonb

created_at timestamptz default now()

Purpose:

store all blocked or suspicious vote attempts

admin can review them in /admin/anti-abuse

allow whitelist/unblock action by changing status to whitelisted



7. RLS POLICIES

Use RLS everywhere.

Public readable tables

Public SELECT allowed:

countries

editions

rounds

round_countries

Admin write access

Admins should have ALL permissions on:

countries

editions

rounds

round_countries

anti_abuse_events

Use has_role(auth.uid(), 'admin').

vote_submissions + vote_entries

Public read is okay for admin scoreboard purposes if needed, but no public INSERT.
Vote inserts must happen through the controlled vote submission logic.



8. ANTI-DUPLICATE / ANTI-ABUSE REQUIREMENTS

This is extremely important.

The platform must do the strongest possible duplicate-vote prevention available in Lovable + Supabase.

Goal

Prevent the same person from voting more than once in the same round as aggressively as possible.

Important clarification

No browser-only solution can guarantee “not even with VPN in any form” perfectly. But I still want the strongest practical multi-layer approach available in this stack.

Required duplicate protection layers per round

For each vote submission, create / compare:

username_normalized



lowercase + trim + normalize whitespace

one username can vote only once per round

IP hash



hash of IP + server-side secret salt

one IP fingerprint should only be allowed once per round unless admin later whitelists an attempt

store only the hash, never raw IP

browser/device fingerprint hash



generate a stable client fingerprint from browser/device characteristics

hash before storage if possible

device token hash



generate a persistent device token in localStorage / secure browser storage

hash it before saving

one device token should only be allowed once per round

risk scoring


suspicious attempts should create an anti_abuse_events record with reason and score

examples:



duplicate username in same round

duplicate device token

duplicate fingerprint

duplicate IP hash

invalid voting payload

trying to vote for own country

too many total points

fewer than 5 countries

duplicate target country entries



Required behavior

When a blocked duplicate/suspicious attempt happens:

do not create a valid vote submission

write an anti_abuse_events record with:



username

home country

round

reason

risk score

metadata if useful

Very important round rule

Duplicate blocking is per round.
If a new round opens, the same person may vote again in that new round.



9. VOTE SUBMISSION LOGIC

Implement a secure server-side submission flow for votes using Supabase-compatible backend logic / edge function structure where possible.

Create a vote submission function / backend path that accepts:

{

  username: string;

  country_code: string; // voter's own country

  votes: Array<{ country_code: string; points: number }>;

}

The function must:

resolve the currently open round

fetch its 26 configured countries

validate that the voter’s home country is one of those 26

block voting for own country

validate all televote rules

run duplicate / anti-abuse checks

if valid, insert into vote_submissions + vote_entries

if invalid or suspicious, log anti_abuse_events when appropriate

return a clear success or error message



10. PUBLIC VOTING RULES

These rules apply on the public voting page and must also be enforced server-side / in submission logic.

Registration step

The user must first:

enter a username

select their own country from the currently open round’s 26 countries

Then they proceed to the voting screen.

Voting rules

exactly 26 countries/options are shown in the round

the voter cannot vote for their own country

the voter must distribute exactly 20 total votes

a voter may give max 10 votes to one country

they must vote for at least 5 different countries

only integer vote values

no duplicate target country entries beyond the one visible card per country

Public voting UI requirements

The main voting page should work like this:

Stage 1: registration card

username input

home country select

button: Continue to Voting

Stage 2: voting booth

Show:

username and home country summary

live “votes remaining” counter out of 20

live “countries used” counter

validation hints

26 country cards in a clean responsive grid/list

for each country:



flag

country name

minus button

current assigned points

plus button

own country must be visibly disabled and marked as not votable

Controls

reset votes button

submit final vote button

Validation behavior

Prevent submit until rules are satisfied.
Show clear validation messages:

“You must distribute exactly 20 votes”

“You must vote for at least 5 countries”

“You cannot vote for your own country”

etc.

Stage 3: confirmation

After successful submission, show a confirmation screen with:

username

home country

vote breakdown

success message

Do not show a “vote again” button.
After successful submission, the user should only see confirmation and optionally a button back to homepage, but not a way to re-enter the same round vote flow as if another vote were allowed.



11. WHAT THE PUBLIC PAGE MUST LOAD FROM DB

The public voting page must not use a hard-coded 26-country list.

On load, it must:

fetch the currently open round

fetch that round’s round_countries

join country info from countries

display only those 26 configured countries

If no round is open:

show a polished “Voting is currently closed” state

If the round exists but has no countries configured:

show a clear admin-facing-friendly error state like “This round has no countries configured.”



12. ADMIN AUTH

Create a real admin auth system using Supabase Auth.

/auth page

Build a polished auth page with:

email input

password input

sign in button

sign up button

“Continue with Google” button

Use Supabase auth methods.

Also build:

useAuth hook

useIsAdmin hook

Admin access must be based on user_roles, not a fake password gate.

Admin access behavior

non-authenticated users trying /admin should be redirected to /auth

authenticated non-admin users should see a clear “Not authorized” state

admins can access all admin pages



13. ADMIN NAVIGATION / LAYOUT

Create a polished admin shell with:

left sidebar on desktop

mobile-friendly drawer/sidebar on phone

top bar with page title

sign out button

Back to Voting button that returns to /

Sidebar entries

Include:

Overview

Editions

Rounds

Results

Analytics

Anti-Abuse

The admin should feel clean and understandable, similar to the Base44 layout style:

clear cards

tidy spacing

readable sections

mobile-first friendliness



14. ADMIN OVERVIEW PAGE

/admin

Show high-level stats cards:

number of editions

number of rounds

number of open rounds

total voters / submissions

total blocked suspicious attempts

currently active edition

currently open round

Add quick links to:

Editions

Rounds

Results

Analytics

Anti-Abuse

Back to Voting



15. ADMIN EDITIONS PAGE

/admin/editions

Features:

list all editions

create new edition

rename edition

archive / unarchive edition

mark edition active

Fields:

edition name

active badge

archived badge

Keep it clean and mobile friendly.



16. ADMIN ROUNDS PAGE

/admin/rounds

This page is crucial.

Round management features

Within a selected edition, admin can:

create round

rename round

delete draft round

set round status:



draft

open

closed

Global open-round rule

Only one round in the whole app may be open at once.

Country picker

Each round must have a country picker modal / panel where admin selects exactly 26 countries from the full country library.

Requirements:

searchable country library

checkbox selection

visible selected count like 21 / 26

selected list with order controls

drag-ish or up/down ordering is fine

save selection button

Round opening rule

A round cannot be opened unless it has exactly 26 countries configured.

When the admin opens a round:

set status to open

set opened_at

When admin closes a round:

set status to closed

set closed_at



17. ADMIN RESULTS PAGE

/admin/results

This page must show results scoped to a selected round.

At the top:

edition / round selector

refresh button

export buttons

Results content

A. Overall scoreboard

For the selected round show:

ranking

flag

country name

total points

number of voters who gave that country points

B. Per-voter breakdown

For the selected round show every submission:

username

home country

timestamp

full vote breakdown of how that voter distributed their points

This needs to be readable on mobile too, not just a broken desktop table squashed into a phone.

Exports

Add export buttons:

CSV overall

CSV detailed

Excel / Sheets friendly export

JSON export

Exports should include proper country names, not broken two-letter codes unless those codes are explicitly part of the file format.



18. ADMIN ANALYTICS PAGE

/admin/analytics

This page is for voting-pattern insights for the selected round.

At the top:

edition / round selector

refresh button

Show these analytics sections:

A. Voters by home country

For each voter home country:

number of submissions

B. Average points received per target country

Show each target country and its average points per vote-entry / or average per receiving voter basis, whichever is more sensible, but keep it consistent and label it clearly.

C. Bloc behaviour / top 3 targets by voter country

For each home country:

show the top 3 destination countries they awarded most points to

D. Points distribution histogram

Show how many 1s, 2s, 3s, etc. were awarded

E. Submissions over time

Timeline / cumulative or per-time-bucket chart for submissions

Chart requirement

Use lightweight inline charts / SVG or simple chart rendering without bloating the app.

The analytics page must actually react to new votes and current selected round data.



19. ADMIN ANTI-ABUSE PAGE

/admin/anti-abuse

This page must list blocked or suspicious vote attempts.

Show:

timestamp

username

home country

round

reason

risk score

status (blocked / whitelisted)

Add filters:

by round

by status

by search text

Add actions:

Whitelist / unblock a blocked record by changing status to whitelisted

Add exports:

CSV

JSON

This page should exist as a real sidebar entry.



20. EXPORT REQUIREMENTS

For admin exports:

overall scoreboard CSV

detailed per-voter CSV

anti-abuse CSV

JSON export where relevant

“Excel / Sheets” button can download a CSV optimized for spreadsheet import

Make sure exported rows use proper country names and useful columns.



21. IMPORTANT COUNTRY DISPLAY RULE

When rendering results or analytics, do not assume every country exists in a hardcoded 26-country list.

Use the countries table to resolve:

proper country name

flag

If a result country exists in vote data but is missing from the current round selection, still try to resolve it from the master countries table so results don’t show broken garbage like 🏳️ BB unless that country genuinely has no metadata.



22. FRONTEND FILE / COMPONENT STRUCTURE

Organize the code cleanly. Create components and hooks rather than dumping everything into one cursed mega-file.

Use a structure along these lines:

src/pages/Index.tsx

src/pages/Auth.tsx

src/pages/admin/AdminLayout.tsx

src/pages/admin/AdminOverview.tsx

src/pages/admin/Editions.tsx

src/pages/admin/Rounds.tsx

src/pages/admin/Results.tsx

src/pages/admin/Analytics.tsx

src/pages/admin/AntiAbuse.tsx

Hooks:

src/hooks/useAuth.ts

src/hooks/useIsAdmin.ts

src/hooks/useOpenRound.ts

Utilities:

country formatting helpers

export helpers

validation helpers

anti-abuse helpers / fingerprint utilities



23. UX DETAILS I SPECIFICALLY WANT

Public voting page

Make it feel like a polished televote booth:

strong SSC21 hero branding at top

card-based registration form

progress bar for remaining votes

obvious validation notices

disabled own-country card

smooth mobile layout

big tap targets for plus/minus buttons

Admin pages

I want the admin UI to feel closer to the Base44 screenshots:

simple sidebar

readable dashboard cards

scoreboard that is clean on mobile

voter breakdown that is actually understandable

analytics cards with breathing room

anti-abuse page as a first-class feature, not hidden junk



24. IMPORTANT FIXES / BEHAVIOR TO PRESERVE

Please make sure the app does not have these previous problems:

Must not happen:

results not updating when new people vote

analytics not updating after votes

public country selector showing wrong / incomplete list

round configured with countries but public page still says “this round has no countries configured”

successful vote screen offering “vote again”

results showing broken unknown country codes when metadata exists in countries

admin pages depending on a hardcoded country list instead of database country data

Must happen:

opening a round with 26 countries makes those same 26 appear on the public voting page

after a vote is cast, results and analytics reflect the new data

a voter can vote again only when a different round is open

not again in the same round



25. FINAL IMPLEMENTATION EXPECTATION

Deliver the full app, including:

schema / migration

RLS

auth hooks

admin pages

public voting flow

anti-abuse page

export utilities

clean responsive UI

proper data loading from Supabase

no fake placeholder logic if avoidable

Do not leave the core system half-implemented.

If something truly requires a manual post-step, clearly isolate it and keep the rest fully functional.

For example:

if the first admin user must be granted via SQL insert into user_roles, that is acceptable, but everything else should be implemented.

Build this as a real Solaris Song Contest televote platform, not a mockup.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://ssc-tele.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e1848c61-349c-4c53-8d0f-bca7891c1ae9).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
