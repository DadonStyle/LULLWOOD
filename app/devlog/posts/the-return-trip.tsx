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
          This post describes the carry-home win condition as it shipped in
          September 2026. LUL-2281 cut the return leg — lifting the child is
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
        Lullwood shipped with a simple win condition: find the glowing child
        and get close enough to pick her up. That was the whole run. We
        called it done, called it a prototype, and started thinking about
        predators.
      </p>
      <p>
        Then someone played it and said: <em>&ldquo;Once I found her it felt
        over. I just walked back.&rdquo;</em>
      </p>
      <p>
        That sentence broke the loop. The child wasn&rsquo;t a destination
        problem — she was a load-bearing story beat. The moment you had her in your arms, the emotional register flipped. You were no longer the one lost in the dark. She was. And someone carrying a frightened
        child does not walk quietly; they move fast, they breathe harder,
        they make noise.
      </p>

      <h2>What changed</h2>
      <p>
        In that September win condition, pickup was the midpoint, not the end. Collecting the child armed the death guard: predators could take you before you reached the treeline, and they did, because you were louder when you carried her. You had to make it back.
      </p>
      <p>
        The code change was three lines in <code>forest-engine.js</code>.
        The design change was everything. A horror game that ends the moment
        you find the thing you were looking for has no second act. The forest knew you had her. So did the bear.
      </p>

      <h2>The implementation detail worth noting</h2>
      <p>
        The original design had predators pause their hunt the moment you
        touched the child — the idea being that they &ldquo;see&rdquo; you
        pick her up and circle. We cut it immediately. Predators that
        theatrically stop on a story beat are predators that break
        immersion. What shipped instead was simpler and scarier: they never knew you were carrying her. They just kept hunting. It was your problem to solve.
      </p>
      <p>
        The scent model did not distinguish carried weight. The sound model did — running with the child raised your noise signature by a factor the wolves could detect at forty units. You found that out on your own, usually on the return trip, usually once.
      </p>

      <h2>Why it felt right</h2>
      <p>
        The strongest moment in the playtest after this shipped: a player
        who had been cautious all run — slow, methodical, hiding every thirty
        seconds — picked up the child and immediately started sprinting for
        the treeline. They had the instinct right. The execution was wrong.
        A bear caught them twelve units out.
      </p>
      <p>
        The lesson the game is trying to teach — that stillness is the
        survival verb, not speed — became legible only once there was
        something on the line for the return trip. The original win condition did not have that. This one did.
      </p>
    </>
  );
}
