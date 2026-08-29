import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // LUL-155: internal analytics dashboard -- already gated by a
      // shared-secret middleware check and absent from sitemap.ts, this is
      // belt-and-suspenders so it's not even offered to crawlers.
      disallow: "/internal",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
