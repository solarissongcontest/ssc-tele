import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileJson,
  Flag,
  Globe,
  Loader2,
  MessageSquare,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { CountryFlag } from "@/components/country-flag";
import { EntryAvatar } from "@/components/entry-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEntryKeyCatalog } from "@/hooks/use-entry-key-catalog";
import {
  useAllCountries,
  useAllRounds,
} from "@/hooks/use-round-results";
import { downloadCSV, downloadJSON } from "@/lib/export";
import {
  entryMap,
  getEntryDisplayName,
} from "@/lib/round-entries";
import {
  listModerationSubmissions,
  restoreSubmission,
  setSubmissionStatus,
  softDeleteSubmission,
  updateSubmissionNote,
  type ModerationSubmission,
} from "@/lib/moderation.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/anti-abuse")({
  head: () => ({
    meta: [{ title: "Moderation — Solaris Admin" }],
  }),
  component: ModerationPage,
});

const STATUS_STYLES: Record<string, string> = {
  active: "bg-primary/15 text-primary border-primary/30",
  suspicious:
    "bg-amber-500/15 text-amber-400 border-amber-400/40",
  verified:
    "bg-emerald-500/15 text-emerald-400 border-emerald-400/40",
  deleted:
    "bg-destructive/15 text-destructive border-destructive/40",
};

function ModerationPage() {
  const qc = useQueryClient();

  const { data: rounds } = useAllRounds();
  const { data: countries } = useAllCountries();

  const [roundId, setRoundId] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);

  const [detail, setDetail] =
    useState<ModerationSubmission | null>(null);

  const [deleteTarget, setDeleteTarget] =
    useState<ModerationSubmission | null>(null);

  const [deleteReason, setDeleteReason] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  const listFn = useServerFn(listModerationSubmissions);
  const statusFn = useServerFn(setSubmissionStatus);
  const deleteFn = useServerFn(softDeleteSubmission);
  const restoreFn = useServerFn(restoreSubmission);
  const noteFn = useServerFn(updateSubmissionNote);

  const subs = useQuery({
    queryKey: ["moderation-subs", roundId],
    queryFn: () =>
      listFn({
        data: {
          roundId: roundId === "all" ? null : roundId,
        },
      }) as Promise<ModerationSubmission[]>,
    refetchInterval: 20_000,
  });

  const targetKeys = useMemo(
    () =>
      Array.from(
        new Set(
          (subs.data ?? []).flatMap((submission) =>
            submission.entries.map(
              (entry) => entry.target_country_code,
            ),
          ),
        ),
      ),
    [subs.data],
  );

  const { data: targetEntries = [] } =
    useEntryKeyCatalog(targetKeys);

  const byEntryKey = useMemo(
    () => entryMap(targetEntries),
    [targetEntries],
  );

  /*
   * Voter identity is still a Solaris country.
   */
  const byCountryCode = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        flag: string;
        flag_url: string | null;
      }
    >();

    for (const country of countries ?? []) {
      map.set(country.code, country);
    }

    return map;
  }, [countries]);

  const targetName = (entryKey: string) => {
    const entry = byEntryKey.get(entryKey);

    return entry
      ? getEntryDisplayName(entry)
      : entryKey;
  };

  const roundName = (id: string | null) =>
    rounds?.find((round) => round.id === id)?.name ?? "—";

  const invalidateAll = () => {
    void qc.invalidateQueries({
      queryKey: ["moderation-subs"],
    });

    void qc.invalidateQueries({
      queryKey: ["moderation-alerts"],
    });

    void qc.invalidateQueries({
      queryKey: ["entry-key-catalog"],
    });
  };

  const statusMut = useMutation({
    mutationFn: (value: {
      id: string;
      status: "active" | "suspicious" | "verified";
    }) => statusFn({ data: value }),

    onSuccess: () => {
      toast.success("Status updated");
      invalidateAll();
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (value: {
      id: string;
      reason: string;
    }) => deleteFn({ data: value }),

    onSuccess: () => {
      toast.success("Vote deleted");
      setDeleteTarget(null);
      setDeleteReason("");
      invalidateAll();
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Failed"),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) =>
      restoreFn({ data: { id } }),

    onSuccess: () => {
      toast.success("Vote restored");
      invalidateAll();
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Failed"),
  });

  const noteMut = useMutation({
    mutationFn: (value: {
      id: string;
      note: string;
    }) => noteFn({ data: value }),

    onSuccess: () => {
      toast.success("Note saved");
      invalidateAll();
    },

    onError: (error: any) =>
      toast.error(error?.message ?? "Failed"),
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();

    return (subs.data ?? []).filter((submission) => {
      if (!showDeleted && submission.status === "deleted") {
        return false;
      }

      if (status !== "all" && submission.status !== status) {
        return false;
      }

      if (term) {
        const targets = submission.entries
          .map((entry) => {
            const entryKey = entry.target_country_code;
            const resolved = byEntryKey.get(entryKey);

            return resolved
              ? `${getEntryDisplayName(resolved)} ${entryKey}`
              : entryKey;
          })
          .join(" ");

        const haystack = [
          submission.username,
          submission.country_code,
          submission.ip_country ?? "",
          targets,
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(term)) return false;
      }

      return true;
    });
  }, [
    subs.data,
    showDeleted,
    status,
    q,
    byEntryKey,
  ]);

  const totals = useMemo(() => {
    const all = subs.data ?? [];

    return {
      total: all.length,
      suspicious: all.filter(
        (submission) => submission.status === "suspicious",
      ).length,
      verified: all.filter(
        (submission) => submission.status === "verified",
      ).length,
      deleted: all.filter(
        (submission) => submission.status === "deleted",
      ).length,
      vpn: all.filter((submission) => submission.is_vpn).length,
      mismatch: all.filter(
        (submission) =>
          submission.ip_country &&
          submission.ip_country.toUpperCase() !==
            submission.country_code.toUpperCase(),
      ).length,
    };
  }, [subs.data]);

  const exportRows = () =>
    filtered.map((submission) => ({
      timestamp: submission.created_at,
      username: submission.username,
      home_country:
        byCountryCode.get(submission.country_code)?.name ??
        submission.country_code,
      home_code: submission.country_code,
      ip_country: submission.ip_country ?? "",
      is_vpn: submission.is_vpn,
      status: submission.status,
      risk_score: submission.risk_score,
      round: roundName(submission.round_id),
      moderator_note: submission.moderator_note ?? "",
      entries: submission.entries
        .map((entry) => {
          const entryKey = entry.target_country_code;

          return `${targetName(entryKey)} [${entryKey}]:${entry.points}`;
        })
        .join("|"),
    }));

  return (
    <AdminShell title="Moderation">
      <div className="space-y-6">
        <section className="glass-strong rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-hero shadow-glow">
              <ShieldAlert className="h-5 w-5 text-primary-foreground" />
            </div>

            <div>
              <p className="text-xs uppercase tracking-widest text-primary">
                Vote integrity
              </p>

              <h2 className="text-xl font-bold">
                Moderation dashboard
              </h2>

              <p className="text-xs text-muted-foreground">
                Voter identity remains the selected Solaris country.
                Ballot targets are generic round entries identified by stable
                entry keys.
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Ballots" value={totals.total} />
          <Stat
            label="Suspicious"
            value={totals.suspicious}
            accent
          />
          <Stat label="Verified" value={totals.verified} />
          <Stat label="Deleted" value={totals.deleted} />
          <Stat
            label="VPN / proxy"
            value={totals.vpn}
            accent
          />
          <Stat
            label="Country mismatch"
            value={totals.mismatch}
          />
        </div>

        <section className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3 sm:p-4">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search voter or target entry…"
              className="pl-9"
            />
          </div>

          <Select value={roundId} onValueChange={setRoundId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Round" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="all">
                All rounds
              </SelectItem>

              {(rounds ?? []).map((round) => (
                <SelectItem key={round.id} value={round.id}>
                  {round.edition_name
                    ? `${round.edition_name} · `
                    : ""}
                  {round.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="all">
                All statuses
              </SelectItem>
              <SelectItem value="active">
                Active
              </SelectItem>
              <SelectItem value="suspicious">
                Suspicious
              </SelectItem>
              <SelectItem value="verified">
                Verified
              </SelectItem>
              <SelectItem value="deleted">
                Deleted
              </SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={showDeleted ? "default" : "outline"}
            size="sm"
            onClick={() => setShowDeleted((value) => !value)}
          >
            {showDeleted ? "Hiding" : "Show"} deleted
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={invalidateAll}
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="bg-hero text-primary-foreground"
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  downloadCSV(
                    `solaris-moderation-${new Date()
                      .toISOString()
                      .slice(0, 10)}.csv`,
                    exportRows(),
                  )
                }
              >
                <Download className="h-4 w-4" />
                CSV
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() =>
                  downloadJSON(
                    `solaris-moderation-${new Date()
                      .toISOString()
                      .slice(0, 10)}.json`,
                    exportRows(),
                  )
                }
              >
                <FileJson className="h-4 w-4" />
                JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        {subs.isLoading ? (
          <div className="glass-strong grid place-items-center rounded-2xl p-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-strong rounded-2xl p-10 text-center text-sm text-muted-foreground">
            <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-primary/70" />
            No ballots match the current filters.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((submission) => {
              const homeCountry =
                byCountryCode.get(submission.country_code);

              const ipCountry = submission.ip_country
                ? byCountryCode.get(submission.ip_country)
                : null;

              const mismatch =
                submission.ip_country &&
                submission.ip_country.toUpperCase() !==
                  submission.country_code.toUpperCase();

              return (
                <li
                  key={submission.id}
                  className={cn(
                    "glass rounded-xl p-3 sm:p-4",
                    submission.status === "suspicious" &&
                      "ring-1 ring-amber-400/30",
                    submission.status === "deleted" &&
                      "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                        submission.status === "suspicious"
                          ? "bg-amber-500/20 text-amber-400"
                          : submission.status === "verified"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : submission.status === "deleted"
                              ? "bg-destructive/20 text-destructive"
                              : "bg-primary/15 text-primary",
                      )}
                    >
                      {submission.status === "verified" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : submission.status === "deleted" ? (
                        <Trash2 className="h-4 w-4" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold">
                          {submission.username}
                        </span>

                        <Badge
                          variant="outline"
                          className="inline-flex gap-1 text-[10px]"
                        >
                          <CountryFlag
                            country={homeCountry}
                            size={12}
                          />
                          {homeCountry?.name ?? submission.country_code}
                        </Badge>

                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] uppercase tracking-wide",
                            STATUS_STYLES[submission.status],
                          )}
                        >
                          {submission.status}
                        </Badge>

                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            submission.risk_score >= 70
                              ? "border-destructive/40 text-destructive"
                              : submission.risk_score >= 30
                                ? "border-amber-400/40 text-amber-400"
                                : "",
                          )}
                        >
                          risk {submission.risk_score}
                        </Badge>

                        {submission.is_vpn ? (
                          <Badge
                            variant="outline"
                            className="inline-flex gap-1 border-amber-400/40 text-[10px] text-amber-400"
                          >
                            <Wifi className="h-3 w-3" />
                            VPN
                          </Badge>
                        ) : null}

                        {mismatch ? (
                          <Badge
                            variant="outline"
                            className="inline-flex gap-1 border-amber-400/40 text-[10px] text-amber-400"
                          >
                            <Globe className="h-3 w-3" />
                            IP {ipCountry?.name ?? submission.ip_country}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-1 text-xs text-muted-foreground">
                        {roundName(submission.round_id)} ·{" "}
                        {new Date(
                          submission.created_at,
                        ).toLocaleString()}{" "}
                        · {submission.entries.length} entries ·{" "}
                        {submission.entries.reduce(
                          (sum, entry) => sum + entry.points,
                          0,
                        )}{" "}
                        pts
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {[...submission.entries]
                          .sort((a, b) => b.points - a.points)
                          .slice(0, 4)
                          .map((ballotEntry) => {
                            const entryKey =
                              ballotEntry.target_country_code;

                            const resolved =
                              byEntryKey.get(entryKey);

                            return (
                              <Badge
                                key={entryKey}
                                variant="outline"
                                className="inline-flex max-w-[180px] gap-1 text-[10px]"
                              >
                                <EntryAvatar
                                  entry={resolved}
                                  size={13}
                                />

                                <span className="truncate">
                                  {targetName(entryKey)}
                                </span>

                                <span className="font-semibold tabular-nums text-primary">
                                  {ballotEntry.points}
                                </span>
                              </Badge>
                            );
                          })}
                      </div>

                      {submission.moderator_note ? (
                        <div className="mt-2 border-l-2 border-primary/40 pl-2 text-[11px] italic text-muted-foreground">
                          <MessageSquare className="mr-1 inline h-3 w-3" />
                          {submission.moderator_note}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDetail(submission);
                          setNoteDraft(
                            submission.moderator_note ?? "",
                          );
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>

                      {submission.status !== "deleted" &&
                      submission.status !== "verified" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-emerald-400/40 text-emerald-400"
                          onClick={() =>
                            statusMut.mutate({
                              id: submission.id,
                              status: "verified",
                            })
                          }
                          disabled={statusMut.isPending}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      ) : null}

                      {submission.status !== "deleted" &&
                      submission.status !== "suspicious" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-400/40 text-amber-400"
                          onClick={() =>
                            statusMut.mutate({
                              id: submission.id,
                              status: "suspicious",
                            })
                          }
                          disabled={statusMut.isPending}
                        >
                          <Flag className="h-4 w-4" />
                        </Button>
                      ) : null}

                      {submission.status !== "deleted" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-destructive/40 text-destructive"
                          onClick={() => {
                            setDeleteTarget(submission);
                            setDeleteReason("");
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            restoreMut.mutate(submission.id)
                          }
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

      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Ballot detail
            </DialogTitle>
          </DialogHeader>

          {detail ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info label="Username" value={detail.username} />
                <Info
                  label="Home"
                  value={
                    byCountryCode.get(detail.country_code)?.name ??
                    detail.country_code
                  }
                />
                <Info
                  label="IP country"
                  value={detail.ip_country ?? "—"}
                />
                <Info
                  label="VPN"
                  value={detail.is_vpn ? "Yes" : "No"}
                />
                <Info
                  label="Risk"
                  value={String(detail.risk_score)}
                />
                <Info
                  label="Status"
                  value={detail.status}
                />
                <Info
                  label="Submitted"
                  value={new Date(
                    detail.created_at,
                  ).toLocaleString()}
                />
                <Info
                  label="Round"
                  value={roundName(detail.round_id)}
                />
              </div>

              <div>
                <p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
                  Points breakdown
                </p>

                <ul className="space-y-1 text-xs">
                  {[...detail.entries]
                    .sort((a, b) => b.points - a.points)
                    .map((ballotEntry) => {
                      const entryKey =
                        ballotEntry.target_country_code;

                      const resolved =
                        byEntryKey.get(entryKey);

                      return (
                        <li
                          key={entryKey}
                          className="flex items-center gap-2"
                        >
                          <EntryAvatar
                            entry={resolved}
                            size={16}
                          />

                          <span className="min-w-0 flex-1 truncate">
                            {targetName(entryKey)}
                          </span>

                          <span className="text-[10px] text-muted-foreground">
                            {entryKey}
                          </span>

                          <span className="font-semibold tabular-nums">
                            {ballotEntry.points}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>

              <div>
                <p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
                  Moderator note
                </p>

                <Textarea
                  value={noteDraft}
                  onChange={(event) =>
                    setNoteDraft(event.target.value)
                  }
                  placeholder="Add context for future moderators…"
                  rows={3}
                />
              </div>
            </div>
          ) : null}

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

                noteMut.mutate({
                  id: detail.id,
                  note: noteDraft,
                });

                setDetail(null);
              }}
              disabled={noteMut.isPending}
            >
              Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete this ballot?
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            The vote will be excluded from official results but kept
            in the archive, including its stable target entry keys,
            for integrity analysis and audit.
          </p>

          <Textarea
            value={deleteReason}
            onChange={(event) =>
              setDeleteReason(event.target.value)
            }
            placeholder="Reason (required)"
            rows={3}
          />

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>

            <Button
              className="bg-destructive text-destructive-foreground"
              disabled={!deleteReason.trim() || deleteMut.isPending}
              onClick={() => {
                if (!deleteTarget) return;

                deleteMut.mutate({
                  id: deleteTarget.id,
                  reason: deleteReason,
                });
              }}
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
      <div className="text-xs text-muted-foreground">
        {label}
      </div>

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

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>

      <div className="truncate font-medium">
        {value}
      </div>
    </div>
  );
}
