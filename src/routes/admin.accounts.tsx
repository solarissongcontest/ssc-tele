import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ShieldCheck,
  UserPlus,
  KeyRound,
  Ban,
  Trash2,
  Pencil,
  CheckCircle2,
  Loader2,
  ScrollText,
  Crown,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdminSession } from "@/hooks/use-admin-session";
import {
  listAdmins,
  createAdminAccount,
  updateAdminUsername,
  resetAdminPassword,
  setAdminDisabled,
  deleteAdminAccount,
  listAdminAuditLog,
} from "@/lib/admin-auth.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/accounts")({
  head: () => ({ meta: [{ title: "Admin Accounts — Solaris" }] }),
  component: AdminAccountsPage,
});

type AdminRow = {
  id: string;
  username: string;
  is_super_admin: boolean;
  disabled: boolean;
  last_login_at: string | null;
  created_at: string;
  created_by_username: string | null;
};

type AuditRow = {
  id: string;
  actor_username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  old_values: any;
  new_values: any;
  reason: string | null;
  created_at: string;
};

function AdminAccountsPage() {
  const { admin, isSuperAdmin, isLoading } = useAdminSession();
  const qc = useQueryClient();

  const fetchList = useServerFn(listAdmins);
  const fetchAudit = useServerFn(listAdminAuditLog);
  const createFn = useServerFn(createAdminAccount);
  const renameFn = useServerFn(updateAdminUsername);
  const resetFn = useServerFn(resetAdminPassword);
  const disableFn = useServerFn(setAdminDisabled);
  const deleteFn = useServerFn(deleteAdminAccount);

  const admins = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: () => fetchList() as Promise<AdminRow[]>,
    enabled: !!isSuperAdmin,
  });
  const audit = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => fetchAudit() as Promise<AuditRow[]>,
    enabled: !!isSuperAdmin,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-accounts"] });
    qc.invalidateQueries({ queryKey: ["admin-audit"] });
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [renameTarget, setRenameTarget] = useState<AdminRow | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [resetTarget, setResetTarget] = useState<AdminRow | null>(null);
  const [resetValue, setResetValue] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      createFn({ data: { username: newUsername, password: newPassword } }),
    onSuccess: () => {
      toast.success(`Created ${newUsername}`);
      setCreateOpen(false);
      setNewUsername("");
      setNewPassword("");
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.message?.replace(/^Error:\s*/, "") ?? "Could not create"),
  });
  const renameMut = useMutation({
    mutationFn: () =>
      renameFn({ data: { id: renameTarget!.id, username: renameValue } }),
    onSuccess: () => {
      toast.success("Username updated");
      setRenameTarget(null);
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.message?.replace(/^Error:\s*/, "") ?? "Could not update"),
  });
  const resetMut = useMutation({
    mutationFn: () =>
      resetFn({ data: { id: resetTarget!.id, password: resetValue } }),
    onSuccess: () => {
      toast.success("Password reset (all sessions revoked)");
      setResetTarget(null);
      setResetValue("");
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.message?.replace(/^Error:\s*/, "") ?? "Could not reset"),
  });
  const disableMut = useMutation({
    mutationFn: (row: AdminRow) =>
      disableFn({ data: { id: row.id, disabled: !row.disabled } }),
    onSuccess: () => {
      toast.success("Status updated");
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.message?.replace(/^Error:\s*/, "") ?? "Could not update"),
  });
  const deleteMut = useMutation({
    mutationFn: (row: AdminRow) => deleteFn({ data: { id: row.id } }),
    onSuccess: () => {
      toast.success("Account deleted");
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.message?.replace(/^Error:\s*/, "") ?? "Could not delete"),
  });

  if (isLoading) {
    return (
      <AdminShell title="Admin Accounts">
        <div className="grid place-items-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AdminShell>
    );
  }

  if (!isSuperAdmin) {
    return (
      <AdminShell title="Admin Accounts">
        <div className="glass-strong rounded-2xl p-8 max-w-md mx-auto text-center space-y-3">
          <Crown className="h-10 w-10 text-primary mx-auto" />
          <h2 className="text-lg font-semibold">Super Admin only</h2>
          <p className="text-sm text-muted-foreground">
            You're signed in as <span className="font-medium">{admin?.username}</span>. Only the
            Super Admin can manage administrator accounts.
          </p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Admin Accounts">
      <div className="space-y-6">
        <section className="glass-strong rounded-2xl p-5 sm:p-6 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-hero grid place-items-center shadow-glow">
              <ShieldCheck className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-primary">Access control</p>
              <h2 className="text-xl font-bold">Administrator accounts</h2>
              <p className="text-xs text-muted-foreground">
                Only the Super Admin (Arthur) can create, edit or delete administrators.
              </p>
            </div>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="bg-hero text-primary-foreground">
            <UserPlus className="h-4 w-4" /> New administrator
          </Button>
        </section>

        {admins.isLoading ? (
          <div className="glass rounded-2xl p-10 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ul className="space-y-2">
            {(admins.data ?? []).map((row) => (
              <li
                key={row.id}
                className={cn(
                  "glass rounded-xl p-4 flex items-start gap-4 flex-wrap",
                  row.disabled && "opacity-60",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{row.username}</span>
                    {row.is_super_admin && (
                      <Badge className="text-[10px] bg-hero text-primary-foreground border-0">
                        <Crown className="h-3 w-3" /> Super Admin
                      </Badge>
                    )}
                    {row.disabled && (
                      <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Last login: {row.last_login_at ? new Date(row.last_login_at).toLocaleString() : "never"} ·{" "}
                    Created: {new Date(row.created_at).toLocaleDateString()}
                    {row.created_by_username && ` by ${row.created_by_username}`}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={row.is_super_admin}
                    onClick={() => {
                      setRenameTarget(row);
                      setRenameValue(row.username);
                    }}
                  >
                    <Pencil className="h-4 w-4" /> Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setResetTarget(row);
                      setResetValue("");
                    }}
                  >
                    <KeyRound className="h-4 w-4" /> Reset password
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={row.is_super_admin || disableMut.isPending}
                    onClick={() => disableMut.mutate(row)}
                  >
                    {row.disabled ? (
                      <><CheckCircle2 className="h-4 w-4" /> Enable</>
                    ) : (
                      <><Ban className="h-4 w-4" /> Disable</>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    disabled={row.is_super_admin || deleteMut.isPending}
                    onClick={() => {
                      if (confirm(`Delete administrator "${row.username}"?`)) deleteMut.mutate(row);
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Audit log */}
        <section className="glass-strong rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-4">
            <ScrollText className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Administrator audit log</h3>
          </div>
          <div className="max-h-[420px] overflow-auto space-y-1.5">
            {(audit.data ?? []).map((row) => (
              <div key={row.id} className="text-xs bg-black/10 rounded-md px-3 py-2 border border-white/5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{row.action}</Badge>
                  {row.actor_username && (
                    <span className="text-muted-foreground">by <span className="text-foreground">{row.actor_username}</span></span>
                  )}
                  {row.target_type && (
                    <span className="text-muted-foreground">→ {row.target_type}</span>
                  )}
                </div>
                {(row.old_values || row.new_values) && (
                  <pre className="mt-1 text-[10px] text-muted-foreground overflow-x-auto">
                    {JSON.stringify({ before: row.old_values, after: row.new_values }, null, 0)}
                  </pre>
                )}
              </div>
            ))}
            {(audit.data ?? []).length === 0 && !audit.isLoading && (
              <p className="text-sm text-muted-foreground">No log entries yet.</p>
            )}
          </div>
        </section>
      </div>

      {/* Create modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New administrator</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Password (min 8 chars)</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              className="bg-hero text-primary-foreground"
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || newUsername.length < 2 || newPassword.length < 8}
            >
              {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename modal */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename {renameTarget?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>New username</Label>
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button
              className="bg-hero text-primary-foreground"
              onClick={() => renameMut.mutate()}
              disabled={renameMut.isPending || renameValue.length < 2}
            >
              {renameMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password modal */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset password for {resetTarget?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>New password (min 8 chars)</Label>
            <Input
              type="password"
              value={resetValue}
              onChange={(e) => setResetValue(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              All existing sessions for this account will be signed out.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button
              className="bg-hero text-primary-foreground"
              onClick={() => resetMut.mutate()}
              disabled={resetMut.isPending || resetValue.length < 8}
            >
              {resetMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
