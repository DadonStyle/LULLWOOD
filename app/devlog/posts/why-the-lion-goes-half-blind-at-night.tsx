import Link from "next/link";

export default function WhyTheLionGoesHalfBlindAtNight() {
  return (
    <>
      <p>
        In <Link href="/">Lullwood</Link>, a free browser horror game, the lion
        is the only predator whose sight gets worse during a run. It sees its
        full 48 units until 90 seconds, then fades in a straight line to half
        range by 150, while wolves and bears see up to 30% farther by 120.
      </p>
      <p>
        This post covers why one hunter in the game fades, read from the
        source and from the design note behind it, and what the fade does to
        your route.
      </p>

      <h2>Two curves, opposite directions</h2>
      <p>
        Every predator&rsquo;s sight radius is its base number multiplied by a
        small product of modifiers. One of them is keyed to how long you have
        been playing. For wolves and bears it is a ramp up:{' '}
        <code>TIME_OF_RUN_DETECT_MUL</code> is 1.3, reached at 120 seconds. For
        the lion it is a different function, <code>duskLionDetectMul</code>:
        1.0 until 90 seconds, then a straight line down to 0.5 at 150, and it
        stays at 0.5 after that. The engine picks between them with one
        branch on the predator&rsquo;s kind. The lion never gets the ramp up.
      </p>
      <p>These are the base sight radii in units, before any of the other modifiers below:</p>
      <ul>
        <li>0 seconds: lion 48, wolf 42, bear 30</li>
        <li>90 seconds: lion 48, wolf about 51, bear about 37</li>
        <li>120 seconds: lion 36, wolf about 55, bear 39</li>
        <li>150 seconds: lion 24, wolf about 55, bear 39</li>
      </ul>
      <p>
        So the lion starts as the farthest-seeing hunter in the forest. Around
        the one-minute mark the wolf has already passed it, and by 150 seconds
        a wolf sees more than twice as far. On Blackout, where the difficulty
        multiplies every sight radius by 0.7, that is about 17 units for the
        lion and 38 for the wolf.
      </p>

      <h2>Why the lion fades</h2>
      <p>
        The feature has a short design note in our wiki, written before it was
        built. Its argument is that time should be a resource: players are
        meant to learn predator detection and stealth early in a run, and the
        approaching dusk is the reward for having learned it. It describes the
        lion as losing its teeth at dusk, a natural end to the lion&rsquo;s
        sight-based advantage.
      </p>
      <p>
        The same note also shows why the lion has its own curve. The fog and
        sky already darken over a run on a separate pacing clock, and that
        clock already raises every predator&rsquo;s sight by up to 30% over the
        same 120 seconds. Layering a new &minus;50% on the lion on top of the
        existing +30% would have had two ramps cancel each other in the same
        window. The engineering resolution on the note says that reads as
        incoherent to the player and to QA, so the lion&rsquo;s curve replaces
        the ambient one instead of stacking with it. Wolves and bears keep the
        ramp up.
      </p>
      <p>
        The change is to sight and nothing else. The lion&rsquo;s speed, its
        charge and its sense of smell come from other constants and do not
        read the dusk curve, so it stays the fastest hunter for the whole run.
        The full numbers for those are on the{' '}
        <Link href="/guides/lions">lion survival guide</Link>.
      </p>

      <h2>What it does to the player&rsquo;s decisions</h2>
      <p>
        The curve gives a run two halves. In the first 90 seconds the lion is
        at full range and the useful skill is not being seen: cover, hiding and
        the mist veil. After 90 seconds the same lion is easier to cross in
        front of, and each additional second makes it easier. Waiting is a
        trade, because the curve that dulls the lion sharpens the wolf and the
        bear in the same window. Crossing late is safer against one predator
        and worse against the other two.
      </p>
      <p>
        That is the design note&rsquo;s time-as-a-resource idea in play. The
        question stops being &ldquo;is the lion dangerous&rdquo; and becomes
        &ldquo;when do I cross, and what am I crossing past&rdquo;. How to hide
        and veil against each predator is in{' '}
        <Link href="/how-to-survive">the Lullwood survival guide</Link>.
      </p>

      <h2>How the game tells you</h2>
      <p>
        There is a hint line, and it names the lion on purpose. Once your run
        clock passes 90 seconds the game queues: &ldquo;as night falls, the
        lion&rsquo;s sight weakens &mdash; darkness favors the quiet.&rdquo;
        The design note first drafted it as &ldquo;predators&rsquo; sight
        weakens&rdquo; and the engineering resolution corrected it, since wolves
        and bears do not weaken. The dimming sky and thicker fog are the other
        tell, and they come from the older pacing clock.
      </p>

      <h2>What the radii leave out</h2>
      <p>
        The base radii above are the starting point, and a real sight check
        multiplies in more. The difficulty tier does (Lantern and Blackout are
        both 0.7, Night is 1.0). The mist veil does, cutting sight to 35% while
        it is held. So does the fog tide, up to 35% less for a predator standing
        inside one of its patches. One modifier is keyed to the clock on your own
        machine: the local hour of day scales every predator&rsquo;s sight
        between 0.8 at night and 1.15 at noon. All of these multiply together,
        so a lion at dusk with the veil held is much shorter-sighted than the
        150-second figure alone suggests.
      </p>
      <p>
        We have not measured whether players notice the hint, or whether they
        actually wait for dusk. The mechanic is fully readable in the source,
        but how it plays is a question about people, and we do not have that
        data yet.
      </p>

      <p>
        If you want to use the lion&rsquo;s clock rather than read about it,{' '}
        <Link href="/guides/lions">the lion guide</Link> has the plan, and{' '}
        <Link href="/">you can play Lullwood free in the browser</Link> and
        watch the sky.
      </p>
    </>
  );
}
