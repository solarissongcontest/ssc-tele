import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { AdminPlaceholder } from "@/components/placeholder-page";

export const Route = createFileRoute("/admin/analytics")({
  component: () => (
    <AdminPlaceholder
      title="Analytics"
      description="Voting patterns, bloc behaviour, points distribution and submission timeline."
      icon={BarChart3}
    />
  ),
});
