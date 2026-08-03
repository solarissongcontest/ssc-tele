import { cn } from "@/lib/utils";

/** Shimmering glass placeholder line. */
export function SkeletonLine({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-3 rounded-full bg-white/10 animate-pulse",
        className,
      )}
    />
  );
}

/** Generic frosted panel placeholder used while a data panel loads. */
export function PanelSkeleton({
  lines = 4,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("glass rounded-3xl p-6 space-y-3", className)} aria-hidden>
      <SkeletonLine className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} className={i % 3 === 2 ? "w-2/3" : "w-full"} />
      ))}
    </div>
  );
}

/** Placeholder for a data table / ranked list. */
export function TableSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("glass rounded-3xl p-4 space-y-2.5", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-1.5">
          <div className="h-7 w-7 rounded-full bg-white/10 animate-pulse shrink-0" />
          <SkeletonLine className="flex-1" />
          <SkeletonLine className="h-3 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder grid for KPI stat cards. */
export function StatsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass rounded-xl p-4 sm:p-5 space-y-4">
          <SkeletonLine className="w-1/2" />
          <SkeletonLine className="h-6 w-1/3" />
        </div>
      ))}
    </div>
  );
}
