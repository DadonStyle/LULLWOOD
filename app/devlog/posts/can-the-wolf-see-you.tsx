import Link from "next/link";

export default function CanTheWolfSeeYou() {
  return (
    <>
      <p>
        Yes, if you are inside its sight radius and no cover box sits on the
        straight line between you. Lullwood decides that without
        three.js&rsquo;s Raycaster: one distance check, then a walk along the
        line through a spatial hash of cover boxes, with one slab test per box
        it finds.
      </p>
      <p>
        We build Lullwood, a free browser horror game, in three.js and Next.js.
        This post is how that check works, read from the source at commit{' '}
        <code>b03da13</code>, the head of our release branch when we wrote it:
        the order of the two tests, the loop, one exemption, one limit we
        measured, and a map-wrap switch that is built and turned off. Line
        numbers below are for that commit.
      </p>

      <h2>Two tests, cheapest first</h2>
      <p>
        The decision is <code>canSee</code> in <code>lib/game/cover.ts</code>{' '}
        (L741-771). It is handed the distance between predator and player. If
        that distance is at or beyond <code>effectiveDetect</code>, it returns
        false and never touches the map (L769). Only a player inside the radius
        gets the second test, <code>hasLOS</code> (L770).
      </p>
      <p>
        <code>effectiveDetect</code> (L734-737) is the predator&rsquo;s base
        detect radius, times one minus a stillness cut, times a multiplier the
        caller supplies. A wolf&rsquo;s base radius is 42 units
        (<code>engine/tuning.js</code> L317).
      </p>
      <p>
        The stillness term is zero unless the player is in the hide stance:{' '}
        <code>state.hidden ? min(1, hideTime / STILL_RAMP) : 0</code> (L735).
        The engine sets <code>hidden</code> only in <code>enterHide</code>{' '}
        (<code>engine/forest-engine.js</code> L4405-4406), which{' '}
        <code>toggleHidden</code> reaches when the player presses H with a
        bramble within 2.2 units of its edge (L4475-4479;{' '}
        <code>HIDE_RADIUS</code>, <code>cover.ts</code> L633), and any movement
        key breaks the stance (L8374). <code>hideTime</code> counts up from
        there (L8375). So a player who simply stops in the open keeps the full
        42; the source says standing still in the open next to a predator still
        gets you caught (<code>cover.ts</code> L711-712). A player who is
        hidden, within 2.2 of the bramble&rsquo;s edge but outside its
        footprint, ramps the cut in over 1.2 seconds and takes up to 82% off
        (<code>STILL_RAMP</code> and <code>STILL_DETECT_CUT</code>, L723-724).
        That is a wolf&rsquo;s 42 shrinking to about 7.6 units, before any other
        multiplier. A hidden player inside the footprint never reaches this
        arithmetic; the branch below returns first.
      </p>
      <p>
        The caller is the engine&rsquo;s own <code>canSee</code> wrapper
        (<code>engine/forest-engine.js</code> L3105-3108). It returns false
        outright when cave immunity or a veil overload is active, and
        otherwise multiplies in the difficulty tier, the mist veil, the fog
        tide, the time of run, the time of day, rock climbing and firefly glow.
        It is a sight test only. Scent is a separate check, covered in{' '}
        <Link href="/devlog/how-scent-and-wind-work">how scent and wind work</Link>.
      </p>
      <p>
        One branch runs before both tests (L766-768). A hidden player standing
        inside a hide-spot footprint is invisible unless the predator has
        closed to contact range. Bramble is the only hide kind (
        <code>HIDE_KINDS</code>, L632). Contact range is the predator&rsquo;s
        body radius plus <code>CATCH_MARGIN</code>, which is 1.3
        (<code>lib/game/predator.ts</code> L44), so for a wolf with a radius of
        0.8 it is 2.1 units.
      </p>

      <h2>The loop: a line as a handful of samples</h2>
      <p>
        <code>hasLOS</code> (L568-617) takes the two points and steps between
        them. The step is half a spatial-hash cell. <code>CELL</code> is 8
        units (L263), so it samples every 4 units, and at least once (L574).
        Each sample maps to a cell key, a <code>Set</code> skips cells it has
        already visited (L583-584), and only the boxes filed under that cell
        are tested.
      </p>
      <p>
        A box is a <code>CoverAABB</code> (L292-299): a centre, a half-width{' '}
        <code>hx</code>, a half-depth <code>hz</code>, a kind and a rotation{' '}
        <code>ry</code>. There is no height. Line of sight here is flat, on
        the ground plane, as the engine comment says (
        <code>forest-engine.js</code> L3054-3057), so a box blocks the line the
        same way whatever its height.
      </p>
      <p>
        For each box, the segment is rotated into the box&rsquo;s own frame
        (L588-592) and passed to <code>segRayVsAABB</code> (L530), a slab test:
        clip the segment against the box&rsquo;s x range, then its z range, and
        it hits if a stretch of the segment survives both. The first hit
        returns false (L611-613). Reaching the end with no hit returns true.
      </p>
      <p>
        The rotation is where this code has hurt us. A source comment (L224-228)
        says the same rotated-box sign bug shipped twice, in two different
        functions that shared one rotation convention, because neither could be
        called from a test. That is why the geometry was lifted out of the
        engine file into <code>cover.ts</code>, where it is unit-testable.
      </p>
      <p>
        Only some things are in the grid at all. Rocks, brambles, logs and
        larger trees are. A tree with a scale of 1.4 or less is never added
        as cover (<code>forest-engine.js</code> L1051), so it cannot block a
        sightline.
      </p>

      <h2>Why not the Raycaster</h2>
      <p>
        three.js ships a <code>Raycaster</code>, and the obvious version casts
        from the wolf&rsquo;s eyes to the player and reports what it hits. A{' '}
        <code>git grep -i raycaster</code> over our engine, library and app
        code finds no use of it. Rocks, logs and brambles are drawn as instanced meshes (
        <code>ensureCoverChunk</code>, <code>forest-engine.js</code> L1313-1341)
        but the logic reads plain data: the same boxes, filed into a map by{' '}
        <code>buildCoverGrid</code> (<code>engine/forest-engine.js</code>{' '}
        L997-1002). A sight test touches a few
        rectangles and never a scene mesh.
      </p>
      <p>
        We have not benchmarked the two against each other, so this post makes
        no speed claim. The reason the source gives is narrower: test only the
        cover in the cells the line passes through, never all of it (L557-559).
      </p>

      <h2>The exemption: standing inside a bramble</h2>
      <p>
        A segment that starts or ends inside a box reads as blocked from every
        direction, because the slab test clips its range to the segment. For a
        rock that never happens, since neither player nor wolf can stand
        inside one. Logs and brambles are walkable (<code>WALKABLE_KINDS</code>,
        L647), so either can be standing in one.
      </p>
      <p>
        So <code>hasLOS</code> skips a walkable box when either endpoint is
        inside its footprint (L606-610). Solid kinds are not skipped. The
        exemption was added so a wolf standing in a bramble is not blinded by
        it. It also stopped the hiding player&rsquo;s own bramble from blocking
        every sightline to them, which is the case the hide branch above (
        L757-768) puts back by an explicit rule.
      </p>

      <h2>One limit we measured</h2>
      <p>
        A cover box is filed under one cell: the one its centre is in (
        <code>buildCoverGrid</code> in <code>engine/forest-engine.js</code>,
        L997-1002). <code>hasLOS</code> reads only the cells its own samples
        land in (<code>cover.ts</code> L580-585). Player collision and{' '}
        <code>insideHideFootprint</code> read the surrounding 3 by 3 block of
        cells instead (<code>neighbourhood</code>, L301; used by{' '}
        <code>coverBlockedR</code> at L431 and by the footprint test at L699).{' '}
        <code>hasLOS</code> does not. So a long box centred just across a cell
        line can overhang into a cell the line samples without ever being
        read.
      </p>
      <p>
        We ran the real function on a synthetic case. A thin box 4.8 long and
        0.7 deep, centred at x = 9.5, spans x = 7.1 to 11.9, but its centre is
        in the next cell over. A line from (6, &minus;6) to (7.9, 6) crosses it
        at about x = 7.27. All four of the line&rsquo;s sample points have x
        under 8, so none reads the box&rsquo;s cell, and <code>hasLOS</code>{' '}
        returns true: the wolf sees through the log. Move the same box&rsquo;s
        centre to x = 6.5 and it returns false.
      </p>
      <p>
        That is a probe, not a rate. We do not know how often a forest
        produces a line like this, and this post is not a bug report.
      </p>

      <h2>The wrap seam: built in, switched off</h2>
      <p>
        Every position comparison in this path goes through{' '}
        <code>wrapDelta</code> and <code>wrapCoord</code> (
        <code>lib/game/wrap.ts</code> L12-24): the line&rsquo;s vector, each
        sample, each box offset (<code>cover.ts</code> L573, L579, L589). With
        a finite map size they take the shortest way around a torus. With an
        infinite one they are plain subtraction.
      </p>
      <p>
        The engine passes <code>WRAP_SPAN = CONFIG.wrapEnabled ?
        CONFIG.mapSize : Infinity</code> (<code>forest-engine.js</code> L329),
        and <code>wrapEnabled</code> is <code>false</code> (
        <code>engine/tuning.js</code> L84). The comment there says it stays off
        until a seam-walk test flips it. So in the game you play today the map
        does not wrap, and this code runs as plain subtraction. We wrote the
        seam math first on purpose, so that turning wrapping on would not mean
        hunting for every raw subtraction (<code>wrap.ts</code> L1-6).
      </p>

      <h2>What it means in play</h2>
      <p>
        Cover and the hide stance are separate dials. Cover removes the line
        between you and the wolf. Hiding at a bramble and staying put shrinks
        the radius it has to beat. The
        practical side, with the timings, is in{' '}
        <Link href="/guides/wolves">how to survive wolves in Lullwood</Link>{' '}
        and <Link href="/how-to-survive">the Lullwood survival guide</Link>.{' '}
        <Link href="/">Play Lullwood free in the browser</Link> and see how
        close you can stand behind a rock.
      </p>
    </>
  );
}
