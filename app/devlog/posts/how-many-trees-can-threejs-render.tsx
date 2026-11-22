import Link from "next/link";

export default function HowManyTreesCanThreejsRender() {
  return (
    <>
      <p>
        Lullwood draws 5,200 trees in a browser tab by splitting them into 64
        chunks, each its own three-part InstancedMesh, so three.js can
        frustum-cull whole chunks, and by building only the chunks near the
        player: 25 at spawn, 36 at most while walking. The heaviest whole
        frame we measured was 101,996 triangles; one pool would be 270,400.
      </p>
      <p>
        We build Lullwood, a free first-person horror game for the browser,
        in three.js and Next.js. This post is the forest renderer, read from
        the source at commit <code>90a269b</code>, the head of our release
        branch when we wrote it. Line numbers are for that commit, in{' '}
        <code>engine/forest-engine.js</code> unless a file is named. The one
        thing it does not give you is a frame-rate number, because we never
        measured one.
      </p>

      <h2>The forest: 5,200 trees, 64 chunks</h2>
      <p>
        <code>CONFIG.trees</code> is 5,200 and <code>CONFIG.mapSize</code> is
        480 world units (<code>engine/tuning.js</code> L86, L18). A tree is
        three meshes: a trunk, <code>CylinderGeometry(0.12, 0.20, 1.6, 6)</code>,
        and two foliage cones with 7 radial segments (L712-714). Placing them
        is a rejection loop over random positions, capped at 130,000
        attempts, 25 per tree on average (L1468).
      </p>
      <p>
        The first version drew all of it from one InstancedMesh pool that
        spanned the map. The source says why that could not be culled: a mesh
        covering the whole map is always at least partly in view, so{' '}
        <code>frustumCulled</code> was off and all 5,200 trees were submitted
        every frame (L1159-1163).
      </p>
      <p>
        The fix, ticket LUL-1487, is a grid. <code>TREE_CHUNK_SIZE</code> is 60
        units, so a 480-unit map is 8 by 8 = 64 chunks (L1165-1166), and each
        tree is filed into a chunk by its x and z alone (L1168-1172). We
        counted on the live game: all 64 chunks hold trees, which is 81 per
        chunk on average.
      </p>

      <h2>One trio per chunk, and a bounding sphere</h2>
      <p>
        Each chunk gets its own trunk mesh and two cone meshes, each an{' '}
        <code>InstancedMesh</code> sized to exactly that chunk&rsquo;s tree
        count (L1206-1214). The engine leaves <code>frustumCulled</code> at
        three.js&rsquo;s default of true, and calls{' '}
        <code>computeBoundingSphere()</code> on each mesh once, because the
        layout is static (L1215, L1236).
      </p>
      <p>
        three.js decides whether to draw an object by testing its bounding
        sphere against the camera frustum. For an InstancedMesh in three.js
        0.185.1 (<code>package.json</code> pins it), the test reads the
        mesh&rsquo;s own <code>boundingSphere</code>, and{' '}
        <code>computeBoundingSphere()</code> builds that sphere from every
        instance matrix, so it wraps the chunk&rsquo;s trees and not one
        tree&rsquo;s geometry (<code>Frustum.js</code> L148-152,{' '}
        <code>InstancedMesh.js</code> L151-174). three.js will build it lazily
        if it is missing. The engine builds it up front, once, because the
        layout never changes. A chunk behind you is then skipped with no new
        per-frame code.
      </p>
      <p>
        The test is coarse. A 60-unit cell has a diagonal of about 85 units,
        so the sphere around a chunk reaches past the chunk itself, and a chunk
        grazing the edge of the view draws all of its trees.
      </p>

      <h2>Then we stopped building most of it</h2>
      <p>
        Culling skips the draw, but the meshes and their GPU buffers still
        exist. A second ticket, LUL-2249, streams them. Only chunks within{' '}
        <code>STREAM_RADIUS_CHUNKS</code> = 2 of the player&rsquo;s own chunk
        are built: a 5 by 5 square, 300 by 300 units (L1253). A chunk is
        disposed only once it is more than <code>STREAM_UNLOAD_CHEBYSHEV</code>{' '}
        = 3 chunks away, so a player stepping back and forth across a boundary
        does not rebuild it every time (L1254, L1291).
      </p>
      <p>
        The check is called once per frame but returns at once unless the
        player has changed chunk (<code>updateStreamedChunks</code>,
        L1273-1275, called at L8639), and building a chunk makes no{' '}
        <code>rng()</code> call, so the map is identical either way. The map is still 5,200 trees in
        data. The ring is 25 chunks, but the unload band keeps the chunks you just
        left, so a walking player can have up to 36 of the 64 as meshes: six
        per axis, two ahead and three behind (L1286-1291). We derived 36 from
        that rule and then measured it.
      </p>

      <h2>The numbers, and the number we do not have</h2>
      <p>
        We measured the live game on 2026-11-09: headless Chrome at 1280 by
        720 on a desktop GPU, our pinned QA seed (<code>20260718</code>), at
        five positions and four headings each, reading{' '}
        <code>qaProbePerf()</code> and <code>qaProbeTreeChunks()</code>.
      </p>
      <ul>
        <li>
          At spawn, 25 chunks are live: 2,088 of the 5,200 trees exist as
          instances. At the corner (&minus;220, &minus;220) the ring is clamped by the
          map edge to 9 chunks and 760 trees.
        </li>
        <li>
          Across all 20 views, one whole frame (every tree, cover prop,
          predator and effect) cost between 35 and 190 draw calls and between
          11,640 and 82,740 triangles.
        </li>
        <li>
          The same position changes with the heading. From (0, 200) the frame
          was 75,928 triangles facing one way and 19,582 facing the other.
          That is consistent with the frustum test, though the heading also
          changes which cover props and predators are in view.
        </li>
        <li>
          Walking changes the chunk count. We stepped the player one chunk at
          a time, teleporting to each chunk centre because the unload rule
          reads only the chunk index, along a staircase path across the map.
          Live chunks climbed to 35, and a path that doubled back across a
          boundary reached 36 chunks and 2,983 trees. The heaviest whole frame
          in those walks was 101,996 triangles and 219 draw calls.
        </li>
      </ul>
      <p>
        For the old pool, the figure is arithmetic, not a measurement. A tree
        is 24 + 14 + 14 = 52 triangles, from the three geometries as
        three.js 0.185.1 builds them, and 52 times 5,200 is 270,400 triangles
        in three draw calls, every frame, before a single predator. The
        heaviest whole frame we measured is under a third of that.
      </p>
      <p>
        There is no recorded before. When the chunking commit landed on
        September 7, 2026, its own message reported the same reading before and
        after, 1 call and 2 triangles, and explained why:{' '}
        <code>renderer.info.render</code> holds only the last render call of a
        frame, and ours ends on the full-screen post-processing blit. The probe
        was measuring a quad. LUL-2257 fixed the probe on September 9, after
        which the last ticket of the streaming epic, LUL-2250, recorded the
        first real numbers (143 draw calls and 70,294 triangles at spawn on
        desktop, <code>docs/specs/lul-2245-baseline-perf.md</code>). Ours are
        in the same range. That file holds no run of the single-pool version
        through the fixed probe, so the 270,400 stays arithmetic.
      </p>

      <h2>What it costs</h2>
      <p>
        Chunking trades triangles for draw calls. Each live chunk is three
        meshes, so a full ring can submit 75 tree draw calls at spawn and up to
        108 (36 chunks times 3) while walking, where the old pool submitted 3, and three.js culls per object, which is why the
        chunks exist at all. We do not know where the frame-time break-even
        sits on a low-end phone, and we ran no benchmark of the old and new
        versions against each other, so this post makes no speed claim.
      </p>
      <p>
        The ring is also wide. Its edge is at least 120 units from the player,
        while a source comment puts the fog&rsquo;s own limit at about 40 to
        60 units (L1159-1160). By that comment, most of what the ring builds is fogged
        out. We have not tested a smaller radius, and nothing here says 2 is
        the right one.
      </p>

      <h2>Where to go next</h2>
      <p>
        The other half of the fog story is in{' '}
        <Link href="/devlog/the-fog-is-the-wolfs-eyesight">the fog tide</Link>,
        and the sight test that never touches a scene mesh is in{' '}
        <Link href="/devlog/can-the-wolf-see-you">how a wolf sees you</Link>.{' '}
        <Link href="/">Play Lullwood free in the browser</Link> and judge the
        forest from inside it.
      </p>
    </>
  );
}
