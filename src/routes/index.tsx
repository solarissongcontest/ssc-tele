import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { Sparkles, Vote } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Solaris Song Contest 21 — Televote" },
      { name: "description", content: "Cast your votes in the Solaris Song Contest televote." },
      { property: "og:title", content: "Solaris Song Contest 21 — Televote" },
      { property: "og:description", content: "Cast your televote in the official Solaris contest." },
    ],
  }),
  component: PublicHome,
});

function PublicHome() {
  return (
    <PublicShell>
      <section className="relative text-center pt-6 pb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs uppercase tracking-widest bg-card border border-border text-muted-foreground mb-5">
          <Sparkles className="h-3 w-3 text-primary" />
          #GETTINGHIGH
        </div>
        <h1 className="text-4xl sm:text-6xl font-black tracking-tight">
          <span className="text-gradient">Solaris</span>
          <br />
          <span className="text-foreground">Televote</span>
        </h1>
        <p className="mt-4 text-muted-foreground max-w-md mx-auto text-sm sm:text-base">
          Your voice decides who shines on the Solaris stage. Distribute your 20 votes across the
          competing nations.
        </p>
      </section>

      <section className="glass-strong rounded-2xl p-8 sm:p-12 text-center space-y-4">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-hero grid place-items-center shadow-glow">
          <Vote className="h-7 w-7 text-primary-foreground" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold">Voting is currently closed</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          The televote booth opens when a round goes live. Check back here when the next show
          starts.
        </p>
      </section>
    </PublicShell>
  );
}
