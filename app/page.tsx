import GameLoader from "@/components/GameLoader";

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
          get them.
        </p>
        <section>
          <h2>The premise</h2>
          <p>
            Lullwood is a browser-based first-person horror game. Cross a
            foggy night forest, find the lost child, and carry them home
            while wolves, bears, and lions hunt you by sight and scent. The
            core loop is hiding and holding still while they sniff the air
            around you.
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
            silhouette is easy to track. Duck into a bush or a hollow log,
            press <strong>H</strong>, and hold still until it loses you.
            Reaching the child is only half of it — you still have to carry
            them all the way home.
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
              <strong>H</strong> — hide (bushes and hollow logs only)
            </li>
            <li>
              <strong>F</strong> — hold for the mist veil, which dims your
              light and cuts how far predators can see you
            </li>
            <li>
              <strong>E</strong> — lift and carry the child
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
          <h2>What makes it different</h2>
          <p>
            Most horror games hand you a weapon. Lullwood doesn&apos;t.
            Predators track you by line of sight and by a decaying scent
            trail you leave behind as you move — the only tool you have is
            stillness: duck into a bush or a hollow log, hold still, and let
            them lose the trail. You win by carrying the child all the way
            home, not just finding them.
          </p>
        </section>
        <section>
          <h2>Questions</h2>
          <h3>Is Lullwood free?</h3>
          <p>
            Yes. It is free to play in the browser, with no purchase, no
            account and no ads.
          </p>
          <h3>Do I need to download or install anything?</h3>
          <p>
            No. Lullwood runs in any modern browser that supports WebGL. It
            loads on the page you are reading.
          </p>
          <h3>Can I play it on a phone?</h3>
          <p>
            Yes. There are on-screen touch controls with twin sticks for
            movement and look, plus buttons for jumping, hiding, the mist
            veil and lifting the child.
          </p>
          <h3>Is it scary?</h3>
          <p>
            It is a horror game built on tension rather than jump scares.
            The fear comes from being hunted while unarmed, and from having
            to stay still while something searches for you nearby.
          </p>
          <h3>How long is a run?</h3>
          <p>
            A successful run takes a few minutes. Dying is common early on,
            and each attempt generates a fresh forest layout.
          </p>
        </section>
      </main>
    </>
  );
}
