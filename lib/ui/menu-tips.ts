// Tooltip copy for GameMenu's top-left button row (components/MenuTooltip.tsx):
// what each button is, then a call to action. Icon-only buttons (☰ ⛶ 💬 ©)
// have no visible text, so the tooltip is the only place a player learns what
// they do before clicking.
export type MenuTipCopy = { title: string; text: string; cta: string };

export const MENU_TIPS = {
  menu: { title: 'Menu', text: 'Pause, sound, difficulty, settings and a new map.', cta: 'Click to open the menu.' },
  fullscreenEnter: { title: 'Fullscreen', text: 'Play on the whole screen for a bigger view of the forest.', cta: 'Click to go fullscreen.' },
  fullscreenExit: { title: 'Fullscreen', text: 'You are playing fullscreen. Esc also leaves it.', cta: 'Click to leave fullscreen.' },
  suggest: { title: 'Suggestions', text: 'Have an idea for Lullwood? The founder reads every suggestion by hand.', cta: 'Click to suggest new things.' },
  credits: { title: 'Credits', text: 'Who made Lullwood, and the artists whose work it uses.', cta: 'Click to see the credits.' },
  rescuer: { title: 'Be the rescuer', text: 'The fastest valid rescue puts its name in the sky above the forest.', cta: 'Click to read the rules for first place.' },
} satisfies Record<string, MenuTipCopy>;
