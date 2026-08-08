import {
  Calculator,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Vote,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export const VOTING_RULES_VERSION = "1";

const STEPS = [
  {
    icon: Vote,
    title: "1. Register",
    body:
      "Choose a display name and your home Solaris country. Your home country is your voter identity, even when the entries receiving points are not countries.",
  },
  {
    icon: Sparkles,
    title: "2. Spread your 20 points",
    body:
      "Give out exactly 20 points across at least 5 different entries, with a maximum of 10 points to any single entry. Where self-voting restrictions apply, your own eligible entry is locked.",
  },
  {
    icon: ShieldCheck,
    title: "3. One genuine ballot",
    body:
      "Each round accepts one televote per voter. Vote according to your own preferences rather than coordinating scores with other delegations or arranging reciprocal support.",
  },
  {
    icon: Calculator,
    title: "4. Conversion to televote points",
    body:
      "After voting closes, eligible entries are ranked from the submitted results and converted into the organizer's fixed televote point pool. Published converted points are whole numbers and the allocated pool is kept exact.",
  },
];

export function HowToVoteContent({
  acknowledgement = false,
  acknowledged = false,
  onAcknowledgedChange,
  onContinue,
  continueLabel = "Enter the voting booth",
  intro,
}: {
  acknowledgement?: boolean;
  acknowledged?: boolean;
  onAcknowledgedChange?: (checked: boolean) => void;
  onContinue?: () => void;
  continueLabel?: string;
  intro?: string;
}) {
  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">
          #GETTINGHIGH
        </p>

        <h1 className="text-2xl font-bold sm:text-3xl">
          How the televote works
        </h1>

        <p className="mx-auto max-w-lg text-sm text-muted-foreground">
          {intro ??
            "Everything you need to know before casting a Solaris televote."}
        </p>
      </header>

      <div className="space-y-3">
        {STEPS.map((step, index) => {
          const Icon = step.icon;

          return (
            <section
              key={step.title}
              className="glass flex gap-4 rounded-3xl p-5 animate-fade-in"
              style={{
                animationDelay: `${index * 60}ms`,
              }}
            >
              <div className="bg-hero shadow-glow grid h-10 w-10 shrink-0 place-items-center rounded-2xl">
                <Icon className="h-5 w-5 text-primary-foreground" />
              </div>

              <div className="min-w-0 space-y-1">
                <h2 className="font-semibold">
                  {step.title}
                </h2>

                <p className="text-sm text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </section>
          );
        })}
      </div>

      <section className="rounded-3xl border border-amber-400/30 bg-amber-500/10 p-5">
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />

          <div className="space-y-2">
            <h2 className="font-semibold">
              Fair-voting and friend-voting warning
            </h2>

            <p className="text-sm text-muted-foreground">
              Your ballot should reflect your own genuine preferences. Do not
              coordinate scores, arrange reciprocal support or maximum-score
              swaps, submit duplicate ballots, or attempt to manipulate the
              result.
            </p>

            <p className="text-sm text-muted-foreground">
              Coordinated, duplicate, manipulated, or otherwise invalid
              ballots may be automatically excluded, reviewed by the
              organizers, or removed from the official result. Integrity
              checks are supporting evidence and do not claim to identify
              every possible case perfectly.
            </p>
          </div>
        </div>
      </section>

      {acknowledgement ? (
        <section className="glass-strong space-y-4 rounded-3xl p-5">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(value) =>
                onAcknowledgedChange?.(value === true)
              }
              className="mt-0.5"
            />

            <span className="text-sm leading-relaxed">
              I have read the rules and understand that coordinated,
              duplicate or manipulated votes may be removed.
            </span>
          </label>

          <Button
            className="bg-hero w-full text-primary-foreground shadow-glow sm:w-auto"
            disabled={!acknowledged}
            onClick={onContinue}
          >
            {continueLabel}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
