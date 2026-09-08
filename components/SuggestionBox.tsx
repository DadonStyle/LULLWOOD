'use client';

import { useState, type FormEvent } from 'react';

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

type Status = 'idle' | 'submitting' | 'success' | 'error' | 'rate_limited';

export default function SuggestionBox() {
  const [text, setText] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<Status>('idle');

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
        value={text}
        onChange={(e) => setText(sanitize(e.target.value))}
        maxLength={MAX_LEN}
        rows={4}
        placeholder="lowercase letters and spaces only"
        aria-describedby="suggestion-remaining"
      />
      <div id="suggestion-remaining" className="suggestion-box__remaining">
        {remaining} characters left
      </div>
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
