import GameLoader from "@/components/GameLoader";

// Server-rendered content shell, LUL-46 (M3b). The game itself stays
// client-only (GameLoader -> next/dynamic({ ssr: false })) and visually owns
// the full viewport the instant it mounts -- html/body overflow: hidden and
// the fixed-position #gate come from the overlay style injected in
// GameCanvas. This section renders in normal document flow *below* that
// viewport (see .about's margin-top in globals.css) so a crawler gets real,
// visible prose while a player never sees or scrolls to it during the
// load -> click -> pointer-lock -> play sequence.
export default function Home() {
  return (
    <>
      <GameLoader />
      <main className="about">
        <h1>Lullwood</h1>
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
              <strong>H</strong> — hide (bushes and hollow logs only)
            </li>
            <li>
              <strong>E</strong> — lift and carry the child
            </li>
            <li>
              <strong>Esc</strong> — menu
            </li>
          </ul>
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
      </main>
    </>
  );
}
