import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  resolveEntry,
  sortEntries,
  type CountryRecord,
  type ResolvedEntry,
  type RoundEntry,
} from "@/lib/round-entries";

/**
 * Resolves stable entry_key values through round_entries.
 *
 * Country entries still use their country code as entry_key.
 * Custom entries are resolved only by entry_key, never by display name.
 */
export function useEntryKeyCatalog(entryKeys: string[]) {
  const stableKeys = useMemo(
    () =>
      Array.from(
        new Set(
          entryKeys
            .map((key) => String(key ?? "").trim())
            .filter(Boolean),
        ),
      ).sort(),
    [entryKeys.join("|")],
  );

  return useQuery({
    queryKey: ["entry-key-catalog", stableKeys],
    enabled: stableKeys.length > 0,

    queryFn: async (): Promise<ResolvedEntry[]> => {
      const { data: rows, error: entryError } = await supabase
        .from("round_entries" as any)
        .select(
          "id,round_id,entry_type,entry_key,country_code,custom_name,short_name,entry_code,subtitle,image_url,description,display_order",
        )
        .in("entry_key", stableKeys);

      if (entryError) throw entryError;

      const raw = (rows ?? []) as unknown as RoundEntry[];

      /*
       * The same country entry_key can appear in many rounds. Collapse by
       * entry_key because the key, not the round-local row UUID, is the
       * identity used by ballots/results/detection.
       */
      raw.sort(
        (a, b) =>
          a.entry_key.localeCompare(b.entry_key) ||
          a.display_order - b.display_order ||
          (a.round_id ?? "").localeCompare(b.round_id ?? "") ||
          a.id.localeCompare(b.id),
      );

      const unique = new Map<string, RoundEntry>();
      for (const entry of raw) {
        if (!unique.has(entry.entry_key)) {
          unique.set(entry.entry_key, entry);
        }
      }

      const uniqueEntries = Array.from(unique.values());

      const countryCodes = Array.from(
        new Set(
          uniqueEntries
            .map((entry) => entry.country_code)
            .filter((code): code is string => Boolean(code)),
        ),
      );

      const countries = new Map<string, CountryRecord>();

      if (countryCodes.length > 0) {
        const { data: countryRows, error: countryError } = await supabase
          .from("countries")
          .select("code,name,flag,flag_url")
          .in("code", countryCodes);

        if (countryError) throw countryError;

        for (const country of countryRows ?? []) {
          countries.set(country.code, country);
        }
      }

      return uniqueEntries.map((entry) => resolveEntry(entry, countries));
    },

    staleTime: 30_000,
  });
}

/** Resolve every participant configured for one voting round. */
export function useRoundEntryCatalog(roundId: string | null) {
  return useQuery({
    queryKey: ["round-entry-catalog", roundId],
    enabled: Boolean(roundId),

    queryFn: async (): Promise<ResolvedEntry[]> => {
      if (!roundId) return [];

      const { data: rows, error: entryError } = await supabase
        .from("round_entries" as any)
        .select(
          "id,round_id,entry_type,entry_key,country_code,custom_name,short_name,entry_code,subtitle,image_url,description,display_order",
        )
        .eq("round_id", roundId)
        .order("display_order");

      if (entryError) throw entryError;

      const raw = (rows ?? []) as unknown as RoundEntry[];

      const countryCodes = Array.from(
        new Set(
          raw
            .map((entry) => entry.country_code)
            .filter((code): code is string => Boolean(code)),
        ),
      );

      const countries = new Map<string, CountryRecord>();

      if (countryCodes.length > 0) {
        const { data: countryRows, error: countryError } = await supabase
          .from("countries")
          .select("code,name,flag,flag_url")
          .in("code", countryCodes);

        if (countryError) throw countryError;

        for (const country of countryRows ?? []) {
          countries.set(country.code, country);
        }
      }

      return sortEntries(raw.map((entry) => resolveEntry(entry, countries)));
    },

    staleTime: 15_000,
  });
}
