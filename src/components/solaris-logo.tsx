import { cn } from "@/lib/utils";

export function SolarisLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <defs>
            <linearGradient id="solg" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.78 0.16 180)" />
              <stop offset="100%" stopColor="oklch(0.70 0.18 155)" />
            </linearGradient>
          </defs>
          <path d="M16 2 L28 16 L16 30 L4 16 Z" stroke="url(#solg)" strokeWidth="1.5" fill="none" />
          <path d="M16 8 L22 16 L16 24 L10 16 Z" fill="url(#solg)" opacity="0.85" />
          <circle cx="16" cy="16" r="2.2" fill="white" />
        </svg>
        <div className="absolute inset-0 blur-md opacity-60 -z-10 bg-hero rounded-full" />
      </div>
      <div className="leading-tight">
        <div className="font-logo text-xl text-gradient leading-none">Solaris</div>
        <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground mt-0.5">Song Contest 21</div>
      </div>
    </div>
  );
}
