# SEO and GEO checklist

Goals:
- Rank on page 1 of Google for **"lullwood"**.
- Get found for **"horror game"**, **"browser game"** and **"horror browser game"**.
- Have **Gemini** and other AI assistants recommend Lullwood.

Last reviewed 2026-10-18.

Google's position is that AI Overviews and AI Mode need no special markup: ordinary SEO is the GEO strategy ([Google: AI features](https://developers.google.com/search/docs/appearance/ai-features)). Measured studies show that what moves AI recommendations most is being **mentioned on other sites** (Reddit, YouTube, listicles, portals), well ahead of anything on our own site ([Ahrefs, 75K brands](https://ahrefs.com/blog/ai-overview-brand-correlation/)). The on-site work below makes Lullwood easy to identify and easy to quote. The off-site list is what actually gets it recommended.

## On-site: done or in review

| Item | Where |
|---|---|
| Title, description, canonical, OG/Twitter, `max-image-preview: large` | `app/layout.tsx`, already live |
| `VideoGame` + `WebSite` + `Organization` JSON-LD | `app/layout.tsx`, already live |
| Server-rendered content shell (H1, premise, how to play, controls, screenshots) | `app/page.tsx`, already live |
| `lullwood.vercel.app` duplicate 308s to `www.lullwoodgame.com` | `next.config.ts`, already live |
| Google Search Console verification tag | live (`NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`) |
| AI crawlers allowed: Googlebot, GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot and bingbot all get a 200 with the full page; apex 308s to www | checked 2026-10-18; `robots.txt` allows `*`, keep it that way |
| 12-question answer-first FAQ + `FAQPage` JSON-LD from one source | #1114, `lib/faq.ts` |
| `WebSite.alternateName`, `Organization.sameAs` (GitHub), real screenshots in `VideoGame` | #1114 |
| Controls list complete (Q, G, C, R); homepage links to /devlog and /credits | #1114 |
| `/llms.txt` | #1114 |
| og:image on every subpage, `BreadcrumbList`, richer `BlogPosting`, post prev/next links | #1115 |
| Helpful 404 (single title, single `noindex`); unknown devlog slug returns a real 404 | #1115 |
| Sitemap: fixed homepage `lastmod`, screenshot image entries | #1115 |
| `/how-to-survive` player guide (Article + BreadcrumbList) | #1117 |
| `/games-like-slender` comparison page (Article + BreadcrumbList) | #1119 |
| IndexNow submits every sitemap URL (it only sent the homepage) | #1116 |
| In-game rules say "lift the child", not "carry them home" | #1118 |
| Homepage and `llms.txt` link to /how-to-survive and /games-like-slender | this PR |
| GitHub repo description (stale "carry them home") and topics | done directly on GitHub |

## On-site: still open

1. **Add each new official profile to `Organization.sameAs`** (`app/layout.tsx`) as it goes live: itch.io, YouTube, Reddit, CrazyGames.
2. **Run `node scripts/indexnow.mjs`** once after these PRs deploy, so Bing, DuckDuckGo, Yandex and Seznam hear about the new URLs. Bing also feeds ChatGPT search and Copilot. Do this at most once per deploy.
3. **A gameplay video** (a trailer or a 60-second clip) embedded on the homepage with `VideoObject` JSON-LD. Video results and AI answers both draw on video. This needs the clip first.
4. **Performance (Core Web Vitals):** the Three.js engine (about 455 KB compressed) loads on every visit before the player interacts, and about 47 KB of CSS comments ship inside `components/GameCanvas.tsx`'s style string. Deferring the engine until the first click would help LCP and INP, but it changes boot and the gate flow, so it needs a product decision and a play test (Tier C territory).
5. **Do not** build near-duplicate keyword pages (`/free-horror-game-online`, `/horror-game-no-download` and so on). Google treats them as doorway pages ([spam policies](https://developers.google.com/search/docs/essentials/spam-policies)). Each new page has to do a job no other page does.

## Founder-only (accounts, posting, spend)

Ordered by expected impact.

1. **Search Console:** submit `sitemap.xml`, request indexing for `/`, `/how-to-survive` and `/games-like-slender`, and watch the queries report for "lullwood", "lullwood game" and "horror browser game".
2. **Bing Webmaster Tools:** import the site from Search Console (one click). Its AI Performance report shows Copilot citations.
3. **itch.io page:** the strongest single brand page a browser game can get. Upload an `index.html` that iframes www.lullwoodgame.com, or a link-out page ([itch.io: new project](https://itch.io/game/new)). After that:
   - Message the curator of the [browser horror collection](https://itch.io/c/4199796/browser-horror).
   - Post honestly in [this thread](https://itch.io/t/4085063/the-best-play-in-browser-horror-games-imo).
4. **CrazyGames:** it accepts games hosted on their own domain and is not exclusive ([developer portal](https://developer.crazygames.com/games), [requirements](https://docs.crazygames.com/requirements/intro/)). Its horror category ranks for the head terms. Poki needs a build under 8 MB, which Lullwood probably isn't.
5. **YouTube:** pitch horror let's-play channels and upload our own clip. YouTube is now the largest social source of AI citations ([Outlierkit](https://outlierkit.com/resources/youtube-overtakes-reddit-ai-citations-2026/)).
6. **Reddit:** genuine posts in r/WebGames, r/HorrorGaming and r/IndieGaming. The launch copy is already written under LUL-1074.
7. **Directories and listicles:**
   - Directories: [IndieDB](https://www.indiedb.com/how-to), [AlternativeTo](https://alternativeto.net/faq), [Gamhub submit](https://gamhub.net/website_submit/).
   - Listicle pitches: [Dinogame](https://dinogame.gg/blog/best-browser-horror-games/), [WindowsReport](https://windowsreport.com/browser-horror-games/).
   - Product Hunt links are nofollow, so it only counts as a mention.
8. **Consistent wording everywhere:** "Lullwood, a free first-person horror browser game". Use the same sentence on every profile, so search engines and LLMs resolve them all to one entity, separate from Lullwood St (San Antonio) and from Gloomwood.

## Measuring

- **Weekly**, in the Search Console queries report: rank for "lullwood", "lullwood game", "lullwood horror game", "horror browser game".
- **Monthly**, ask Gemini, ChatGPT and Perplexity: "free horror games I can play in my browser" and "what is Lullwood". Record whether Lullwood is named and which source it cites.
- Expect "lullwood game" to rank before the bare "lullwood". The bare term competes with real-estate listings, and Google autocorrects it to Gloomwood until there is enough signal.
