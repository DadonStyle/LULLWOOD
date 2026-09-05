export default function TheReturnTrip() {
  return (
    <>
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
        problem — she was a load-bearing story beat. The moment you have her
        in your arms, the emotional register flips. You are no longer the
        one lost in the dark. She is. And someone carrying a frightened
        child does not walk quietly; they move fast, they breathe harder,
        they make noise.
      </p>

      <h2>What changed</h2>
      <p>
        In the new win condition, pickup is the midpoint, not the end.
        Collecting the child arms the death guard: predators can now take
        you before you reach the treeline, and they will, because you are
        louder when you carry her. You have to make it back.
      </p>
      <p>
        The code change was three lines in <code>forest-engine.js</code>.
        The design change was everything. A horror game that ends the moment
        you find the thing you were looking for has no second act. The
        forest knows you have her. So does the bear.
      </p>

      <h2>The implementation detail worth noting</h2>
      <p>
        The original design had predators pause their hunt the moment you
        touched the child — the idea being that they &ldquo;see&rdquo; you
        pick her up and circle. We cut it immediately. Predators that
        theatrically stop on a story beat are predators that break
        immersion. What ships instead is simpler and scarier: they never
        knew you were carrying her. They just keep hunting. It is your
        problem to solve.
      </p>
      <p>
        The scent model does not distinguish carried weight. The sound
        model does — running with the child raises your noise signature by a
        factor the wolves can detect at forty units. You find that out on
        your own, usually on the return trip, usually once.
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
        something on the line for the return trip. The original win condition
        did not have that. This one does.
      </p>
    </>
  );
}
