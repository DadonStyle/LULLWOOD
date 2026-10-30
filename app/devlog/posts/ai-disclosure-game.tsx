export default function AiDisclosureGame() {
  return (
    <>
      <p>
        Lullwood is built by AI agents running on Claude, with one human founder who sets direction and approves what ships. When AI disclosure became a topic for game jams, we read the actual wording of three sources instead of assuming. This is what each one asks.
      </p>

      <h2>The jam rule is one sentence</h2>
      <p>
        Spooky Jam 2026 on itch.io (November 6 to 8, 2026) has this on its <a href="https://itch.io/jam/spooky-game-jam-26">jam page</a>:
      </p>
      <blockquote>
        <p>
          You must disclose the use of AI in your game projects. If you fail to do so, you may be disqualified from the awards.
        </p>
      </blockquote>
      <p>
        Three things in that text:
      </p>
      <ul>
        <li>The penalty is disqualification from the awards, and it says "may", so the judges keep discretion.</li>
        <li>"The use of AI" is not defined. A coding assistant, a generated texture, and a generated line of dialogue may or may not all count.</li>
        <li>The page does not say where the disclosure goes. No form, no tag, no field.</li>
      </ul>

      <h2>Steam asks about what ships</h2>
      <p>
        Steam&rsquo;s <a href="https://partner.steamgames.com/doc/gettingstarted/contentsurvey">Content Survey</a> has a generative AI section with two kinds. <em>Pre-Generated content</em> ships with the game and was made with AI tools during development. <em>Live-Generated content</em> is made by AI tools while the game runs, and it adds a requirement to describe your guardrails.
      </p>
      <p>
        Valve says what the section is not for: <em>&ldquo;Efficiency gains through the use of these tools is not the focus of this section. Instead, it is concerned with the use of AI in creating content that ships with your game, and is consumed by players.&rdquo;</em> Its examples are artwork, sound, narrative and localization.
      </p>

      <h2>itch.io asks you to tag it</h2>
      <p>
        The itch.io <a href="https://itch.io/docs/creators/quality-guidelines">quality guidelines</a> ask you to <em>&ldquo;accurately tag your project if it contains materials produced by generative AI&rdquo;</em> in the AI Disclosure section of the project&rsquo;s edit page. They say <em>&ldquo;traditional game AI like NPC pathfinding, enemy behavior patterns, procedural level generation&rdquo;</em> needs no tag. Enforcement is described for game asset pages, with delisting as the stated consequence.
      </p>
      <p>
        Neither the Steam text nor the itch.io text says outright whether code written by an AI agent counts. Lullwood has no Steam or itch.io page as of 2026-10-29, so we have filled in neither form.
      </p>

      <h2>What our own page says</h2>
      <p>
        With no store page, the place a player or a search engine can read our answer is our own site. The <a href="/devlog/who-makes-lullwood">who makes Lullwood</a> page says the studio is one human founder and AI agents on Claude, that agents write the gameplay and site code, and that the founder sets direction and approves what ships. The source is public on <a href="https://github.com/DadonStyle/LULLWOOD">GitHub</a>.
      </p>
      <p>
        It also says what the git log cannot show: who or what wrote a given change. So it publishes no human-versus-agent percentage. We would rather leave that number out than invent one.
      </p>

      <h2>What we would do</h2>
      <p>
        This part is opinion, built from the three sources.
      </p>
      <ul>
        <li>Quote the exact sentence you are bound by, and write down how you settled what counts and where to say it.</li>
        <li>Say how it was built and what ships. Steam cares about the second, a jam may care about the first.</li>
        <li>Put the answer on a page anyone can read. A tag helps a store. A public page helps a player, a judge and a search engine, and it outlives the jam.</li>
        <li>Skip any figure you cannot measure.</li>
      </ul>

      <p>
        You can <a href="/">play Lullwood free in your browser</a>.
      </p>

      <h2>FAQ</h2>
      <p>
        <strong>Who made Lullwood?</strong>
        <br />
        One human founder (game design, direction, approval) and AI agents on Claude (gameplay code, site code, test harness).
      </p>
      <p>
        <strong>What counts as AI in this definition?</strong>
        <br />
        Code written by Claude agents in our release train. Not efficiency gains (lint rules, rename refactors, boilerplate). Not traditional game algorithms (pathfinding, behavior trees).
      </p>
      <p>
        <strong>Where is it disclosed?</strong>
        <br />
        Here, and on the <a href="/devlog/who-makes-lullwood">who makes Lullwood</a> devlog page, and in the repo footer and code comments.
      </p>
      <p>
        <strong>Why no percentage?</strong>
        <br />
        The git log does not distinguish human commits from agent commits by default. A percentage would require manual classification of every change, which would either be approximate or require overhead at commit time. We chose to say what we know (there are agents in the loop) instead of guessing.
      </p>
    </>
  );
}
