import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Vote, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  buildClientIdentity,
  hasSubmittedRound,
  markRoundSubmitted,
} from "@/lib/anti-abuse";

export type RoundCountry = {
  display_order: number;
  country: { code: string; name: string; flag: string };
};

type Stage = "register" | "vote" | "done";

const TOTAL = 20;
const MAX_PER = 10;
const MIN_COUNTRIES = 5;

export function VotingBooth({
  roundId,
  roundName,
  editionName,
  countries,
}: {
  roundId: string;
  roundName: string;
  editionName?: string | null;
  countries: RoundCountry[];
}) {
  const alreadyVoted = hasSubmittedRound(roundId);
  const [stage, setStage] = useState<Stage>(alreadyVoted ? "done" : "register");
  const [username, setUsername] = useState("");
  const [home, setHome] = useState<string>("");
  const [points, setPoints] = useState<Record<string, number>>({});
  const [confirmation, setConfirmation] = useState<{
    username: string;
    home: string;
    breakdown: { code: string; points: number }[];
  } | null>(null);

  const sorted = useMemo(
    () => [...countries].sort((a, b) => a.display_order - b.display_order),
    [countries],
  );
  const byCode = useMemo(() => {
    const m = new Map<string, RoundCountry["country"]>();
    sorted.forEach((c) => m.set(c.country.code, c.country));
    return m;
  }, [sorted]);

  const used = Object.values(points).reduce((a, b) => a + b, 0);
  const remaining = TOTAL - used;
  const countriesUsed = Object.keys(points).filter((k) => points[k] > 0).length;

  const submitMut = useMutation({
    mutationFn: async () => {
      const ident = await buildClientIdentity();
      const entries = Object.entries(points)
        .filter(([, p]) => p > 0)
        .map(([target_country_code, p]) => ({ target_country_code, points: p }));

      const { data, error } = await supabase.rpc("submit_vote" as any, {
        p_round_id: roundId,
        p_username: username.trim(),
        p_country_code: home,
        p_entries: entries,
        p_ip_hash: null,
        p_fingerprint_hash: ident.fingerprint_hash,
        p_device_token_hash: ident.device_token_hash,
      });
      if (error) throw error;
      return { data, entries };
    },
    onSuccess: ({ entries }) => {
      markRoundSubmitted(roundId);
      setConfirmation({
        username: username.trim(),
        home,
        breakdown: entries
          .map((e) => ({ code: e.target_country_code, points: e.points }))
          .sort((a, b) => b.points - a.points),
      });
      setStage("done");
      toast.success("Your vote has been recorded");
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Could not submit your vote";
      toast.error(msg);
      if (/already voted|already recorded/i.test(msg)) {
        markRoundSubmitted(roundId);
        setStage("done");
      }
    },
  });

  /* ---------- DONE ---------- */
  if (stage === "done") {
    return (
      <DoneCard
        roundName={roundName}
        editionName={editionName}
        confirmation={confirmation}
        byCode={byCode}
      />
    );
  }

  /* ---------- REGISTER ---------- */
  if (stage === "register") {
    const ok = username.trim().length >= 2 && home;
    return (
      <section className="glass-strong rounded-2xl p-6 sm:p-8 space-y-5 max-w-lg mx-auto">
        <header className="text-center space-y-1">
          <p className="text-xs uppercase tracking-widest text-primary">
            {editionName ? `${editionName} · ` : ""}
            {roundName}
          </p>
          <h2 className="text-2xl font-bold">Register to vote</h2>
          <p className="text-sm text-muted-foreground">
            Pick a display name and the country you're voting from.
          </p>
        </header>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Username
            </label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. NordicFan21"
              maxLength={40}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Your home country
            </label>
            <Select value={home} onValueChange={setHome}>
              <SelectTrigger>
                <SelectValue placeholder="Select your country…" />
              </SelectTrigger>
              <SelectContent className="max-h-[50vh]">
                {sorted.map((c) => (
                  <SelectItem key={c.country.code} value={c.country.code}>
                    <span className="mr-2">{c.country.flag}</span>
                    {c.country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              You cannot vote for your own country.
            </p>
          </div>
        </div>
        <Button
          disabled={!ok}
          onClick={() => setStage("vote")}
          className="w-full bg-hero text-primary-foreground shadow-glow h-11"
        >
          <Vote className="h-4 w-4" />
          Enter the booth
        </Button>
      </section>
    );
  }

  /* ---------- VOTE ---------- */
  const adjust = (code: string, delta: number) => {
    setPoints((prev) => {
      const cur = prev[code] ?? 0;
      let next = cur + delta;
      if (next < 0) next = 0;
      if (next > MAX_PER) next = MAX_PER;
      const sumOthers = used - cur;
      if (sumOthers + next > TOTAL) next = TOTAL - sumOthers;
      const out = { ...prev, [code]: next };
      if (next === 0) delete out[code];
      return out;
    });
  };

  const canSubmit = used === TOTAL && countriesUsed >= MIN_COUNTRIES;

  return (
    <section className="space-y-5">
      <div className="glass-strong rounded-2xl p-4 sm:p-5 sticky top-3 z-10 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-primary truncate">
              {editionName ? `${editionName} · ` : ""}
              {roundName}
            </p>
            <p className="text-sm font-semibold truncate">
              Voting as <span className="text-primary">{username}</span> ·{" "}
              {byCode.get(home)?.flag} {byCode.get(home)?.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "tabular-nums",
                remaining === 0 ? "text-primary border-primary/50" : "",
              )}
            >
              {remaining} left
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "tabular-nums",
                countriesUsed >= MIN_COUNTRIES ? "text-primary border-primary/50" : "",
              )}
            >
              {countriesUsed}/{MIN_COUNTRIES}+ countries
            </Badge>
          </div>
        </div>
        {used > TOTAL && (
          <div className="mt-2 text-xs flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> Too many points distributed.
          </div>
        )}
      </div>

      <ul className="grid grid-cols-1 gap-2.5">
        {sorted.map((c) => {
          const code = c.country.code;
          const isHome = code === home;
          const p = points[code] ?? 0;
          return (
            <li
              key={code}
              className={cn(
                "glass rounded-xl px-3 py-3 flex items-center gap-3",
                isHome && "opacity-50",
                p > 0 && "ring-1 ring-primary/40",
              )}
            >
              <span className="text-2xl leading-none shrink-0">{c.country.flag}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.country.name}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  #{c.display_order} · {code}
                  {isHome ? " · your country" : ""}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={isHome || p === 0}
                  onClick={() => adjust(code, -1)}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <div className="w-9 text-center font-bold tabular-nums text-lg">{p}</div>
                <Button
                  size="icon"
                  className={cn(
                    "h-9 w-9",
                    p > 0 ? "bg-primary text-primary-foreground" : "bg-card border border-border",
                  )}
                  disabled={isHome || p >= MAX_PER || remaining === 0}
                  onClick={() => adjust(code, 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-3 z-10">
        <div className="glass-strong rounded-2xl p-4 space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">
              Need exactly <strong className="text-foreground">20</strong> points across at least{" "}
              <strong className="text-foreground">5</strong> countries, max{" "}
              <strong className="text-foreground">10</strong> per country.
            </span>
          </div>
          <Button
            className="w-full h-12 bg-hero text-primary-foreground shadow-glow text-base"
            disabled={!canSubmit || submitMut.isPending}
            onClick={() => submitMut.mutate()}
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
  byCode,
}: {
  roundName: string;
  editionName?: string | null;
  confirmation:
    | { username: string; home: string; breakdown: { code: string; points: number }[] }
    | null;
  byCode: Map<string, { code: string; name: string; flag: string }>;
}) {
  return (
    <section className="glass-strong rounded-2xl p-6 sm:p-8 max-w-xl mx-auto space-y-5 text-center">
      <div className="mx-auto h-14 w-14 rounded-2xl bg-hero grid place-items-center shadow-glow">
        <CheckCircle2 className="h-7 w-7 text-primary-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-primary">
          {editionName ? `${editionName} · ` : ""}
          {roundName}
        </p>
        <h2 className="text-2xl font-bold">Your vote is in</h2>
        <p className="text-sm text-muted-foreground">
          Thank you for taking part in the televote. Results are revealed live on stage.
        </p>
      </div>

      {confirmation && (
        <div className="text-left space-y-3">
          <div className="text-xs text-muted-foreground">
            {confirmation.username} · {byCode.get(confirmation.home)?.flag}{" "}
            {byCode.get(confirmation.home)?.name ?? confirmation.home}
          </div>
          <ul className="space-y-1.5">
            {confirmation.breakdown.map((b) => {
              const c = byCode.get(b.code);
              return (
                <li
                  key={b.code}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card/60 border border-border"
                >
                  <span className="text-xl">{c?.flag ?? "🏳️"}</span>
                  <span className="flex-1 text-sm truncate">{c?.name ?? b.code}</span>
                  <span className="font-bold tabular-nums text-primary">{b.points}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
