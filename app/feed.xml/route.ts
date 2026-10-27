import { buildDevlogFeed } from "@/lib/devlog-feed";

// The registry is static, so the feed is rendered once at build time.
export const dynamic = "force-static";

export function GET() {
  return new Response(buildDevlogFeed(), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
