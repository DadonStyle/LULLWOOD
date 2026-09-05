import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllPosts, getPost } from "@/lib/devlog";
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
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/devlog/${slug}` },
    openGraph: {
      title: `${post.title} — Lullwood Devlog`,
      description: post.description,
      url: `/devlog/${slug}`,
      type: "article",
      publishedTime: post.date,
    },
    twitter: {
      card: "summary",
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
  const { default: Content } = await import(
    `../../../content/devlog/${slug}`
  );

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    url: `${SITE_URL}/devlog/${slug}`,
    author: { "@type": "Organization", name: "Lullwood" },
    publisher: { "@type": "Organization", name: "Lullwood" },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="devlog-post">
        <nav className="devlog-back">
          <Link href="/devlog">← Devlog</Link>
        </nav>
        <article>
          <header>
            <h1>{post.title}</h1>
            <time dateTime={post.date}>
              {new Date(post.date + "T12:00:00Z").toLocaleDateString(
                "en-US",
                { year: "numeric", month: "long", day: "numeric" }
              )}
            </time>
          </header>
          <div className="devlog-body">
            <Content />
          </div>
        </article>
        <footer className="devlog-footer">
          <Link href="/">Play Lullwood — free in your browser</Link>
        </footer>
      </main>
    </>
  );
}
