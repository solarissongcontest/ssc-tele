import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin-shell";
import { CalendarDays, PlayCircle, Trophy, BarChart3, ShieldAlert, Users } from "lucide-react";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Admin Overview — Solaris" }] }),
  component: AdminOverview,
});

const STATS = [
  { label: "Editions", value: "—", icon: CalendarDays, to: "/admin/editions" },
  { label: "Rounds", value: "—", icon: PlayCircle, to: "/admin/rounds" },
  { label: "Open rounds", value: "—", icon: PlayCircle, to: "/admin/rounds" },
  { label: "Submissions", value: "—", icon: Users, to: "/admin/results" },
  { label: "Blocked attempts", value: "—", icon: ShieldAlert, to: "/admin/anti-abuse" },
  { label: "Active edition", value: "—", icon: Trophy, to: "/admin/editions" },
] as const;

function AdminOverview() {
  return (
    <AdminShell title="Overview">
      <div className="space-y-8">
        <section className="glass-strong rounded-2xl p-6 sm:p-8">
          <p className="text-xs uppercase tracking-widest text-primary">Control room</p>
          <h2 className="mt-1 text-2xl sm:text-3xl font-bold">Solaris Televote</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Manage editions, configure rounds, review live results and protect the vote.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            At a glance
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {STATS.map((s) => {
              const Icon = s.icon;
              return (
                <Link
                  key={s.label}
                  to={s.to}
                  className="glass rounded-xl p-4 sm:p-5 hover:ring-1 hover:ring-primary/40 hover:-translate-y-0.5 transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <Icon className="h-4 w-4 text-primary/70" />
                  </div>
                  <div className="mt-3 text-3xl font-bold tabular-nums">{s.value}</div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="grid sm:grid-cols-2 gap-3">
          {[
            { to: "/admin/editions", label: "Manage Editions", icon: CalendarDays },
            { to: "/admin/rounds", label: "Configure Rounds", icon: PlayCircle },
            { to: "/admin/results", label: "View Results", icon: Trophy },
            { to: "/admin/analytics", label: "Open Analytics", icon: BarChart3 },
          ].map((q) => {
            const I = q.icon;
            return (
              <Link key={q.to} to={q.to} className="glass rounded-xl p-4 flex items-center gap-3 hover:bg-card/90 transition">
                <div className="h-9 w-9 rounded-lg bg-hero grid place-items-center">
                  <I className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="font-medium">{q.label}</span>
              </Link>
            );
          })}
        </section>
      </div>
    </AdminShell>
  );
}
