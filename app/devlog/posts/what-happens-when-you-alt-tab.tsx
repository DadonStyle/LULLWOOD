import Link from "next/link";

export default function WhatHappensWhenYouAltTab() {
  return (
    <>
      <p>
        Almost nothing. On desktop, switching windows releases the mouse lock,
        and Lullwood treats that as a pause. Even without the pause, the frame
        loop clamps the one huge time step you come back with to 0.05 seconds,
        so a predator is where you left it.
      </p>
      <p>
        The interesting part is where the clamp stops: it caps the time step,
        not the clock that step is read from. We build{" "}
        <Link href="/">Lullwood</Link>, a free browser horror game, in three.js.
        Everything below was read from the source at commit{" "}
        <code>3a184da</code> on 2026-11-23, and the last section says what we
        did not test.
      </p>

      <h2>The constant</h2>
      <p>
        <code>lib/game/scent.ts</code> exports{" "}
        <code>DT_CLAMP_CEILING = 0.05</code> and a function that applies it:
      </p>
      <pre>
        <code>{`export function clampDt(rawDt: number, ceiling: number = DT_CLAMP_CEILING): number {
  return Math.min(rawDt, ceiling);
}`}</code>
      </pre>
      <p>
        It is a plain <code>Math.min</code>, nothing cleverer. The comment above
        the constant says what it is for: it &ldquo;stops a tab-out or GC pause
        from teleporting predators through walls.&rdquo; The test file pins the
        case this post is about:
      </p>
      <pre>
        <code>{`test('clampDt caps a spike well past the ceiling (tab-out / GC pause)', () => {
  assert.equal(clampDt(2.5), DT_CLAMP_CEILING);
});`}</code>
      </pre>
      <p>
        That test passes on this commit, along with the other 38 in the file.
        The engine calls the function once per frame, in <code>tick()</code>:{" "}
        <code>const dt = clampDt(clock.getDelta())</code>. Everything that
        moves, a predator step or a stamina tick, is multiplied by that{" "}
        <code>dt</code>.
      </p>

      <h2>Why the browser makes it necessary</h2>
      <p>
        MDN documents that <code>requestAnimationFrame()</code> calls are paused
        in most browsers in background tabs. So when you tab away, the render
        loop does not run slowly. It does not run. The next frame arrives when
        you come back, and <code>clock.getDelta()</code> returns the real
        seconds since the last one. In three.js r185, which is the line this
        repository pins, <code>getDelta()</code> does no clamping of its own: it
        subtracts two <code>performance.now()</code> readings and adds the
        result to <code>elapsedTime</code>. After 30 seconds away, the first
        raw <code>dt</code> is about 30.
      </p>

      <h2>What an unclamped 30 seconds would do</h2>
      <p>
        Walking speed in <code>engine/tuning.js</code> is 6 units a second and
        the sprint multiplier, <code>STAMINA_SPRINT_MUL</code>, is 1.8, so a
        sprinting player covers 10.8. The in-game hints call the wolf &ldquo;faster
        than you&rdquo; and the lion &ldquo;the fastest hunter here&rdquo;. One
        step of 30 seconds at the player&rsquo;s sprint speed alone is 324
        units, taken in a single frame, which is how a predator ends up on the other
        side of a wall. One clamped step is 0.54. How each predator hunts is
        in the <Link href="/how-to-survive">survival guide</Link>.
      </p>
      <p>
        Stamina has the same shape. <code>STAMINA_DRAIN_TIME</code> is 6
        seconds of sprinting from full, and <code>stepStamina</code> subtracts{" "}
        <code>dt / STAMINA_DRAIN_TIME</code>. A 30-second step is five full
        bars, so a sprinting player would arrive back at zero in one frame. A
        0.05 step takes under 1% of the bar.
      </p>

      <h2>What actually pauses the game</h2>
      <p>
        We did not write a <code>visibilitychange</code> or blur handler into
        the game loop, and we are not claiming one exists. What does pause a
        desktop run is pointer lock. The Pointer Lock spec says the browser
        must exit the lock when the window or tab loses focus, and the engine
        listens for <code>pointerlockchange</code>: if the lock is lost
        mid-run, it calls <code>setPaused(true)</code>. The code comment calls
        it &ldquo;Esc / released lock -&gt; menu&rdquo;, so the same path
        serves Esc and alt-tab. While paused, the run timer stops.
      </p>
      <p>
        That handler is bound in desktop mode only. On a touch device, or on a
        desktop where you never took the lock, nothing pauses, and the clamp is
        the only thing between your return and the first frame.
      </p>

      <h2>The clock we did not clamp</h2>
      <p>
        <code>dt</code> is clamped. <code>clock.elapsedTime</code> is not,
        because <code>getDelta()</code> adds the raw gap to it before the engine
        sees the number. Anything that stores an <code>elapsedTime</code>{" "}
        snapshot and subtracts it later reads real wall-clock time, however
        long the tab was away. The run timer is the example we handle on
        purpose: <code>setPaused(false)</code> slides <code>enteredAt</code>{" "}
        forward by the paused span, which is why a paused desktop run does not
        count the time away. Without the pause, on a touch device, the run
        timer counts it.
      </p>

      <h2>What we have not checked</h2>
      <p>
        We have not alt-tabbed a live run in a browser for this post. The claims
        come from the source, the spec and MDN, plus the test run above, and
        the browser behaviour is the part that could differ: we have not tried
        Firefox or Safari, a second monitor where the tab stays visible, or a
        phone. We did not look at audio. The engine also schedules some delayed
        actions through <code>later()</code>, a wall-clock{" "}
        <code>setTimeout</code> that a hidden tab throttles rather than stops,
        and we have not traced those.
      </p>
    </>
  );
}
