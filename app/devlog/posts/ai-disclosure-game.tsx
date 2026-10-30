import Link from "next/link";
import JsonLd from "@/components/JsonLd";

// Visible answers and FAQPage JSON-LD both render from this one list, so the
// markup cannot drift from the text.
const QA: { question: string; answer: string }[] = [
  {
    question: "Is Lullwood made by AI?",
    answer:
      "Yes. Lullwood is made by Independence AI Studio: one human founder and a team of AI agents running on Claude. The agents write the gameplay and site code and review each other's work. The founder sets direction and approves what ships. The source is public and MIT-licensed.",
  },
  {
    question: "Do you have to disclose AI use in a game jam?",
    answer:
      "It depends on the jam. Spooky Jam 2026 on itch.io says: “You must disclose the use of AI in your game projects. If you fail to do so, you may be disqualified from the awards.” We read that page on 2026-10-29. Check the rules of the jam you are entering, because each host writes its own.",
  },
  {
    question: "Does Steam ask developers to disclose AI?",
    answer:
      "Steam's Content Survey has a Generative Artificial Intelligence Content section. It separates Pre-Generated content (made with AI tools during development and shipped to players) from Live-Generated content (made by AI tools while the game runs), and asks for guardrails on the second kind. Valve's page says efficiency gains from AI tools are not the focus of the section.",
  },
  {
    question: "Does itch.io ask developers to tag generative AI?",
    answer:
      "Yes. itch.io's quality guidelines ask you to tag a project that contains materials produced by generative AI, using the AI Disclosure section on the project's edit page. The same page says traditional game AI such as enemy behaviour and procedural level generation does not need a tag.",
  },
  {
    question: "What percentage of Lullwood is AI-generated?",
    answer:
      "We do not publish one. The git history shows who opened a pull request, not who or what wrote the change, so it cannot produce an honest figure on its own.",
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

export default function AiDisclosureGame() {
  return (
    <>
      <JsonLd data={faqJsonLd} />
      <p>
        Yes, Lullwood is made by AI. It is a free{" "}
        <Link href="/">browser horror game</Link> built by a team of AI agents
        running on Claude, with one human founder, and we say so up front. A
        game jam, a store form and a project page each ask a developer to
        disclose AI in a different way. This post sets them side by side.
      </p>
      <p>
        We read each source ourselves on 2026-10-29 and quote it below. Where
        a page is silent on something, we say it is silent and do not guess.
      </p>

      <h2>What does a game jam rule actually say about AI?</h2>
      <p>
        Spooky Jam 2026 on itch.io (November 6 to 8, 2026) has a page{" "}
        (<a href="https://itch.io/jam/spooky-game-jam-26">
          itch.io/jam/spooky-game-jam-26
        </a>
        , read 2026-10-29) that states the rule in one sentence and repeats it in
        a second place:
      </p>
      <blockquote>
        <p>
          &ldquo;You must disclose the use of AI in your game projects. If you
          fail to do so, you may be disqualified from the awards.&rdquo;
        </p>
      </blockquote>
      <p>
        Three things stand out in that text. The penalty is{" "}
        <em>disqualification from the awards</em>, and it is phrased as
        &ldquo;may&rdquo;, so the judges keep discretion. The sentence says
        &ldquo;the use of AI&rdquo; and does not define it, so a developer has
        to decide whether a coding assistant, a generated texture and a
        generated line of dialogue all count. And the page we read does not
        say where the disclosure goes: no form, no tag, no field. A jam entry
        page description is the obvious place, but that is our reading, not
        the host&rsquo;s instruction.
      </p>

      <h2>What does a store form ask?</h2>
      <p>
        Two storefronts publish their wording. Both are narrower than a jam
        rule, and neither asks the same thing.
      </p>
      <p>
        <strong>Steam.</strong> The Content Survey that every Steam game
        fills in has a third part on generative AI (
        <a href="https://partner.steamgames.com/doc/gettingstarted/contentsurvey">
          partner.steamgames.com/doc/gettingstarted/contentsurvey
        </a>
        , read 2026-10-29). It splits AI use in two. <em>Pre-Generated</em>{" "}
        is content that ships with the game and is consumed by players,
        created with AI tools during development. <em>Live-Generated</em> is
        content created with AI tools while the game is running, and it adds
        a requirement to describe the guardrails that stop the AI producing
        illegal content. Valve is explicit about what the section is not for:
        &ldquo;Efficiency gains through the use of these tools is not the
        focus of this section. Instead, it is concerned with the use of AI in
        creating content that ships with your game, and is consumed by
        players.&rdquo; Its examples are artwork, sound, narrative and
        localization.
      </p>
      <p>
        <strong>itch.io.</strong> The itch.io quality guidelines (
        <a href="https://itch.io/docs/creators/quality-guidelines">
          itch.io/docs/creators/quality-guidelines
        </a>
        , read 2026-10-29) ask you to &ldquo;accurately tag your project if it
        contains materials produced by generative AI&rdquo; in the AI
        Disclosure section of the project&rsquo;s edit page. They name large
        language models and image generators as examples, and say that
        &ldquo;traditional game AI like NPC pathfinding, enemy behavior
        patterns, procedural level generation&rdquo; does not need a tag.
        The page also says itch.io is &ldquo;strictly enforcing disclosure for
        all game asset pages&rdquo;, with delisting as the stated consequence;
        that sentence is about asset pages, not about games.
      </p>
      <p>
        Read side by side, the jam rule asks about AI in your project, while
        the Steam text asks about AI in what the player receives. Neither
        page, in the wording we read, says outright whether code written by an
        AI agent counts. Lullwood is not listed on Steam or itch.io as of
        2026-10-29, so we have filled in neither form and cannot tell you how
        a reviewer would rule on ours.
      </p>

      <h2>What does Lullwood&rsquo;s own page disclose?</h2>
      <p>
        With no store page, the place players and search engines can read our
        answer is our own site. The{" "}
        <Link href="/devlog/who-makes-lullwood">who makes Lullwood</Link> page
        has said since 2026-10-27 that the studio is one human founder and a
        team of AI agents on Claude, orchestrated with Paperclip, and that the
        agents handle design, engineering, code review, testing and marketing.
        It says the founder decides direction and approves what ships. It
        links the public, MIT-licensed source on{" "}
        <a href="https://github.com/DadonStyle/LULLWOOD">GitHub</a> and
        counts pull requests with the command and the date each count was
        taken. It also states what the git log cannot show: who or what wrote
        a given change. For that reason we publish no human-versus-agent
        percentage.
      </p>
      <p>
        The same page is not an asset inventory. It describes how the game is
        made, not an itemised list of which artwork, sound or text in the
        game came from which tool, which is the shape a Steam-style form
        asks for. The{" "}
        <Link href="/credits">Lullwood credits</Link> page lists the
        third-party assets we use and their licences. If you want to compare
        approaches, the engineering side of the same story is in{" "}
        <Link href="/devlog/eleven-agents-one-release-train">
          Eleven agents, one release train
        </Link>
        .
      </p>

      <h2>What should a developer disclose?</h2>
      <p>
        This part is our opinion, built from the three sources above.
      </p>
      <ul>
        <li>
          <strong>Quote the exact sentence you are bound by.</strong> The jam
          rule is one line, and its edges (what counts, where to say it) are
          yours to settle. Write down how you settled them.
        </li>
        <li>
          <strong>Separate how it was built from what ships.</strong> Steam
          cares about the shipped content, a jam may care about the whole
          project. Saying both costs two sentences.
        </li>
        <li>
          <strong>Put it on a page anyone can read.</strong> A tag on a store
          form helps a store. A public page helps a player, a judge and a
          search engine, and it stays up when the jam ends.
        </li>
        <li>
          <strong>Do not publish a number you cannot measure.</strong> Our
          own history cannot split human work from agent work, so we left the
          figure out rather than invent one.
        </li>
      </ul>

      <h2>Where these facts come from</h2>
      <ul>
        <li>
          Jam rule: itch.io/jam/spooky-game-jam-26, fetched and read on
          2026-10-29.
        </li>
        <li>
          Steam: partner.steamgames.com/doc/gettingstarted/contentsurvey,
          read on 2026-10-29.
        </li>
        <li>
          itch.io: itch.io/docs/creators/quality-guidelines, read on
          2026-10-29.
        </li>
        <li>
          Lullwood&rsquo;s own disclosure: the live{" "}
          <Link href="/devlog/who-makes-lullwood">who makes Lullwood</Link>{" "}
          page, read on 2026-10-29. Rules change, so check the source before
          you rely on a quote.
        </li>
      </ul>

      <h2>Questions about AI disclosure in a game</h2>
      {QA.map(({ question, answer }) => (
        <div key={question}>
          <h3>{question}</h3>
          <p>{answer}</p>
        </div>
      ))}
      <p>
        You can <Link href="/">play Lullwood free in your browser</Link> at
        www.lullwoodgame.com, read the{" "}
        <Link href="/faq">Lullwood FAQ</Link>, or see how the game plays in{" "}
        <Link href="/how-to-survive">how to survive Lullwood</Link>.
      </p>
    </>
  );
}
