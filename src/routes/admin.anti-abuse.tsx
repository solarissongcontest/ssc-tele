import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCcw,
  Download,
  FileJson,
  Search,
  Loader2,
  AlertTriangle,
  Trash2,
  RotateCcw,
  MessageSquare,
  Globe,
  Wifi,
  Eye,
  CheckCircle2,
  Flag,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CountryFlag } from "@/components/country-flag";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAllRounds, useAllCountries } from "@/hooks/use-round-results";
import { downloadCSV, downloadJSON } from "@/lib/export";
import { cn } from "@/lib/utils";
import {
  listModerationSubmissions,
  setSubmissionStatus,
  softDeleteSubmission,
  restoreSubmission,
  updateSubmissionNote,
  type ModerationSubmission,
} from "@/lib/moderation.functions";

export const Route = createFileRoute("/admin/anti-abuse")({
  head: () => ({ meta: [{ title: "Moderation — Solaris Admin" }] }),
  component: ModerationPage,
});

const STATUS_STYLES: Record<string, string> = {
  active: "bg-primary/15 text-primary border-primary/30",
  suspicious: "bg-amber-500/15 text-amber-400 border-amber-400/40",
  verified: "bg-emerald-500/15 text-emerald-400 border-emerald-400/40",
  deleted: "bg-destructive/15 text-destructive border-destructive/40",
};

function ModerationPage() {
  const qc = useQueryClient();
  const { data: rounds } = useAllRounds();
  const { data: countries } = useAllCountries();
  const [roundId, setRoundId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [detail, setDetail] = useState<ModerationSubmission | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModerationSubmission | null>(
    null,
  );
  const [deleteReason, setDeleteReason] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  const listFn = useServerFn(listModerationSubmissions);
  const statusFn = useServerFn(setSubmissionStatus);
  const deleteFn = useServerFn(softDeleteSubmission);
  const restoreFn = useServerFn(restoreSubmission);
  const noteFn = useServerFn(updateSubmissionNote);

  const byCode = useMemo(() => {
    const m = new Map<string, { name: string; flag: string; flag_url: string | null }>();
    (countries ?? []).forEach((c) => m.set(c.code, c));
    return m;
  }, [countries]);

  const roundName = (id: string | null) =>
    rounds?.find((r) => r.id === id)?.name ?? "—";

  const subs = useQuery({
    queryKey: ["moderation-subs", roundId],
    queryFn: () =>
      listFn({ data: { roundId: roundId === "all" ? null : roundId } }) as Promise<
        ModerationSubmission[]
      >,
    refetchInterval: 20_000,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["moderation-subs"] });
    qc.invalidateQueries({ queryKey: ["moderation-alerts"] });
  };

  const statusMut = useMutation({
    mutationFn: (v: {
      id: string;
      status: "active" | "suspicious" | "verified";
    }) => statusFn({ data: v }),
    onSuccess: () => {
      toast.success("Status updated");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (v: { id: string; reason: string }) => deleteFn({ data: v }),
    onSuccess: () => {
      toast.success("Vote deleted");
      setDeleteTarget(null);
      setDeleteReason("");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Vote restored");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const noteMut = useMutation({
    mutationFn: (v: { id: string; note: string }) => noteFn({ data: v }),
    onSuccess: () => {
      toast.success("Note saved");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (subs.data ?? []).filter((s) => {
      if (!showDeleted && s.status === "deleted") return false;
      if (status !== "all" && s.status !== status) return false;
      if (term) {
        const hay = `${s.username} ${s.country_code} ${s.ip_country ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [subs.data, status, q, showDeleted]);

  const totals = useMemo(() => {
    const all = subs.data ?? [];
    return {
      total: all.length,
      suspicious: all.filter((s) => s.status === "suspicious").length,
      verified: all.filter((s) => s.status === "verified").length,
      deleted: all.filter((s) => s.status === "deleted").length,
      vpn: all.filter((s) => s.is_vpn).length,
      mismatch: all.filter(
        (s) =>
          s.ip_country &&
          s.ip_country.toUpperCase() !== s.country_code.toUpperCase(),
      ).length,
    };
  }, [subs.data]);

  const exportRows = () =>
    filtered.map((s) => ({
      timestamp: s.created_at,
      username: s.username,
      home_country: byCode.get(s.country_code)?.name ?? s.country_code,
      home_code: s.country_code,
      ip_country: s.ip_country ?? "",
      is_vpn: s.is_vpn,
      status: s.status,
      risk_score: s.risk_score,
      round: roundName(s.round_id),
      moderator_note: s.moderator_note ?? "",
      entries: s.entries
        .map((e) => `${e.target_country_code}:${e.points}`)
        .join("|"),
    }));

  return (
    <AdminShell title="Moderation">
      <div className="space-y-6">
        <section className="glass-strong rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-hero grid place-items-center shadow-glow">
              <ShieldAlert className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-primary">
                Vote integrity
              </p>
              <h2 className="text-xl font-bold">Moderation dashboard</h2>
              <p className="text-xs text-muted-foreground">
                Review, verify, edit or remove submitted ballots. Every action is
                recorded in the audit log.
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Ballots" value={totals.total} />
          <Stat label="Suspicious" value={totals.suspicious} accent />
          <Stat label="Verified" value={totals.verified} />
          <Stat label="Deleted" value={totals.deleted} />
          <Stat label="VPN / proxy" value={totals.vpn} accent />
          <Stat label="Country mismatch" value={totals.mismatch} />
        </div>

        {/* Filters */}
        <section className="glass rounded-2xl p-3 sm:p-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search username or country…"
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
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspicious">Suspicious</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="deleted">Deleted</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={showDeleted ? "default" : "outline"}
            size="sm"
            onClick={() => setShowDeleted((v) => !v)}
          >
            {showDeleted ? "Hiding" : "Show"} deleted
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => invalidateAll()}
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
              <DropdownMenuItem
                onClick={() =>
                  downloadCSV(
                    `solaris-moderation-${new Date().toISOString().slice(0, 10)}.csv`,
                    exportRows(),
                    [
                      "timestamp",
                      "username",
                      "home_country",
                      "home_code",
                      "ip_country",
                      "is_vpn",
                      "status",
                      "risk_score",
                      "round",
                      "moderator_note",
                      "entries",
                    ],
                  )
                }
              >
                <Download className="h-4 w-4" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  downloadJSON(
                    `solaris-moderation-${new Date().toISOString().slice(0, 10)}.json`,
                    exportRows(),
                  )
                }
              >
                <FileJson className="h-4 w-4" /> JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        {/* List */}
        {subs.isLoading ? (
          <div className="glass-strong rounded-2xl p-10 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-strong rounded-2xl p-10 text-center text-sm text-muted-foreground">
            <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-primary/70" />
            No ballots match the current filters.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((s) => {
              const homeC = byCode.get(s.country_code);
              const ipC = s.ip_country ? byCode.get(s.ip_country) : null;
              const mismatch =
                s.ip_country &&
                s.ip_country.toUpperCase() !== s.country_code.toUpperCase();
              return (
                <li
                  key={s.id}
                  className={cn(
                    "glass rounded-xl p-3 sm:p-4",
                    s.status === "suspicious" && "ring-1 ring-amber-400/30",
                    s.status === "deleted" && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "h-9 w-9 shrink-0 rounded-lg grid place-items-center",
                        s.status === "suspicious"
                          ? "bg-amber-500/20 text-amber-400"
                          : s.status === "verified"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : s.status === "deleted"
                              ? "bg-destructive/20 text-destructive"
                              : "bg-primary/15 text-primary",
                      )}
                    >
                      {s.status === "verified" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : s.status === "deleted" ? (
                        <Trash2 className="h-4 w-4" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm truncate">
                          {s.username}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] inline-flex items-center gap-1"
                        >
                          <CountryFlag country={homeC} size={12} />
                          {homeC?.name ?? s.country_code}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] uppercase tracking-wide", STATUS_STYLES[s.status])}
                        >
                          {s.status}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            s.risk_score >= 70
                              ? "text-destructive border-destructive/40"
                              : s.risk_score >= 30
                                ? "text-amber-400 border-amber-400/40"
                                : "",
                          )}
                        >
                          risk {s.risk_score}
                        </Badge>
                        {s.is_vpn && (
                          <Badge
                            variant="outline"
                            className="text-[10px] inline-flex items-center gap-1 text-amber-400 border-amber-400/40"
                          >
                            <Wifi className="h-3 w-3" /> VPN
                          </Badge>
                        )}
                        {mismatch && (
                          <Badge
                            variant="outline"
                            className="text-[10px] inline-flex items-center gap-1 text-amber-400 border-amber-400/40"
                          >
                            <Globe className="h-3 w-3" />
                            IP {ipC?.name ?? s.ip_country}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {roundName(s.round_id)} ·{" "}
                        {new Date(s.created_at).toLocaleString()} ·{" "}
                        {s.entries.length} countries ·{" "}
                        {s.entries.reduce((a, b) => a + b.points, 0)} pts
                      </div>
                      {s.moderator_note && (
                        <div className="mt-2 text-[11px] text-muted-foreground italic border-l-2 border-primary/40 pl-2">
                          <MessageSquare className="inline h-3 w-3 mr-1" />
                          {s.moderator_note}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDetail(s);
                          setNoteDraft(s.moderator_note ?? "");
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {s.status !== "deleted" && s.status !== "verified" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-emerald-400 border-emerald-400/40"
                          onClick={() =>
                            statusMut.mutate({ id: s.id, status: "verified" })
                          }
                          disabled={statusMut.isPending}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                      {s.status !== "deleted" && s.status !== "suspicious" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-amber-400 border-amber-400/40"
                          onClick={() =>
                            statusMut.mutate({ id: s.id, status: "suspicious" })
                          }
                          disabled={statusMut.isPending}
                        >
                          <Flag className="h-4 w-4" />
                        </Button>
                      )}
                      {s.status !== "deleted" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/40"
                          onClick={() => {
                            setDeleteTarget(s);
                            setDeleteReason("");
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => restoreMut.mutate(s.id)}
                          disabled={restoreMut.isPending}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ballot detail</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info label="Username" value={detail.username} />
                <Info label="Home" value={detail.country_code} />
                <Info label="IP country" value={detail.ip_country ?? "—"} />
                <Info label="VPN" value={detail.is_vpn ? "Yes" : "No"} />
                <Info label="Risk" value={String(detail.risk_score)} />
                <Info label="Status" value={detail.status} />
                <Info
                  label="Submitted"
                  value={new Date(detail.created_at).toLocaleString()}
                />
                <Info label="Round" value={roundName(detail.round_id)} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                  Points breakdown
                </p>
                <ul className="text-xs space-y-1">
                  {[...detail.entries]
                    .sort((a, b) => b.points - a.points)
                    .map((e) => (
                      <li
                        key={e.target_country_code}
                        className="flex items-center gap-2"
                      >
                        <CountryFlag
                          country={byCode.get(e.target_country_code)}
                          size={14}
                        />
                        <span className="flex-1 truncate">
                          {byCode.get(e.target_country_code)?.name ??
                            e.target_country_code}
                        </span>
                        <span className="tabular-nums font-semibold">
                          {e.points}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                  Moderator note
                </p>
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add context for future moderators…"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDetail(null)}
            >
              Close
            </Button>
            <Button
              onClick={() => {
                if (!detail) return;
                noteMut.mutate({ id: detail.id, note: noteDraft });
                setDetail(null);
              }}
              disabled={noteMut.isPending}
            >
              Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this ballot?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The vote will be excluded from all results, but kept in the archive
            (with your reason) for audit. The voter can re-submit.
          </p>
          <Textarea
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder="Reason (required)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground"
              disabled={!deleteReason.trim() || deleteMut.isPending}
              onClick={() =>
                deleteTarget &&
                deleteMut.mutate({ id: deleteTarget.id, reason: deleteReason })
              }
            >
              Delete vote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          accent ? "text-amber-400" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="font-medium truncate">{value}</div>
    </div>
  );
}
