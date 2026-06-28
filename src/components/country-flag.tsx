import { cn } from "@/lib/utils";
import noFlagAsset from "@/assets/no-flag-star.png.asset.json";

export type CountryLike = {
  code?: string;
  name?: string | null;
  flag?: string | null;
  flag_url?: string | null;
} | null | undefined;

export const UNKNOWN_COUNTRY_NAME = "Unknown Country";
export const NO_FLAG_PLACEHOLDER_URL = noFlagAsset.url;

export function countryName(c: CountryLike): string {
  return c?.name ?? UNKNOWN_COUNTRY_NAME;
}

/**
 * Renders a country flag. If a CDN flag image is configured, it is shown as an
 * <img>; otherwise the Solaris "no flag" star placeholder is rendered with the
 * same dimensions so the UI remains visually consistent.
 */
export function CountryFlag({
  country,
  className,
  size = 24,
}: {
  country: CountryLike;
  className?: string;
  size?: number;
}) {
  const url = country?.flag_url || NO_FLAG_PLACEHOLDER_URL;
  const alt = country?.name ?? country?.code ?? "Flag";
  const isPlaceholder = !country?.flag_url;

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={cn(
        "inline-block rounded-[3px] shrink-0 ring-1 ring-white/15 shadow-sm",
        isPlaceholder ? "object-contain bg-white/5 p-0.5" : "object-cover",
        className,
      )}
      style={{ width: size, height: Math.round(size * 0.66) }}
    />
  );
}
