import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import GameLoader from "@/components/GameLoader";
import { FAQ, faqJsonLd } from "@/lib/faq";
import { videoGameJsonLd } from "@/lib/game-jsonld";

// LUL-2375: the canonical is per page, not inherited from the layout -- with
// it on the layout every child route (/suggest) declared itself a duplicate
// of the homepage and Google would fold it into "/". Only `alternates` here:
// a page-level `openGraph` would REPLACE the layout's whole openGraph object
// (Next merges metadata per top-level key), dropping the social description.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Server-rendered content shell, LUL-46 (M3b). The game itself stays
// client-only (GameLoader -> next/dynamic({ ssr: false })) and visually owns
// the full viewport the instant it mounts -- html/body overflow: hidden and
// the fixed-position #gate come from the overlay style injected in
// GameCanvas. This section renders in normal document flow *below* that
// viewport (see .about's margin-top in globals.css) so a crawler gets real,
// visible prose while a player never sees or scrolls to it during the
// load -> click -> pointer-lock -> play sequence.
//
// A <canvas> is a single opaque node to a crawler, so this prose IS the
// indexable surface of the site -- every word Google has to work with lives
// here. It was 857 chars, which is thin for a page competing on "browser
// horror game"; the FAQ and "how to play" sections below exist to answer the
// questions people actually type, in their words rather than ours.
export default function Home() {
  return (
    <>
      <GameLoader />
      <main className="about">
        <h1>Lullwood — a free browser horror game</h1>
        <p className="about-tagline">
          A lost, glowing child is out there in the fog. You have to go and
          get her.
        </p>
        <section>
          <h2>The premise</h2>
          <p>
            Lullwood is a browser-based first-person horror game. Cross a
            foggy night forest and reach the lost child before wolves, bears,
            and lions hunt you down by sight and scent. The core loop is
            hiding and holding still while they sniff the air around you.
          </p>
          <p>
            It runs in the browser with no download, no install and no
            account — open the page, click once, and you are in the forest.
          </p>
        </section>
        <section>
          <h2>How to play</h2>
          <p>
            You start at the treeline. Somewhere ahead a child is glowing
            faintly in the dark, and the light is the only thing you can
            navigate by. Walk toward it, keep off open ground, and listen —
            predators announce themselves before you can see them.
          </p>
          <p>
            When something starts hunting you, running is usually the wrong
            answer: sprinting lays a stronger scent trail and a moving
            silhouette is easy to track. Duck into a bush,
            press <strong>H</strong>, and hold still until it loses you.
            Reach the child and press <strong>E</strong> to lift her —
            that&apos;s the win.
          </p>
        </section>
        <section>
          <h2>Controls</h2>
          <ul>
            <li>
              <strong>WASD</strong> — move
            </li>
            <li>
              <strong>Mouse</strong> — look
            </li>
            <li>
              <strong>Shift</strong> — run
            </li>
            <li>
              <strong>Space</strong> — jump, and how you clear a charging
              predator
            </li>
            <li>
              <strong>H</strong> — hide (bushes only)
            </li>
            <li>
              <strong>F</strong> — hold for the mist veil, which dims your
              light and cuts how far predators can see you
            </li>
            <li>
              <strong>Q</strong> — veil overload, a panic burn of the veil
            </li>
            <li>
              <strong>G</strong> — break your scent trail with the scent veil
            </li>
            <li>
              <strong>C</strong> — climb a vantage rock to look out over the
              forest
            </li>
            <li>
              <strong>R</strong> — shuffle to another hiding spot
            </li>
            <li>
              <strong>E</strong> — lift the child (this is the win)
            </li>
            <li>
              <strong>Esc</strong> — menu
            </li>
          </ul>
          <p>
            On a phone or tablet the same actions are on screen: twin sticks
            to move and look, and buttons for jump, hide, veil and lift.
          </p>
        </section>
        <section>
          <h2>Screenshots</h2>
          <p>
            The forest at night, rendered in-engine (no HUD, no admin
            overlay) — this is what the game actually looks like.
          </p>
          <div className="about-gallery">
            <Image
              src="/screenshots/lullwood-night-forest-pine-trees.png"
              alt="Low-poly pine forest at night in Lullwood, snow-dusted ground and a rocky outcrop under a starfield"
              width={3840}
              height={2160}
              sizes="(min-width: 640px) 592px, 100vw"
            />
            <Image
              src="/screenshots/lullwood-dense-pine-forest-snow.png"
              alt="Dense stand of pine trees in Lullwood's night forest, seen from ground level near a snowbank"
              width={3840}
              height={2160}
              sizes="(min-width: 640px) 592px, 100vw"
            />
            <Image
              src="/screenshots/lullwood-forest-rock-outcrop-night.png"
              alt="A snow-covered rock outcrop breaking up the tree line in Lullwood's forest at night"
              width={3840}
              height={2160}
              sizes="(min-width: 640px) 592px, 100vw"
            />
          </div>
        </section>
        <section>
          <h2>What makes it different</h2>
          <p>
            Most horror games hand you a weapon. Lullwood doesn&apos;t.
            Predators track you by line of sight and by a decaying scent
            trail you leave behind as you move — the only tool you have is
            stillness: duck into a bush, hold still, and let
            them lose the trail. You win the instant you reach the child and
            lift her — there&apos;s no trip home to survive afterward.
          </p>
        </section>
        <section>
          <h2>Built by an AI studio</h2>
          <p>
            Lullwood is made by a team of AI agents. Not AI-assisted — the
            design, engineering, testing, and balancing are all done by a
            coordinated fleet of language-model agents running on Claude.
            There is one human: the founder, who sets direction and approves
            releases.
          </p>
          <p>
            The agents work from a shared task board and a shared codebase.
            One writes game engine code, one scouts new mechanics, one reviews
            every diff before it lands, one tests each build after it ships.
            They coordinate through structured handoffs and a shared wiki
            rather than a Slack channel.
          </p>
          <p>
            What that means in practice: the game ships faster than a
            traditional indie team. A design idea goes from the board to a
            playable build in hours rather than weeks. When a bug is found, a
            fix is often in code review the same session.
          </p>
          <p>
            The game is iterating constantly. Features like scent trails,
            stamina, and the mist veil were all designed, implemented, and
            tuned by agents running in parallel. The agents disagree, leave
            findings in code review, and sometimes send tickets back for a
            clearer spec — it is a team, not a magic box, and it is building
            this game right now.
          </p>
        </section>
        <section>
          <h2>Questions</h2>
          {FAQ.map(({ question, answer }) => (
            <div key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </div>
          ))}
        </section>
        <section>
          <h2>Got an idea?</h2>
          <p>
            <Link href="/suggest" className="about-suggest-link">
              Suggest something for Lullwood
            </Link>{" "}
            — the founder reads every suggestion by hand.
          </p>
        </section>
        <section>
          <h2>More about Lullwood</h2>
          <ul>
            <li>
              <Link href="/how-to-survive">How to survive Lullwood</Link> — how
              predators find you, hiding, the mist veil and tips for each
              difficulty
            </li>
            <li>
              <Link href="/guides/how-to-win">How do you win Lullwood?</Link> —
              the win condition: lift the child, no trip home
            </li>
            <li>
              <Link href="/games-like-slender">Games like Slender</Link> — what
              makes the genre work, and where Lullwood fits
            </li>
            <li>
              <Link href="/devlog">The Lullwood devlog</Link> — how the game
              is built, post by post
            </li>
            <li>
              <Link href="/credits">Credits</Link> — the third-party assets
              in the game and the people who made them
            </li>
          </ul>
        </section>
      </main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(videoGameJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <script
        type="application/ld+json"
        // Built from lib/faq.ts, the same list the Questions section renders.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
