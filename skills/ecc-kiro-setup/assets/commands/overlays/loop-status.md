---
source: "commands/loop-status.md"
sha256: "74ca3ff7a7249f5d0bc7f87cdec882ef1f682ebc6567653eac5bb7ebaeae8b2e"
credit:
  - "Adapted from ECC (https://github.com/affaan-m/ECC) v2.2.3: commands/loop-status.md. MIT License, Copyright (c) 2026 Affaan Mustafa."
description: "Inspect a loop prepared by /ecc-loop-start: pattern, progress, last good checkpoint, failing checks, cost so far, and a recommendation to continue, pause or stop."
---
# Loop status

Report where a loop stands, from files and git. This command only reads. It changes nothing and starts nothing.

## What it can and cannot see

- It reads the runbook that `/ecc-loop-start` wrote, the progress log inside it, git, and the usage log of Kiro.
- It cannot read an active `/goal` from another session. Kiro documents no way to do that. The live view is the CLI session where the goal runs. If you are in that session, the agent here sees only what is on disk.
- It does not scan chat transcripts for stuck tool calls. Only the progress log and git show whether the loop is moving.

## Read ARGS

- `--watch`: chat cannot refresh on a timer, so do not poll. Remember that `--watch` was given. Steps 1 to 4 run once as usual, and step 5 then adds the second-terminal loop. Do not leave it out.
- Anything else: print the usage line and stop.

## Step 1: find the runbook

```bash
ls -1t .kiro/ecc/plans/*.loop.md
```

- None found: say there is no loop in this project and point to `/ecc-loop-start`. Stop.
- Several: use the newest, and list the others by name.

Read the newest file. Take the facts from its list: pattern, mode, created time, loop branch, base commit, cap, test command, baseline result. If a fact is missing, say "not recorded" and go on.

## Step 2: read the state

```bash
git branch --show-current
git log --format='%h %cI %s' <base commit>..HEAD
git status --porcelain
git diff --stat <base commit>
```

From the progress log table count the rows (iterations done), find the last row whose result is green (the last good checkpoint), and look for a DONE or STOPPED line.

Run the stop condition from the runbook once, for example the test command, and keep the first error lines if it fails. Running the tests is the only command here that can take time. If the tests cannot run, say why.

If the pattern is `continuous-pr` or `rfc-dag`, also run:

```bash
node .kiro/ecc/scripts/feature-check.mjs workflows
```

Exit 0 means Workflows are on, so point to the Workflows panel (IDE) or the CLI workflow command (list runs, then status for one run). Any other exit means "not confirmed": print the script's text and rely on the progress log only.

## Step 3: cost so far

Count the days from the created time to now, rounded up, and run:

```bash
node .kiro/ecc/scripts/usage-report.mjs cost --days <days> --json
```

Report the credits for this workspace and the total, as credits and not dollars. The numbers cover every session in the period, not only the loop. If the script fails, say "cost not available".

## Step 4: report

Print these lines:

- Loop: slug, pattern, mode, branch, and whether the current branch is the loop branch.
- Phase: iteration count out of the cap, and DONE, STOPPED or running.
- Last good checkpoint: the row number, its commit and its time. "None yet" if there is none.
- Failing checks: the stop-condition result, with the first errors.
- Drift: time since created against iterations done, commits since the base, the size of the uncommitted change, and the credits from step 3.
- Recommendation: one of continue, pause or stop, with one sentence of reason.

Recommendation rules, first match wins:
1. DONE line, or the stop condition holds: stop. The loop has finished. Review the diff.
2. STOPPED line, or two iterations in a row without a commit, or the same check failing in the last two rows: pause. Read the log, fix the cause, then restart.
3. Iterations done have reached the cap: stop. Raise the cap only on purpose.
4. The working tree has many uncommitted changes and the last good checkpoint is old: pause, and ask the loop to commit or revert.
5. Otherwise: continue.

## Step 5: ways to act

End with the ways to act, as text for the user to type: `/goal clear` in the CLI session to stop the loop, and `git switch <starting branch>` to leave the loop branch.

If `--watch` was given, say first that chat cannot refresh by itself and this was one report. Then print this block for the user to run in a second terminal:

```bash
while true; do clear; git status -sb; git log --oneline -8; sleep 30; done
```
