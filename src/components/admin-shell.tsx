import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, useEffect, type ReactNode } from "react";
import {
  LayoutDashboard,
  Trophy,
  PlayCircle,
  BarChart3,
  ShieldAlert,
  CalendarDays,
  ArrowLeft,
  LogOut,
  Menu,
  Palette,
  X,
} from "lucide-react";
import { SolarisLogo } from "./solaris-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useIsAdmin } from "@/hooks/use-is-admin";

const NAV = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/admin/editions", label: "Editions", icon: CalendarDays },
  { to: "/admin/rounds", label: "Rounds", icon: PlayCircle },
  { to: "/admin/results", label: "Results", icon: Trophy },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/admin/anti-abuse", label: "Anti-Abuse", icon: ShieldAlert },
  { to: "/admin/theme", label: "Theme", icon: Palette },
] as const;

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <SolarisLogo />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to, (item as any).exact);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-primary/30"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-3 space-y-2 border-t border-sidebar-border">
        <Button asChild variant="outline" className="w-full justify-start" size="sm">
          <Link to="/" onClick={onNavigate}>
            <ArrowLeft className="h-4 w-4" />
            Back to Voting
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-destructive"
          onClick={async () => {
            await signOut();
            navigate({ to: "/auth" });
          }}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { loading: authLoading, user } = useAuth();
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/auth" });
    }
  }, [authLoading, user, navigate]);

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-muted-foreground text-sm animate-pulse">Loading admin…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-muted-foreground text-sm">Redirecting…</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="glass-strong rounded-2xl p-8 max-w-md text-center space-y-4">
          <ShieldAlert className="h-10 w-10 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">Not authorized</h1>
          <p className="text-sm text-muted-foreground">
            Your account doesn't have admin access. Ask a contest organizer to grant you the
            <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-xs">admin</code>
            role.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/">Back to voting</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col bg-sidebar border-r border-sidebar-border min-h-screen sticky top-0">
        <SidebarBody />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-sidebar border-r border-sidebar-border shadow-2xl animate-in slide-in-from-left">
            <div className="flex justify-end p-2">
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <SidebarBody onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex flex-col min-w-0">
        <header className="sticky top-0 z-20 backdrop-blur-xl bg-stage/70 border-b border-border">
          <div className="h-14 px-4 sm:px-6 flex items-center gap-3">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-base sm:text-lg font-semibold truncate">{title}</h1>
          </div>
        </header>
        <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-6xl w-full">{children}</div>
      </div>
    </div>
  );
}
