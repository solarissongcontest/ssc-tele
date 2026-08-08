import {
  Link,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  BarChart3,
  Calculator,
  CalendarDays,
  FileText,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  PlayCircle,
  Radar,
  ShieldAlert,
  Trophy,
  Users,
  X,
} from "lucide-react";
import {
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { SolarisLogo } from "@/components/solaris-logo";
import { Button } from "@/components/ui/button";
import { useAdminSession } from "@/hooks/use-admin-session";
import { adminLogout } from "@/lib/admin-auth.functions";
import { getModerationAlertsCount } from "@/lib/moderation.functions";
import { cn } from "@/lib/utils";

const BASE_NAV = [
  {
    to: "/admin",
    label: "Overview",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    to: "/admin/editions",
    label: "Editions",
    icon: CalendarDays,
  },
  {
    to: "/admin/rounds",
    label: "Rounds",
    icon: PlayCircle,
  },
  {
    to: "/admin/results",
    label: "Results",
    icon: Trophy,
  },
  {
    to: "/admin/televote",
    label: "Televote Conversion",
    icon: Calculator,
  },
  {
    to: "/admin/combined",
    label: "Combined Televote",
    icon: Layers,
  },
  {
    to: "/admin/analytics",
    label: "Analytics",
    icon: BarChart3,
  },
  {
    to: "/admin/anti-abuse",
    label: "Anti-Abuse",
    icon: ShieldAlert,
    badgeKey: "moderation",
  },
  {
    to: "/admin/detection",
    label: "Detection",
    icon: Radar,
  },
  {
    to: "/admin/friend-voting",
    label: "Friend-Voting",
    icon: Radar,
  },
  {
    to: "/admin/theme",
    label: "Theme",
    icon: Palette,
  },
] as const;

function SidebarBody({
  onNavigate,
  isSuperAdmin,
  username,
}: {
  onNavigate?: () => void;
  isSuperAdmin: boolean;
  username: string | undefined;
}) {
  const pathname = useRouterState({
    select: (state) =>
      state.location.pathname,
  });

  const navigate = useNavigate();
  const qc = useQueryClient();
  const logoutFn =
    useServerFn(adminLogout);
  const alertsFn =
    useServerFn(
      getModerationAlertsCount,
    );

  const alerts = useQuery({
    queryKey: [
      "moderation-alerts",
    ],

    queryFn: () =>
      alertsFn() as Promise<number>,

    refetchInterval:
      30_000,
  });

  const nav = isSuperAdmin
    ? ([
        ...BASE_NAV,
        {
          to: "/admin/accounts",
          label:
            "Admin Accounts",
          icon: Users,
        },
        {
          to: "/admin/audit-log",
          label:
            "Audit Log",
          icon: FileText,
        },
      ] as const)
    : BASE_NAV;

  const isActive = (
    to: string,
    exact?: boolean,
  ) =>
    exact
      ? pathname === to
      : pathname === to ||
        pathname.startsWith(
          `${to}/`,
        );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-sidebar-border px-5 py-5">
        <SolarisLogo />

        {username ? (
          <p className="mt-2 truncate text-[11px] text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">
              {username}
            </span>

            {isSuperAdmin
              ? " · Super Admin"
              : ""}
          </p>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-4">
        {nav.map((item) => {
          const Icon =
            item.icon;

          const active =
            isActive(
              item.to,
              (item as any)
                .exact,
            );

          const showBadge =
            (item as any)
              .badgeKey ===
              "moderation" &&
            (alerts.data ??
              0) > 0;

          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={
                onNavigate
              }
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-primary/30"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />

              <span className="min-w-0 flex-1 truncate">
                {item.label}
              </span>

              {showBadge ? (
                <span className="ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                  {alerts.data! >
                  99
                    ? "99+"
                    : alerts.data}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 space-y-2 border-t border-sidebar-border p-3">
        <Button
          asChild
          variant="outline"
          className="w-full justify-start"
        >
          <Link
            to="/"
            onClick={
              onNavigate
            }
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Voting
          </Link>
        </Button>

        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-destructive"
          onClick={
            async () => {
              await logoutFn(
                {},
              );

              await qc.invalidateQueries(
                {
                  queryKey: [
                    "admin-session",
                  ],
                },
              );

              navigate({
                to: "/auth",
              });
            }
          }
        >
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </div>
  );
}

export function AdminShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [
    open,
    setOpen,
  ] = useState(false);

  const {
    admin,
    isLoading,
    isSuperAdmin,
  } = useAdminSession();

  const navigate =
    useNavigate();

  useEffect(() => {
    if (
      !isLoading &&
      !admin
    ) {
      navigate({
        to: "/auth",
      });
    }
  }, [
    isLoading,
    admin,
    navigate,
  ]);

  useEffect(() => {
    if (!open) return;

    const previous =
      document.body.style
        .overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        previous;
    };
  }, [open]);

  useEffect(() => {
    const onKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key ===
          "Escape" &&
        open
      ) {
        setOpen(false);
      }
    };

    window.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        onKeyDown,
      );
    };
  }, [open]);

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center overflow-x-hidden">
        <div className="animate-pulse text-sm text-muted-foreground">
          Loading admin…
        </div>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="grid min-h-screen place-items-center overflow-x-hidden">
        <div className="text-sm text-muted-foreground">
          Redirecting…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden md:grid md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen min-h-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <SidebarBody
          isSuperAdmin={
            isSuperAdmin
          }
          username={
            admin.username
          }
        />
      </aside>

      {open ? (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Admin navigation"
        >
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 h-full w-full bg-black/65 backdrop-blur-sm"
            onClick={() =>
              setOpen(false)
            }
          />

          <aside
            className={cn(
              "absolute inset-y-0 left-0 flex w-[min(88vw,320px)] flex-col",
              "border-r border-sidebar-border bg-sidebar shadow-2xl",
              "animate-in slide-in-from-left duration-200",
            )}
          >
            <div className="flex h-14 shrink-0 items-center justify-end border-b border-sidebar-border px-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                onClick={() =>
                  setOpen(
                    false,
                  )
                }
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="min-h-0 flex-1">
              <SidebarBody
                onNavigate={() =>
                  setOpen(
                    false,
                  )
                }
                isSuperAdmin={
                  isSuperAdmin
                }
                username={
                  admin.username
                }
              />
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-screen min-w-0 max-w-full flex-col overflow-x-hidden">
        <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-stage/85 backdrop-blur-xl">
          <div className="flex min-h-14 items-center gap-3 px-3 sm:px-5 lg:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open admin navigation"
              onClick={() =>
                setOpen(true)
              }
            >
              <Menu className="h-5 w-5" />
            </Button>

            <h1 className="min-w-0 flex-1 truncate text-base font-semibold sm:text-lg">
              {title}
            </h1>
          </div>
        </header>

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden">
          <div
            className={cn(
              "mx-auto w-full min-w-0 max-w-7xl px-3 py-4 sm:px-5 sm:py-6 lg:px-6 lg:py-8",
              /*
               * Dense admin tables must scroll inside their own containers,
               * never make the whole page wider than the viewport.
               */
              "[&_.overflow-x-auto]:max-w-full [&_.overflow-x-auto]:overscroll-x-contain",
              /*
               * Form rows generated by older pages often use fixed widths.
               * These rules keep controls inside the mobile viewport.
               */
              "[&_input]:max-w-full [&_textarea]:max-w-full",
              "[&_[role=combobox]]:max-w-full",
              /*
               * Chart-like blocks stay clipped to their panel rather than
               * producing page-level horizontal scroll.
               */
              "[&_svg]:max-w-full",
            )}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
