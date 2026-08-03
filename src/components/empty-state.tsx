import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared empty state for lists, tables and dashboards.
 * Keeps the Liquid Glass language: floating frosted panel, glowing icon droplet.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass rounded-3xl px-6 py-12 text-center flex flex-col items-center gap-3",
        className,
      )}
    >
      <div className="h-14 w-14 rounded-2xl bg-hero grid place-items-center shadow-glow">
        <Icon className="h-6 w-6 text-primary-foreground" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
