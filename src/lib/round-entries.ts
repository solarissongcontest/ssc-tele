// Generic round participants ("entries").
//
// A round may contain country entries, organizer-written custom entries, or
// both. Every entry has a stable database id and a stable `entry_key` that is
// used as the ballot / result key everywhere in the system. For country
// entries the key IS the country code, which keeps every historical country
// round, result row and combined aggregation valid without migration.

import type { CountryLike } from "@/components/country-flag";

export type EntryType = "country" | "custom";
export type ParticipantMode = "countries" | "custom" | "mixed";
export type SelfVotingMode =
  | "country_match"
  | "linked_identity"
  | "disabled"
  | "unrestricted";

export type RoundEntry = {
  id: string;
  round_id?: string;
  entry_type: EntryType;
  /** stable ballot / result key — country code for country entries */
  entry_key: string;
  country_code: string | null;
  custom_name: string | null;
  short_name: string | null;
  entry_code: string | null;
  subtitle: string | null;
  image_url: string | null;
  description: string | null;
  display_order: number;
};

export type CountryRecord = {
  code: string;
  name: string;
  flag?: string | null;
  flag_url?: string | null;
};

export type ResolvedEntry = RoundEntry & { country: CountryRecord | null };

export function resolveEntry(
  entry: RoundEntry,
  countries: Map<string, CountryRecord>,
): ResolvedEntry {
  return {
    ...entry,
    country: entry.country_code ? (countries.get(entry.country_code) ?? null) : null,
  };
}

/** Display name for any entry — country name or organizer-written text. */
export function getEntryDisplayName(entry: ResolvedEntry | null | undefined): string {
  if (!entry) return "Unknown entry";
  if (entry.entry_type === "custom")
    return entry.custom_name?.trim() || entry.entry_key;
  return entry.country?.name || entry.country_code || entry.entry_key;
}

export function getEntryShortName(entry: ResolvedEntry | null | undefined): string {
  return entry?.short_name?.trim() || getEntryDisplayName(entry);
}

/** Short code shown in tables / exports. */
export function getEntryCode(entry: ResolvedEntry | null | undefined): string {
  if (!entry) return "";
  if (entry.entry_type === "custom")
    return entry.entry_code?.trim() || entry.entry_key;
  return entry.country_code ?? entry.entry_key;
}

/** Image for the entry: flag for countries, custom artwork otherwise. */
export function getEntryImage(entry: ResolvedEntry | null | undefined): string | null {
  if (!entry) return null;
  if (entry.entry_type === "custom") return entry.image_url?.trim() || null;
  return entry.country?.flag_url ?? null;
}

/** The country-shaped object <CountryFlag/> expects, or null for custom entries. */
export function entryAsCountry(entry: ResolvedEntry | null | undefined): CountryLike {
  if (!entry || entry.entry_type !== "country") return null;
  return entry.country ?? { code: entry.country_code ?? "", name: entry.country_code };
}

/** Initials fallback used when a custom entry has no image. */
export function getEntryInitials(entry: ResolvedEntry | null | undefined): string {
  const name = getEntryDisplayName(entry);
  return name
    .split(/[\s—–-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function isCountryOnly(entries: { entry_type: EntryType }[]): boolean {
  return entries.length > 0 && entries.every((e) => e.entry_type === "country");
}

/** Contextual noun for the current line-up: "countries" vs "entries". */
export function entryNoun(
  entries: { entry_type: EntryType }[],
  plural = true,
): string {
  if (isCountryOnly(entries)) return plural ? "countries" : "country";
  return plural ? "entries" : "entry";
}

export function sortEntries<T extends { display_order: number; entry_key: string }>(
  entries: T[],
): T[] {
  return [...entries].sort(
    (a, b) => a.display_order - b.display_order || a.entry_key.localeCompare(b.entry_key),
  );
}

/** Builds a lookup keyed by the stable entry key. */
export function entryMap(entries: ResolvedEntry[]): Map<string, ResolvedEntry> {
  const m = new Map<string, ResolvedEntry>();
  entries.forEach((e) => m.set(e.entry_key, e));
  return m;
}
