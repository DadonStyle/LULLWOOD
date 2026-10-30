import Link from "next/link";

export default function TheReturnTrip() {
  return (
    <>
      <aside
        style={{
          borderLeft: "3px solid #4a5f82",
          background: "#0f1621",
          padding: "14px 18px",
          marginBottom: 28,
          borderRadius: "0 4px 4px 0",
        }}
      >
        <p
          style={{
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#6a8cb0",
            marginBottom: 6,
          }}
        >
          <time dateTime="2026-10-26">Superseded, October 26, 2026</time>
        </p>
        <p style={{ fontSize: 14, color: "#9fb2cd", marginBottom: 0 }}>
          This post describes the carry-home win condition as it ran from
          August 15 to September 9, 2026. LUL-2281 cut the return leg — lifting the child is
          the win now, on the spot, with no trip back to survive. Current
          rules:{" "}
          <Link
            href="/how-to-survive"
            style={{ color: "#8fb0d6", textDecoration: "underline" }}
          >
            how to survive Lullwood
          </Link>
          .
        </p>
      </aside>
      <p>
        <strong>Today:</strong> reach the child, press E to lift her, and the
        run is won. There is no return leg. The rest of this post is the
        history of the version that had one.
      </p>
      <p>
        <Link href="/">Lullwood</Link> shipped with a simple win condition: find the glowing child
        and get close enough to pick her up. That was the whole run. We
        called it done, called it a prototype, and started thinking about
        predators.
      </p>
      <p>
        That ending had a cost: the moment you reached her, the run was over,
        and nothing came after it. The return trip, ticket LUL-38, merged on
        August 15, 2026 and made the pickup the midpoint instead.
      </p>
      <p>
        The idea was that the child isn&rsquo;t only a destination — she is a
        load-bearing story beat. The moment you had her in your arms, the emotional register flipped. You were no longer the one lost in the dark. She was. And someone carrying a frightened
        child does not walk quietly; they are easier to see and they make
        noise.
      </p>

      <h2>What changed</h2>
      <p>
        In that win condition, pickup was the midpoint, not the end. Collecting the child did not end the run: predators could still take you on the way back to the spawn point, where home was. You had to make it back.
      </p>
      <p>
        The design change was everything. A horror game that ends the moment
        you find the thing you were looking for has no second act.
      </p>

      <h2>What carrying cost the player</h2>
      <p>
        The cost was built into numbers the predators already used. While
        you carried the child, a predator&rsquo;s detect range was multiplied
        by 1.35. A carried child also cried on a two-second timer, and a
        roaming predator within 5.6 units of you heard each pulse (a hidden carrier with live sniff immunity was exempt). Walking
        pace was scaled down while you carried her.
      </p>

      <h2>What it was meant to teach</h2>
      <p>
        The lesson the game is trying to teach — that stillness is the
        survival verb, not speed — became legible only once there was
        something on the line for the return trip. The original win condition did not have that. This one did, until LUL-2281 cut it on September 9, 2026, 25 days after it merged.
      </p>
    </>
  );
}
