// LUL-3264 wave 2 (S4/S5): the flag-colour source for sky balloons and tree
// tinting. One entry per code in COUNTRY_ALLOWLIST (lib/game/leaderboard.ts)
// -- the submission form only ever accepts those 30 codes, so this table
// only needs to cover them, not the ~200-entry ISO superset the original
// PLAN (LUL-3264 Part 2.6) estimated before S1 scoped the allowlist down.
//
// 2-3 colours per flag, in flag order, hex. Low-saturation tree tinting
// (S5's "saturation low" requirement) is the *consumer's* job -- blend these
// against the existing tintCol multiplier (forest-engine.js:1027), don't
// pre-desaturate them here, so sky balloons (which want the true flag
// colours) and tree tint (which wants them muted) can share one table.

export const COUNTRY_PALETTES: Readonly<Record<string, readonly string[]>> = {
  US: ['#B22234', '#FFFFFF', '#3C3B6E'],
  GB: ['#C8102E', '#FFFFFF', '#012169'],
  CA: ['#FF0000', '#FFFFFF'],
  AU: ['#00008B', '#FFFFFF', '#FF0000'],
  DE: ['#000000', '#DD0000', '#FFCE00'],
  FR: ['#0055A4', '#FFFFFF', '#EF4135'],
  JP: ['#FFFFFF', '#BC002D'],
  BR: ['#009739', '#FEDD00', '#012169'],
  IN: ['#FF9933', '#FFFFFF', '#138808'],
  MX: ['#006847', '#FFFFFF', '#CE1126'],
  ES: ['#AA151B', '#F1BF00'],
  IT: ['#008C45', '#FFFFFF', '#CD212A'],
  NL: ['#AE1C28', '#FFFFFF', '#21468B'],
  SE: ['#006AA7', '#FECC00'],
  NO: ['#BA0C2F', '#FFFFFF', '#00205B'],
  DK: ['#C8102E', '#FFFFFF'],
  FI: ['#FFFFFF', '#002F6C'],
  PL: ['#FFFFFF', '#DC143C'],
  RU: ['#FFFFFF', '#0039A6', '#D52B1E'],
  CN: ['#DE2910', '#FFDE00'],
  KR: ['#FFFFFF', '#C60C30', '#003478'],
  ZA: ['#007A4D', '#FFB81C', '#000000'],
  NZ: ['#00247D', '#CC142B', '#FFFFFF'],
  IE: ['#169B62', '#FFFFFF', '#FF883E'],
  PT: ['#006600', '#FF0000', '#FFCC00'],
  AR: ['#74ACDF', '#FFFFFF', '#F6B40E'],
  CL: ['#D52B1E', '#FFFFFF', '#0039A6'],
  TR: ['#E30A17', '#FFFFFF'],
  GR: ['#0D5EAF', '#FFFFFF'],
  IL: ['#FFFFFF', '#0038B8'],
};
