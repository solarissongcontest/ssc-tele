import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Vote,
} from "lucide-react";
import { toast } from "sonner";
import { toJpeg, toPng } from "html-to-image";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CountryFlag, countryName } from "@/components/country-flag";
import { EntryAvatar } from "@/components/entry-avatar";

import { supabase } from "@/integrations/supabase/client";
import {
  buildClientIdentity,
  hasSubmittedRound,
  markRoundSubmitted,
} from "@/lib/anti-abuse";
import {
  entryMap,
  entryNoun,
  getEntryCode,
  getEntryDisplayName,
  sortEntries,
  type ResolvedEntry,
  type SelfVotingMode,
} from "@/lib/round-entries";
import { submitVote } from "@/lib/vote.functions";
import { cn } from "@/lib/utils";

type CountryShape = {
  code: string;
  name: string;
  flag: string;
  flag_url: string | null;
};

type Stage = "register" | "vote" | "done";

type Confirmation = {
  username: string;
  home: string;
  breakdown: {
    entryKey: string;
    points: number;
  }[];
};

const TOTAL = 20;
const MAX_PER = 10;
const MIN_ENTRIES = 5;

export function VotingBooth({
  roundId,
  roundName,
  editionName,
  entries,
  selfVotingMode = "country_match",
}: {
  roundId: string;
  roundName: string;
  editionName?: string | null;
  entries: ResolvedEntry[];
  selfVotingMode?: SelfVotingMode | string;
}) {
  const alreadyVoted = hasSubmittedRound(roundId);

  const [stage, setStage] = useState<Stage>(
    alreadyVoted ? "done" : "register",
  );

  const [username, setUsername] = useState("");
  const [home, setHome] = useState("");
  const [points, setPoints] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  /*
   * The voter identity is still a Solaris country.
   *
   * This is separate from the round participants. A round may contain:
   * - countries
   * - custom entries
   * - both
   *
   * The country dropdown therefore continues to load the complete country
   * library instead of only the entries competing in this round.
   */
  const {
    data: allCountries,
    isLoading: countriesLoading,
    error: countriesError,
  } = useQuery({
    queryKey: ["solaris-countries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("countries")
        .select("code,name,flag,flag_url")
        .order("name");

      if (error) throw error;

      return (data ?? []) as CountryShape[];
    },
    staleTime: 60_000,
  });

  const sortedEntries = useMemo(
    () => sortEntries(entries),
    [entries],
  );

  const byEntryKey = useMemo(
    () => entryMap(sortedEntries),
    [sortedEntries],
  );

  const byCountryCode = useMemo(() => {
    const map = new Map<string, CountryShape>();

    for (const country of allCountries ?? []) {
      map.set(country.code, country);
    }

    for (const entry of sortedEntries) {
      if (
        entry.entry_type === "country" &&
        entry.country_code &&
        entry.country
      ) {
        map.set(entry.country_code, {
          code: entry.country.code,
          name: entry.country.name,
          flag: entry.country.flag ?? "",
          flag_url: entry.country.flag_url ?? null,
        });
      }
    }

    return map;
  }, [allCountries, sortedEntries]);

  const participantNoun = entryNoun(sortedEntries, true);
  const participantNounSingle = entryNoun(sortedEntries, false);

  const used = Object.values(points).reduce(
    (sum, value) => sum + value,
    0,
  );

  const remaining = Math.max(0, TOTAL - used);

  const entriesUsed = Object.values(points).filter(
    (value) => value > 0,
  ).length;

  /*
   * The database currently treats the matching country entry as the voter's
   * own entry for every restricted mode. Custom-entry identity linking can be
   * added later without changing the ballot key model.
   */
  const isSelfEntry = (entry: ResolvedEntry) => {
    if (selfVotingMode === "unrestricted") return false;

    return (
      entry.entry_type === "country" &&
      Boolean(home) &&
      entry.country_code === home
    );
  };

  const submitVoteFn = useServerFn(submitVote);

  const submitMut = useMutation({
    mutationFn: async () => {
      const ident = await buildClientIdentity();

      /*
       * IMPORTANT:
       *
       * target_country_code is still the legacy RPC JSON property name.
       * Its VALUE is now the stable round entry key.
       *
       * For a country entry:
       *   entry_key === country code
       *
       * For a custom entry:
       *   entry_key === stable generated/custom entry key
       */
      const ballotEntries = Object.entries(points)
        .filter(([, value]) => value > 0)
        .map(([entryKey, value]) => ({
          target_country_code: entryKey,
          points: value,
        }));

      const data = await submitVoteFn({
        data: {
          roundId,
          username: username.trim(),
          countryCode: home,
          entries: ballotEntries,
          fingerprintHash: ident.fingerprint_hash,
          deviceTokenHash: ident.device_token_hash,
        },
      });

      return {
        data,
        ballotEntries,
      };
    },

    onSuccess: ({ ballotEntries }) => {
      markRoundSubmitted(roundId);

      setConfirmation({
        username: username.trim(),
        home,
        breakdown: ballotEntries
          .map((entry) => ({
            entryKey: entry.target_country_code,
            points: entry.points,
          }))
          .sort(
            (a, b) =>
              b.points - a.points ||
              a.entryKey.localeCompare(b.entryKey),
          ),
      });

      setStage("done");

      toast.success("Your vote has been recorded");
    },

    onError: (error: any) => {
      const message =
        error?.message ??
        "Could not submit your vote";

      toast.error(message);

      if (/already voted|already recorded/i.test(message)) {
        markRoundSubmitted(roundId);
        setStage("done");
      }
    },
  });

  /*
   * ------------------------------------------------------------
   * DONE
   * ------------------------------------------------------------
   */

  if (stage === "done") {
    return (
      <DoneCard
        roundName={roundName}
        editionName={editionName}
        confirmation={confirmation}
        byCountryCode={byCountryCode}
        byEntryKey={byEntryKey}
      />
    );
  }

  /*
   * ------------------------------------------------------------
   * REGISTER
   * ------------------------------------------------------------
   */

  if (stage === "register") {
    const canContinue =
      username.trim().length >= 2 &&
      Boolean(home) &&
      !countriesLoading &&
      !countriesError;

    return (
      <section className="glass-strong mx-auto max-w-lg space-y-5 rounded-2xl p-6 sm:p-8">
        <header className="space-y-1 text-center">
          <p className="text-xs uppercase tracking-widest text-primary">
            {editionName ? `${editionName} · ` : ""}
            {roundName}
          </p>

          <h2 className="text-2xl font-bold">
            Register to vote
          </h2>

          <p className="text-sm text-muted-foreground">
            Pick a display name and the Solaris country you are voting from.
          </p>
        </header>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor="solaris-vote-username"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Username
            </label>

            <Input
              id="solaris-vote-username"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value)
              }
              placeholder="e.g. NordicFan21"
              maxLength={40}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Your home country
            </label>

            <Select
              value={home}
              onValueChange={setHome}
              disabled={countriesLoading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    countriesLoading
                      ? "Loading countries…"
                      : "Select your country…"
                  }
                />
              </SelectTrigger>

              <SelectContent className="max-h-[50vh]">
                {(allCountries ?? []).map((country) => (
                  <SelectItem
                    key={country.code}
                    value={country.code}
                  >
                    <span className="inline-flex items-center gap-2">
                      <CountryFlag
                        country={country}
                        size={18}
                      />

                      {country.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {countriesError ? (
              <p className="text-[11px] text-destructive">
                The country list could not be loaded. Refresh the page and try
                again.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                All {allCountries?.length ?? 0} Solaris nations are listed,
                including those not competing in this round.
                {selfVotingMode === "unrestricted"
                  ? " Self-voting is allowed in this round."
                  : " You cannot vote for your own country entry."}
              </p>
            )}
          </div>
        </div>

        <Button
          disabled={!canContinue}
          onClick={() => setStage("vote")}
          className="bg-hero shadow-glow h-11 w-full text-primary-foreground"
        >
          <Vote className="h-4 w-4" />

          Enter the booth
        </Button>
      </section>
    );
  }

  /*
   * ------------------------------------------------------------
   * VOTE
   * ------------------------------------------------------------
   */

  const adjust = (
    entryKey: string,
    delta: number,
  ) => {
    setPoints((previous) => {
      const current = previous[entryKey] ?? 0;

      let next = current + delta;

      if (next < 0) next = 0;
      if (next > MAX_PER) next = MAX_PER;

      const currentTotal = Object.values(previous).reduce(
        (sum, value) => sum + value,
        0,
      );

      const otherTotal = currentTotal - current;

      if (otherTotal + next > TOTAL) {
        next = Math.max(0, TOTAL - otherTotal);
      }

      const output = {
        ...previous,
        [entryKey]: next,
      };

      if (next === 0) {
        delete output[entryKey];
      }

      return output;
    });
  };

  const canSubmit =
    used === TOTAL &&
    entriesUsed >= MIN_ENTRIES;

  const homeCountry =
    byCountryCode.get(home);

  const visibleEntries = sortedEntries.filter(
    (entry) => {
      const query = search.trim().toLowerCase();

      if (!query) return true;

      return (
        getEntryDisplayName(entry)
          .toLowerCase()
          .includes(query) ||
        getEntryCode(entry)
          .toLowerCase()
          .includes(query) ||
        (entry.subtitle ?? "")
          .toLowerCase()
          .includes(query)
      );
    },
  );

  return (
    <section className="space-y-5">
      <div className="glass-strong sticky top-3 z-10 rounded-2xl p-4 backdrop-blur-xl sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] uppercase tracking-widest text-primary">
              {editionName ? `${editionName} · ` : ""}
              {roundName}
            </p>

            <p className="inline-flex max-w-full items-center gap-1.5 truncate text-sm font-semibold">
              Voting as{" "}
              <span className="truncate text-primary">
                {username}
              </span>

              <span aria-hidden>·</span>

              <CountryFlag
                country={homeCountry}
                size={16}
              />

              <span className="truncate">
                {countryName(homeCountry)}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "tabular-nums",
                remaining === 0 &&
                  "border-primary/50 text-primary",
              )}
            >
              {remaining} left
            </Badge>

            <Badge
              variant="outline"
              className={cn(
                "tabular-nums",
                entriesUsed >= MIN_ENTRIES &&
                  "border-primary/50 text-primary",
              )}
            >
              {entriesUsed}/{MIN_ENTRIES}+ {participantNoun}
            </Badge>
          </div>
        </div>

        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={TOTAL}
          aria-valuenow={Math.min(used, TOTAL)}
          aria-label="Points distributed"
        >
          <div
            className="bg-hero h-full transition-all duration-300"
            style={{
              width: `${Math.min(
                100,
                (used / TOTAL) * 100,
              )}%`,
            }}
          />
        </div>

        {used > TOTAL ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />

            Too many points distributed.
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

          <Input
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder={`Search ${participantNoun}…`}
            aria-label={`Search ${participantNoun} in this round`}
            className="pl-9"
          />
        </div>

        <Button
          variant="outline"
          className="shrink-0"
          disabled={used === 0}
          onClick={() => setPoints({})}
        >
          <RotateCcw className="h-4 w-4" />

          <span className="hidden sm:inline">
            Reset
          </span>
        </Button>
      </div>

      {visibleEntries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No {participantNoun} match “{search}”.
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-2.5">
        {visibleEntries.map((entry) => {
          const entryKey = entry.entry_key;
          const blockedSelfVote = isSelfEntry(entry);
          const value = points[entryKey] ?? 0;

          return (
            <li
              key={entry.id}
              className={cn(
                "glass flex min-w-0 items-center gap-3 rounded-xl px-3 py-3",
                blockedSelfVote && "opacity-50",
                value > 0 &&
                  "ring-1 ring-primary/40",
              )}
            >
              <EntryAvatar
                entry={entry}
                size={32}
              />

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {getEntryDisplayName(entry)}
                </div>

                <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                  #{entry.display_order}

                  {entry.subtitle
                    ? ` · ${entry.subtitle}`
                    : ""}

                  {blockedSelfVote
                    ? " · your entry"
                    : ""}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={
                    blockedSelfVote ||
                    value === 0
                  }
                  onClick={() =>
                    adjust(entryKey, -1)
                  }
                  aria-label={`Remove one point from ${getEntryDisplayName(
                    entry,
                  )}`}
                >
                  <Minus className="h-4 w-4" />
                </Button>

                <div
                  className="w-9 text-center text-lg font-bold tabular-nums"
                  aria-label={`${value} points`}
                >
                  {value}
                </div>

                <Button
                  type="button"
                  size="icon"
                  className={cn(
                    "h-9 w-9",
                    value > 0
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card",
                  )}
                  disabled={
                    blockedSelfVote ||
                    value >= MAX_PER ||
                    remaining === 0
                  }
                  onClick={() =>
                    adjust(entryKey, 1)
                  }
                  aria-label={`Add one point to ${getEntryDisplayName(
                    entry,
                  )}`}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-3 z-10">
        <div className="glass-strong space-y-3 rounded-2xl p-4">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">
              Need exactly{" "}
              <strong className="text-foreground">
                {TOTAL}
              </strong>{" "}
              points across at least{" "}
              <strong className="text-foreground">
                {MIN_ENTRIES}
              </strong>{" "}
              {participantNoun}, max{" "}
              <strong className="text-foreground">
                {MAX_PER}
              </strong>{" "}
              per {participantNounSingle}.
            </span>
          </div>

          <Button
            className="bg-hero shadow-glow h-12 w-full text-base text-primary-foreground"
            disabled={
              !canSubmit ||
              submitMut.isPending
            }
            onClick={() =>
              submitMut.mutate()
            }
          >
            {submitMut.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}

            Submit your televote
          </Button>
        </div>
      </div>
    </section>
  );
}

function DoneCard({
  roundName,
  editionName,
  confirmation,
  byCountryCode,
  byEntryKey,
}: {
  roundName: string;
  editionName?: string | null;
  confirmation: Confirmation | null;
  byCountryCode: Map<string, CountryShape>;
  byEntryKey: Map<string, ResolvedEntry>;
}) {
  const exportRef = useRef<HTMLDivElement | null>(null);

  const [exporting, setExporting] = useState<
    "png" | "jpg" | null
  >(null);

  const homeCountry = confirmation
    ? byCountryCode.get(
        confirmation.home,
      )
    : null;

  const sortedBreakdown = confirmation
    ? [...confirmation.breakdown].sort(
        (a, b) =>
          b.points - a.points ||
          getEntryDisplayName(
            byEntryKey.get(a.entryKey),
          ).localeCompare(
            getEntryDisplayName(
              byEntryKey.get(b.entryKey),
            ),
          ),
      )
    : [];

  const totalPoints =
    sortedBreakdown.reduce(
      (sum, item) =>
        sum + item.points,
      0,
    );

  const share = async () => {
    if (!confirmation) return;

    const lines = sortedBreakdown
      .map((item) => {
        const entry =
          byEntryKey.get(
            item.entryKey,
          );

        return `${item.points} — ${getEntryDisplayName(
          entry,
        )}`;
      })
      .join("\n");

    const text =
      `My ${
        editionName
          ? `${editionName} `
          : ""
      }${roundName} televote:\n` +
      `${lines}\n` +
      "#GETTINGHIGH";

    try {
      if (
        typeof navigator !==
          "undefined" &&
        navigator.share
      ) {
        await navigator.share({
          title: "My Solaris televote",
          text,
        });

        return;
      }

      await navigator.clipboard.writeText(
        text,
      );

      toast.success(
        "Vote summary copied to clipboard",
      );
    } catch {
      /*
       * The user may simply have dismissed the share sheet.
       * No error toast is needed for that.
       */
    }
  };

  const buildFileName = (
    extension: "png" | "jpg",
  ) => {
    const base = [
      editionName,
      roundName,
      "vote-overview",
    ]
      .filter(Boolean)
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return `${base || "solaris-vote-overview"}.${extension}`;
  };

  const triggerDownload = (
    dataUrl: string,
    fileName: string,
  ) => {
    const link =
      document.createElement("a");

    link.href = dataUrl;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const exportImage = async (
    format: "png" | "jpg",
  ) => {
    if (
      !confirmation ||
      !exportRef.current ||
      exporting
    ) {
      return;
    }

    try {
      setExporting(format);

      /*
       * This is deliberately a rendered copy of the visible vote card rather
       * than a screenshot of the whole page. The action buttons therefore do
       * not end up inside the downloaded image.
       *
       * cacheBust helps when country flags / entry artwork are remote images.
       * A high pixel ratio keeps text and flags sharp when shared on Instagram.
       */
      const options = {
        cacheBust: true,
        pixelRatio: 3,
        backgroundColor: "#07122f",
      };

      const dataUrl =
        format === "png"
          ? await toPng(
              exportRef.current,
              options,
            )
          : await toJpeg(
              exportRef.current,
              {
                ...options,
                quality: 0.95,
              },
            );

      triggerDownload(
        dataUrl,
        buildFileName(format),
      );

      toast.success(
        `${format.toUpperCase()} vote overview created`,
      );
    } catch (error) {
      console.error(
        "Vote overview export failed",
        error,
      );

      toast.error(
        "Could not create the vote image. Try PNG if JPG fails.",
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <section className="mx-auto max-w-xl space-y-4 animate-pop-in">
      <div className="glass-strong space-y-5 rounded-2xl p-6 text-center sm:p-8">
        <div className="bg-hero shadow-glow mx-auto grid h-14 w-14 place-items-center rounded-2xl">
          <CheckCircle2 className="h-7 w-7 text-primary-foreground" />
        </div>

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-widest text-primary">
            {editionName
              ? `${editionName} · `
              : ""}

            {roundName}
          </p>

          <h2 className="text-2xl font-bold">
            Your vote is in
          </h2>

          <p className="text-sm text-muted-foreground">
            Thank you for taking part in the televote. Results are revealed later.
          </p>
        </div>
      </div>

      {confirmation ? (
        <>
          <div
            ref={exportRef}
            className="overflow-hidden rounded-[30px] border border-white/20 p-[1px] shadow-2xl"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.48), rgba(255,255,255,0.08) 42%, rgba(79,235,255,0.28) 100%)",
            }}
          >
            <div
              className="relative overflow-hidden rounded-[29px] px-5 py-6 text-left sm:px-6"
              style={{
                background:
                  "radial-gradient(circle at 15% 0%, rgba(105,229,255,0.23), transparent 38%), radial-gradient(circle at 100% 95%, rgba(57,210,198,0.18), transparent 42%), linear-gradient(150deg, #101842 0%, #0b2152 52%, #063c59 100%)",
              }}
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-50"
                style={{
                  background:
                    "linear-gradient(115deg, rgba(255,255,255,0.12), transparent 26%, transparent 64%, rgba(255,255,255,0.07))",
                }}
              />

              <div className="relative">
                <div className="text-center">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#76f0e1]">
                    Solaris Song Contest
                  </p>

                  <h3 className="mt-2 text-2xl font-bold text-white">
                    My televote
                  </h3>

                  <p className="mt-1 text-sm text-white/70">
                    {editionName
                      ? `${editionName} · `
                      : ""}
                    {roundName}
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-white/12 bg-white/[0.07] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {confirmation.username}
                    </p>

                    <div className="mt-0.5 inline-flex max-w-full items-center gap-1.5 text-xs text-white/65">
                      <CountryFlag
                        country={homeCountry}
                        size={16}
                      />

                      <span className="truncate">
                        {countryName(
                          homeCountry,
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xl font-bold tabular-nums text-white">
                      {totalPoints}
                    </p>

                    <p className="text-[9px] uppercase tracking-[0.18em] text-white/55">
                      total points
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {sortedBreakdown.map(
                    (item, index) => {
                      const entry =
                        byEntryKey.get(
                          item.entryKey,
                        );

                      return (
                        <div
                          key={
                            item.entryKey
                          }
                          className="grid grid-cols-[28px_30px_minmax(0,1fr)_54px] items-center gap-2 rounded-2xl border border-white/10 bg-black/10 px-3 py-2.5"
                        >
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/80">
                            {index + 1}
                          </div>

                          <EntryAvatar
                            entry={
                              entry
                            }
                            size={28}
                          />

                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-white">
                              {getEntryDisplayName(
                                entry,
                              )}
                            </p>

                            {entry?.subtitle ? (
                              <p className="mt-0.5 truncate text-[10px] text-white/50">
                                {
                                  entry.subtitle
                                }
                              </p>
                            ) : null}
                          </div>

                          <div className="text-right">
                            <p className="text-lg font-bold leading-none tabular-nums text-[#76f0e1]">
                              {
                                item.points
                              }
                            </p>

                            <p className="mt-1 text-[8px] uppercase tracking-[0.15em] text-white/45">
                              pts
                            </p>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>

                <div className="mt-5 border-t border-white/10 pt-3 text-center">
                  <p className="text-[9px] uppercase tracking-[0.22em] text-white/45">
                    Solaris Televote
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-strong space-y-3 rounded-2xl p-4">
            <p className="text-center text-xs text-muted-foreground">
              Save your vote overview as an image or share the text version.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-11"
                disabled={
                  exporting !== null
                }
                onClick={() =>
                  exportImage("png")
                }
              >
                {exporting ===
                "png" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}

                PNG
              </Button>

              <Button
                variant="outline"
                className="h-11"
                disabled={
                  exporting !== null
                }
                onClick={() =>
                  exportImage("jpg")
                }
              >
                {exporting ===
                "jpg" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}

                JPG
              </Button>
            </div>

            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={share}
            >
              <Share2 className="h-4 w-4" />

              Share my vote
            </Button>
          </div>
        </>
      ) : (
        <div className="glass-strong rounded-2xl p-5 text-center text-sm text-muted-foreground">
          This browser already recorded a vote for this round, so the previous
          ballot overview is not available on this device.
        </div>
      )}
    </section>
  );
}
