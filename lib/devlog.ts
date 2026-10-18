// LUL-47: Devlog infrastructure. Posts live in app/devlog/posts/ as .tsx files
// with a default-exported React component; this registry is the metadata.
//
// To add a post: create app/devlog/posts/<slug>.tsx, add its meta here,
// and the sitemap + index + [slug] route update automatically.

export interface PostMeta {
  slug: string;
  title: string;
  date: string; // YYYY-MM-DD
  // YYYY-MM-DD of the last substantive edit. Leave unset for a post that has
  // not changed since it went up -- dateModified then falls back to `date`.
  updated?: string;
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
  {
    slug: 'eleven-agents-one-release-train',
    title: 'Eleven agents, one release train',
    date: '2026-09-19',
    description:
      'The org chart running Lullwood: eleven Claude agents, no human in the daily commit loop, and why code review stopped blocking two-thirds of what ships.',
  },
  {
    slug: 'the-squash-that-broke-the-release-train',
    title: 'The squash that broke the release train',
    date: '2026-09-21',
    description:
      "A squash merge quietly discarded a repair commit's parent, and every release cut after it opened with a conflict. How we found the real cause — twice.",
  },
  {
    slug: 'the-lake-was-never-forest',
    title: 'The lake was never forest',
    date: '2026-09-24',
    description:
      'Why we deleted the lake, the bog, and the mission built on top of the lake — and replaced the mission instead of leaving an empty slot.',
  },
];

export function getAllPosts(): PostMeta[] {
  return [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
}

export function getPost(slug: string): PostMeta | undefined {
  return POSTS.find((p) => p.slug === slug);
}

// The chronological neighbours of a post, for its prev/next links: `older`
// was published just before it, `newer` just after. Either is undefined at
// the ends of the list (or for an unknown slug).
export function getAdjacentPosts(slug: string): { older?: PostMeta; newer?: PostMeta } {
  const posts = getAllPosts(); // newest first
  const i = posts.findIndex((p) => p.slug === slug);
  if (i === -1) return {};
  return { newer: posts[i - 1], older: posts[i + 1] };
}
