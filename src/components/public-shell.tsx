import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SolarisLogo } from "./solaris-logo";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-stage/60 border-b border-border">
        <div className="mx-auto max-w-3xl px-4 h-14 flex items-center justify-between">
          <Link to="/" className="hover:opacity-80 transition">
            <SolarisLogo />
          </Link>
          <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Main">
          <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3 text-muted-foreground hover:text-foreground">
            <Link to="/results">Results</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3 text-muted-foreground hover:text-foreground">
            <Link to="/combined">Combined</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3 text-muted-foreground hover:text-foreground">
            <Link to="/editions">Archive</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex px-3 text-muted-foreground hover:text-foreground">
            <Link to="/how-to-vote">How to vote</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3 text-muted-foreground hover:text-foreground">
            <Link to="/auth">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          </Button>
          </nav>

        </div>
      </header>
      <main className="flex-1 mx-auto max-w-3xl w-full px-4 py-6 sm:py-10">{children}</main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        #GETTINGHIGH · Solaris Televote Platform
      </footer>
    </div>
  );
}
