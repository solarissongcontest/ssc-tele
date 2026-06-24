import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, Archive, ArchiveRestore, Star, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/editions")({
  head: () => ({ meta: [{ title: "Editions — Solaris Admin" }] }),
  component: EditionsPage,
});

type Edition = {
  id: string;
  name: string;
  is_active: boolean;
  is_archived: boolean;
  created_at: string;
};

function EditionsPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Edition | null>(null);
  const [name, setName] = useState("");

  const { data: editions, isLoading } = useQuery({
    queryKey: ["editions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("editions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Edition[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["editions"] });

  const createMut = useMutation({
    mutationFn: async (n: string) => {
      const { error } = await supabase.from("editions").insert({ name: n });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Edition created");
      setCreateOpen(false);
      setName("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameMut = useMutation({
    mutationFn: async ({ id, n }: { id: string; n: string }) => {
      const { error } = await supabase.from("editions").update({ name: n }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Renamed");
      setRenameTarget(null);
      setName("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const update: any = { is_archived: archived };
      if (archived) update.is_active = false;
      const { error } = await supabase.from("editions").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const activateMut = useMutation({
    mutationFn: async (id: string) => {
      // Deactivate all others, then activate target
      const { error: e1 } = await supabase
        .from("editions")
        .update({ is_active: false })
        .neq("id", id);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("editions")
        .update({ is_active: true, is_archived: false })
        .eq("id", id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Active edition updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminShell title="Editions">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-widest text-primary">Contest editions</p>
            <h2 className="text-xl sm:text-2xl font-bold">All editions</h2>
          </div>
          <Button
            onClick={() => {
              setName("");
              setCreateOpen(true);
            }}
            className="bg-hero text-primary-foreground shadow-glow"
          >
            <Plus className="h-4 w-4" />
            New Edition
          </Button>
        </div>

        {isLoading ? (
          <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading editions…
          </div>
        ) : !editions || editions.length === 0 ? (
          <div className="glass-strong rounded-2xl p-10 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-hero grid place-items-center shadow-glow">
              <CalendarDays className="h-6 w-6 text-primary-foreground" />
            </div>
            <h3 className="font-semibold">No editions yet</h3>
            <p className="text-sm text-muted-foreground">
              Create your first edition to start building rounds.
            </p>
            <Button
              onClick={() => {
                setName("");
                setCreateOpen(true);
              }}
              className="bg-hero text-primary-foreground"
            >
              <Plus className="h-4 w-4" />
              Create edition
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            {editions.map((e) => (
              <div
                key={e.id}
                className="glass rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:ring-1 hover:ring-primary/30 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold truncate">{e.name}</h3>
                    {e.is_active && (
                      <Badge className="bg-primary text-primary-foreground">Active</Badge>
                    )}
                    {e.is_archived && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Archived
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Created {new Date(e.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!e.is_active && !e.is_archived && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => activateMut.mutate(e.id)}
                      disabled={activateMut.isPending}
                    >
                      <Star className="h-4 w-4" />
                      Activate
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRenameTarget(e);
                      setName(e.name);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                    Rename
                  </Button>
                  {e.is_archived ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => archiveMut.mutate({ id: e.id, archived: false })}
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      Unarchive
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => archiveMut.mutate({ id: e.id, archived: true })}
                    >
                      <Archive className="h-4 w-4" />
                      Archive
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New edition</DialogTitle>
            <DialogDescription>
              e.g. "Solaris Song Contest 21"
            </DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            placeholder="Edition name"
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
            <DialogTitle>Rename edition</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(ev) => setName(ev.target.value)} autoFocus />
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
    </AdminShell>
  );
}
