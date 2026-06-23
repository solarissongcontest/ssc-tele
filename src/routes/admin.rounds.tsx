import { createFileRoute } from "@tanstack/react-router";
import { PlayCircle } from "lucide-react";
import { AdminPlaceholder } from "@/components/placeholder-page";

export const Route = createFileRoute("/admin/rounds")({
  component: () => (
    <AdminPlaceholder
      title="Rounds"
      description="Configure semi-finals and finals, pick the 26 competing nations and open the round."
      icon={PlayCircle}
    />
  ),
});
