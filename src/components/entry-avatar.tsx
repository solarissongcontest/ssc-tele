import { cn } from "@/lib/utils";
import { CountryFlag } from "@/components/country-flag";
import {
  getEntryDisplayName,
  getEntryImage,
  getEntryInitials,
  entryAsCountry,
  type ResolvedEntry,
} from "@/lib/round-entries";

/**
 * Renders the visual for any round participant: a flag for country entries,
 * custom artwork for custom entries, or an initials tile when no image exists.
 */
export function EntryAvatar({
  entry,
  size = 28,
  className,
}: {
  entry: ResolvedEntry | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!entry) return <CountryFlag country={null} size={size} className={className} />;

  if (entry.entry_type === "country") {
    return (
      <CountryFlag country={entryAsCountry(entry)} size={size} className={className} />
    );
  }

  const img = getEntryImage(entry);
  if (img) {
    return (
      <img
        src={img}
        alt={getEntryDisplayName(entry)}
        loading="lazy"
        className={cn(
          "inline-block shrink-0 rounded-lg object-cover ring-1 ring-white/15",
          className,
        )}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15 font-semibold",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
    >
      {getEntryInitials(entry) || "?"}
    </span>
  );
}

/** Name + optional subtitle, safe for narrow mobile layouts. */
export function EntryLabel({
  entry,
  className,
  showSubtitle = true,
}: {
  entry: ResolvedEntry | null | undefined;
  className?: string;
  showSubtitle?: boolean;
}) {
  return (
    <span className={cn("min-w-0 flex flex-col", className)}>
      <span className="truncate">{getEntryDisplayName(entry)}</span>
      {showSubtitle && entry?.subtitle ? (
        <span className="truncate text-[11px] text-muted-foreground">
          {entry.subtitle}
        </span>
      ) : null}
    </span>
  );
}
