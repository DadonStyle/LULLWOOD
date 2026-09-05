import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";
import { getAllPosts } from "../lib/devlog";

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
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    ...devlogEntries,
  ];
}
