import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentAdmin } from "@/lib/admin-auth.functions";

export type CurrentAdmin = {
  id: string;
  username: string;
  is_super_admin: boolean;
  last_login_at: string | null;
} | null;

export function useAdminSession() {
  const fetchMe = useServerFn(getCurrentAdmin);
  const q = useQuery({
    queryKey: ["admin-session"],
    queryFn: () => fetchMe() as Promise<CurrentAdmin>,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return {
    admin: (q.data ?? null) as CurrentAdmin,
    isLoading: q.isLoading,
    isSuperAdmin: !!q.data?.is_super_admin,
    refetch: q.refetch,
  };
}
