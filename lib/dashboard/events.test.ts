// Node built-in test runner. Run: node --test lib/dashboard/events.test.ts
//
// LUL-2392 follow-up: KNOWN_EVENTS here is a separate allowlist from
// lib/analytics.ts's AnalyticsEventInput union -- adding an event to the emitter
// without adding it here makes parseRawEvent() silently drop every row of it as
// "unknown event". This test locks every event the emitter can send to also being
// accepted on read-back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRawEvent, KNOWN_EVENTS } from './events.ts';

test('parseRawEvent: accepts every event name the emitter can send', () => {
  const EMITTED_EVENTS = [
    'page_view',
    'cta_start_clicked',
    'game_start',
    'win',
    'loss',
    'session_length',
    'feature_engagement',
    'engine_contract_violation',
    'chase_gap',
  ];
  for (const event of EMITTED_EVENTS) {
    assert.ok(KNOWN_EVENTS.includes(event as (typeof KNOWN_EVENTS)[number]), `${event} missing from KNOWN_EVENTS`);
    const parsed = parseRawEvent({ event, ts: 1, anon_id: 'a' });
    assert.notEqual(parsed, null, `${event} was dropped by parseRawEvent`);
  }
});

test('parseRawEvent: rejects a genuinely unknown event', () => {
  assert.equal(parseRawEvent({ event: 'made_up_event', ts: 1, anon_id: 'a' }), null);
});
