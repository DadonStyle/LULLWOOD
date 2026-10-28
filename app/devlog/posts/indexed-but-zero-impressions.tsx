import Link from "next/link";
import JsonLd from "@/components/JsonLd";

// Visible answers and FAQPage JSON-LD both render from this one list, so the
// markup cannot drift from the text.
const QA: { question: string; answer: string }[] = [
  {
    question: "Can a site be indexed but get zero impressions?",
    answer:
      "Yes. Indexed means Google has stored the page. An impression needs the page to be shown for a query, and a page with almost no links from other sites rarely wins one. Lullwood had 10 of 11 sitemap URLs indexed and Search Console reported no impressions for any query containing its name.",
  },
  {
    question: "Does a good sitemap, fast server and valid schema fix zero impressions?",
    answer:
      "Not on their own. Lullwood had a submitted sitemap, automatic IndexNow pings, a 0.121 second time to first byte, valid JSON-LD and 200 responses for nine search and AI crawlers. Over the 28 days to 2026-10-26 that produced 1 click and 14 impressions. Those checks make a page crawlable. They do not make other sites link to it.",
  },
  {
    question: "Are links from GitHub and dev.to followed by search engines?",
    answer:
      "Not equally. We fetched both on 2026-10-28. The website link on the Lullwood GitHub repository page carries rel=\"nofollow\". Links in the body of a dev.to article carried rel=\"noopener noreferrer\" with no nofollow. A nofollow link tells search engines not to pass ranking credit through it.",
  },
  {
    question: "Does Search Console hide queries with few impressions?",
    answer:
      "Yes. Search Console leaves out queries too rare to report without identifying searchers. For Lullwood the Search Analytics API returned no query rows at all in the 28 days to 2026-10-26, so the accurate statement is that no reported impression was attributed to a query containing the word Lullwood, not that nobody was ever shown the site.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: QA.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
};

export default function IndexedButZeroImpressions() {
  return (
    <>
      <JsonLd data={faqJsonLd} />
      <p>
        Lullwood, a free browser horror game, had ten pages indexed by Google
        and no Search Console impressions for any query containing its name.
        Crawling, speed and schema were all fine. Google&rsquo;s URL
        Inspection tool lists exactly one outside page linking to us, a post
        we published ourselves.
      </p>
      <p>
        That is the whole diagnosis. If your own pages are indexed but get
        zero impressions, the first thing to count is who links to you, not
        how well Google can read you. The rest of this post is the evidence,
        the command or API behind each number, and what we do not know.
        Lullwood is the <Link href="/">free browser horror game</Link> this
        site exists for; this is the builder side of it, the same side as our
        other <Link href="/devlog">Lullwood devlog</Link> posts.
      </p>

      <h2>What did the SEO checklist cover?</h2>
      <p>
        We did the things a search checklist tells you to do, and measured
        each one on 2026-10-28:
      </p>
      <ul>
        <li>
          A sitemap submitted to Search Console. It went from 11 URLs to 18
          in a single release, and the live <code>sitemap.xml</code> lists 18.
        </li>
        <li>
          IndexNow pings that run on their own after a deploy that changes a
          page, and returned HTTP 200 for all 18 URLs on the run after that release.
        </li>
        <li>
          Valid <code>WebSite</code>, <code>Organization</code>,{" "}
          <code>VideoGame</code> and <code>FAQPage</code> JSON-LD on the home
          page. All four blocks parse.
        </li>
        <li>
          A 0.121 second time to first byte on the home page.
        </li>
        <li>
          HTTP 200 for nine search and AI crawlers (GPTBot, OAI-SearchBot,
          ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot,
          Googlebot, Bingbot, Applebot) on <code>/</code>,{" "}
          <code>/robots.txt</code>, <code>/llms.txt</code> and{" "}
          <code>/sitemap.xml</code>.
        </li>
        <li>One H1 per page and self-referential absolute canonicals.</li>
      </ul>

      <h2>What did that buy us in Search Console?</h2>
      <p>
        In the 28 days from 2026-09-28 to 2026-10-26, the Search Console
        API reported 1 click, 14 impressions and an average position of 2.7.
        By page, the home page had 13 of those impressions and 1 click, and{" "}
        <code>/devlog</code> had the other impression.
      </p>
      <p>
        Do not read 2.7 as page one. It is an average over 14 impressions,
        on queries Google will not name. The same API returned no query rows
        at all, so there is nothing to filter for the word Lullwood, and
        nothing to confirm that those 14 were for our name.
      </p>
      <p>
        The URL Inspection API says 10 of the 11 sitemap URLs at that time
        were &ldquo;Submitted and indexed&rdquo;, last crawled between
        2026-10-21 and 2026-10-25. The exception was{" "}
        <code>/suggest</code>, a form page that was not yet indexed. After
        the release that took the sitemap to 18, the seven new URLs were
        hours old and unindexed when we inspected them, which is expected
        and not a finding.
      </p>

      <h2>Why does an indexed site still get zero impressions?</h2>
      <p>
        Indexed but zero impressions is what you get when the search engine
        has read you and has no reason to rank you. Across all of the pages
        we inspected, URL Inspection&rsquo;s <code>referringUrls</code> field
        listed four distinct pages that link to ours:
      </p>
      <ul>
        <li>
          <code>www.lullwoodgame.com/</code>, our home page
        </li>
        <li>
          <code>www.lullwoodgame.com/credits</code>, our credits page
        </li>
        <li>
          <code>www.lullwoodgame.com/devlog</code>, our devlog index
        </li>
        <li>
          <a href="https://dev.to/lullwoodgamer/how-scent-and-wind-work-in-our-threejs-horror-game-1a6n">
            a dev.to cross-post
          </a>{" "}
          of our scent and wind devlog post, published 2026-10-27 by the
          Lullwood account on dev.to
        </li>
      </ul>
      <p>
        Three of four are our own pages, which tells Google how our site is
        organised and nothing about whether anyone else cares. The external
        set is one URL, and it is a link we made. This list is what Google
        reports for the pages we inspected, not a complete backlink audit.
      </p>
      <p>
        The result that outranks us on the name makes it worse. When we
        searched for Lullwood on 2026-10-22 and again on 2026-10-26, with a
        web-search tool and not a logged-in Google results page, the result
        that ranked for our name was our own{" "}
        <a href="https://github.com/DadonStyle/LULLWOOD">GitHub repository</a>
        , first on 2026-10-26. On 2026-10-28 we fetched that repository page and its website link
        to <code>www.lullwoodgame.com</code> carries{" "}
        <code>rel=&quot;nofollow&quot;</code>. The repository does not appear
        in the referring URLs at all. The page ranking for our name passes
        us no credit.
      </p>
      <p>
        The one place we could make a followed link ourselves was the body of
        a dev.to article. Fetching our published one, its links to{" "}
        <code>www.lullwoodgame.com</code> had no <code>nofollow</code>.
        Every other venue we measured (a GitHub README, an itch.io game page,
        the Three.js Discourse) marks outbound links <code>nofollow</code>.
      </p>

      <h2>What is the difference between crawlability and authority?</h2>
      <p>
        Crawlability is whether a search engine can fetch and understand a
        page. Authority is whether anyone else vouches for it. A checklist
        fixes the first, because every item on it is something you control
        from your own repository. The second needs people you do not control
        to link to you, so it does not appear on a checklist and cannot be
        shipped in a release.
      </p>
      <p>
        The practical rule we took from our own numbers: when Search Console
        says indexed and the impressions say zero, stop editing the site and
        start counting referring URLs.
      </p>

      <h2>What we are doing next, and what we do not know</h2>
      <p>
        As of 2026-10-28 the number of distinct external pages linking to
        Lullwood is still one. We have not solved this, and this post is not
        a result.
      </p>
      <p>
        More dev.to cross-posts of these devlog pages are scheduled, with the
        canonical set to the page on this site, and each links back to{" "}
        <Link href="/">the Lullwood game</Link>. We also plan to ask curated
        lists of browser and AI-made games to include Lullwood. Those lists
        mark links <code>nofollow</code> too, so we expect them to help
        readers and answer engines more than rankings.
      </p>
      <p>
        We will report the referring-URL count again, whatever it is. If it
        rises and impressions for our name stay at zero, authority is
        lagging and we keep going. If it does not rise, the one link we have
        was luck and this diagnosis needs revising.
      </p>

      <h2>Where these numbers come from</h2>
      <ul>
        <li>
          Clicks, impressions, position and per-page figures: Search Console
          Search Analytics API, 28 days from 2026-09-28 to 2026-10-26.
        </li>
        <li>
          Indexed state, last crawl and referring URLs: Search Console URL
          Inspection API, run on every URL in the sitemap on 2026-10-28.
        </li>
        <li>
          Sitemap size: <code>curl</code> of the live{" "}
          <code>sitemap.xml</code>, counting <code>&lt;loc&gt;</code>{" "}
          entries, 2026-10-28.
        </li>
        <li>
          TTFB, JSON-LD, canonicals and crawler responses: requests to the
          live home page and four paths, 2026-10-28.
        </li>
        <li>
          Link attributes: <code>curl</code> of the GitHub repository page
          and the dev.to article, 2026-10-28.
        </li>
        <li>
          Which page ranks first for our name: a web-search tool on
          2026-10-22 and 2026-10-26. Directional, not a logged-in Google
          results page.
        </li>
      </ul>

      <h2>Questions about indexed pages with zero impressions</h2>
      {QA.map(({ question, answer }) => (
        <div key={question}>
          <h3>{question}</h3>
          <p>{answer}</p>
        </div>
      ))}
      <p>
        For the game itself, play Lullwood free in your browser at{" "}
        <Link href="/">www.lullwoodgame.com</Link>, read{" "}
        <Link href="/how-to-survive">how to survive Lullwood</Link>, or see
        who builds it in the{" "}
        <Link href="/devlog/who-makes-lullwood">Lullwood studio devlog</Link>
        . Common questions are in the <Link href="/faq">Lullwood FAQ</Link>.
      </p>
    </>
  );
}
