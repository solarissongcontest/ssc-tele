import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin-shell";
import {
  CalendarDays,
  PlayCircle,
  Trophy,
  BarChart3,
  ShieldAlert,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Admin Overview — Solaris" }] }),
  component: AdminOverview,
});

type OverviewStats = {
  editions: number;
  rounds: number;
  openRounds: number;
  submissions: number;
  blocked: number;
  activeEdition: string | null;
};

function AdminOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview-stats"],
    queryFn: async (): Promise<OverviewStats> => {
      const [editions, rounds, openRounds, submissions, blocked, active] =
        await Promise.all([
          supabase.from("editions").select("*", { count: "exact", head: true }),
          supabase.from("rounds").select("*", { count: "exact", head: true }),
          supabase
            .from("rounds")
            .select("*", { count: "exact", head: true })
            .eq("status", "open"),
          supabase
            .from("vote_submissions")
            .select("*", { count: "exact", head: true }),
          supabase
            .from("anti_abuse_events")
            .select("*", { count: "exact", head: true }),
          supabase
            .from("editions")
            .select("name")
            .eq("is_active", true)
            .maybeSingle(),
        ]);
      return {
        editions: editions.count ?? 0,
        rounds: rounds.count ?? 0,
        openRounds: openRounds.count ?? 0,
        submissions: submissions.count ?? 0,
        blocked: blocked.count ?? 0,
        activeEdition: (active.data as any)?.name ?? null,
      };
    },
    refetchInterval: 15_000,
  });

  const stats = [
    {
      label: "Editions",
      value: data?.editions,
      icon: CalendarDays,
      to: "/admin/editions" as const,
    },
    {
      label: "Rounds",
      value: data?.rounds,
      icon: PlayCircle,
      to: "/admin/rounds" as const,
    },
    {
      label: "Open rounds",
      value: data?.openRounds,
      icon: PlayCircle,
      to: "/admin/rounds" as const,
    },
    {
      label: "Submissions",
      value: data?.submissions,
      icon: Users,
      to: "/admin/results" as const,
    },
    {
      label: "Anti-abuse events",
      value: data?.blocked,
      icon: ShieldAlert,
      to: "/admin/anti-abuse" as const,
    },
    {
      label: "Active edition",
      value: data?.activeEdition ?? "—",
      icon: Trophy,
      to: "/admin/editions" as const,
      isText: true,
    },
  ];

  return (
    <AdminShell title="Overview">
      <div className="space-y-8">
        <section className="glass-strong rounded-2xl p-6 sm:p-8">
          <p className="text-xs uppercase tracking-widest text-primary">
            Control room
          </p>
          <h2 className="mt-1 text-2xl sm:text-3xl font-bold">
            Solaris Televote
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Manage editions, configure rounds, review live results and protect
            the vote.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            At a glance
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {stats.map((s) => {
              const Icon = s.icon;
              const display =
                isLoading || s.value === undefined
                  ? "…"
                  : s.isText
                    ? String(s.value)
                    : new Intl.NumberFormat().format(Number(s.value));
              return (
                <Link
                  key={s.label}
                  to={s.to}
                  className="glass rounded-xl p-4 sm:p-5 hover:ring-1 hover:ring-primary/40 hover:-translate-y-0.5 transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {s.label}
                    </span>
                    <Icon className="h-4 w-4 text-primary/70" />
                  </div>
                  <div
                    className={
                      s.isText
                        ? "mt-3 text-xl font-bold truncate"
                        : "mt-3 text-3xl font-bold tabular-nums"
                    }
                  >
                    {display}
                  </div>
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
              <Link
                key={q.to}
                to={q.to}
                className="glass rounded-xl p-4 flex items-center gap-3 hover:bg-card/90 transition"
              >
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
