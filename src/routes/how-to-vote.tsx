import {
  createFileRoute,
  Link,
} from "@tanstack/react-router";

import {
  HowToVoteContent,
} from "@/components/how-to-vote-content";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/how-to-vote")({
  head: () => ({
    meta: [
      {
        title: "How the Solaris Televote Works",
      },
      {
        name: "description",
        content:
          "How to cast your Solaris Song Contest televote, including voting rules, fair-voting safeguards and result conversion.",
      },
      {
        property: "og:title",
        content: "How the Solaris Televote Works",
      },
      {
        property: "og:description",
        content:
          "Voting rules, anti-abuse safeguards and the Solaris televote process.",
      },
      {
        property: "og:type",
        content: "article",
      },
      {
        name: "twitter:card",
        content: "summary_large_image",
      },
    ],

    links: [
      {
        rel: "canonical",
        href: "/how-to-vote",
      },
    ],
  }),

  component: HowToVote,
});

function HowToVote() {
  return (
    <PublicShell>
      <HowToVoteContent />

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button
          asChild
          className="bg-hero text-primary-foreground shadow-glow"
        >
          <Link to="/">
            Go to the voting booth
          </Link>
        </Button>

        <Button
          asChild
          variant="outline"
        >
          <Link to="/results">
            See published results
          </Link>
        </Button>
      </div>
    </PublicShell>
  );
}
