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
      // post.updated, when set, is the last substantive edit (LUL-6091) --
      // falling back to post.date silently dropped it here before, so a
      // post's own lastmod could contradict its JSON-LD dateModified.
      lastModified: new Date(post.updated ?? post.date),
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
      lastModified: new Date("2026-10-27T00:00:00.000Z"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      // Authoring date (2026-10-26), not the Wed 2026-10-28 publish date in
      // the brief -- see SEO-GEO.md item 5 on why the sitemap field must not
      // carry a date that hasn't happened yet.
      url: `${SITE_URL}/guides`,
      lastModified: new Date("2026-10-26T00:00:00.000Z"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/guides/wolves`,
      lastModified: new Date("2026-10-22T00:00:00.000Z"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/guides/how-to-win`,
      lastModified: new Date("2026-10-27T00:00:00.000Z"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/faq`,
      lastModified: new Date("2026-10-27T00:00:00.000Z"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/games-like-slender`,
      lastModified: new Date("2026-10-18T00:00:00.000Z"),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/press`,
      lastModified: new Date("2026-10-22T00:00:00.000Z"),
      changeFrequency: "monthly",
      priority: 0.4,
      images: [
        `${SITE_URL}/screenshots/lullwood-night-forest-pine-trees.png`,
        `${SITE_URL}/screenshots/lullwood-dense-pine-forest-snow.png`,
        `${SITE_URL}/screenshots/lullwood-forest-rock-outcrop-night.png`,
        `${SITE_URL}/press/lullwood-04-distant-glow.png`,
        `${SITE_URL}/press/lullwood-05-under-canopy.png`,
        `${SITE_URL}/press/lullwood-06-night-clearing.png`,
        `${SITE_URL}/press/lullwood-cover-a.png`,
        `${SITE_URL}/press/lullwood-cover-b.png`,
      ],
    },
    ...devlogEntries,
  ];
}
