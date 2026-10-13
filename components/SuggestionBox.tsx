'use client';

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';

// LUL-1918: player suggestion intake. Guards mirror app/api/suggestions/route.ts
// byte for byte (^[a-z ]{3,300}$) -- duplication is intentional, see LUL-1917.
const MAX_LEN = 300;
const MIN_LEN = 3;

function sanitize(raw: string): string {
  // Lowercasing here is a UX convenience (Shift+letter shouldn't feel like a
  // rejected keystroke) -- everything that isn't a-z or space is dropped, not
  // transformed, so the field can never hold anything the server would 400 on.
  return raw.toLowerCase().replace(/[^a-z ]/g, '').slice(0, MAX_LEN);
}

// LUL-5982: how many characters strictly before `cursor` in `raw` sanitize()
// would drop. Typing a rejected character anywhere but the end shortens the
// string, and the browser resets selectionStart to the end on that DOM write
// -- this is what lets the caller put the cursor back where the player was.
function countDroppedBefore(raw: string, cursor: number): number {
  let dropped = 0;
  for (let i = 0; i < cursor && i < raw.length; i++) {
    if (!/[a-z ]/.test(raw[i].toLowerCase())) dropped++;
  }
  return dropped;
}

type Status = 'idle' | 'submitting' | 'success' | 'error' | 'rate_limited';

export default function SuggestionBox() {
  const [text, setText] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  // Dropping the one rejected character typed can leave `text` equal to what
  // it already was (e.g. "hello world" -> insert "1" -> sanitized back to
  // "hello world"), so React bails out of re-rendering on `text` alone --
  // but the DOM textarea's native value still got reset mid-edit and React's
  // controlled-input machinery force-syncs it back, which resets the cursor
  // regardless. Ticking this on every keystroke guarantees the layout effect
  // below always runs to restore the cursor, even when `text` didn't change.
  const [selectionTick, setSelectionTick] = useState(0);

  // A layout effect, not a plain effect: it must run synchronously right
  // after React commits the shortened value to the DOM (which is what resets
  // selectionStart to the end) and before the browser processes the next
  // keystroke, or a fast typist outruns the restore and lands back at the end.
  useLayoutEffect(() => {
    const pos = pendingSelectionRef.current;
    if (pos === null) return;
    pendingSelectionRef.current = null;
    textareaRef.current?.setSelectionRange(pos, pos);
  }, [selectionTick]);

  const remaining = MAX_LEN - text.length;
  const canSubmit = status !== 'submitting' && text.trim().length >= MIN_LEN;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, website: honeypot }),
      });
      if (res.ok) {
        setStatus('success');
        setText('');
      } else if (res.status === 429) {
        setStatus('rate_limited');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className="suggestion-box suggestion-box--done">
        <p>Thanks. The founder reads every suggestion by hand.</p>
        <button type="button" onClick={() => setStatus('idle')}>
          send another
        </button>
      </div>
    );
  }

  return (
    <form className="suggestion-box" onSubmit={handleSubmit}>
      <label htmlFor="suggestion-text">suggest something for lullwood</label>
      <textarea
        id="suggestion-text"
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          const cursor = e.target.selectionStart ?? raw.length;
          const sanitized = sanitize(raw);
          const dropped = countDroppedBefore(raw, cursor);
          pendingSelectionRef.current = Math.min(Math.max(cursor - dropped, 0), sanitized.length);
          setText(sanitized);
          setSelectionTick((t) => t + 1);
        }}
        maxLength={MAX_LEN}
        rows={4}
        placeholder="lowercase letters and spaces only"
        aria-describedby="suggestion-remaining suggestion-hint"
      />
      <div id="suggestion-remaining" className="suggestion-box__remaining">
        {remaining} characters left
      </div>
      <p id="suggestion-hint" className="suggestion-box__hint">
        Only English letters and spaces are allowed — no numbers or symbols.
      </p>
      {/* Honeypot: invisible to a real player via CSS (off-screen, not
          display:none -- some bots skip display:none fields specifically).
          A filled-in value means it was auto-filled by a bot, not typed by a
          human, so the server drops the submission with no error. */}
      <input
        type="text"
        name="website"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        className="suggestion-box__honeypot"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <button type="submit" disabled={!canSubmit}>
        {status === 'submitting' ? 'sending…' : 'send suggestion'}
      </button>
      {status === 'rate_limited' && (
        <p role="alert" className="suggestion-box__error">
          too many suggestions right now — try again later.
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="suggestion-box__error">
          that could not be submitted. lowercase letters and spaces only, 3-300 characters.
        </p>
      )}
    </form>
  );
}
