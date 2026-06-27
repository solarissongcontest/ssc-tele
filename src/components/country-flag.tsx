import { cn } from "@/lib/utils";

export type CountryLike = {
  code?: string;
  name?: string | null;
  flag?: string | null;
  flag_url?: string | null;
} | null | undefined;

export const UNKNOWN_COUNTRY_NAME = "Unknown Country";

export function countryName(c: CountryLike): string {
  return c?.name ?? UNKNOWN_COUNTRY_NAME;
}

/**
 * Renders a country flag. If a CDN flag image is configured, it is shown as an
 * <img>; otherwise the emoji fallback (or a generic white flag) is rendered.
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
  const url = country?.flag_url;
  const alt = country?.name ?? country?.code ?? "Flag";

  if (url) {
    return (
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className={cn(
          "inline-block rounded-[3px] object-cover shrink-0 ring-1 ring-white/15 shadow-sm",
          className,
        )}
        style={{ width: size, height: Math.round(size * 0.66) }}
      />
    );
  }
  return (
    <span
      aria-label={alt}
      className={cn("inline-block leading-none align-middle shrink-0", className)}
      style={{ fontSize: size }}
    >
      {country?.flag ?? "🏳️"}
    </span>
  );
}
