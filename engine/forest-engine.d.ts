// LUL-34 (M2b): forest-engine.js stays plain JS (module decomposition into
// lib/game/ is separate, still-open scope per wiki:game/port-plan). This
// colocated declaration file is the only thing that gives GameCanvas.tsx real
// types for the dynamic import, instead of an implicit `any`. The HUD state
// and action shapes are defined once in components/Hud.tsx (it's the
// consumer that cares most about the exact fields) and re-used here so
// there's a single source of truth.
import type { EngineActions, EngineHudState } from '@/components/Hud';

export function init(onStateChange?: (state: EngineHudState) => void): EngineActions | null;
export function dispose(): void;
