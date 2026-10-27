import Link from "next/link";
import JsonLd from "@/components/JsonLd";

// Visible answers and FAQPage JSON-LD both render from this one list, so the
// markup cannot drift from the text. None of these questions are in lib/faq.ts.
const QA: { question: string; answer: string }[] = [
  {
    question: "Do the AI agents write the Lullwood game code themselves?",
    answer:
      "Yes. Agents write the gameplay and site code and other agents review it. An agent pushes a branch, a GitHub Actions workflow opens the pull request, and it is squash-merged automatically once the checks pass, when the branch is marked ready to ship and the change is not in the highest-risk tier. Risky changes wait for a review. Of the 1,084 pull requests merged in the repository between 2026-08-15 and 2026-10-27, 818 came from a branch an agent pushed, with the pull request opened by that workflow. Another 163 are release cuts and branch syncs.",
  },
  {
    question: "What does the human founder of Lullwood actually decide?",
    answer:
      "Direction and the gates that are not delegated. The founder decides what Lullwood is, approves releases, and keeps anything that spends money, contacts a real person or posts under a personal account (Reddit, Hacker News and LinkedIn). On 2026-10-27 the founder also decided that a Brand Reviewer agent PASS is the approval for marketing pages, so that call is made once and not page by page.",
  },
  {
    question: "Can I see the Lullwood source code?",
    answer:
      "Yes. The source is public and MIT-licensed at github.com/DadonStyle/LULLWOOD, including the full git history and the AGENTS.md file that tells the agents how to ship a change. Third-party assets are listed on the Lullwood credits page.",
  },
  {
    question: "Can the Lullwood git history show how much a human wrote?",
    answer:
      "No, not on its own. The log shows who opened a pull request, not who or what wrote the change. 818 of the 1,084 merged pull requests were opened by the automation from agent-pushed branches. Another 84 came from the same kind of branch but were opened under the founder's GitHub login, so the log cannot say whether a person or an agent opened them. We do not publish a human-versus-agent percentage.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: QA.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
};

export default function WhoMakesLullwood() {
  return (
    <>
      <JsonLd data={faqJsonLd} />
      <p>
        Lullwood is made by Independence AI Studio: one human founder and a
        team of AI agents running on Claude, orchestrated with Paperclip. The
        agents handle design, engineering, code review, testing and
        marketing. The founder sets direction and approves what ships. The
        game is built with Next.js and Three.js, and its source is public on
        GitHub.
      </p>
      <p>
        That is the claim. The rest of this page is the evidence, with the
        command or board each number came from, and the places where our own
        work went wrong. Lullwood is a free{" "}
        <Link href="/">browser horror game</Link>; this is the builder side
        of it.
      </p>

      <h2>Who is in the Lullwood studio?</h2>
      <p>
        One person, the founder, and a roster of Claude agents on a Paperclip
        board. On 2026-10-27 the board lists 19 agents: nine are active and
        ten are paused. These are the roles that matter most to how a change
        reaches a player:
      </p>
      <ul>
        <li>
          <strong>CEO</strong> decides what gets built and why.
        </li>
        <li>
          <strong>CTO</strong> turns that into engineering work.
        </li>
        <li>
          <strong>Founding Engineer</strong> owns infrastructure, CI,
          releases and deploys.
        </li>
        <li>
          <strong>Game Engineer</strong> owns gameplay code and the mobile
          controls.
        </li>
        <li>
          <strong>Code Reviewer</strong> is the gate on pull requests that
          touch risky code.
        </li>
        <li>
          <strong>Growth Lead</strong> sets marketing strategy and is the
          only agent that posts to social channels.
        </li>
        <li>
          <strong>Content Producer</strong> drafts pages and posts,
          including this one.
        </li>
        <li>
          <strong>Brand Reviewer</strong> passes or fails each draft against
          written brand rules before it can ship.
        </li>
      </ul>
      <p>
        Paused today: Game Tester, Feature Scout, Game Economist, Backlog
        Keeper and six more support roles. We wrote about the engineering
        half of this org chart in{" "}
        <Link href="/devlog/eleven-agents-one-release-train">
          Eleven agents, one release train
        </Link>
        , when the count was eleven on 2026-09-19. Read that post for how
        the work is split and why review was resized to risk. This one is
        about who is in the room and who decides. The three marketing agents
        behind this page (Growth Lead brief, Content Producer draft, Brand
        Reviewer check) joined on 2026-10-22.
      </p>

      <h2>How does an agent&rsquo;s change reach a player?</h2>
      <p>
        Agents push to the repository with an SSH deploy key. That key can
        move branches but has no GitHub API scope, so an agent cannot open
        or merge a pull request on its own. A workflow opens the pull
        request against <code>release/next</code>. It is squash-merged once
        both CI checks are green, when the branch is marked ready to ship
        and the change is not in the highest-risk tier (engine simulation,
        persistence, secrets and auth, release cuts); those wait for a
        blocking review. <code>main</code> is protected: no
        direct pushes, a pull request is mandatory, and release cuts move
        <code> release/next</code> into it.
      </p>
      <p>
        Counted with the GitHub CLI on 2026-10-27: 916 pull requests merged
        into <code>release/next</code> between 2026-08-19 and 2026-10-27,
        223 of them in the 30 days from 2026-09-27. In the same period 84
        release pull requests, titled &ldquo;Release v&hellip;&rdquo;,
        merged into <code>main</code> between 2026-08-20 and 2026-10-27.
      </p>

      <h2>What has broken in the Lullwood build?</h2>
      <p>
        <strong>A future date, three times in two days.</strong> In the week
        of 2026-10-19 two pages we wrote carried a future{" "}
        <code>datePublished</code>, because the publish date from the brief
        leaked into the markup. Both passed brand review: the check was not
        on anyone&rsquo;s list. The fix corrected the page and left a future
        date in the sitemap. The next version of the check looked at the{" "}
        <code>app</code> and <code>public</code> folders and missed{" "}
        <code>lib/devlog.ts</code>, which is where a devlog post&rsquo;s
        date actually lives, so a devlog post reached production with a
        date ahead of the calendar. Each check was scoped to where the last
        defect had been, so it certified the next one as fixed. The check
        now searches every date on the whole branch.
      </p>
      <p>
        <strong>A clip of the wrong thing.</strong> A 9-second gameplay clip
        cost six Content Producer heartbeats and two Brand Reviewer FAILs,
        then shipped nothing, because the capture script was filming a
        synthetic test scene and not the game.
      </p>

      <h2>Where these numbers come from</h2>
      <ul>
        <li>
          Pull request counts: <code>gh pr list --state merged</code> on the
          Lullwood repository, filtered by <code>--base</code>, author and
          branch name, run on 2026-10-27.
        </li>
        <li>
          Agent count and paused or active status: the Paperclip board,
          2026-10-27.
        </li>
        <li>
          How a change ships: <code>AGENTS.md</code> in the repository.
        </li>
      </ul>

      <h2>Questions about who makes Lullwood</h2>
      {QA.map(({ question, answer }) => (
        <div key={question}>
          <h3>{question}</h3>
          <p>{answer}</p>
        </div>
      ))}
      <p>
        Read the code at{" "}
        <a href="https://github.com/DadonStyle/LULLWOOD">
          github.com/DadonStyle/LULLWOOD
        </a>
        , see the <Link href="/credits">Lullwood credits</Link>, or play
        Lullwood free in your browser at{" "}
        <Link href="/">www.lullwoodgame.com</Link>. For how to stay alive in
        the forest, read <Link href="/how-to-survive">how to survive Lullwood</Link>.
      </p>
    </>
  );
}
