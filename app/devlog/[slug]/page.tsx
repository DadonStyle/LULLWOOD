import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { getAdjacentPosts, getAllPosts, getPost } from "@/lib/devlog";
import {
  ORG_REF,
  SOCIAL_IMAGE,
  SOCIAL_OPEN_GRAPH,
  SOCIAL_TWITTER,
  breadcrumbJsonLd,
} from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  // Throwing here, not just in the page, is what makes an unknown slug take
  // app/not-found.tsx's title and robots -- returning {} left it with the
  // layout's homepage title and `index, follow` on a 404.
  if (!post) notFound();

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/devlog/${slug}` },
    openGraph: {
      ...SOCIAL_OPEN_GRAPH,
      title: `${post.title} — Lullwood Devlog`,
      description: post.description,
      url: `/devlog/${slug}`,
      type: "article",
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
    },
    twitter: {
      ...SOCIAL_TWITTER,
      title: `${post.title} — Lullwood Devlog`,
      description: post.description,
    },
  };
}

export default async function DevlogPost({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  // Dynamic import so tree-shaking drops unreferenced posts at build time.
  const { default: Content } = await import(`../posts/${slug}`);

  const { older, newer } = getAdjacentPosts(slug);
  const url = `${SITE_URL}/devlog/${slug}`;

  // Google's Article rich result wants image + dateModified; without them
  // the post is eligible only for a plain blue link. author/publisher point
  // at the layout's Organization node rather than restating it.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    image: `${SITE_URL}${SOCIAL_IMAGE.url}`,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: ORG_REF,
    publisher: ORG_REF,
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Devlog", path: "/devlog" },
          { name: post.title, path: `/devlog/${slug}` },
        ])}
      />
      <main className="devlog-post">
        <nav className="devlog-back">
          <Link href="/devlog">← Devlog</Link>
        </nav>
        <article>
          <header>
            <h1>{post.title}</h1>
            <time
              dateTime={post.date}
              style={
                post.updated && post.updated !== post.date
                  ? { marginBottom: 0 }
                  : undefined
              }
            >
              {new Date(post.date + "T12:00:00Z").toLocaleDateString(
                "en-US",
                { year: "numeric", month: "long", day: "numeric" }
              )}
            </time>
            {post.updated && post.updated !== post.date && (
              <time dateTime={post.updated} style={{ color: "#4a5f82" }}>
                Updated{" "}
                {new Date(post.updated + "T12:00:00Z").toLocaleDateString(
                  "en-US",
                  { year: "numeric", month: "long", day: "numeric" }
                )}
              </time>
            )}
          </header>
          <div className="devlog-body">
            <Content />
          </div>
        </article>
        <footer className="devlog-footer">
          <p className="devlog-play">
            <Link href="/">Play Lullwood free in your browser</Link>
          </p>
          {(older || newer) && (
            <nav className="devlog-pager" aria-label="More devlog posts">
              {older && (
                <Link href={`/devlog/${older.slug}`} rel="prev">
                  ← {older.title}
                </Link>
              )}
              {newer && (
                <Link
                  href={`/devlog/${newer.slug}`}
                  rel="next"
                  className="devlog-pager__next"
                >
                  {newer.title} →
                </Link>
              )}
            </nav>
          )}
        </footer>
      </main>
    </>
  );
}
