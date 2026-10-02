// LUL-5828: turns a KeyboardEvent.code (what keyMap/setKeyMap store) into the
// short label HUD prompts and the Settings Controls fieldset show the player --
// 'KeyE' -> 'E', 'Space' -> 'SPACE', 'ShiftLeft' -> 'SHIFT LEFT'. Without this,
// a remapped prompt reads "Press  KeyE  to pick up the stone" (Q6: copy naming
// a key should read the key, not the raw DOM code).
export function formatKeyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
}
