// The homepage's "Questions" section and its FAQPage JSON-LD both render from
// this one list, so the markup can never drift from the visible text (Google's
// structured-data policy requires the two to match).
//
// Each answer opens with a self-contained sentence that names Lullwood: AI
// answer engines (Google AI Overviews, Gemini, ChatGPT search) lift single
// passages, so an answer that only makes sense next to its question gets
// skipped or misattributed. Plain strings only -- they are emitted into JSON-LD
// as-is.

export interface FaqEntry {
  question: string;
  answer: string;
}

export const FAQ: FaqEntry[] = [
  {
    question: 'What is Lullwood?',
    answer:
      'Lullwood is a free first-person horror game you play in your web browser. You cross a foggy night forest to reach a lost, glowing child while wolves, bears and lions hunt you by sight and by scent.',
  },
  {
    question: 'Is Lullwood free?',
    answer:
      'Yes. Lullwood is completely free to play in the browser, with no purchase, no account and no ads.',
  },
  {
    question: 'Do I need to download or install anything?',
    answer:
      'No. Lullwood runs in any modern browser that supports WebGL, such as Chrome, Edge, Firefox or Safari. It loads on the page you are reading, with nothing to install.',
  },
  {
    question: 'Can I play Lullwood on a phone or tablet?',
    answer:
      'Yes. Lullwood has on-screen touch controls: twin sticks for movement and look, plus buttons for jumping, hiding, the mist veil and lifting the child.',
  },
  {
    question: 'Is Lullwood scary?',
    answer:
      'Lullwood is a horror game built on tension rather than jump scares. The fear comes from being hunted while unarmed, and from having to stay still while something searches for you nearby.',
  },
  {
    question: 'Can you fight the predators?',
    answer:
      'No. Lullwood gives you no weapons. You survive by hiding in bushes, holding still, dimming your light with the mist veil and jumping clear of a charge, while predators follow your line of sight and the scent trail you leave behind.',
  },
  {
    question: 'How long is a run?',
    answer:
      'A successful run of Lullwood takes a few minutes. Dying is common early on, and each attempt generates a fresh forest layout.',
  },
  {
    question: 'What difficulty levels are there?',
    answer:
      'Lullwood has three difficulty levels: Lantern (forgiving), Night, and Blackout, the default, which has no minimap and puts the child further from where you start.',
  },
  {
    question: 'Is there a leaderboard?',
    answer:
      'Yes. The fastest rescue on Blackout difficulty becomes the top rescuer, shown in the game menu and in the sky over the forest. Runs played with admin mode on do not count.',
  },
  {
    question: 'Is Lullwood multiplayer?',
    answer: 'No. Lullwood is a single-player game.',
  },
  {
    question: 'Is Lullwood the same game as Gloomwood?',
    answer:
      'No. Gloomwood is a separate stealth horror game sold on Steam. Lullwood is an unrelated free horror game that runs in the browser at lullwoodgame.com.',
  },
  {
    question: 'Who makes Lullwood?',
    answer:
      'Lullwood is made by an all-AI game studio: a team of AI agents running on Claude handles design, engineering, testing and balancing, and one human founder sets direction and approves releases.',
  },
];

export const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map(({ question, answer }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer },
  })),
};
