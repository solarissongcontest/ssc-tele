import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SolarisLogo } from "@/components/solaris-logo";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { adminLogin } from "@/lib/admin-auth.functions";
import { useAdminSession } from "@/hooks/use-admin-session";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Administrator Log In — Solaris" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const login = useServerFn(adminLogin);
  const { admin, isLoading } = useAdminSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoading && admin) navigate({ to: "/admin" });
  }, [isLoading, admin, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login({ data: { username, password } });
      await qc.invalidateQueries({ queryKey: ["admin-session"] });
      toast.success("Signed in");
      navigate({ to: "/admin" });
    } catch (err: any) {
      toast.error(err?.message?.replace(/^Error:\s*/, "") ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Link to="/"><SolarisLogo /></Link>
        </div>
        <div className="glass-strong rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-hero grid place-items-center shadow-glow">
              <ShieldCheck className="h-6 w-6 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold">Administrator Log In</h1>
            <p className="text-sm text-muted-foreground">
              Only accounts created by the Super Admin can sign in.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-hero text-primary-foreground shadow-glow"
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Log In
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground">← Back to voting</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
