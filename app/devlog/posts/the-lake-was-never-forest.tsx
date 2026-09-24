export default function TheLakeWasNeverForest() {
  return (
    <>
      <p>
        Lullwood shipped with a lake and a bog. Neither belonged. The
        founder said it plainly: this is a forest with something
        supernatural in it, and a forest does not need a sea, a pond, a
        lake, or a bog. So we cut them, along with the one mission built on
        top of the lake, and replaced that mission rather than leaving an
        empty slot.
      </p>
      <p>
        The removal took five staged pull requests, in a deliberate order,
        so the game stayed playable after every single one.
      </p>

      <h2>The lake was already broken, not just unwanted</h2>
      <p>
        Before we cut it, a design review turned up something nobody had
        noticed: the lake&rsquo;s speed penalty only applied to the player.
        Predators waded through it at full speed. That is not a tradeoff
        anyone designed on purpose — it is the kind of asymmetry that
        creeps in when a mechanic is built once and never revisited. Deleting
        the lake did not just simplify the map. It closed a bug that had
        been quietly making the water more dangerous to hide near than it
        should have been.
      </p>
      <p>
        The bog was never really scenery either. Its own code called it
        &ldquo;shallow water at half walk speed&rdquo; and it fed into
        predator pathing costs, not just a visual biome. Removing it meant
        touching movement and pack behavior, not deleting a prop.
      </p>

      <h2>A mission, not a mission slot</h2>
      <p>
        The lake carried the game&rsquo;s only detour objective — reach the
        deep water, on a timer, for a bonus payout. Our first instinct was
        to delete the mission along with the water it lived in. The founder
        overruled that: replace it with something forest-native, don&rsquo;t
        just leave the slot empty.
      </p>
      <p>
        So the mission plumbing survived — the HUD pill, the anti-farming
        seeded draw, the reward structure — and only the target changed.
        The detour now points at the fire tower instead of the lake. Same
        system, same rules, different place to run to. That is a smaller
        change in code than a full mission redesign, and it is why the
        engineering work here was mostly deletion: the one part that
        wasn&rsquo;t deletion was swapping a coordinate and a name.
      </p>

      <h2>Docs rot the same way code does</h2>
      <p>
        The last stage of this cut was not code at all. It was finding what
        the removal left behind: a cue-audit table still citing a
        `lakeLight` symbol that no longer existed, a project README still
        listing the lake and the bog as example modules in a directory that
        had quietly stopped containing them. None of it broke a build.
        All of it would have sent the next person reading those files
        looking for something that was gone.
      </p>
      <p>
        A scope cut is not finished when the last line of game code is
        deleted. It is finished when nothing left in the repository still
        describes the thing you removed as if it were still there.
      </p>
    </>
  );
}
