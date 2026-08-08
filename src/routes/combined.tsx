import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { EntryAvatar } from "@/components/entry-avatar";
import { PublicShell } from "@/components/public-shell";
import {
  entryMap,
  getEntryDisplayName,
  type ResolvedEntry,
} from "@/lib/round-entries";
import {
  getPublishedCombined,
  listPublishedCombined,
} from "@/lib/combined.functions";

export const Route = createFileRoute("/combined")({
  head: () => ({
    meta: [
      {
        title:
          "Combined Televote Result — Solaris Song Contest",
      },
      {
        name: "description",
        content:
          "Official Solaris combined televote result.",
      },
    ],
  }),
  component: CombinedResultsPage,
});

function CombinedResultsPage() {
  const listFn = useServerFn(
    listPublishedCombined,
  );

  const getFn = useServerFn(
    getPublishedCombined,
  );

  const [id, setId] =
    useState<string | undefined>(
      undefined,
    );

  const [details, setDetails] =
    useState(false);

  const list = useQuery({
    queryKey: [
      "public-combined-list-redesign",
    ],
    queryFn: async () =>
      await listFn(),
    refetchInterval: 20_000,
  });

  const effectiveId =
    id ??
    list.data?.[0]?.id ??
    undefined;

  const data = useQuery({
    queryKey: [
      "public-combined-redesign",
      effectiveId,
    ],
    queryFn: async () =>
      await getFn({
        data: {
          id: effectiveId,
        },
      }),
    enabled: Boolean(effectiveId),
    refetchInterval: 15_000,
  });

  const aggregation =
    data.data?.aggregation ?? null;

  const rows =
    data.data?.rows ?? [];

  const entryCatalog =
    (data.data?.entryCatalog ??
      []) as ResolvedEntry[];

  const byEntryKey =
    useMemo(
      () => entryMap(entryCatalog),
      [entryCatalog],
    );

  const columns =
    aggregation?.columns;

  const finalTotal = rows.reduce(
    (sum: number, row: any) =>
      sum +
      Number(
        row.final_televote_score ?? 0,
      ),
    0,
  );

  return (
    <PublicShell>
      <div className="space-y-5">
        <header className="px-1 text-center">
          <p className="text-[11px] uppercase tracking-[0.32em] text-primary">
            Official combined result
          </p>

          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {aggregation
              ? aggregation.name
              : "Combined televote"}
          </h1>

          {aggregation ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {aggregation.edition
                ? `${aggregation.edition} · `
                : ""}
              {
                aggregation.total_points
              } televote points · v
              {aggregation.version}
            </p>
          ) : null}
        </header>

        {(list.data ?? []).length >
        1 ? (
          <label className="glass block rounded-2xl p-3">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
              Published result
            </span>

            <select
              value={
                effectiveId ?? ""
              }
              onChange={(event) =>
                setId(
                  event.target.value,
                )
              }
              className="min-h-11 w-full rounded-xl border border-border bg-background/30 px-3 text-sm"
            >
              {(list.data ?? []).map(
                (item: any) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {item.name}
                  </option>
                ),
              )}
            </select>
          </label>
        ) : null}

        {!aggregation &&
        !data.isLoading &&
        !list.isLoading ? (
          <div className="glass rounded-3xl p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No combined result has
              been published yet.
            </p>
          </div>
        ) : null}

        {aggregation ? (
          <>
            <section className="grid grid-cols-3 gap-2">
              <Stat
                label="Entries"
                value={String(
                  rows.length,
                )}
              />

              <Stat
                label="Pool"
                value={String(
                  aggregation.total_points,
                )}
              />

              <Stat
                label="Final total"
                value={String(
                  finalTotal,
                )}
              />
            </section>

            <div className="glass flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">
                  Score detail
                </p>

                <p className="text-xs text-muted-foreground">
                  Show the component
                  columns beneath each
                  entry.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setDetails(
                    (value) =>
                      !value,
                  )
                }
                className={`min-h-9 rounded-full border px-3 text-xs font-medium ${
                  details
                    ? "border-primary/35 bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground"
                }`}
              >
                {details
                  ? "Hide"
                  : "Show"}
              </button>
            </div>

            <section className="space-y-2">
              {rows.map(
                (
                  row: any,
                  index: number,
                ) => {
                  const entryKey =
                    row.entry_key ??
                    row.country_code;

                  const entry =
                    byEntryKey.get(
                      entryKey,
                    );

                  const label =
                    entry
                      ? getEntryDisplayName(
                          entry,
                        )
                      : entryKey;

                  return (
                    <div
                      key={entryKey}
                      className={`glass-strong rounded-3xl p-3 sm:p-4 ${
                        index === 0
                          ? "ring-1 ring-primary/30"
                          : ""
                      }`}
                    >
                      <div className="grid grid-cols-[34px_minmax(0,1fr)_88px] items-center gap-3">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${
                            index === 0
                              ? "bg-primary/20 text-primary"
                              : "bg-white/[0.05] text-muted-foreground"
                          }`}
                        >
                          {index + 1}
                        </div>

                        <div className="flex min-w-0 items-center gap-2.5">
                          <EntryAvatar
                            entry={entry}
                            size={26}
                          />

                          <p className="truncate font-medium">
                            {label}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-xl font-semibold tabular-nums">
                            {Number(
                              row.final_televote_score,
                            )}
                          </p>

                          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
                            final
                          </p>
                        </div>
                      </div>

                      {details ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3 sm:grid-cols-4">
                          {columns?.combined_original ? (
                            <MiniScore
                              label="Original"
                              value={Number(
                                row.combined_original_score,
                              ).toLocaleString(
                                undefined,
                                {
                                  maximumFractionDigits: 3,
                                },
                              )}
                            />
                          ) : null}

                          {columns?.converted ? (
                            <MiniScore
                              label="Televote"
                              value={String(
                                row.converted_points,
                              )}
                            />
                          ) : null}

                          {columns?.bonus ? (
                            <MiniScore
                              label="Bonus"
                              value={String(
                                Number(
                                  row.bonus_points,
                                ),
                              )}
                            />
                          ) : null}

                          {columns?.final ? (
                            <MiniScore
                              label="Final"
                              value={String(
                                Number(
                                  row.final_televote_score,
                                ),
                              )}
                              strong
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                },
              )}
            </section>
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

function MiniScore({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/10 px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>

      <p
        className={`mt-0.5 tabular-nums ${
          strong
            ? "text-base font-semibold"
            : "text-sm font-medium"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
