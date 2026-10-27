import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { getAllPosts } from "@/lib/devlog";
import { DEVLOG_FEED_TYPES, SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER, breadcrumbJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Devlog",
  description:
    "Development notes from the Lullwood team — design decisions, mechanics, and what we learned building a browser horror game.",
  alternates: { canonical: "/devlog", types: DEVLOG_FEED_TYPES },
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: "Devlog — Lullwood",
    description:
      "Development notes from the Lullwood team — design decisions, mechanics, and what we learned building a browser horror game.",
    url: "/devlog",
    type: "website",
  },
  twitter: {
    ...SOCIAL_TWITTER,
    title: "Devlog — Lullwood",
    description:
      "Development notes from the Lullwood team — design decisions, mechanics, and what we learned building a browser horror game.",
  },
};

export default function DevlogIndex() {
  const posts = getAllPosts();

  return (
    <main className="devlog-index">
      <JsonLd data={breadcrumbJsonLd([{ name: "Devlog", path: "/devlog" }])} />
      <h1>Devlog</h1>
      <p className="devlog-tagline">
        Notes on building Lullwood — design decisions, mechanics, and what
        we learned along the way.
      </p>
      <ul className="devlog-list">
        {posts.map((post) => (
          <li key={post.slug} className="devlog-item">
            <Link href={`/devlog/${post.slug}`}>
              <article>
                <h2>{post.title}</h2>
                <time dateTime={post.date}>
                  {new Date(post.date + "T12:00:00Z").toLocaleDateString(
                    "en-US",
                    { year: "numeric", month: "long", day: "numeric" }
                  )}
                </time>
                <p>{post.description}</p>
              </article>
            </Link>
          </li>
        ))}
      </ul>
      <p className="devlog-back">
        <Link href="/">← Back to the game</Link>
      </p>
    </main>
  );
}
