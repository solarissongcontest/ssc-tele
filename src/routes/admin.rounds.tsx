import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  CircleDot,
  Layers3,
  Loader2,
  Lock,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { RoundEntryEditor } from "@/components/round-entry-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type {
  ParticipantMode,
  SelfVotingMode,
} from "@/lib/round-entries";
import {
  createRound,
  deleteRound,
  renameRound,
  setRoundStatus,
} from "@/lib/rounds-admin.functions";
import { cn } from "@/lib/utils";
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

export const Route = createFileRoute("/admin/rounds")({
  head: () => ({
    meta: [{ title: "Rounds — Solaris Admin" }],
  }),
  component: RoundsPage,
});

type Edition = {
  id: string;
  name: string;
  is_active: boolean;
  is_archived: boolean;
};

type RoundStatus = "draft" | "open" | "closed";

export type AdminRound = {
  id: string;
  edition_id: string;
  name: string;
  status: RoundStatus;
  opened_at: string | null;
  closed_at: string | null;
  participant_mode: ParticipantMode;
  self_voting_mode: SelfVotingMode;
};

function RoundsPage() {
  const queryClient = useQueryClient();

  const [editionId, setEditionId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AdminRound | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminRound | null>(null);
  const [entryRoundId, setEntryRoundId] = useState<string | null>(null);
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

  const effectiveEdition =
    editionId ??
    editions?.find(
      (edition) =>
        edition.is_active &&
        !edition.is_archived,
    )?.id ??
    editions?.[0]?.id ??
    null;

  const {
    data: rounds,
    isLoading: roundsLoading,
  } = useQuery({
    queryKey: ["rounds", effectiveEdition],

    queryFn: async () => {
      if (!effectiveEdition) {
        return [] as AdminRound[];
      }

      const { data, error } = await supabase
        .from("rounds")
        .select(
          `
            id,
            edition_id,
            name,
            status,
            opened_at,
            closed_at,
            participant_mode,
            self_voting_mode
          `,
        )
        .eq("edition_id", effectiveEdition)
        .order("created_at", { ascending: true });

      if (error) throw error;

      return (data ?? []) as AdminRound[];
    },

    enabled: Boolean(effectiveEdition),
  });

  const roundIds = useMemo(
    () => (rounds ?? []).map((round) => round.id),
    [rounds],
  );

  /*
   * round_entries is the authoritative participant table.
   * Do not use round_countries for admin counts anymore.
   */
  const { data: counts } = useQuery({
    queryKey: ["round_entry_counts", roundIds],

    queryFn: async () => {
      if (roundIds.length === 0) {
        return {} as Record<string, number>;
      }

      const { data, error } = await supabase
        .from("round_entries" as any)
        .select("round_id")
        .in("round_id", roundIds);

      if (error) throw error;

      const result: Record<string, number> = {};

      for (const row of (data ?? []) as {
        round_id: string;
      }[]) {
        result[row.round_id] =
          (result[row.round_id] ?? 0) + 1;
      }

      return result;
    },

    enabled: roundIds.length > 0,
  });

  const createFn = useServerFn(createRound);
  const renameFn = useServerFn(renameRound);
  const deleteFn = useServerFn(deleteRound);
  const statusFn = useServerFn(setRoundStatus);

  const invalidateAll = () => {
    void queryClient.invalidateQueries({
      queryKey: ["rounds"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["round_entry_counts"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["round_entries"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["public-open-round"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["all-rounds"],
    });
  };

  const createMut = useMutation({
    mutationFn: async (roundName: string) => {
      if (!effectiveEdition) {
        throw new Error("Select an edition");
      }

      await createFn({
        data: {
          editionId: effectiveEdition,
          name: roundName,
        },
      });
    },

    onSuccess: () => {
      toast.success("Round created");
      setCreateOpen(false);
      setName("");
      invalidateAll();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const renameMut = useMutation({
    mutationFn: async ({
      id,
      newName,
    }: {
      id: string;
      newName: string;
    }) => {
      await renameFn({
        data: {
          id,
          name: newName,
        },
      });
    },

    onSuccess: () => {
      toast.success("Renamed");
      setRenameTarget(null);
      setName("");
      invalidateAll();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await deleteFn({
        data: { id },
      });
    },

    onSuccess: () => {
      toast.success("Round deleted");
      setDeleteTarget(null);
      invalidateAll();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const statusMut = useMutation({
    mutationFn: async ({
      round,
      status,
    }: {
      round: AdminRound;
      status: RoundStatus;
    }) => {
      await statusFn({
        data: {
          id: round.id,
          status,
        },
      });
    },

    onSuccess: (_data, variables) => {
      toast.success(`Round ${variables.status}`);
      invalidateAll();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  /*
   * Store only the id so the editor receives the latest round object after
   * React Query refreshes participant_mode.
   */
  const entryRound =
    (rounds ?? []).find(
      (round) => round.id === entryRoundId,
    ) ?? null;

  return (
    <AdminShell title="Rounds">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-primary">
              Edition
            </p>

            <Select
              value={effectiveEdition ?? undefined}
              onValueChange={(value) =>
                setEditionId(value)
              }
            >
              <SelectTrigger className="w-[280px] max-w-full">
                <SelectValue placeholder="Select an edition" />
              </SelectTrigger>

              <SelectContent>
                {(editions ?? []).map((edition) => (
                  <SelectItem
                    key={edition.id}
                    value={edition.id}
                  >
                    {edition.name}
                    {edition.is_active
                      ? " · Active"
                      : ""}
                    {edition.is_archived
                      ? " · Archived"
                      : ""}
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
          <div className="glass-strong space-y-3 rounded-2xl p-10 text-center">
            <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" />

            <h3 className="font-semibold">
              No edition selected
            </h3>

            <p className="text-sm text-muted-foreground">
              Create an edition first, then come back here to build rounds.
            </p>
          </div>
        ) : roundsLoading ? (
          <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            Loading rounds…
          </div>
        ) : !rounds || rounds.length === 0 ? (
          <div className="glass-strong space-y-3 rounded-2xl p-10 text-center">
            <div className="bg-hero shadow-glow mx-auto grid h-12 w-12 place-items-center rounded-2xl">
              <PlayCircle className="h-6 w-6 text-primary-foreground" />
            </div>

            <h3 className="font-semibold">
              No rounds yet
            </h3>

            <p className="text-sm text-muted-foreground">
              Create a round like “Semi-Final 1” or “Grand Final”.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {rounds.map((round) => {
              const count =
                counts?.[round.id] ?? 0;

              const validCount =
                count >= 2 &&
                count <= 50;

              const canOpen =
                validCount &&
                round.status !== "open";

              const noun =
                round.participant_mode ===
                "countries"
                  ? count === 1
                    ? "country"
                    : "countries"
                  : count === 1
                    ? "entry"
                    : "entries";

              return (
                <div
                  key={round.id}
                  className="glass flex flex-col gap-4 rounded-xl p-4 transition hover:ring-1 hover:ring-primary/30 sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold">
                          {round.name}
                        </h3>

                        <StatusBadge
                          status={round.status}
                        />

                        <ParticipantModeBadge
                          mode={
                            round.participant_mode
                          }
                        />

                        <Badge
                          variant="outline"
                          className={cn(
                            "tabular-nums",
                            validCount
                              ? "border-primary/40 text-primary"
                              : "text-muted-foreground",
                          )}
                        >
                          {count} {noun}
                        </Badge>
                      </div>

                      <p className="mt-1 text-xs text-muted-foreground">
                        {round.opened_at
                          ? `Opened ${new Date(
                              round.opened_at,
                            ).toLocaleString()} · `
                          : ""}

                        {round.closed_at
                          ? `Closed ${new Date(
                              round.closed_at,
                            ).toLocaleString()}`
                          : ""}

                        {!round.opened_at &&
                        !round.closed_at
                          ? "Not opened yet"
                          : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setEntryRoundId(round.id)
                      }
                    >
                      <Layers3 className="h-4 w-4" />
                      Entries
                    </Button>

                    {round.status !== "open" ? (
                      <Button
                        size="sm"
                        className="bg-primary text-primary-foreground"
                        disabled={
                          !canOpen ||
                          statusMut.isPending
                        }
                        onClick={() =>
                          statusMut.mutate({
                            round,
                            status: "open",
                          })
                        }
                        title={
                          !validCount
                            ? "Configure between 2 and 50 entries first"
                            : ""
                        }
                      >
                        <PlayCircle className="h-4 w-4" />
                        Open
                      </Button>
                    ) : null}

                    {round.status === "open" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          statusMut.mutate({
                            round,
                            status: "closed",
                          })
                        }
                        disabled={
                          statusMut.isPending
                        }
                      >
                        <Lock className="h-4 w-4" />
                        Close
                      </Button>
                    ) : null}

                    {round.status !== "draft" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          statusMut.mutate({
                            round,
                            status: "draft",
                          })
                        }
                        disabled={
                          statusMut.isPending
                        }
                      >
                        <CircleDot className="h-4 w-4" />
                        Mark Draft
                      </Button>
                    ) : null}

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRenameTarget(round);
                        setName(round.name);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      Rename
                    </Button>

                    {round.status === "draft" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setDeleteTarget(round)
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              New round
            </DialogTitle>

            <DialogDescription>
              e.g. “Semi-Final 1” or “Grand Final”
            </DialogDescription>
          </DialogHeader>

          <Input
            value={name}
            onChange={(event) =>
              setName(event.target.value)
            }
            placeholder="Round name"
            autoFocus
          />

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setCreateOpen(false)
              }
            >
              Cancel
            </Button>

            <Button
              onClick={() => {
                const trimmed = name.trim();

                if (trimmed) {
                  createMut.mutate(trimmed);
                }
              }}
              disabled={
                !name.trim() ||
                createMut.isPending
              }
              className="bg-hero text-primary-foreground"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Rename round
            </DialogTitle>
          </DialogHeader>

          <Input
            value={name}
            onChange={(event) =>
              setName(event.target.value)
            }
            autoFocus
          />

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setRenameTarget(null)
              }
            >
              Cancel
            </Button>

            <Button
              onClick={() => {
                const trimmed = name.trim();

                if (
                  renameTarget &&
                  trimmed
                ) {
                  renameMut.mutate({
                    id: renameTarget.id,
                    newName: trimmed,
                  });
                }
              }}
              disabled={
                !name.trim() ||
                renameMut.isPending
              }
              className="bg-hero text-primary-foreground"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this round?
            </AlertDialogTitle>

            <AlertDialogDescription>
              This permanently removes “
              {deleteTarget?.name}” and its entry configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteMut.mutate(
                    deleteTarget.id,
                  );
                }
              }}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RoundEntryEditor
        open={Boolean(entryRound)}
        onOpenChange={(open) => {
          if (!open) {
            setEntryRoundId(null);
            invalidateAll();
          }
        }}
        round={entryRound}
      />
    </AdminShell>
  );
}

function StatusBadge({
  status,
}: {
  status: RoundStatus;
}) {
  if (status === "open") {
    return (
      <Badge className="bg-primary text-primary-foreground">
        Open
      </Badge>
    );
  }

  if (status === "closed") {
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground"
      >
        Closed
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="text-muted-foreground"
    >
      Draft
    </Badge>
  );
}

function ParticipantModeBadge({
  mode,
}: {
  mode: ParticipantMode;
}) {
  const label =
    mode === "countries"
      ? "Countries"
      : mode === "custom"
        ? "Custom"
        : "Mixed";

  return (
    <Badge
      variant="outline"
      className="border-white/10 text-muted-foreground"
    >
      {label}
    </Badge>
  );
}
