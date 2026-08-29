'use client';

import type { EngineActions, EngineHudState } from './Hud';
import { DEEPER_LUNGS_COSTS, DEEPER_LUNGS_MAX_TIER } from '@/lib/game/economy';
import { VEIL_MAX_HOLD } from '@/lib/game/veil';

// LUL-1043: the one Embers spend surface (wiki game/economy/embers) --
// Deeper Lungs is the only sink in this cheap version; Steady Arms/Ash-Foot
// are gated on this one showing people actually spend (decisions/
// embers-accepted-2026-08-29). Balance and tier are engine state (the payout
// that fills the balance happens inside arriveHome()/triggerDeath() in
// engine/forest-engine.js), so unlike SettingsPanel this component owns no
// localStorage of its own -- it only renders state.embersBalance /
// state.deeperLungsTier and calls actions.buyDeeperLungs(), which
// re-validates cost and balance on the engine side before it commits.
const DEEPER_LUNGS_HOLD_SECONDS = [VEIL_MAX_HOLD, 6, 7, 8];

export default function EmbersPanel({
  state,
  actions,
  open,
  onClose,
}: {
  state: EngineHudState;
  actions: EngineActions | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  const tier = state.deeperLungsTier;
  const maxed = tier >= DEEPER_LUNGS_MAX_TIER;
  const nextCost = maxed ? null : DEEPER_LUNGS_COSTS[tier];
  const canAfford = nextCost != null && state.embersBalance >= nextCost;

  return (
    <div id="embersPanel" role="dialog" aria-label="Embers">
      <div id="embersHeader">
        <h2>Embers: {state.embersBalance}</h2>
        <button onClick={onClose} aria-label="Close embers">
          ✕
        </button>
      </div>

      <fieldset>
        <legend>Deeper Lungs</legend>
        <p>
          Mist-veil hold: {DEEPER_LUNGS_HOLD_SECONDS[tier]}s
          {!maxed && ` → ${DEEPER_LUNGS_HOLD_SECONDS[tier + 1]}s`}
          {maxed && ' (maxed)'}
        </p>
        {!maxed && (
          <button className="embersBuyBtn" disabled={!canAfford} onClick={() => actions?.buyDeeperLungs()}>
            Buy tier {tier + 1} — {nextCost}
          </button>
        )}
      </fieldset>
    </div>
  );
}
