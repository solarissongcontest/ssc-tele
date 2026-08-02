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
          <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Link to="/results">Results</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Link to="/combined">Combined</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Link to="/auth">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto max-w-3xl w-full px-4 py-6 sm:py-10">{children}</main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        #GETTINGHIGH · Solaris Televote Platform
      </footer>
    </div>
  );
}
