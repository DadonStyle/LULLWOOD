import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/devlog";

// Without this file a mistyped or stale link got Next's bare default 404 -- a
// dead end with no route back to the game. This one renders inside the root
// layout and links to everything a visitor is likely to have been looking for.
export const metadata: Metadata = {
  title: "Page not found",
  // Next injects `<meta name="robots" content="noindex">` on every 404
  // response. `null` drops the layout's `index, follow` (and its googlebot
  // twin) so that injected tag is the only robots signal. Setting
  // `{ index: false }` here instead emits a second, duplicate robots meta.
  robots: null,
};

export default function NotFound() {
  const latest = getAllPosts().slice(0, 3);

  return (
    <main className="devlog-index not-found-page">
      <h1>Page not found</h1>
      <p className="devlog-tagline">
        Nothing lives at this address. The forest is still there, though.
      </p>
      <p className="not-found-page__play">
        <Link href="/">Play Lullwood free in your browser</Link>
      </p>
      <h2 className="not-found-page__heading">
        Latest from the <Link href="/devlog">devlog</Link>
      </h2>
      <ul className="devlog-list">
        {latest.map((post) => (
          <li key={post.slug} className="devlog-item">
            <Link href={`/devlog/${post.slug}`}>
              <article>
                <h2>{post.title}</h2>
                <p>{post.description}</p>
              </article>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
