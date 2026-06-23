import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { AdminPlaceholder } from "@/components/placeholder-page";

export const Route = createFileRoute("/admin/anti-abuse")({
  component: () => (
    <AdminPlaceholder
      title="Anti-Abuse"
      description="Review blocked or suspicious vote attempts. Whitelist or unblock as needed."
      icon={ShieldAlert}
    />
  ),
});
