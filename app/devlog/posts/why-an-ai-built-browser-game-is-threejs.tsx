import Link from "next/link";

export default function WhyAnAiBuiltBrowserGameIsThreejs() {
  return (
    <>
      <p>
        Lullwood, our free browser horror game, is built in three.js because
        the agents that build it work on text. Almost everything the game is
        sits in source files an agent can open, search and diff, and the one
        3D model it loads is 226 KB. We never built Lullwood in another
        engine, so this is a reason, not a comparison.
      </p>
      <p>
        On 2026-11-04 a{" "}
        <a href="https://bsky.app/profile/axylusion.bsky.social/post/3mzhwmexdb72r">
          Bluesky post by Axy Lusion
        </a>{" "}
        linked an X post by Lucca Cerf about giving Three.js, Godot, Unity
        and Unreal almost the same prompt, one engine after another, over
        four days. The Bluesky post sums it up: &ldquo;Three.js and Unity won
        because agents can read the files as text. Unreal&rsquo;s binary
        assets shut them out.&rdquo; That is their experiment and their
        conclusion. We have not reproduced it, and we read only those two
        short posts, not the full thread. What we can do is count how much of
        our own project an agent can read as text.
      </p>

      <h2>What the repository holds</h2>
      <p>
        We ran <code>git diff --numstat</code> from the empty tree to{" "}
        <code>origin/release/next</code> at commit <code>0698b3f</code> on
        2026-11-12. For a file git treats as binary it prints a dash instead
        of line counts, so it sorts the repository without our opinion in it.
      </p>
      <ul>
        <li>
          <strong>793 tracked files: 746 text, 47 binary.</strong>
        </li>
        <li>
          <strong>The 47 binary files:</strong> 42 PNG, 2 WebM, 1 MP4, 1 ICO
          and 1 GLB. Thirty of the PNGs are country flags (56,449 bytes in
          all). Nine more are home-page screenshots, press images and a
          controls diagram. The other eight are two social-card images, the
          apple touch icon, two QA recordings, the favicon,{" "}
          <code>death.mp4</code> (60,635 bytes) and the GLB.
        </li>
        <li>
          <strong>One model:</strong>{" "}
          <code>public/models/letter-balloons.glb</code>, 226,360 bytes. We
          searched for <code>.glb</code>, <code>.gltf</code>,{" "}
          <code>.fbx</code>, <code>.blend</code>, <code>.psd</code>,{" "}
          <code>.unity</code> and <code>.uasset</code> files, and that is the
          only hit. There are no scene files or project files of any kind.
        </li>
        <li>
          <strong>The checks are text too:</strong> 177 Playwright spec files
          in <code>e2e/</code> and 87 unit-test files.
        </li>
      </ul>
      <p>
        By bytes the picture flips: 29,947,013 binary against 7,556,412
        text, because nine marketing PNGs in <code>public/</code> weigh
        25,699,407 bytes between them. The game does not request those, as{" "}
        <Link href="/devlog/a-night-forest-with-one-model-file">
          our post on what the game ships
        </Link>{" "}
        found. So we are claiming a narrow thing: the
        game&rsquo;s behaviour, its tuning, its sound and its tests are text.
        The repository also holds a lot of pictures, and we are not hiding
        them.
      </p>

      <h2>The one file an agent cannot read</h2>
      <p>
        A <code>.glb</code> is a 12-byte header, then chunks. This one has a
        20,116-byte JSON chunk and a 206,216-byte binary chunk. The JSON is
        readable: we read it with a short script and found 26 meshes, 26
        nodes, 78 accessors and one material. The binary chunk is vertex
        data, and a diff of it is not something a reviewer can read.
      </p>
      <p>
        The code is built so the game does not depend on it.{" "}
        <code>engine/forest-engine.js</code> loads the file with{" "}
        <code>GLTFLoader</code> at L566, and the error callback ends in a
        comment, <code>keep the canvas fallback</code>, so if the model fails
        to load the leaderboard name is drawn on a canvas instead. The model
        is third-party, credited on the{" "}
        <Link href="/credits">Lullwood credits page</Link>.
      </p>

      <h2>What reading it as text did, once</h2>
      <p>
        On 2026-10-11 we changed the default difficulty from Night to
        Blackout. That is PR #1066, squashed as commit <code>10a1851</code>:
        10 files, 35 insertions, 15 deletions. The behaviour change is three
        one-line edits to a string literal,{" "}
        <code>&apos;night&apos;</code> to <code>&apos;blackout&apos;</code>:
        the engine&rsquo;s <code>let difficulty</code>, the engine&rsquo;s{" "}
        <code>hudState</code> object, and <code>INITIAL_HUD_STATE</code> in{" "}
        <code>components/Hud.tsx</code>. The rest is labels, comments and
        test assertions that assumed the old default.
      </p>
      <p>
        The author changed two of the three. The Code Reviewer agent returned
        CHANGES REQUESTED naming the third, the <code>hudState</code> literal
        at line 4670 of that commit, and the commit message records the effect: a
        first-time player&rsquo;s shop would have shown Night pricing (120
        embers) while charging Blackout pricing (140). We did not re-run that
        bug, so that figure is the commit message&rsquo;s. It was fixed with
        one line. A default that lives as a literal in three places is
        something a search finds and a diff shows, and that is the whole
        mechanism we can point to.
      </p>

      <h2>What this does not show</h2>
      <ul>
        <li>
          <strong>No comparison.</strong> We built Lullwood once, in three.js
          and Next.js. We have no timing, no pass rate and no cost figure for
          any other engine, and we did not try an engine editor, so we cannot
          say what we gave up.
        </li>
        <li>
          <strong>Readable is not tidy.</strong> The game engine we wrote on
          top of three.js is a single file,{" "}
          <code>engine/forest-engine.js</code>, 9,691 lines and 595,103 bytes.
          Our devlog posts cite it by line number.
        </li>
        <li>
          <strong>Text is not correctness.</strong> The review above caught a
          miss; it also shows the miss happened.
        </li>
        <li>
          <strong>Other people&rsquo;s games.</strong> Simon Willison&rsquo;s{" "}
          <a href="https://simonwillison.net/2026/Oct/28/vibe-game-development/">
            October 28 write-up
          </a>{" "}
          says all four games he describes are HTML and JavaScript running in
          the browser. He writes that he vibe coded them without looking at
          the code at all. In Lullwood another agent reads the code.
        </li>
      </ul>

      <h2>Where to go next</h2>
      <p>
        The byte-level count of what the game loads is in{" "}
        <Link href="/devlog/a-night-forest-with-one-model-file">
          a night forest with one model file
        </Link>
        , and who does what between the founder and the agents is in{" "}
        <Link href="/devlog/who-makes-lullwood">who makes Lullwood</Link>.{" "}
        <Link href="/">Play Lullwood free in the browser</Link> and judge
        the result from inside the forest.
      </p>
    </>
  );
}
