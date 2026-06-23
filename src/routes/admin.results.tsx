import { createFileRoute } from "@tanstack/react-router";
import { Trophy } from "lucide-react";
import { AdminPlaceholder } from "@/components/placeholder-page";

export const Route = createFileRoute("/admin/results")({
  component: () => (
    <AdminPlaceholder
      title="Results"
      description="Live scoreboard and per-voter breakdown for the selected round."
      icon={Trophy}
    />
  ),
});
