export default function TheSquashThatBrokeTheReleaseTrain() {
  return (
    <>
      <p>
        Every feature at Lullwood ships the same way: a branch merges into
        <code>release/next</code>, and periodically <code>release/next</code>{' '}
        merges into <code>main</code>, which is what actually deploys. That
        second merge — the version cut — only works if the two branches
        share history. For a few days in August, they quietly stopped
        sharing it, and nobody had told them to.
      </p>
      <p>
        The automation that merges pull requests was set to squash-merge
        anything on a branch named <code>lul-*</code> once it carried a
        ship marker. That is the right default for an ordinary feature
        branch — one clean commit is easier to read than ten. It is the
        wrong default for a specific kind of pull request whose entire
        purpose is a real merge commit: a repair PR recording that{' '}
        <code>main</code> had been merged into <code>release/next</code>. A
        squash discards the second parent of a merge, so two of those
        repair PRs got squashed on the way in, and the ancestry edge they
        existed to create was thrown away in the same motion that appeared
        to land them successfully.
      </p>
      <p>
        Nothing broke immediately. It broke on the next version cut, which
        opened with a conflict on a file both branches had touched — the
        first symptom anyone actually saw of a problem that had already
        happened days earlier.
      </p>

      <h2>The first fix was aimed at the wrong thing</h2>
      <p>
        The obvious patch was to detect a release-train repair PR and merge
        it for real instead of squashing it — checking the pull request
        title for a fixed prefix and special-casing it. It shipped, the
        repair was redone, and it got squashed anyway.
      </p>
      <p>
        Two things turned out to be true at once. First, the title-based
        check could not work in general: pull request titles are generated
        from the head commit&rsquo;s subject line with no fixed convention
        enforced anywhere, so a differently worded commit produced a
        differently worded title and skipped the check entirely. Second,
        and this was the real cause — a separate piece of automation was
        arming GitHub&rsquo;s own native auto-merge with squash mode the
        moment the pull request opened, completely independent of the
        merge bot the first fix had patched. The fix had corrected the
        mechanism that never actually fired.
      </p>

      <h2>What actually held</h2>
      <p>
        The working fix stopped trying to infer intent from titles or
        content and keyed off the one thing fully under the author&rsquo;s
        control: the branch name. Every place in the pipeline capable of
        merging a pull request — the bot, and both of GitHub&rsquo;s own
        auto-merge arm points — now checks for the release-train branch
        pattern and forces a real merge commit for it, never a squash. On
        top of that, the version-cut workflow itself now asserts that the
        commit it is about to tag has exactly two parents before it
        proceeds, and refuses loudly if it does not. That turns a squashed
        cut into an immediate, loud failure instead of a quiet one that
        only shows up as a conflict on the cut after next.
      </p>
      <p>
        The fix that made this hold shipped without the marker that lets a
        pull request merge itself on green checks. It touches merge rules
        and release cuts — the one category of change that still gets a
        human-equivalent blocking review before it lands, even under a
        review policy built specifically to let most things merge
        unreviewed. Some categories of mistake are still worth slowing down
        for.
      </p>
    </>
  );
}
