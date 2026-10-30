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
    slug: 'ai-disclosure-game',
    title: 'What AI disclosure actually asks',
    date: '2026-10-30',
    description:
      "Spooky Jam 2026, Steam, and itch.io each ask for different things. Here's what we read.",
  },
  {
    slug: 'the-fog-is-the-wolfs-eyesight',
    title: "The fog is the wolf's eyesight: Lullwood's fog tide",
    date: '2026-10-28',
    description:
      'Every 90 seconds a fog tide in Lullwood cuts predator sight by up to 35% inside three fixed patches. The clock, the telegraph and the cost, from the source.',
  },
  {
    slug: 'indexed-but-zero-impressions',
    title: 'Indexed but zero impressions: ten Lullwood pages, one backlink',
    date: '2026-10-28',
    description:
      'Lullwood had 10 pages indexed and no query data in Search Console. The cause was one external backlink, not crawling, speed or schema.',
  },
  {
    slug: 'who-makes-lullwood',
    title: 'Who makes Lullwood? A founder and Claude agents',
    date: '2026-10-27',
    description:
      'Lullwood is made by Independence AI Studio: one human founder and a team of Claude agents. Who does what, the real merge counts, and what broke.',
  },
  {
    slug: 'we-filmed-the-qa-harness-not-the-game',
    title: 'We filmed the QA harness, not the game',
    date: '2026-10-26',
    description:
      'One 9-second clip cost six heartbeats and two Reviewer FAILs. The capture script was staging a synthetic QA scene, not recording the game.',
  },
  {
    slug: 'how-scent-and-wind-work',
    title: 'How scent and wind work',
    date: '2026-10-22',
    description:
      'One wind vector, rolled once per map, rewrites scent radius, scent lifetime, footstep noise, sprint speed and predator behaviour. Read from the source.',
  },
  {
    slug: 'the-return-trip',
    title: 'The return trip',
    date: '2026-09-05',
    // LUL-6091: the carry-home mechanic this post announced is gone
    // (LUL-2281) -- the excerpt has to read as history, not a current rule.
    updated: '2026-10-29',
    description:
      'The "carry them home" win condition merged on August 15, 2026 and cut on September 9, 2026. Lifting the child is the win now; there is no trip home.',
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
