import { AdminShell } from "@/components/admin-shell";
import type { LucideIcon } from "lucide-react";

export function AdminPlaceholder({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <AdminShell title={title}>
      <div className="glass-strong rounded-2xl p-8 sm:p-12 text-center space-y-4 max-w-xl mx-auto">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-hero grid place-items-center shadow-glow">
          <Icon className="h-7 w-7 text-primary-foreground" />
        </div>
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="text-xs text-muted-foreground/70">Coming in the next build step.</p>
      </div>
    </AdminShell>
  );
}
