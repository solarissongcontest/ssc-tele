import { Link } from "@tanstack/react-router";
import {
  Menu,
  Shield,
  Trophy,
  Layers3,
  Archive,
  Vote,
  X,
} from "lucide-react";
import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { SolarisLogo } from "./solaris-logo";

const items = [
  {
    to: "/results" as const,
    label: "Results",
    description: "Official televote scoreboard",
    icon: Trophy,
  },
  {
    to: "/combined" as const,
    label: "Combined",
    description: "Combined televote result",
    icon: Layers3,
  },
  {
    to: "/editions" as const,
    label: "Archive",
    description: "Previous editions and results",
    icon: Archive,
  },
  {
    to: "/how-to-vote" as const,
    label: "How to vote",
    description: "Voting rules and instructions",
    icon: Vote,
  },
  {
    to: "/auth" as const,
    label: "Admin",
    description: "Administration and integrity tools",
    icon: Shield,
  },
];

export function PublicShell({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";

    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", close);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-stage/55 backdrop-blur-2xl">
        <div className="mx-auto flex h-[72px] w-full max-w-4xl items-center justify-between px-4">
          <Link
            to="/"
            className="transition hover:opacity-85"
            onClick={() => setOpen(false)}
          >
            <SolarisLogo />
          </Link>

          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-foreground shadow-sm backdrop-blur-xl transition hover:bg-white/[0.1]"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-[100]">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          <aside className="glass-strong absolute right-3 top-3 w-[min(92vw,390px)] overflow-hidden rounded-[30px] border border-white/15 p-3 shadow-2xl">
            <div className="flex items-center justify-between px-2 py-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-primary">
                  Solaris
                </p>

                <p className="mt-0.5 font-semibold">
                  Navigation
                </p>
              </div>

              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav
              className="mt-2 space-y-1"
              aria-label="Main navigation"
            >
              {items.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className="group flex min-h-[66px] items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 transition hover:border-white/10 hover:bg-white/[0.06]"
                    activeProps={{
                      className:
                        "border-primary/25 bg-primary/[0.08]",
                    }}
                  >
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-primary">
                      <Icon className="h-4.5 w-4.5" />
                    </span>

                    <span className="min-w-0">
                      <span className="block font-medium">
                        {item.label}
                      </span>

                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-4xl flex-1 px-3 py-6 sm:px-4 sm:py-10">
        {children}
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        #GETTINGHIGH · Solaris Televote Platform
      </footer>
    </div>
  );
}
