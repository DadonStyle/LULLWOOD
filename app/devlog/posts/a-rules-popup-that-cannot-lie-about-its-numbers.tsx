import Link from "next/link";

const FUNCTION_SOURCE = [
  "export function rescuerRules(recordTimeMs: number | null): string[] {",
  "  const floorSeconds = (PLAUSIBILITY_FLOOR_MS / 1000).toFixed(1);",
  "  return [",
  "    'Play on Blackout difficulty (the default).',",
  "    // ...admin mode, win the run, the record to beat...",
  "    `The run has to take at least ${floorSeconds} seconds and under an hour. Faster runs are rejected as impossible.`,",
  "    // ...the timer, the nickname...",
  "    `Wait ${COOLDOWN_MS / 1000} seconds between submissions, and at most ${IP_LIMIT} per hour.`,",
  "  ];",
  "}",
].join("\n");

export default function ARulesPopupThatCannotLieAboutItsNumbers() {
  return (
    <>
      <p>
        Lullwood&rsquo;s &ldquo;Be the rescuer&rdquo; popup lists what a run
        has to meet to take first place on the leaderboard. Three of its numbers
        are read, not typed: they come from the constants the leaderboard
        server enforces, so those numbers cannot drift from the check. The
        sentences around them are hand-typed, and this post is about where
        that line falls.
      </p>
      <p>
        We build <Link href="/">Lullwood</Link>, a free browser horror game, in
        three.js and Next.js. This post reads one small function from our
        source at commit <code>0698b3f</code>, the head of our release branch
        when we wrote it, and says what it protects against and what it does
        not. Line numbers are for that commit.
      </p>

      <h2>The function</h2>
      <p>
        <code>rescuerRules</code> is in <code>lib/game/rescuerRules.ts</code>{" "}
        (L14-28). It returns eight strings, in the order a player meets the
        rules. The popup in <code>components/GameMenu.tsx</code> maps them
        straight into a list (L138). Here it is, with five of the eight strings
        replaced by comments. The three left in are the first rule, for
        orientation, and the two that read a constant.
      </p>
      <pre
        style={{
          overflowX: "auto",
          background: "#111827",
          color: "#94adc7",
          padding: "12px 14px",
          borderRadius: 4,
          fontSize: 13,
          lineHeight: 1.5,
          marginBottom: 20,
        }}
      >
        <code style={{ background: "none", padding: 0 }}>{FUNCTION_SOURCE}</code>
      </pre>
      <p>
        The fourth rule also carries a value: the current top rescuer&rsquo;s
        time, passed in as <code>recordTimeMs</code> and formatted, or a
        sentence saying no one holds the record yet. So three of the eight
        strings contain something computed, and the other five are plain text.
        The doc comment above the function states the intent: the list is built
        from the same constants the client gate and the server enforce, so the
        popup can&rsquo;t drift from what is actually checked.
      </p>

      <h2>Where each number is enforced</h2>
      <p>
        The constants live in <code>lib/game/leaderboard.ts</code>, a file with
        no database and no Node-only imports, so the client, the Next route, the win-screen form and the leaderboard service on our
        own server all import it.
      </p>
      <ul>
        <li>
          <code>PLAUSIBILITY_FLOOR_MS</code> (L30) is a formula, not a literal:
          the half-diagonal of the map divided by the fastest possible speed,
          halved as a margin. It rounds to about 15.7 seconds, which is the
          number the popup prints. <code>validateTimeMs</code> (L83-87) rejects
          anything under it, and the submit route calls that function (
          <code>app/api/leaderboard/route.ts</code> L45). The win-screen form
          also checks the same constant and renders nothing for a run under
          the floor (<code>components/Leaderboard.tsx</code> L127).
        </li>
        <li>
          <code>COOLDOWN_MS</code> (L17, 10,000) and <code>IP_LIMIT</code>{" "}
          (L18, 5) are checked in the leaderboard service, in{" "}
          <code>services/leaderboard-db/db.ts</code> (L307-308), which refuses
          a submission with <code>cooldown</code> or <code>ip-limit</code>. The
          Next route maps a 429 from that service to a rate-limited answer (
          <code>route.ts</code> L74-77).
        </li>
      </ul>
      <p>
        One correction to the doc comment, from reading the callers: only the
        floor is checked on both sides. Outside the popup, the cooldown and the
        limit are imported by the service and by nothing in the client.
      </p>

      <h2>What a test pins, and what it does not</h2>
      <p>
        <code>lib/game/rescuerRules.test.ts</code> has three tests, and we ran
        them: three pass. The one that matters here is named &ldquo;numbers
        come from the enforced constants&rdquo; (L13). It does not assert
        &ldquo;10 seconds&rdquo;. It builds the expected text from the
        constants (<code>{"`${COOLDOWN_MS / 1000} seconds between submissions`"}</code>)
        and looks for it in the popup text. Tune the constant and the test
        follows it.
      </p>
      <p>
        We checked that in a local working copy, reverted and never committed. Changing{" "}
        <code>COOLDOWN_MS</code> from 10,000 to 30,000 made the popup say
        &ldquo;Wait 30 seconds between submissions&rdquo; with no edit to the
        popup, and all three tests still passed. That is the behaviour the
        function exists for.
      </p>
      <p>
        The browser test, <code>e2e/rescuer-rules.spec.ts</code>, opens the
        popup with a mocked record of 125,000 ms and checks it names Blackout,
        admin mode and a time to beat of 2:05. It does not assert any of the
        three constant-driven numbers. The unit test is the only thing that
        does.
      </p>

      <h2>What it does not cover</h2>
      <p>
        Three claims are the same kind of thing as the numbers, and they are
        typed by hand. The popup says a run must take{" "}
        <em>under an hour</em>, and the ceiling is a separate constant,{" "}
        <code>PLAUSIBILITY_CEILING_MS</code> (L31). It says{" "}
        <em>per hour</em> next to the limit of five, and the window is{" "}
        <code>IP_WINDOW_MS</code> (L19). It says a nickname is{" "}
        <em>3-20 letters, a-z only</em>, and the rule the form and the server
        use is <code>NICKNAME_PATTERN</code>, <code>/^[a-z]{"{3,20}"}$/</code>{" "}
        (L13).
      </p>
      <p>
        We measured the middle one. Setting <code>IP_WINDOW_MS</code> to two
        hours in the same working copy left the popup saying &ldquo;at most 5
        per hour&rdquo;, and the three tests passed. The popup would have lied, and
        nothing caught it. The nickname line is only partly covered: the first
        test looks for the string <code>3-20 letters</code> in the popup, which
        proves the words are there and not that they match the pattern.
      </p>
      <p>
        The prose rules have the same exposure, and we have already paid for
        it. Commit <code>9299ad5</code> (October 18, 2026) changed one line of
        the popup and one test needle. The line was{" "}
        <em>&ldquo;Win the run: find the lost child and carry them home.&rdquo;</em>{" "}
        and became <em>&ldquo;Win the run: reach the lost child and lift them.
        There is no trip home after that.&rdquo;</em> The commit message says
        why: the win had been lifting the child since the carry-home leg was
        removed, and the popup still told players to carry them home. The
        history of that mechanic is in{" "}
        <Link href="/devlog/the-return-trip">the return trip</Link>. No constant
        could have prevented that edit, because there is no constant for a
        sentence. What holds it now is a test needle, <code>lift them</code>,
        that was changed in the same commit.
      </p>
      <p>
        A comment drifted too. The header of <code>rescuerRules.ts</code> says
        the popup content is for <code>components/Hud.tsx</code>. The only
        component that imports the function is <code>components/GameMenu.tsx</code>.
        No test reads comments.
      </p>

      <h2>What to take from it</h2>
      <ul>
        <li>
          Import the number, never copy it. A displayed value that is read from
          the enforcing constant cannot be wrong in the way a typed one can.
        </li>
        <li>
          Assert against the constant, not a literal. The test is a divergence
          detector: it fails if the popup and the constant stop agreeing. It
          would not fail if someone typed &ldquo;10&rdquo; and the constant
          happened to be 10, so the structure is the import and the test is the
          backstop.
        </li>
        <li>
          Count what is still hand-typed. Here, five of the eight strings
          contain no computed value, and three phrases (two inside the
          computed lines, one in a plain one) restate a rule that has its own
          constant or pattern. That is the remaining surface, and it is a
          short list.
        </li>
      </ul>
      <p>
        If you want to see the popup, <Link href="/">play Lullwood free in the
        browser</Link> and open the &ldquo;Be the rescuer&rdquo; button in the
        top-left menu row. The game-side view of the same rules is{" "}
        <Link href="/guides/how-to-win">how to win Lullwood</Link>, where the
        win is lifting the child and the leaderboard counts only Blackout wins.
      </p>
    </>
  );
}
