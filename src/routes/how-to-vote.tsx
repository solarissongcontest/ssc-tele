import { createFileRoute, Link } from "@tanstack/react-router";
import { Vote, ShieldCheck, Calculator, Sparkles } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/how-to-vote")({
  head: () => ({
    meta: [
      { title: "How the Solaris Televote Works" },
      {
        name: "description",
        content:
          "How to cast your Solaris Song Contest televote: 20 points across at least 5 countries, and how those votes convert into official televote points.",
      },
      { property: "og:title", content: "How the Solaris Televote Works" },
      {
        property: "og:description",
        content:
          "Voting rules, anti-abuse safeguards and the rank-weighted conversion behind the Solaris televote.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/how-to-vote" }],
  }),
  component: HowToVote,
});

const STEPS = [
  {
    icon: Vote,
    title: "1. Register",
    body: "Choose a display name and your home country. You may come from any Solaris nation, even one that isn't competing in the current round.",
  },
  {
    icon: Sparkles,
    title: "2. Spread your 20 points",
    body: "Give out exactly 20 points across at least 5 different countries, with a maximum of 10 points to any single country. If your own country is competing, it's locked — you can't vote for yourself.",
  },
  {
    icon: ShieldCheck,
    title: "3. One vote per round",
    body: "Each round accepts one televote per person. Duplicate attempts from the same name, network or device are blocked and reviewed by the organizers.",
  },
  {
    icon: Calculator,
    title: "4. Conversion to televote points",
    body: "When a round closes, countries are ranked by their raw vote totals. Each rank gets a weight of (n + 2 − rank) raised to an exponent, the weighted scores are scaled into the organizer's fixed point pool, and leftovers go to the largest remainders — so the published points are always whole numbers that sum exactly to the pool.",
  },
];

function HowToVote() {
  return (
    <PublicShell>
      <div className="space-y-6">
        <header className="text-center space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-primary">#GETTINGHIGH</p>
          <h1 className="text-2xl sm:text-3xl font-bold">How the televote works</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Everything you need to know before the booth opens.
          </p>
        </header>

        <div className="space-y-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <section
                key={s.title}
                className="glass rounded-3xl p-5 flex gap-4 animate-fade-in"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="h-10 w-10 shrink-0 rounded-2xl bg-hero grid place-items-center shadow-glow">
                  <Icon className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="min-w-0 space-y-1">
                  <h2 className="font-semibold">{s.title}</h2>
                  <p className="text-sm text-muted-foreground">{s.body}</p>
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild className="bg-hero text-primary-foreground shadow-glow">
            <Link to="/">Go to the voting booth</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/results">See published results</Link>
          </Button>
        </div>
      </div>
    </PublicShell>
  );
}
