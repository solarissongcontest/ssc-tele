import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trophy } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { EntryAvatar } from "@/components/entry-avatar";
import { TableSkeleton } from "@/components/panel-skeleton";
import { PublicShell } from "@/components/public-shell";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useRoundEntries } from "@/hooks/use-round-results";
import {
  entryMap,
  entryNoun,
  getEntryDisplayName,
} from "@/lib/round-entries";
import { getPublishedResults } from "@/lib/televote.functions";

export const Route = createFileRoute("/results")({
  head: () => ({
    meta: [
      {
        title: "Televote Results — Solaris Song Contest",
      },
      {
        name: "description",
        content:
          "Official Solaris Song Contest televote results: original vote totals and converted televote points for the latest published round.",
      },
      {
        property: "og:title",
        content: "Televote Results — Solaris Song Contest",
      },
      {
        property: "og:description",
        content:
          "Original vote totals and converted televote points for the latest published Solaris round.",
      },
      { property: "og:type", content: "website" },
      {
        name: "twitter:card",
        content: "summary_large_image",
      },
    ],
  }),
  component: PublicResultsPage,
});

function PublicResultsPage() {
  const fetchResults = useServerFn(getPublishedResults);

  const [mode, setMode] = useState<
    "original" | "converted" | "side"
  >("side");

  const { data, isLoading } = useQuery({
    queryKey: ["public-published-results"],
    queryFn: async () =>
      await fetchResults({ data: {} }),
    refetchInterval: 15_000,
  });

  const round = data?.round ?? null;
  const rows = data?.rows ?? [];

  const { data: roundEntries = [] } =
    useRoundEntries(round?.id ?? null);

  const byEntryKey = useMemo(
    () => entryMap(roundEntries),
    [roundEntries],
  );

  const participantLabel = entryNoun(
    roundEntries,
    false,
  );

  return (
    <PublicShell>
      <div className="space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-primary">
            Official result
          </p>

          <h1 className="text-2xl font-semibold">
            {round
              ? `${
                  round.edition
                    ? `${round.edition} — `
                    : ""
                }${round.name}`
              : "Televote results"}
          </h1>

          {round ? (
            <p className="text-xs text-muted-foreground">
              {round.total_points} televote points distributed · v
              {round.version} ·{" "}
              {round.calculated_at
                ? new Date(
                    round.calculated_at,
                  ).toLocaleString()
                : ""}
            </p>
          ) : null}
        </header>

        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : null}

        {!isLoading && !round ? (
          <EmptyState
            icon={Trophy}
            title="No results published yet"
            description="Published televote scoreboards appear here right after the show."
          />
        ) : null}

        {round ? (
          <>
            <Tabs
              value={mode}
              onValueChange={(value) =>
                setMode(value as typeof mode)
              }
            >
              <TabsList className="w-full">
                <TabsTrigger
                  className="flex-1"
                  value="original"
                >
                  Original
                </TabsTrigger>

                <TabsTrigger
                  className="flex-1"
                  value="converted"
                >
                  Converted
                </TabsTrigger>

                <TabsTrigger
                  className="flex-1"
                  value="side"
                >
                  Side-by-side
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="glass overflow-x-auto rounded-3xl p-4">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">#</th>

                    <th className="py-2 pr-3">
                      {participantLabel}
                    </th>

                    {mode !== "converted" ? (
                      <th className="py-2 pr-3 text-right">
                        Original votes
                      </th>
                    ) : null}

                    {mode !== "original" ? (
                      <th className="py-2 pr-3 text-right">
                        Televote points
                      </th>
                    ) : null}

                    {round.advanced &&
                    mode === "side" ? (
                      <>
                        <th className="py-2 pr-3 text-right">
                          Rank factor
                        </th>
                        <th className="py-2 pr-3 text-right">
                          Weighted
                        </th>
                        <th className="py-2 pr-3 text-right">
                          Exact quota
                        </th>
                      </>
                    ) : null}
                  </tr>
                </thead>

                <tbody>
                  {rows.map(
                    (row: any, index: number) => {
                      // country_code is the legacy DB/API name.
                      // Its value is a generic entry_key.
                      const entryKey =
                        row.entry_key ??
                        row.country_code;

                      const entry =
                        byEntryKey.get(entryKey);

                      const label = entry
                        ? getEntryDisplayName(entry)
                        : entryKey;

                      return (
                        <tr
                          key={entryKey}
                          className="border-t border-white/5"
                        >
                          <td className="py-2 pr-3 tabular-nums">
                            {index + 1}
                          </td>

                          <td className="py-2 pr-3">
                            <span className="flex items-center gap-2">
                              <EntryAvatar
                                entry={entry}
                                size={20}
                              />
                              <span>{label}</span>
                            </span>
                          </td>

                          {mode !== "converted" ? (
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {row.original_votes}
                            </td>
                          ) : null}

                          {mode !== "original" ? (
                            <td className="py-2 pr-3 text-right text-base font-semibold tabular-nums">
                              {row.final_points}
                            </td>
                          ) : null}

                          {round.advanced &&
                          mode === "side" ? (
                            <>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {Number(
                                  row.rank_factor,
                                ).toFixed(3)}
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {Number(
                                  row.weighted_score,
                                ).toFixed(2)}
                              </td>

                              <td className="py-2 pr-3 text-right tabular-nums">
                                {Number(
                                  row.exact_points,
                                ).toFixed(4)}
                              </td>
                            </>
                          ) : null}
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </PublicShell>
  );
}
