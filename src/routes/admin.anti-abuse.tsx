import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCcw,
  Download,
  FileJson,
  Search,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAllRounds, useAllCountries } from "@/hooks/use-round-results";
import { downloadCSV, downloadJSON } from "@/lib/export";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/anti-abuse")({
  head: () => ({ meta: [{ title: "Anti-Abuse — Solaris Admin" }] }),
  component: AntiAbusePage,
});

type Event = {
  id: string;
  created_at: string;
  round_id: string | null;
  username: string | null;
  username_normalized: string | null;
  country_code: string | null;
  reason: string;
  risk_score: number;
  status: string;
  metadata: any;
};

const REASON_LABEL: Record<string, string> = {
  self_vote: "Self-vote attempt",
  wrong_total_points: "Wrong total points",
  too_few_countries: "Too few countries",
  duplicate_username: "Duplicate username",
  duplicate_ip: "Duplicate IP",
  duplicate_fingerprint: "Duplicate fingerprint",
  duplicate_device: "Duplicate device",
};

function AntiAbusePage() {
  const qc = useQueryClient();
  const { data: rounds } = useAllRounds();
  const { data: countries } = useAllCountries();
  const [roundId, setRoundId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");

  const byCode = useMemo(() => {
    const m = new Map<string, { name: string; flag: string; flag_url: string | null }>();
    (countries ?? []).forEach((c) => m.set(c.code, c));
    return m;
  }, [countries]);
  const roundName = (id: string | null) =>
    rounds?.find((r) => r.id === id)?.name ?? "—";

  const events = useQuery({
    queryKey: ["anti-abuse-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anti_abuse_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as Event[];
    },
    refetchInterval: 15_000,
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (events.data ?? []).filter((e) => {
      if (roundId !== "all" && e.round_id !== roundId) return false;
      if (status !== "all" && e.status !== status) return false;
      if (term) {
        const hay = `${e.username ?? ""} ${e.username_normalized ?? ""} ${
          e.country_code ?? ""
        } ${e.reason}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [events.data, roundId, status, q]);

  const whitelistMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("anti_abuse_events")
        .update({ status: "whitelisted" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked as whitelisted");
      qc.invalidateQueries({ queryKey: ["anti-abuse-events"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update"),
  });

  const exportRows = () =>
    filtered.map((e) => ({
      timestamp: e.created_at,
      username: e.username ?? "",
      home_country: byCode.get(e.country_code ?? "")?.name ?? e.country_code ?? "",
      home_code: e.country_code ?? "",
      round: roundName(e.round_id),
      reason: REASON_LABEL[e.reason] ?? e.reason,
      reason_code: e.reason,
      risk_score: e.risk_score,
      status: e.status,
    }));

  const exportCSV = () =>
    downloadCSV(
      `solaris-anti-abuse-${new Date().toISOString().slice(0, 10)}.csv`,
      exportRows(),
      [
        "timestamp",
        "username",
        "home_country",
        "home_code",
        "round",
        "reason",
        "reason_code",
        "risk_score",
        "status",
      ],
    );

  const exportJSON_ = () =>
    downloadJSON(
      `solaris-anti-abuse-${new Date().toISOString().slice(0, 10)}.json`,
      exportRows(),
    );

  const totals = useMemo(() => {
    const all = events.data ?? [];
    return {
      total: all.length,
      pending: all.filter((e) => e.status === "pending").length,
      whitelisted: all.filter((e) => e.status === "whitelisted").length,
      high: all.filter((e) => e.risk_score >= 70).length,
    };
  }, [events.data]);

  return (
    <AdminShell title="Anti-Abuse">
      <div className="space-y-6">
        <section className="glass-strong rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-hero grid place-items-center shadow-glow">
              <ShieldAlert className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-primary">Vote integrity</p>
              <h2 className="text-xl font-bold">Suspicious & blocked attempts</h2>
              <p className="text-xs text-muted-foreground">
                Every blocked vote is logged here with reason and risk score.
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Events" value={totals.total} />
          <Stat label="Pending" value={totals.pending} />
          <Stat label="Whitelisted" value={totals.whitelisted} />
          <Stat label="High risk (≥70)" value={totals.high} accent />
        </div>

        {/* Filters */}
        <section className="glass rounded-2xl p-3 sm:p-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search username, country, reason…"
              className="pl-9"
            />
          </div>
          <Select value={roundId} onValueChange={setRoundId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Round" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rounds</SelectItem>
              {(rounds ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.edition_name ? `${r.edition_name} · ` : ""}
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="whitelisted">Whitelisted</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["anti-abuse-events"] })}
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="bg-hero text-primary-foreground">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportCSV}>
                <Download className="h-4 w-4" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportJSON_}>
                <FileJson className="h-4 w-4" /> JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        {/* List */}
        {events.isLoading ? (
          <div className="glass-strong rounded-2xl p-10 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-strong rounded-2xl p-10 text-center text-sm text-muted-foreground">
            <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-primary/70" />
            No matching events. The vote is clean.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((e) => {
              const country = byCode.get(e.country_code ?? "");
              const high = e.risk_score >= 70;
              return (
                <li
                  key={e.id}
                  className={cn(
                    "glass rounded-xl p-3 sm:p-4 flex items-start gap-3",
                    high && "ring-1 ring-destructive/40",
                  )}
                >
                  <div
                    className={cn(
                      "h-9 w-9 shrink-0 rounded-lg grid place-items-center",
                      high
                        ? "bg-destructive/20 text-destructive"
                        : "bg-primary/15 text-primary",
                    )}
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">
                        {e.username ?? "—"}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {country?.flag ?? "🏳️"} {country?.name ?? e.country_code ?? "—"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          high ? "text-destructive border-destructive/40" : "",
                        )}
                      >
                        risk {e.risk_score}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          e.status === "whitelisted"
                            ? "text-primary border-primary/40"
                            : "",
                        )}
                      >
                        {e.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {REASON_LABEL[e.reason] ?? e.reason} ·{" "}
                      {roundName(e.round_id)} ·{" "}
                      {new Date(e.created_at).toLocaleString()}
                    </div>
                    {e.metadata && Object.keys(e.metadata).length > 0 && (
                      <pre className="mt-2 text-[10px] text-muted-foreground bg-card/50 border border-border rounded-md px-2 py-1 overflow-x-auto">
                        {JSON.stringify(e.metadata)}
                      </pre>
                    )}
                  </div>
                  {e.status !== "whitelisted" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => whitelistMut.mutate(e.id)}
                      disabled={whitelistMut.isPending}
                    >
                      <ShieldCheck className="h-4 w-4" />
                      <span className="hidden sm:inline">Whitelist</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-2 text-2xl font-bold tabular-nums",
          accent ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
