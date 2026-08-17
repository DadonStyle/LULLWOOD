// LUL-276: single source of truth for "is this a mobile/touch device". Every
// other file that needs to pick a control scheme calls this instead of
// re-deriving the detection logic.
//
// Replaces the old `navigator.maxTouchPoints > 0` test that used to live in
// components/TouchControls.tsx -- that test is true on plenty of ordinary
// desktop machines (touchscreen laptops, some desktop Chrome/Edge installs
// with a touch-capable HID present), which mounted the on-screen twin-stick
// overlay on top of desktop mouse-look. See wiki
// game/lul274-input-mode-separation FACT 1.
//
// `(pointer: coarse) and (hover: none)` is the correct signal: no fine
// pointer (mouse) and no hover capability, i.e. a touch-only device. The
// max-width fallback catches browsers that don't support the pointer/hover
// media features at all.
export function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(pointer: coarse) and (hover: none)').matches) return true;
  return window.matchMedia('(max-width: 768px)').matches;
}
