import Link from "next/link";

export default function HowScentAndWindWork() {
  return (
    <>
      <p>
        In Lullwood, wind is a single vector rolled once when the forest
        generates, not drawn per frame. That one constant feeds six separate
        systems: how far your scent spreads, how long it lasts, how loud your
        footsteps are, how fast you can sprint, which way a predator leans
        while it tracks you, and when a chasing predator freezes.
      </p>
      <p>
        We build Lullwood in three.js and Next.js, and this wind vector is
        the smallest piece of code in the project with the widest blast
        radius. One number, read by five different modules, each of which
        has no idea the other four exist.
      </p>

      <h2>One roll, pushed once</h2>
      <p>
        <code>generateWind()</code> runs once inside{' '}
        <code>generateMap()</code>, after trees, predators and props are
        already placed. It draws an angle from the map&rsquo;s seeded random
        stream and turns it into a unit vector, <code>windX</code>/
        <code>windZ</code>. That vector is pushed to engine state a single
        time —{' '}
        <code>pushState({'{'} windX, windZ {'}'})</code> — and never touched
        again until the next map. No per-frame gust, no drift over the
        course of a run. The forest you spawn into has already decided which
        way the air is moving before you take a step.
      </p>
      <p>
        A second coin flip, <code>windHighSpeed</code>, rides alongside it:
        50/50, but drawn from an independent seeded generator rather than the
        map&rsquo;s own random stream, specifically so that reading it never
        shifts where every other roll in that seed lands. Get that wrong and
        a QA-pinned seed stops reproducing the same forest.
      </p>

      <h2>What it changes for you</h2>
      <p>
        Move with your back to the wind and your scent trail deposits at
        full radius. Move into it — <code>isMovingAgainstWind()</code>, a dot
        product between your heading and the wind vector — and the radius
        drops by <code>WIND_AGAINST_RADIUS_MULTIPLIER</code>, 0.8, a flat 20%
        cut. On a high-wind map, <code>windHighSpeed</code> also shortens how
        long any scent point survives before it decays, another 20% off via{' '}
        <code>scentLifetimeWithWind()</code> — and the two reductions stack
        multiplicatively, not as one overriding the other, so a high-wind map
        where you&rsquo;re also moving upwind leaves the shortest, smallest
        scent trail the game can produce.
      </p>
      <p>
        Sprinting against the wind is quieter, too: footstep noise radius
        drops from the normal sprint&rsquo;s 24 units to 16.8 —{' '}
        <code>NOISE_RADIUS_RUN_WIND</code>, 0.7× the base — because the wind
        is carrying the sound away from whatever is behind you rather than
        toward it. And it&rsquo;s faster: <code>WIND_ASSIST_SPEED_MUL</code>{' '}
        adds a flat 20% to your sprint speed in the same direction. We call
        the whole package Wind-Assisted Evasion. It is the one piece of the
        system we designed as a reward rather than a cost: read the wind
        indicator, run into it, and you are quieter, harder to smell, and
        faster, all at once.
      </p>

      <h2>What it changes for predators</h2>
      <p>
        Wind doesn&rsquo;t just help you — it also steers whoever is hunting
        you. The moment a predator gets a scent lock, its approach heading
        stops pointing straight at your last known position and bends toward
        downwind instead. <code>biasTowardWind()</code> blends the straight-
        line heading with the wind vector at a fixed weight,{' '}
        <code>INVESTIGATION_DOWNWIND_BIAS</code> (0.3), then renormalizes the
        result back to a unit vector. It only applies while a scent lock is
        active — a predator that loses you by sight or sound alone still
        walks straight at where it last heard or saw you. The narrative only
        holds for the channel it is actually modeling: predators hunt
        downwind of scent, not downwind of everything.
      </p>
      <p>
        The more surprising piece is <code>shouldWindPause()</code>: a
        chasing predator sprinting roughly perpendicular to your facing (the
        dot product of its approach and your facing has to sit under 0.2 to
        read as &ldquo;crossing&rdquo; rather than &ldquo;toward&rdquo;), with
        the wind strongly at its back (dot product over 0.6), freezes its
        sprint for 0.3 seconds. The idea, credited to our Scout agent and
        accepted by the founder, is that a predator moving across your
        downwind side is momentarily carrying its own scent and noise ahead
        of itself, loud enough to make it flinch.
      </p>

      <h2>The honest failure</h2>
      <p>
        That freeze shipped with no cooldown, on the design argument that the
        exact geometry it needed — perpendicular, strongly downwind, during
        an active chase — would be rare enough in practice not to matter. It
        was not. A stationary player facing a chasing predator leaves the
        approach direction, the facing and the wind all unchanged from one
        tick to the next, which means the freeze decays to zero and the same
        check fires again immediately, forever. Two existing end-to-end
        tests had scripted exactly that geometry without anyone noticing it
        was the trivial reproduction case, and both started failing the day
        the freeze shipped.
      </p>
      <p>
        The fix is a second timer, <code>windPauseCooldownT</code>, that
        blocks a fresh freeze for 2 seconds after one ends — the predator
        keeps chasing at full speed through that window, only the retrigger
        check is suppressed. &ldquo;Essentially never reachable&rdquo; is a
        claim worth testing against a player who simply stops moving, because
        stopping is the single most common thing a cornered player does.
      </p>

      <p>
        The wind arrow in the corner of the screen is reading one number. If
        you want the practical version of what to do about it — when to run
        into it, when hiding beats moving — that is{' '}
        <Link href="/how-to-survive">the survival guide</Link>, not this post.{' '}
        <Link href="/">Play Lullwood</Link> and watch the arrow.
      </p>
    </>
  );
}
