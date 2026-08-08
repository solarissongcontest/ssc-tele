import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { EntryAvatar } from "@/components/entry-avatar";
import { PublicShell } from "@/components/public-shell";
import {
  entryMap,
  entryNoun,
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
          "Official Solaris combined televote: converted televote points, bonus points and the final televote score across every voting source.",
      },
      {
        property: "og:title",
        content:
          "Combined Televote Result — Solaris Song Contest",
      },
      {
        property: "og:description",
        content:
          "Converted televote points, bonus points and final televote scores for the Solaris Song Contest.",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        name: "twitter:card",
        content: "summary_large_image",
      },
    ],
  }),
  component: CombinedResultsPage,
});

function CombinedResultsPage() {
  const listFn =
    useServerFn(
      listPublishedCombined,
    );

  const getFn =
    useServerFn(
      getPublishedCombined,
    );

  const [id, setId] =
    useState<string | undefined>(
      undefined,
    );

  const list = useQuery({
    queryKey: [
      "public-combined-list",
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
      "public-combined",
      effectiveId,
    ],
    queryFn: async () =>
      await getFn({
        data: {
          id: effectiveId,
        },
      }),
    enabled:
      Boolean(
        effectiveId,
      ),
    refetchInterval: 15_000,
  });

  const aggregation =
    data.data?.aggregation ??
    null;

  const rows =
    data.data?.rows ?? [];

  const entryCatalog =
    (data.data?.entryCatalog ??
      []) as ResolvedEntry[];

  const byEntryKey =
    useMemo(
      () => entryMap(
        entryCatalog,
      ),
      [entryCatalog],
    );

  const participantLabel =
    entryNoun(
      entryCatalog,
      false,
    );

  const columns =
    aggregation?.columns;

  return (
    <PublicShell>
      <div className="space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-primary">
            Official result
          </p>

          <h1 className="text-2xl font-semibold">
            {aggregation
              ? aggregation.name
              : "Combined televote"}
          </h1>

          {aggregation ? (
            <p className="text-xs text-muted-foreground">
              {aggregation.edition
                ? `${aggregation.edition} · `
                : ""}
              {
                aggregation.total_points
              }{" "}
              televote points
              distributed · v
              {
                aggregation.version
              }
            </p>
          ) : null}
        </header>

        {(list.data ?? [])
          .length > 1 ? (
          <div className="flex flex-wrap justify-center gap-2">
            {(list.data ?? []).map(
              (item: any) => (
                <button
                  key={
                    item.id
                  }
                  onClick={() =>
                    setId(
                      item.id,
                    )
                  }
                  className={`rounded-full border px-4 py-2 text-xs ${
                    effectiveId ===
                    item.id
                      ? "border-primary/60 text-foreground"
                      : "border-white/10 text-muted-foreground"
                  }`}
                >
                  {item.name}
                </button>
              ),
            )}
          </div>
        ) : null}

        {!aggregation &&
        !data.isLoading &&
        !list.isLoading ? (
          <div className="glass rounded-3xl p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No combined result
              has been published
              yet. Check back after
              the show.
            </p>
          </div>
        ) : null}

        {aggregation ? (
          <div className="glass overflow-x-auto rounded-3xl p-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">
                    #
                  </th>

                  <th className="py-2 pr-3">
                    {
                      participantLabel
                    }
                  </th>

                  {columns?.combined_original ? (
                    <th className="py-2 pr-3 text-right">
                      Combined original
                    </th>
                  ) : null}

                  {columns?.converted ? (
                    <th className="py-2 pr-3 text-right">
                      Televote points
                    </th>
                  ) : null}

                  {columns?.bonus ? (
                    <th className="py-2 pr-3 text-right">
                      Bonus
                    </th>
                  ) : null}

                  {columns?.final ? (
                    <th className="py-2 pr-3 text-right">
                      Final
                    </th>
                  ) : null}
                </tr>
              </thead>

              <tbody>
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
                      <tr
                        key={
                          entryKey
                        }
                        className="border-t border-white/5"
                      >
                        <td className="py-2 pr-3 tabular-nums">
                          {
                            index +
                            1
                          }
                        </td>

                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-2">
                            <EntryAvatar
                              entry={
                                entry
                              }
                              size={
                                20
                              }
                            />

                            <span>
                              {
                                label
                              }
                            </span>
                          </span>
                        </td>

                        {columns?.combined_original ? (
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {Number(
                              row.combined_original_score,
                            ).toLocaleString(
                              undefined,
                              {
                                maximumFractionDigits: 3,
                              },
                            )}
                          </td>
                        ) : null}

                        {columns?.converted ? (
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {
                              row.converted_points
                            }
                          </td>
                        ) : null}

                        {columns?.bonus ? (
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {Number(
                              row.bonus_points,
                            )}
                          </td>
                        ) : null}

                        {columns?.final ? (
                          <td className="py-2 pr-3 text-right text-base font-semibold tabular-nums">
                            {Number(
                              row.final_televote_score,
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </PublicShell>
  );
}
