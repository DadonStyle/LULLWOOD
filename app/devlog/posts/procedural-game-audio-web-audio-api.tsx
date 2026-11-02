import Link from "next/link";

export default function ProceduralGameAudioWebAudioApi() {
  return (
    <>
      <p>
        Lullwood, our free browser horror game, ships no audio files. Every
        sound in it is generated at runtime with the Web Audio API: looped
        noise buffers, oscillators, filters, gain envelopes and a stereo
        panner. A search of all 778 tracked files at commit{' '}
        <code>ce46801</code> finds no audio file and no audio loader.
      </p>
      <p>
        We build Lullwood in three.js and Next.js. This post shows what the
        sound graph is made of, the one audible consequence a player notices
        (the fog tide&rsquo;s drone swelling before the fog arrives), and
        exactly what we searched to say &ldquo;no audio files&rdquo;. Line
        numbers are in <code>engine/forest-engine.js</code> at that commit.
      </p>

      <h2>What we searched, and what it found</h2>
      <p>
        An absence claim is only as good as the search behind it, so here is
        the whole search. The commit is <code>ce46801</code>, the tip of{' '}
        <code>release/next</code> when we wrote this.
      </p>
      <ul>
        <li>
          <strong>Every tracked path, by extension.</strong>{' '}
          <code>git ls-tree -r --name-only ce46801</code> lists 778 files. We
          matched them against <code>.mp3</code>, <code>.wav</code>,{' '}
          <code>.ogg</code>, <code>.oga</code>, <code>.opus</code>,{' '}
          <code>.m4a</code>, <code>.aac</code>, <code>.flac</code>,{' '}
          <code>.aif</code>, <code>.aiff</code>, <code>.weba</code>,{' '}
          <code>.wma</code>, <code>.amr</code>, <code>.caf</code>,{' '}
          <code>.ac3</code>, <code>.mka</code>, <code>.mp2</code>,{' '}
          <code>.mid</code> and <code>.midi</code>. No match.
        </li>
        <li>
          <strong>Every file, by content.</strong> We extracted the commit and
          ran <code>file --mime-type</code> over all 778 files, in case audio
          sat behind a wrong extension. Zero of them are <code>audio/*</code>.
        </li>
        <li>
          <strong>The code, by reference.</strong>{' '}
          <code>git grep -n -E</code> over <code>engine</code>,{' '}
          <code>app</code>, <code>components</code>, <code>lib</code>,{' '}
          <code>shared</code>, <code>public</code>, <code>scripts</code> and{' '}
          <code>services</code>, for <code>decodeAudioData</code>,{' '}
          <code>new Audio(</code>, <code>HTMLAudioElement</code>,{' '}
          <code>&lt;audio</code>, <code>createMediaElementSource</code> and
          the extensions <code>.mp3</code>, <code>.wav</code>,{' '}
          <code>.ogg</code>, <code>.m4a</code>, <code>.aac</code>,{' '}
          <code>.flac</code>, <code>.opus</code>. Zero matches. The same
          search shape finds 19 uses of <code>createBufferSource</code> in the
          engine, so the search itself works.
        </li>
        <li>
          <strong>The whole tree for the headline word.</strong>{' '}
          <code>decodeAudioData</code> appears once in all 778 files, in a
          design note that says there is none. <code>package.json</code>{' '}
          lists no audio library.
        </li>
      </ul>
      <p>
        Three video files exist, and they are the nearest thing to an
        exception. Two are QA recordings under <code>QA_REGRESSION/</code>,
        outside <code>public/</code>. The third is <code>public/death.mp4</code>,
        the death sequence, which the page loads in a <code>&lt;video&gt;</code>{' '}
        tag marked <code>muted</code>. None of the three has an audio stream
        in its container. A search like this shows what the repository
        contains. It cannot show what a browser extension or a CDN adds, and we
        make no claim about either.
      </p>

      <h2>Noise is the raw material</h2>
      <p>
        The function <code>noise()</code> (L4145) fills a buffer with{' '}
        <code>Math.random()</code>, either raw white noise or a leaky running
        sum of it that works as brown noise. Three looped beds are built from
        it in <code>startAudio()</code> (L4157), each a three-second buffer
        with <code>loop = true</code>:
      </p>
      <ul>
        <li>
          <strong>Wind</strong> (L4196): brown noise through a lowpass filter
          at 340 Hz.
        </li>
        <li>
          <strong>Insects</strong> (L4202): white noise through a bandpass
          filter at 4,800 Hz. Its gain comes from the time-of-day table, and
          that gain is 0 at night.
        </li>
        <li>
          <strong>Rain</strong> (L4208): noise through a 2,000 Hz bandpass,
          held at a gain of 0.0001 until the rainfall event raises it. The
          comment above it says white noise. The call passes{' '}
          <code>true</code>, which is brown. The sound is what the code does,
          not what the comment says.
        </li>
      </ul>
      <p>
        The reverb is also noise. <code>impulse(ctx, 2.4, 3.0)</code> (L4152)
        builds a two-channel, 2.4-second buffer of random samples multiplied
        by a falling curve, and a <code>ConvolverNode</code> (L4192) uses it as
        the forest&rsquo;s echo. Almost every source feeds both the master
        gain and that convolver. One thing differs from the map. The terrain
        comes from a seeded generator and is the same for the same seed. The
        noise comes from <code>Math.random()</code>, so no two sessions share a
        wind.
      </p>
      <p>
        The wind answers your movement. Each frame, in the calm bed, its gain
        is <code>0.05 + move01 * 0.10</code>, before a time-of-day factor (1 at
        night, 0.6 at noon) and a fog-tide duck, and its filter cutoff is{' '}
        <code>320 + move01 * 900</code> Hz (L9136-9137), where{' '}
        <code>move01</code> runs from 0 standing still to 1 at full sprint. A
        sprint triples the wind&rsquo;s base gain and opens its filter to 1,220
        Hz.
      </p>

      <h2>The calm bed is a chord, the chase is a different one</h2>
      <p>
        The low drone (L4214-4219) is three sine oscillators at 55, 82.5 and
        110 Hz, each detuned by up to 6 cents. Those are a root, the fifth
        above it and the octave. A 0.05 Hz oscillator, one cycle every 20
        seconds, nudges its gain by 0.02 around a base of 0.05.
      </p>
      <p>
        The chase cue (L4222-4231) is built from the same pitches with one
        change. Three sawtooth waves sit at 55, 77.78 and 110 Hz, through a
        560 Hz lowpass. The fifth is gone, and 77.78 is 55 multiplied by the
        square root of 2: a tritone, the interval a code comment calls
        &ldquo;tritone-ish&rdquo;. A 110 Hz sine throbs under it, its gain
        driven by a second oscillator that starts at 2.7 Hz, and a quiet 1,245
        Hz triangle sits on top.
      </p>
      <p>
        The cue is silent (gain 0.0001) until a predator is chasing or
        bee-lining at you. Then the engine pulls the calm bed out entirely,
        setting the wind and drone targets to 0.0001 (L9126-9128), and the
        chase cue comes in at a gain between 0.5 and 1.0. The throb rate climbs
        from 2.3 to as high as 5.5 beats a second (L9122) with how long the
        chase has lasted and how close the nearest animal is. Lose it, and the
        cue falls back to silence while the bed returns.
      </p>

      <h2>The fog-tide warning is a gain target, not a cue file</h2>
      <p>
        This is the one a player notices. In{' '}
        <Link href="/devlog/the-fog-is-the-wolfs-eyesight">
          the fog tide post
        </Link>{' '}
        the clock is a 90-second loop whose telegraph starts 10 seconds before
        the fog does. Here is how that becomes sound, with no file in sight.
      </p>
      <ul>
        <li>
          <code>eventCycleBuildAmount()</code> (<code>eventScheduler.ts</code>{' '}
          L48-53) returns 0 through the calm phase, rises linearly to 1 across
          the 10-second lead-in, and stays at 1.
        </li>
        <li>
          The engine does not use that signal directly. Every frame it eases a
          second value toward it: <code>fogTideBuild</code> moves a fraction{' '}
          <code>dt / 2</code> of the way (L8457), a two-second lag.
        </li>
        <li>
          Also every frame, the calm bed sets the drone&rsquo;s target gain to{' '}
          <code>0.05 * fogTideDroneGainMul(...)</code> times the time-of-day
          factor, with a 0.3-second time constant (L9138). The multiplier is{' '}
          <code>1 + build * 1.6</code>, so it runs 1 to 2.6.
        </li>
      </ul>
      <p>
        At night the drone climbs from 0.05 to 0.13 as the lead-in plays out.
        It is not an automation curve scheduled ahead on the audio timeline.
        The game recomputes a target every frame from its own clock and the
        gain node chases it. That has a plain consequence: the clock only runs
        while you play, and the retargeting sits inside the{' '}
        <code>playing</code> check (L9124), so pausing stops the swell where it
        was. Change <code>leadIn</code> from 10 to 6 in the config and the
        warning shortens with it, because no sample was authored to be 10
        seconds long.
      </p>
      <p>
        Three limits are worth knowing. The swell happens only in the calm
        bed, so a chase mutes it. It is weighted by your distance to a fog
        patch, so you hear it near one. And it multiplies a base that depends
        on your local clock. The game reads the hour once, at load (L385):
        the drone factor is 1 from 20:00 to 03:59, and 0.08 from 11:00 to
        13:59. Played at noon, the same warning runs from 0.004 to about 0.010,
        8% of the night swing.
      </p>

      <h2>Direction is one StereoPanner</h2>
      <p>
        The child&rsquo;s cry is how you find her in fog. <code>childCry()</code>{' '}
        (L2999) makes a sine oscillator at 420 Hz plus up to 90 Hz when you are
        close, sweeps it up by a quarter and back in 0.6 seconds, and sends it
        through a <code>StereoPanner</code>. The pan value (L3004-3008) is the
        child&rsquo;s offset projected onto your right and forward axes, then{' '}
        <code>right / hypot(right, fwd)</code>. Each cry builds its own nodes,
        starts them, and stops 0.75 seconds later.
      </p>
      <p>
        The cadence carries distance as well (L9106-9111): a cry every 5.5
        seconds when you are 140 units or more away, closing to every 2
        seconds beside her, and a peak gain from 0.04 to 0.09.
      </p>
      <p>
        That pan formula is the sine of the angle off straight ahead, so it
        only knows left from right. A cry from directly ahead and one from
        directly behind both pan to the centre. The cost is covered by text,
        not by audio: with captions on, the same function writes something
        like &ldquo;a child crying &middot; far &middot; behind&rdquo;
        (L3020-3023). Footsteps are simpler. The engine accumulates distance
        walked and plays a short noise burst every 1.9 units (L9146-9149),
        through a bandpass between 150 and 250 Hz, so the footsteps are
        tied to ground covered, not to an animation.
      </p>

      <h2>What it costs</h2>
      <p>
        No file means no sound editor. Changing a sound means changing a number
        and playing the game. Tests cannot listen either, so the engine exposes
        hooks that read node values instead; <code>qaProbePredatorVolume()</code>{' '}
        (L5085) returns a gain.
      </p>
      <p>
        It also means Web Audio behaviour becomes your bugs. Chromium puts a{' '}
        <code>GainNode</code> to sleep once the last sound routed through it
        ends, and a sleeping node&rsquo;s gain timeline does not advance, so
        the node&rsquo;s <code>.gain.value</code> read the old level, so{' '}
        <code>qaProbePredatorVolume()</code> returned stale values and the
        predator-audio specs failed at random. Players heard the right level.
        The fix (L4177-4190) is a
        silent <code>ConstantSourceNode</code> with an offset of 0, connected
        to that gain node so it never sleeps. On iOS, the context starts
        suspended whatever the user did, so <code>startAudio()</code> calls{' '}
        <code>resume()</code> inside the gesture (L4161-4166).
      </p>
      <p>
        Two things we have not measured: how long <code>startAudio()</code>{' '}
        takes to fill its buffers on a phone, and whether the seam of a
        three-second noise loop is audible. The code does not crossfade it.
      </p>

      <p>
        The other half of this story, the files Lullwood does not ship for
        trees, animals and sky, with a measured first load, is in{' '}
        <Link href="/devlog/a-night-forest-with-one-model-file">
          a night forest with one model file
        </Link>
        . To hear the graph rather than read it, wear headphones and{' '}
        <Link href="/">play Lullwood free in the browser</Link>, then wait for
        the drone to rise.
      </p>
    </>
  );
}
