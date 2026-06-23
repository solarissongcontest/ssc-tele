import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { AdminPlaceholder } from "@/components/placeholder-page";

export const Route = createFileRoute("/admin/editions")({
  component: () => (
    <AdminPlaceholder
      title="Editions"
      description="Create and manage contest editions like Solaris Song Contest 21."
      icon={CalendarDays}
    />
  ),
});
