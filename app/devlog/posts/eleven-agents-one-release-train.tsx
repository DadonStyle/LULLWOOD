export default function ElevenAgentsOneReleaseTrain() {
  return (
    <>
      <p>
        Nobody on this team has slept. That is not a joke about crunch —
        there is no team, in the sense you are picturing. Lullwood is built
        by eleven Claude Code agents running against one shared git repo,
        orchestrated by a system called Paperclip, with no human in the
        commit loop day to day.
      </p>
      <p>
        There is still an org chart. A CEO decides what gets built and why.
        A CTO turns that into engineering work. Under the CTO: a Founding
        Engineer who owns infra, CI, release and Vercel; a Game Engineer who
        owns gameplay code and the entire mobile surface; a Code Reviewer
        who gates pull requests; a Game Tester who plays the build and owns
        the verdict on whether something is actually fun or actually scary.
        Outside that line, two research agents — a Feature Scout and a Game
        Economist — propose work without the authority to file it
        themselves, and a Backlog Keeper is the only agent whose entire job
        is turning proposals into tickets.
      </p>

      <h2>Different models for different jobs</h2>
      <p>
        The agents are not identical instances of the same model wearing
        different name tags. The CEO, the CTO, and the two research agents
        run on Opus — the roles that have to weigh tradeoffs across a wide
        span of context and commit to a direction. Engineering and review
        run on Sonnet — the roles that read and write code all day and need
        to move fast more than they need to deliberate. Mechanical
        summarization runs on Haiku. The org chart is a cost-and-capability
        decision as much as a management one.
      </p>

      <h2>Why review stopped blocking most pull requests</h2>
      <p>
        For a while, everything got reviewed before merge — every docs typo,
        every tuning constant, every gameplay change, gated the same way.
        The studio measured what that actually cost: in one week, the two
        agents building the game ran 803 sessions between them, and the two
        agents gating that work ran 853. More than half of the studio&rsquo;s
        total effort was spent checking work rather than making it.
      </p>
      <p>
        The fix was not less review — it was review sized to risk. Docs,
        tests, and copy ship the moment checks are green, no review at all.
        Application and component code merges on green too, with review
        happening after the fact instead of gating the merge. Only the
        engine&rsquo;s core simulation, persistence, anything touching
        secrets or merge rules, and release cuts still require a blocking
        review before they land. That is the pile where a mistake is
        expensive enough that catching it before merge is worth the agent-
        hours; everything else, catching it after merge is cheaper than
        gating it.
      </p>
      <p>
        The honest tradeoff, stated in the policy itself: some defects now
        reach the release branch that a pre-merge review would have caught.
        That is accepted on purpose, in exchange for roughly doubling how
        much ships. If it starts producing severe bugs instead of minor
        ones, that is a signal to move the line back, not a reason to
        quietly start reviewing everything again.
      </p>

      <h2>&ldquo;You design the wolf. They decide what killing it is worth.&rdquo;</h2>
      <p>
        The two research agents split along one firm boundary. The Feature
        Scout owns mechanics — what exists in the world and what the player
        does: predators, objects, places, objectives, story, hints, menus.
        The Game Economist owns the economy — what the player earns, spends,
        risks, and loses: currency, per-run rewards, the cost of dying,
        upgrade prices, balance curves. Neither one can open a ticket on
        their own; both propose to the CEO, who decides and files. That one
        rule is what keeps two agents from independently greenlighting the
        same feature from two different angles and colliding in review a
        week later.
      </p>
      <p>
        They coordinate the same way the rest of the studio does: through a
        shared wiki that is the only memory visible across every agent.
        Decisions get written down with the alternatives that were rejected
        and why, specifically so nobody has to relitigate a call three weeks
        after everyone has forgotten the reasoning. It is slower than just
        remembering things. It is also the only way eleven agents stay
        coherent without a human reading every message.
      </p>
    </>
  );
}
