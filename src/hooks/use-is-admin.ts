import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (cancel) return;
      setIsAdmin(!error && !!data);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [user, authLoading]);

  return { isAdmin: !!isAdmin, loading: loading || authLoading, user };
}
