import Link from "next/link";

export default function TheFogIsTheWolfsEyesight() {
  return (
    <>
      <p>
        In Lullwood, the fog is the predators&rsquo; eyesight. Every 90 seconds
        a fog tide rolls in for 20 seconds, and a wolf, bear or lion standing
        in it sees up to 35% less far. A low drone starts 10 seconds before
        the fog arrives, so waiting for the tide is a choice, not a surprise.
      </p>
      <p>
        We build Lullwood, a free browser horror game, in three.js and Next.js.
        This post is how the tide works, read from the source: the clock, where
        the fog sits on the map, whose position the sight cut is measured at,
        and what it costs you.
      </p>

      <h2>A 90-second clock with three phases</h2>
      <p>
        The tide is a pure function of one number. The engine keeps a counter,{' '}
        <code>fogTideClock</code>, that wraps at 90. In{' '}
        <code>FOG_TIDE_CONFIG</code> the period is 90, the active window is 20
        and the lead-in is 10, so each loop splits into three phases by
        position: calm for the first 60 seconds, signpost from 60 to 70, active
        from 70 to 90. The signpost phase is the telegraph. Nothing about the
        world has changed yet except the sound.
      </p>
      <p>
        The counter only advances while you are playing, so the pause menu
        freezes the tide with everything else. It is also not seeded. A
        fixed-period cycle keyed to the game clock is already identical run to
        run with no random draw at all, and a seed-derived offset would only
        have been a second seed source. On a fresh page load your first tide
        opens 70 seconds into play. The code never resets the counter between
        runs, so on a later run in the same tab it is already mid-cycle.
      </p>

      <h2>Three patches, not the whole map</h2>
      <p>
        The tide has a clock but also a location. <code>FOG_TIDE_SITES</code>{' '}
        lists three circular patches on the map, with radii of 130, 130 and 110
        units. The tide&rsquo;s strength at any point is the global ramp
        multiplied by a weight that is 1 at a patch&rsquo;s centre and falls in
        a straight line to 0 at its edge. Outside every patch it is 0, whatever
        the clock says. The source comment gives the reason: the test
        for the feature was &ldquo;can you walk out of the fog&rdquo;, and that
        needs somewhere clear to walk to.
      </p>
      <p>
        The timing is the same everywhere and only the extent is local, so
        every patch thickens on the same beat. The ramp is also eased, not
        snapped. The sight cut takes a four-second time constant to build, so
        the number below is what you get once the tide has settled, a few
        seconds into the active window.
      </p>

      <h2>The wolf&rsquo;s position decides, not yours</h2>
      <p>
        Here is the detail that matters for play. When a predator checks
        whether it can see you, the engine multiplies its sight radius by{' '}
        <code>fogTideDetectMul(fogTideAmountAt(p.x, p.z, ...))</code>, and{' '}
        <code>p</code> is the predator. The tide is sampled where the hunter
        stands. At full strength, <code>FOG_TIDE_DETECT_MUL</code> is 0.65:
      </p>
      <ul>
        <li>Wolf: sight radius 42 becomes 27.3</li>
        <li>Bear: 30 becomes 19.5</li>
        <li>Lion: 48 becomes 31.2</li>
      </ul>
      <p>
        Those are the base radii at the centre of a patch, before the
        difficulty tier and the time-of-run curve are applied on top. Halfway
        out from the centre the weight is 0.5, so the cut is about 17.5%
        instead of 35%.
      </p>
      <p>
        The fog you see is a different measurement. Scene fog density is
        sampled at your position, so you can stand in thick fog while a wolf
        outside the patch still sees you at full range. The reverse also
        happens: you can be in clear air with a hunter inside a patch, and it
        sees you short. What the screen shows is not a guarantee about what a
        predator sees.
      </p>
      <p>
        The cut stacks multiplicatively with the mist veil. Holding the veil
        multiplies sight by 0.35, so a predator at a patch&rsquo;s centre that
        is hunting a player who holds the veil sees at 0.35 &times; 0.65,
        about 0.23 of its normal radius. The comment in the source
        says that stacking is intended: the veil is a resource you spend and the
        tide is a free world event. How the veil works is in{' '}
        <Link href="/how-to-survive">the survival guide</Link>.
      </p>
      <p>
        Against you, it is a sight effect only. The scent and footstep checks do
        not read the tide, so the fog does not hide your trail. For scent, see{' '}
        <Link href="/guides/wolves">how to survive wolves</Link>.
      </p>

      <h2>How the game tells you</h2>
      <p>
        There is no on-screen banner. We found no text in the HUD that names
        the tide while it is happening. The telegraph is audio and fog. During
        the signpost phase the drone gain rises to 2.6 times its normal level,
        and as the tide settles the wind gain drops to 30% of normal, so the
        ambient bed falls to a low drone. At full tide the scene fog density
        gets a further 0.1 on top of whatever is already set.
      </p>
      <p>
        Two limits are worth knowing. The drone and the wind duck are blended by
        your distance from a patch, so you hear the signpost properly only near
        one. And they sit in the calm audio bed: while something is hunting you,
        the engine drops the calm bed entirely. The end-of-run recap can log
        the event in plain text, as &ldquo;a fog tide rolled in&rdquo; and
        &ldquo;the fog tide passed.&rdquo;
      </p>

      <h2>The cost: the child gets louder too</h2>
      <p>
        The same tide that cuts sight makes the child easier to find. At full
        tide, her glow intensity is multiplied by 1.5 and the range of her light
        by 1.35, both sampled at her position. The cry works the same way. The
        child&rsquo;s cry is a hearing check with a radius of 32 units, and it
        is scaled by the same 1.35 at her position, so it reaches up to 43.2
        units when she stands at a patch&rsquo;s centre. A predator inside that radius rolls a
        chance each second to hear it and investigate.
      </p>
      <p>
        So fog helps you cross unseen and it also carries her cry further. A
        hunter that cannot see you can still hear her. That trade is
        why waiting for the tide is a decision and not a free win.
      </p>

      <h2>What we took from other games, and what is a first cut</h2>
      <p>
        The source header cites one piece of genre research: Don&rsquo;t
        Starve telegraphs its dangerous phase with a warning phase, dusk,
        before the state changes. The signpost phase is that idea. The
        scheduler that drives it is generic: a calm, signpost and active loop
        that other timed events can reuse.
      </p>
      <p>
        The patch positions are described in the source as a first cut, with a
        tuning pass expected after playtesting. The cycle is also too slow to
        drive through end-to-end tests step by step, so the engine exposes a
        QA hook, <code>qaSetFogTideClock</code>, that sets the counter
        directly. It does not force the tide on, so the phase transitions
        still fire from the clock like they would in play.
      </p>

      <p>
        If you want to use the tide rather than read about it, the practical
        side is in <Link href="/how-to-survive">the Lullwood survival guide</Link>.{' '}
        <Link href="/">Play Lullwood free in the browser</Link> and listen for
        the drone.
      </p>
    </>
  );
}
