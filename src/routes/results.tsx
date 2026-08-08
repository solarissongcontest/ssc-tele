import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trophy } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { EntryAvatar } from "@/components/entry-avatar";
import { TableSkeleton } from "@/components/panel-skeleton";
import { PublicShell } from "@/components/public-shell";
import { useRoundEntries } from "@/hooks/use-round-results";
import {
  entryMap,
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
          "Official Solaris Song Contest televote results.",
      },
    ],
  }),
  component: PublicResultsPage,
});

function PublicResultsPage() {
  const fetchResults = useServerFn(getPublishedResults);

  const [mode, setMode] = useState<
    "converted" | "original" | "compare"
  >("converted");

  const { data, isLoading } = useQuery({
    queryKey: ["public-published-results-redesign"],
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

  const totalOriginal = rows.reduce(
    (sum: number, row: any) =>
      sum + Number(row.original_votes ?? 0),
    0,
  );

  const totalConverted = rows.reduce(
    (sum: number, row: any) =>
      sum + Number(row.final_points ?? 0),
    0,
  );

  return (
    <PublicShell>
      <div className="space-y-5">
        <header className="px-1 text-center">
          <p className="text-[11px] uppercase tracking-[0.32em] text-primary">
            Official televote result
          </p>

          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {round
              ? `${round.edition ? `${round.edition} · ` : ""}${round.name}`
              : "Televote results"}
          </h1>

          {round ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {round.total_points} converted televote points · v
              {round.version}
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
            description="Published televote scoreboards appear here after the show."
          />
        ) : null}

        {round ? (
          <>
            <section className="grid grid-cols-3 gap-2">
              <Stat
                label="Entries"
                value={String(rows.length)}
              />
              <Stat
                label="Original"
                value={String(totalOriginal)}
              />
              <Stat
                label="Converted"
                value={String(totalConverted)}
              />
            </section>

            <div className="glass flex gap-1 rounded-2xl p-1.5">
              <ModeButton
                active={mode === "converted"}
                onClick={() => setMode("converted")}
              >
                Converted
              </ModeButton>

              <ModeButton
                active={mode === "original"}
                onClick={() => setMode("original")}
              >
                Original
              </ModeButton>

              <ModeButton
                active={mode === "compare"}
                onClick={() => setMode("compare")}
              >
                Compare
              </ModeButton>
            </div>

            <section className="space-y-2">
              {rows.map((row: any, index: number) => {
                const entryKey =
                  row.entry_key ?? row.country_code;

                const entry =
                  byEntryKey.get(entryKey);

                const label = entry
                  ? getEntryDisplayName(entry)
                  : entryKey;

                const originalRank =
                  Number(row.original_rank ?? index + 1);

                const convertedRank = index + 1;
                const movement =
                  originalRank - convertedRank;

                return (
                  <div
                    key={entryKey}
                    className={`glass-strong grid items-center gap-3 rounded-3xl px-3 py-3 sm:px-4 ${
                      index === 0
                        ? "ring-1 ring-primary/30"
                        : ""
                    } ${
                      mode === "compare"
                        ? "grid-cols-[34px_minmax(0,1fr)_84px_84px]"
                        : "grid-cols-[34px_minmax(0,1fr)_96px]"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${
                        index === 0
                          ? "bg-primary/20 text-primary"
                          : "bg-white/[0.05] text-muted-foreground"
                      }`}
                    >
                      {convertedRank}
                    </div>

                    <div className="flex min-w-0 items-center gap-2.5">
                      <EntryAvatar
                        entry={entry}
                        size={26}
                      />

                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {label}
                        </p>

                        {mode === "compare" ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            original #{originalRank}
                            {movement !== 0
                              ? ` · ${
                                  movement > 0 ? "▲" : "▼"
                                }${Math.abs(movement)}`
                              : " · unchanged"}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {mode === "converted" ? (
                      <Score
                        value={row.final_points}
                        label="points"
                        strong
                      />
                    ) : null}

                    {mode === "original" ? (
                      <Score
                        value={row.original_votes}
                        label="votes"
                      />
                    ) : null}

                    {mode === "compare" ? (
                      <>
                        <Score
                          value={row.original_votes}
                          label="original"
                        />

                        <Score
                          value={row.final_points}
                          label="converted"
                          strong
                        />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </section>

            {round.advanced ? (
              <details className="glass rounded-3xl p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Advanced calculation details
                </summary>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-xs">
                    <thead className="uppercase text-muted-foreground">
                      <tr>
                        <th className="p-2 text-left">
                          Entry
                        </th>
                        <th className="p-2 text-right">
                          Rank factor
                        </th>
                        <th className="p-2 text-right">
                          Weighted
                        </th>
                        <th className="p-2 text-right">
                          Exact quota
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {rows.map((row: any) => {
                        const entryKey =
                          row.entry_key ?? row.country_code;

                        const entry =
                          byEntryKey.get(entryKey);

                        return (
                          <tr
                            key={entryKey}
                            className="border-t border-white/5"
                          >
                            <td className="p-2">
                              {entry
                                ? getEntryDisplayName(entry)
                                : entryKey}
                            </td>

                            <td className="p-2 text-right tabular-nums">
                              {Number(
                                row.rank_factor,
                              ).toFixed(3)}
                            </td>

                            <td className="p-2 text-right tabular-nums">
                              {Number(
                                row.weighted_score,
                              ).toFixed(2)}
                            </td>

                            <td className="p-2 text-right tabular-nums">
                              {Number(
                                row.exact_points,
                              ).toFixed(4)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </>
        ) : null}
      </div>
    </PublicShell>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="glass-strong rounded-2xl p-3 text-center">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>

      <p className="mt-1 text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function Score({
  value,
  label,
  strong = false,
}: {
  value: number;
  label: string;
  strong?: boolean;
}) {
  return (
    <div className="text-right">
      <p
        className={`tabular-nums ${
          strong
            ? "text-xl font-semibold"
            : "text-base font-medium"
        }`}
      >
        {Number(value ?? 0)}
      </p>

      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 flex-1 rounded-xl px-3 text-xs font-medium transition ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}
