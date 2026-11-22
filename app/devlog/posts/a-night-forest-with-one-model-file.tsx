import Link from "next/link";

export default function ANightForestWithOneModelFile() {
  return (
    <>
      <p>
        Lullwood ships one 3D model file, a 226 KB <code>.glb</code> that
        spells the leaderboard record-holder&rsquo;s name in the sky. The
        forest, the wolves, bears and lions, the sky and every sound are built
        in code. Measured in a browser, a cold first load of the game fetched
        676 KB, and that one model was 153 KB of it.
      </p>
      <p>
        We build Lullwood, a free browser horror game, in three.js and Next.js.
        This post counts what the repository ships, what a browser downloads,
        and what each claim rests on. Code references are to our release
        branch at commit <code>b03da13</code>, with line numbers for that
        commit. Byte counts are bytes; &ldquo;KB&rdquo; here means 1,000
        bytes.
      </p>

      <h2>What the repository ships</h2>
      <ul>
        <li>
          <strong>Models: one.</strong>{" "}
          <code>public/models/letter-balloons.glb</code> is 226,360 bytes. It
          holds 26 meshes (the letters A to Z), 8,224 vertices, 12,435
          triangles, and no textures. It is a third-party model under CC BY
          4.0, trimmed by us and credited on the{" "}
          <Link href="/credits">Lullwood credits page</Link>.
        </li>
        <li>
          <strong>Audio files: none.</strong> <code>git ls-files</code> lists
          no <code>.mp3</code>, <code>.ogg</code>, <code>.wav</code>,{" "}
          <code>.m4a</code>, <code>.aac</code>, <code>.opus</code> or{" "}
          <code>.flac</code>.
        </li>
        <li>
          <strong>Texture loaders: none.</strong> A search of the engine,
          library, component and app code finds no <code>TextureLoader</code>.
          The one image-file use is 30 country-flag PNGs (56,449 bytes in
          all), fetched one per country on first use and drawn onto the
          balloon&rsquo;s canvas (<code>forest-engine.js</code> L585-594).
        </li>
        <li>
          <strong>Video: one.</strong> <code>public/death.mp4</code> is 60,635
          bytes, in the page as a <code>preload=&quot;auto&quot;</code>{" "}
          element (<code>components/GameCanvas.tsx</code> L1088).
        </li>
        <li>
          <strong>Code:</strong> the engine is{" "}
          <code>engine/forest-engine.js</code> at 595,103 bytes plus{" "}
          <code>engine/tuning.js</code> at 30,599.
        </li>
      </ul>
      <p>
        &ldquo;Ships&rdquo; is slippery here. <code>public/</code> holds 46
        files and 26,055,552 bytes in git, and nine marketing PNGs (press
        images, screenshots and one controls diagram) make up 25,699,407 of
        them. The game never requests those. What matters for a player is the
        next section.
      </p>

      <h2>How we measured</h2>
      <ul>
        <li>
          <strong>Repository counts:</strong> <code>git ls-files</code>,{" "}
          <code>git grep</code> and <code>git show</code> against{" "}
          <code>origin/release/next</code> at <code>b03da13</code>, run on
          2026-11-02. The live site builds from <code>main</code> (
          <code>572d8cf</code> that day).{" "}
          <code>
            git diff --stat main release/next -- engine lib components public
            app/page.tsx app/layout.tsx package.json
          </code>{" "}
          printed nothing, so the game code is identical.
        </li>
        <li>
          <strong>First load:</strong> Chrome for Testing 151 driven by
          Playwright, empty cache, a 1280 by 720 desktop window, on{" "}
          <code>https://www.lullwoodgame.com/</code>. We summed{" "}
          <code>encodedDataLength</code> from the DevTools Network domain
          (bytes on the wire after compression, response headers included).
          The window runs from navigation until 16 seconds after the click
          that starts play, with a W key held for 12 of them. Nothing more
          downloaded after the click.
        </li>
        <li>
          <strong>Repeats:</strong> three runs, 675,829, 675,844 and 675,856
          bytes. We quote the first. It is one browser on one network on one
          day, and it is not a mobile measurement.
        </li>
      </ul>

      <h2>The first load of the game, labelled</h2>
      <p>
        Lullwood has no separate game page: the game and a short text page
        about it share <code>/</code>. That makes it easy to quote the wrong
        number. Fetching the home page with curl and adding the script and
        style files its HTML names gives about 201 KB (9,332 bytes of
        document and 191,751 of files). That is the page. The engine, the
        model and the video load afterwards, so the figure for the game is the
        browser one.
      </p>
      <p>
        <strong>Game route, cold, browser: 675,829 bytes in 23 requests.</strong>
      </p>
      <ul>
        <li>Engine and three.js, one script: 215,807 (795,397 decoded)</li>
        <li>React, Next.js and interface scripts, ten files: 206,697</li>
        <li>
          The model, <code>letter-balloons.glb</code>: 153,478 (22.7% of the
          load)
        </li>
        <li>
          <code>death.mp4</code>: 61,320
        </li>
        <li>
          Document, stylesheet, icons and one resized screenshot in the page
          below the game: 23,596
        </li>
        <li>
          Cloudflare analytics beacon and its report call, both from a third party: 10,955
        </li>
        <li>One flag PNG: 2,780</li>
        <li>Leaderboard and telemetry calls: 1,196</li>
      </ul>
      <p>
        The game itself (engine, model, video, one flag and two API calls) is
        434,581 bytes, 64% of the load. The model and the video are the only
        parts of it that are not code, and together they are 214,798 bytes,
        32%.
      </p>
      <p>
        The awkward part is the model. The glTF loader runs during engine
        setup (<code>forest-engine.js</code> L566, inside <code>init</code>),
        so every player downloads 153 KB of letters before anyone has looked
        at a leaderboard. If the load fails, the game draws the nickname on a
        canvas instead (L575). We did not weigh whether that trade is right,
        and we are not claiming it is.
      </p>

      <h2>The forest is code</h2>
      <p>
        A tree is three shapes. <code>trunkGeo</code> is a six-sided{" "}
        <code>CylinderGeometry</code> (L712) and two <code>ConeGeometry</code>{" "}
        canopies stack above it (L713-714). Each map chunk builds one{" "}
        <code>InstancedMesh</code> for each shape (<code>ensureChunk</code>,
        L1211-1213), so a chunk&rsquo;s trees are three instanced meshes, not a
        model per tree. The default configuration asks for
        up to 5,200 trees (<code>engine/tuning.js</code> L86).
      </p>
      <p>
        Cover is the same idea. A log is a <code>BoxGeometry</code>, a rock a{" "}
        <code>DodecahedronGeometry</code> and a bramble an{" "}
        <code>IcosahedronGeometry</code> (L760-762), one instanced mesh per kind
        per chunk (L1324). The throwable stones reuse the rock geometry
        (L781-783). In all, <code>new THREE.InstancedMesh</code> appears at
        five places in the engine: L783, L1211, L1212, L1213 and L1324.
      </p>
      <p>
        Textures are the same story. <code>CanvasTexture</code> appears five
        times (L463, L495, L520, L531, L1800). The sky backdrop is a 4 by 512
        pixel canvas painted with a three-stop gradient (L458-463), and the
        radio-mast beacon glow is a 64 by 64 radial gradient (L1793-1801).
      </p>

      <h2>The predators are spheres, cylinders and cones</h2>
      <p>
        All three species come from one function, <code>makePredator</code>{" "}
        (L2305-2367). It calls only <code>SphereGeometry</code>,{" "}
        <code>CylinderGeometry</code> and <code>ConeGeometry</code>. A chest,
        midriff and haunch are three overlapping spheres; the neck, snout, legs
        and tail are cylinders; the ears are cones or small spheres, depending on the species; the lion&rsquo;s mane
        is a ring of twelve small spheres (L2332). What makes a bear a bear is
        a handful of numbers in a spec table (height, length, width, whether
        it has ears or a mane), not a different model. Three of each species
        are built when the engine loads (L2372), nine predators in all.
      </p>
      <p>
        We checked the other direction too. The only loader import in the
        engine is <code>GLTFLoader</code> (L29), and its only call is the
        balloon letters at L566. No predator, tree or rock goes through it.
      </p>

      <h2>The sound is code, too</h2>
      <p>
        There are no audio files, so the audio is written into the Web Audio
        graph. <code>noise()</code> (L4145-4150) fills a buffer with{" "}
        <code>Math.random()</code>, and the wind, insect and rain beds are
        that buffer looped through filters (L4195-4211). The low drone is
        three sine oscillators at 55, 82.5 and 110 Hz (L4215-4217). The chase
        cue is a sawtooth cluster at 55, 77.78 and 110 Hz over a pulsing
        110 Hz sine (L4224-4226). In the engine, <code>createOscillator</code>{" "}
        appears on 53 lines and <code>createBufferSource</code> on 19.
      </p>

      <h2>What this does not show</h2>
      <p>
        We measured bytes, not time. We have no frame-rate, load-time or
        memory comparison against an asset-based game, so this post makes no
        speed claim and no claim that code-built art is better. Drawing a wolf
        from spheres costs authoring effort and looks like what it is. The
        claim is narrow: the files a player downloads for the forest, the
        animals and the sound are zero, and the one model we do ship is the
        second-largest thing in the load.
      </p>
      <p>
        To see what 676 KB buys,{" "}
        <Link href="/">play Lullwood free in the browser</Link>. For how the
        wolves behave once they are on screen, read{" "}
        <Link href="/guides/wolves">how to survive wolves in Lullwood</Link>.
      </p>
    </>
  );
}
