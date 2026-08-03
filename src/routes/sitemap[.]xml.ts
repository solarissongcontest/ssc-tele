import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://ssc-tele.lovable.app";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "hourly", priority: "1.0" },
          { path: "/how-to-vote", changefreq: "monthly", priority: "0.7" },
          { path: "/results", changefreq: "hourly", priority: "0.9" },
          { path: "/combined", changefreq: "hourly", priority: "0.8" },
          { path: "/editions", changefreq: "weekly", priority: "0.8" },
        ];

        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { data: rounds } = await supabaseAdmin
            .from("rounds")
            .select("edition_id")
            .eq("results_status", "published");
          const ids = [...new Set((rounds ?? []).map((r: any) => r.edition_id))];
          ids.forEach((id) =>
            entries.push({
              path: `/editions/${id}`,
              changefreq: "weekly",
              priority: "0.6",
            }),
          );
        } catch {
          // Sitemap stays valid with the static routes if the lookup fails.
        }

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
