import { cn } from "@/lib/utils";

export function SolarisLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="leading-tight">
        <div className="font-logo text-xl text-gradient leading-none">SOLARIS</div>
        <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground mt-0.5">Song Contest 21</div>
      </div>
    </div>
  );
}
