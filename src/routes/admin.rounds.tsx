import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  PlayCircle,
  Plus,
  Pencil,
  Trash2,
  Globe,
  Lock,
  CircleDot,
  Loader2,
  AlertCircle,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CountryPickerDialog } from "@/components/country-picker-dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  createRound,
  renameRound,
  setRoundStatus,
  deleteRound,
} from "@/lib/rounds-admin.functions";

export const Route = createFileRoute("/admin/rounds")({
  head: () => ({ meta: [{ title: "Rounds — Solaris Admin" }] }),
  component: RoundsPage,
});

type Edition = { id: string; name: string; is_active: boolean; is_archived: boolean };
type RoundStatus = "draft" | "open" | "closed";
type Round = {
  id: string;
  edition_id: string;
  name: string;
  status: RoundStatus;
  opened_at: string | null;
  closed_at: string | null;
};

function RoundsPage() {
  const qc = useQueryClient();
  const [editionId, setEditionId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Round | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Round | null>(null);
  const [pickerRound, setPickerRound] = useState<Round | null>(null);
  const [name, setName] = useState("");

  const { data: editions } = useQuery({
    queryKey: ["editions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("editions")
        .select("id,name,is_active,is_archived")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Edition[];
    },
  });

  // Default to active edition once
  const effectiveEdition =
    editionId ??
    editions?.find((e) => e.is_active && !e.is_archived)?.id ??
    editions?.[0]?.id ??
    null;

  const { data: rounds, isLoading: roundsLoading } = useQuery({
    queryKey: ["rounds", effectiveEdition],
    queryFn: async () => {
      if (!effectiveEdition) return [];
      const { data, error } = await supabase
        .from("rounds")
        .select("*")
        .eq("edition_id", effectiveEdition)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Round[];
    },
    enabled: !!effectiveEdition,
  });

  const roundIds = useMemo(() => (rounds ?? []).map((r) => r.id), [rounds]);

  const { data: counts } = useQuery({
    queryKey: ["round_country_counts", roundIds],
    queryFn: async () => {
      if (roundIds.length === 0) return {} as Record<string, number>;
      const { data, error } = await supabase
        .from("round_countries")
        .select("round_id")
        .in("round_id", roundIds);
      if (error) throw error;
      const m: Record<string, number> = {};
      for (const r of data as { round_id: string }[]) {
        m[r.round_id] = (m[r.round_id] ?? 0) + 1;
      }
      return m;
    },
    enabled: roundIds.length > 0,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["rounds"] });
    qc.invalidateQueries({ queryKey: ["round_country_counts"] });
    qc.invalidateQueries({ queryKey: ["public-open-round"] });
  };

  const createMut = useMutation({
    mutationFn: async (n: string) => {
      if (!effectiveEdition) throw new Error("Select an edition");
      const { error } = await supabase
        .from("rounds")
        .insert({ name: n, edition_id: effectiveEdition, status: "draft" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Round created");
      setCreateOpen(false);
      setName("");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameMut = useMutation({
    mutationFn: async ({ id, n }: { id: string; n: string }) => {
      const { error } = await supabase.from("rounds").update({ name: n }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Renamed");
      setRenameTarget(null);
      setName("");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rounds").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Round deleted");
      setDeleteTarget(null);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: async ({ round, status }: { round: Round; status: RoundStatus }) => {
      if (status === "open") {
        const c = counts?.[round.id] ?? 0;
        if (c < 2 || c > 50)
          throw new Error(`Round must have between 2 and 50 countries (has ${c})`);
      }
      const update: Partial<Round> = { status };
      if (status === "open") update.opened_at = new Date().toISOString();
      if (status === "closed") update.closed_at = new Date().toISOString();
      const { error } = await supabase
        .from("rounds")
        .update(update as any)
        .eq("id", round.id);
      if (error) {
        if (error.code === "23505") {
          throw new Error("Another round is already open. Close it first.");
        }
        throw error;
      }
    },
    onSuccess: (_d, vars) => {
      toast.success(`Round ${vars.status}`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminShell title="Rounds">
      <div className="space-y-6">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-primary">Edition</p>
            <Select
              value={effectiveEdition ?? undefined}
              onValueChange={(v) => setEditionId(v)}
            >
              <SelectTrigger className="w-[280px] max-w-full">
                <SelectValue placeholder="Select an edition" />
              </SelectTrigger>
              <SelectContent>
                {(editions ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                    {e.is_active ? " · Active" : ""}
                    {e.is_archived ? " · Archived" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => {
              setName("");
              setCreateOpen(true);
            }}
            disabled={!effectiveEdition}
            className="bg-hero text-primary-foreground shadow-glow"
          >
            <Plus className="h-4 w-4" />
            New Round
          </Button>
        </div>

        {!effectiveEdition ? (
          <div className="glass-strong rounded-2xl p-10 text-center space-y-3">
            <AlertCircle className="h-6 w-6 mx-auto text-muted-foreground" />
            <h3 className="font-semibold">No edition selected</h3>
            <p className="text-sm text-muted-foreground">
              Create an edition first, then come back here to build rounds.
            </p>
          </div>
        ) : roundsLoading ? (
          <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading rounds…
          </div>
        ) : !rounds || rounds.length === 0 ? (
          <div className="glass-strong rounded-2xl p-10 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-hero grid place-items-center shadow-glow">
              <PlayCircle className="h-6 w-6 text-primary-foreground" />
            </div>
            <h3 className="font-semibold">No rounds yet</h3>
            <p className="text-sm text-muted-foreground">
              Create a round like “Semi-Final 1” or “Grand Final”.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {rounds.map((r) => {
              const c = counts?.[r.id] ?? 0;
              const ok = c >= 2 && c <= 50;
              const canOpen = ok && r.status !== "open";
              return (
                <div
                  key={r.id}
                  className="glass rounded-xl p-4 sm:p-5 flex flex-col gap-4 hover:ring-1 hover:ring-primary/30 transition"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate">{r.name}</h3>
                        <StatusBadge status={r.status} />
                        <Badge
                          variant="outline"
                          className={cn(
                            "tabular-nums",
                            ok ? "text-primary border-primary/40" : "text-muted-foreground",
                          )}
                        >
                          {c} {c === 1 ? "country" : "countries"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {r.opened_at && `Opened ${new Date(r.opened_at).toLocaleString()} · `}
                        {r.closed_at && `Closed ${new Date(r.closed_at).toLocaleString()}`}
                        {!r.opened_at && !r.closed_at && "Not opened yet"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPickerRound(r)}
                    >
                      <Globe className="h-4 w-4" />
                      Countries
                    </Button>
                    {r.status !== "open" && (
                      <Button
                        size="sm"
                        className="bg-primary text-primary-foreground"
                        disabled={!canOpen || statusMut.isPending}
                        onClick={() => statusMut.mutate({ round: r, status: "open" })}
                        title={!ok ? "Pick between 2 and 50 countries first" : ""}
                      >
                        <PlayCircle className="h-4 w-4" />
                        Open
                      </Button>
                    )}
                    {r.status === "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => statusMut.mutate({ round: r, status: "closed" })}
                        disabled={statusMut.isPending}
                      >
                        <Lock className="h-4 w-4" />
                        Close
                      </Button>
                    )}
                    {r.status !== "draft" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => statusMut.mutate({ round: r, status: "draft" })}
                        disabled={statusMut.isPending}
                      >
                        <CircleDot className="h-4 w-4" />
                        Mark Draft
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRenameTarget(r);
                        setName(r.name);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      Rename
                    </Button>
                    {r.status === "draft" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New round</DialogTitle>
            <DialogDescription>e.g. “Semi-Final 1” or “Grand Final”</DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Round name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => name.trim() && createMut.mutate(name.trim())}
              disabled={!name.trim() || createMut.isPending}
              className="bg-hero text-primary-foreground"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename round</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                renameTarget && name.trim() && renameMut.mutate({ id: renameTarget.id, n: name.trim() })
              }
              disabled={!name.trim() || renameMut.isPending}
              className="bg-hero text-primary-foreground"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this round?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes “{deleteTarget?.name}” and its country configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CountryPickerDialog
        open={!!pickerRound}
        onOpenChange={(o) => !o && setPickerRound(null)}
        roundId={pickerRound?.id ?? null}
        roundName={pickerRound?.name ?? ""}
      />
    </AdminShell>
  );
}

function StatusBadge({ status }: { status: RoundStatus }) {
  if (status === "open")
    return <Badge className="bg-primary text-primary-foreground">Open</Badge>;
  if (status === "closed")
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Closed
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Draft
    </Badge>
  );
}
