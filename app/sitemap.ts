import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

// Extend this array as new routes land -- e.g. LUL-47's devlog.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
