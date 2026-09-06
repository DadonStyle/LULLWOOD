// LUL-47: Devlog infrastructure. Posts live in content/devlog/ as .tsx files
// that export a `meta` object and a default React component.
//
// To add a post: create content/devlog/<slug>.tsx, add its meta to POSTS,
// and the sitemap + index + [slug] route update automatically.

export interface PostMeta {
  slug: string;
  title: string;
  date: string; // YYYY-MM-DD
  description: string;
}

// Registry — single source of truth for all devlog posts.
// Add an entry here when you add a post file.
const POSTS: PostMeta[] = [
  {
    slug: 'the-return-trip',
    title: 'The return trip',
    date: '2026-09-05',
    description:
      'How the win condition changed from "reach the child" to "carry them home" — and why the predators can still take you on the way back.',
  },
];

export function getAllPosts(): PostMeta[] {
  return [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
}

export function getPost(slug: string): PostMeta | undefined {
  return POSTS.find((p) => p.slug === slug);
}
