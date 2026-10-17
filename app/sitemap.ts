import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";
import { getAllPosts } from "../lib/devlog";

// The last real homepage content change (gameplay screenshots, 2026-10-02);
// bump it by hand when the copy or media change again. It used to be
// `new Date()`, which stamped a fresh lastmod on every build -- Google learns
// that a lastmod which always moves carries no signal and stops trusting it,
// for this URL and the rest of the sitemap.
const HOME_LAST_MODIFIED = new Date("2026-10-02T00:00:00.000Z");

// The homepage's gameplay screenshots (public/screenshots), listed so Google
// Images can attribute them to the page they appear on.
const HOME_SCREENSHOTS = [
  "lullwood-night-forest-pine-trees.png",
  "lullwood-dense-pine-forest-snow.png",
  "lullwood-forest-rock-outcrop-night.png",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();

  const devlogEntries: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/devlog`,
      lastModified: posts[0] ? new Date(posts[0].date) : new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...posts.map((post) => ({
      url: `${SITE_URL}/devlog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: "yearly" as const,
      priority: 0.6,
    })),
  ];

  return [
    {
      url: SITE_URL,
      lastModified: HOME_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 1,
      images: HOME_SCREENSHOTS.map((file) => `${SITE_URL}/screenshots/${file}`),
    },
    // LUL-2375: indexable, linked from the homepage, was missing here.
    {
      url: `${SITE_URL}/suggest`,
      lastModified: new Date("2026-09-09T00:00:00.000Z"),
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/credits`,
      lastModified: new Date("2026-10-13T00:00:00.000Z"),
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/how-to-survive`,
      lastModified: new Date("2026-10-18T00:00:00.000Z"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...devlogEntries,
  ];
}
