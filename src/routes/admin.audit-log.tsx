import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAdminSession } from "@/hooks/use-admin-session";
import { listAuditLog, type AuditLogRow } from "@/lib/detection.functions";
import { downloadCSV, downloadJSON } from "@/lib/export";
import { FileText, Loader2, RefreshCcw } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/admin/audit-log")({
  head: () => ({ meta: [{ title: "Audit Log — Solaris Admin" }] }),
  component: AuditLogPage,
});

function AuditLogPage() {
  const { admin, isLoading, isSuperAdmin } = useAdminSession();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isLoading && (!admin || !isSuperAdmin)) navigate({ to: "/admin" });
  }, [isLoading, admin, isSuperAdmin, navigate]);

  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const listFn = useServerFn(listAuditLog);
  const q = useQuery({
    queryKey: ["audit-log", action, actor],
    queryFn: () =>
      listFn({
        data: { action: action || null, actor: actor || null, limit: 300 },
      }) as Promise<AuditLogRow[]>,
    enabled: !!admin && isSuperAdmin,
  });

  const rows = q.data ?? [];

  return (
    <AdminShell title="Moderator Audit Log">
      <div className="space-y-4">
        <div className="glass-strong rounded-2xl p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Action</label>
            <Input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g. delete_vote"
              className="w-56"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Actor</label>
            <Input
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="Username"
              className="w-56"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length === 0}
              onClick={() =>
                downloadCSV(
                  `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
                  rows.map((r) => ({
                    time: r.created_at,
                    actor: r.actor_username ?? "",
                    action: r.action,
                    target_type: r.target_type ?? "",
                    target_id: r.target_id ?? "",
                    reason: r.reason ?? "",
                  })),
                )
              }
            >
              CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length === 0}
              onClick={() =>
                downloadJSON(
                  `audit-log-${new Date().toISOString().slice(0, 10)}.json`,
                  rows,
                )
              }
            >
              JSON
            </Button>
          </div>
        </div>

        <section className="glass-strong rounded-2xl p-4 sm:p-5">
          <header className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">
              {rows.length} entr{rows.length === 1 ? "y" : "ies"}
            </h3>
          </header>
          {q.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline-block mr-2" />
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No audit entries match this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left py-2 pr-3">Time</th>
                    <th className="text-left py-2 pr-3">Actor</th>
                    <th className="text-left py-2 pr-3">Action</th>
                    <th className="text-left py-2 pr-3">Target</th>
                    <th className="text-left py-2 pr-3">Reason</th>
                    <th className="text-left py-2">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-border/60 align-top">
                      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 font-medium">
                        {r.actor_username ?? "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className="text-[10px]">
                          {r.action}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {r.target_type && (
                          <div>{r.target_type}</div>
                        )}
                        {r.target_id && (
                          <div className="text-muted-foreground font-mono">
                            {r.target_id.slice(0, 8)}…
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">{r.reason ?? "—"}</td>
                      <td className="py-2 text-xs">
                        {r.old_values || r.new_values ? (
                          <details>
                            <summary className="cursor-pointer text-primary">
                              view
                            </summary>
                            <pre className="mt-1 p-2 rounded bg-muted/40 max-w-md overflow-auto text-[10px]">
                              {JSON.stringify(
                                { old: r.old_values, new: r.new_values },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
