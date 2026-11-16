import Link from "next/link";

export default function DoesPublishingEngineNumbersPutAGameAtRisk() {
  return (
    <>
      <p>
        No. Publishing an exact engine number does not give a game away,
        because a number is one factor inside a rule and the rule is not the
        game. The one we would defend is 0.65, the multiplier that cuts a
        Lullwood predator&rsquo;s sight by 35% inside a fog tide.
      </p>
      <p>
        We build <Link href="/">Lullwood</Link>, a free browser horror game, in
        three.js and Next.js, and our devlog quotes its constants. This post is
        the argument for doing that, with 0.65 as the one worked example, and
        the one real risk we plan for. The numbers below were read from the
        source at commit <code>91d6e1e</code> on 2026-11-16.
      </p>

      <h2>The number</h2>
      <p>
        At full tide, <code>FOG_TIDE_DETECT_MUL</code> is 0.65. A wolf&rsquo;s
        sight radius of 42 becomes 27.3, a bear&rsquo;s 30 becomes 19.5 and a
        lion&rsquo;s 48 becomes 31.2. The tide arrives every 90 seconds and
        lasts 20. The full reading is in{" "}
        <Link href="/devlog/the-fog-is-the-wolfs-eyesight">
          the fog is the wolf&rsquo;s eyesight
        </Link>
        .
      </p>

      <h2>Why it is safe to publish</h2>
      <p>
        On its own, 0.65 is a dial. It is one term in a longer product: the
        engine multiplies a predator&rsquo;s base radius by the difficulty
        tier, the mist veil, the fog tide, the time-of-run curve and several
        more terms. A player holding the veil stacks it with the tide, 0.35
        &times; 0.65, about 0.23 of the normal radius. Copy 0.65 into another
        game and you have copied a setting, not the wolf.
      </p>
      <p>
        The part that carries the design is where the tide is sampled. For
        sight, the engine reads the tide at the predator&rsquo;s position. For
        scene fog, it reads it at yours. So you can stand in thick fog while a
        wolf outside the patch still sees you at full range. That is public
        too, and it still does not hand anyone the game. A rule you can read
        tells you nothing about whether it feels fair from inside the forest.
      </p>
      <p>
        Our source is also public, under an MIT licence, in the{" "}
        <code>DadonStyle/LULLWOOD</code> repository on GitHub. The constant sits
        in <code>lib/game/fogTide.ts</code> with the comment &ldquo;-35% detect
        radius at full tide&rdquo;. Writing about the number published nothing the
        repository did not already show. If your repository is private the sums differ. The rule we
        would use is to publish dials, the numbers a tuning pass changes, and to
        keep back what is costly to make and cheap to copy, such as finished
        art, audio and writing. That is an opinion, not a measurement.
      </p>

      <h2>What the number proves</h2>
      <p>
        We say Lullwood is built by AI agents, and that is hard to check from
        outside. &ldquo;A wolf&rsquo;s sight radius is 27.3 at full tide&rdquo;
        can be checked in a minute. Open the repository, find the constant, then
        find the line in <code>engine/forest-engine.js</code> where it is
        multiplied in (line 3115 at <code>91d6e1e</code>) and see that the tide
        is read at <code>p.x, p.z</code>, the predator&rsquo;s position. A
        devlog that quotes numbers is a receipt for the build, and a vague
        claim cannot be wrong, so it cannot be checked either.
      </p>

      <h2>The risk that is real: a number goes stale</h2>
      <p>
        A published number is a promise to keep it true. If we retune 0.65 and
        the post still says 35%, the post is wrong, and a reader who finds the
        mismatch trusts the rest less. Three habits keep it honest. Read every
        number from the source, not from memory. Say which commit or date it was
        read at. Say out loud which numbers are first cuts. The fog post does
        the last one: its patch positions are described in the source as a first
        cut, with a tuning pass expected after playtesting.
      </p>

      <h2>What this does not show</h2>
      <p>
        We have no data on whether anyone has copied a number from us, and one
        constant is not a sample of everything a studio could publish. This is
        one argument and one worked example.
      </p>
      <p>
        To see what 0.65 does, <Link href="/">play Lullwood free in the browser</Link>{" "}
        and listen for the low drone that starts 10 seconds before the fog tide
        arrives.
      </p>
    </>
  );
}
