// Third-party asset credits, rendered by app/credits/page.tsx (linked from the
// in-game menu) and mirrored in CREDITS.md. Every asset that ships under a
// license asking for attribution gets an entry here, with the title, author,
// source and license links CC BY requires.

export interface Credit {
  title: string;
  author: string;
  authorUrl: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  usedFor: string;
  changes?: string;
}

// Listed first on the credits page: the studio and the person behind it
// (founder 2026-10-13: link the founder's GitHub profile, not the repo).
export const STUDIO_CREDIT = {
  studio: 'Independence AI Studio',
  author: 'Noam Dadon',
  authorUrl: 'https://github.com/DadonStyle',
} as const;

export const CREDITS: readonly Credit[] = [
  {
    title: 'Letter-balloons',
    author: 'danny_p3d',
    authorUrl: 'https://sketchfab.com/dannyp_3d',
    sourceUrl: 'https://sketchfab.com/3d-models/letter-balloons-1dddbbd0e345485bbe557e68827ce9be',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    usedFor: "the top rescuer's name, spelled in balloons in the sky",
    changes: 'split into one model per letter, recentred, rescaled, simplified and recoloured',
  },
  {
    title: 'flag-icons',
    author: 'Panayiotis Lipiridis',
    authorUrl: 'https://github.com/lipis',
    sourceUrl: 'https://github.com/lipis/flag-icons',
    license: 'MIT',
    licenseUrl: 'https://github.com/lipis/flag-icons/blob/main/LICENSE',
    usedFor: "the top rescuer's country flag",
    changes: 'rendered to small PNG images',
  },
];
