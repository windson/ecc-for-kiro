---
source: "commands/loop-start.md"
sha256: "f12ce22d669072226a0df8a98f1421cc1318752e7a3e2d5eae0fe99cbb6f2f3c"
credit:
  - "Adapted from ECC (https://github.com/affaan-m/ECC) v2.2.3: commands/loop-start.md. MIT License, Copyright (c) 2026 Affaan Mustafa."
description: "Prepare a bounded autonomous loop: check the repo and the tests, write a runbook with a stop condition and an iteration cap, and print the lines that start and monitor it. It never starts the loop itself."
---
# Loop start

Prepare a managed loop and write its runbook. This command does not run the loop. A chat turn cannot type slash commands, so it prints the lines you paste to start it.

## Read ARGS

- `pattern`: `sequential` (default), `continuous-pr`, `rfc-dag` or `infinite`.
- `--mode safe` (default) or `--mode fast`.
- Any text left over is the objective.

If a value is not one of these, print the usage line and stop. Write nothing.

## Step 1: the repository

Run these with the shell tool, from the project root:

```bash
git rev-parse --show-toplevel
git branch --show-current
git rev-parse --short HEAD
git status --porcelain
date -u +%Y-%m-%dT%H:%M:%SZ
```

- Not a git repository: stop. A loop needs commits to roll back to.
- Note whether the tree is clean. A dirty tree is recorded in the runbook, not treated as an error.
- Branch strategy: the loop works on its own branch, `loop/<slug>`. The runbook holds the `git switch -c` line. This command does not change branches.

## Step 2: objective and stop condition

The objective comes from ARGS, or else from the conversation so far. If there is none, ask for it in chat and stop.

The loop needs a stop condition that a command can check. The default is the project's test command exiting 0. Find that command, in this order: the `test` script in `package.json` (run with the package manager the lock file shows), `make test`, `pytest`, `go test ./...`, `cargo test`, `gradle test`. If none exists and the objective gives no other checkable condition, stop and say so. Do not write a runbook for a loop that cannot tell when it is done.

## Step 3: baseline test run

Run the test command once. Record the result.

- Green: the baseline is green.
- Red: the baseline is red. Record the first error line. Safe mode and fast mode both put an "Iteration 0: restore green" item first in the runbook, and the stop condition still requires the test command to exit 0. No iteration builds new work on a red baseline.

## Step 4: which opt-in features are on

Run both checks and keep their text. A non-zero exit means "not confirmed on", and for the goal check that is always the answer, because Kiro documents no way to read the setting from a script.

```bash
node .kiro/ecc/scripts/feature-check.mjs goal
node .kiro/ecc/scripts/feature-check.mjs workflows
```

Rules, so the command fails closed:
- Never start iterations in this chat as a stand-in for a loop that is not confirmed. The only fallback is the manual one in the runbook: one iteration per prompt, run by the user.
- For `continuous-pr` and `rfc-dag`, the workflow recipe is marked usable only when the workflows check exits 0. Otherwise print its instructions and mark the recipe "not usable until Workflows are on". The goal line is still written.
- For `sequential` and `infinite`, skip the workflows check.

## Step 5: write the runbook

Pick a slug of lowercase letters, digits and hyphens: the pattern, then up to three words of the objective. If `.kiro/ecc/plans/<slug>.loop.md` exists, add `-2`, `-3` and so on. Never overwrite a runbook.

Write `.kiro/ecc/plans/<slug>.loop.md` with these sections, in this order:

1. A title and a list of facts: pattern, mode, created (UTC time), branch now, loop branch, base commit, clean or dirty tree, test command, baseline result, goal check result, workflows check result (or "not needed").
2. Objective.
3. Stop condition, written so that a command decides it. Example: "`<test command>` exits 0 and `<other check>` prints nothing".
4. Cap: the `--max` number. Defaults: sequential 10, continuous-pr 8, rfc-dag 10, infinite 25. The cap is never removed, including for `infinite`.
5. Iteration steps for the loop agent:
   - Read this runbook and the progress log.
   - Safe mode: run the test command first. If it is red, fix that before new work. If the same check fails in two iterations in a row, stop and write a STOPPED line.
   - Fast mode: skip that first run, and run the test command at the end of the loop and again before writing a DONE line.
   - Do one task from the task list.
   - Run the test command. Commit only on green, with the message `loop(<slug>): <task>`.
   - Never force-push, never merge, never push to the default branch.
   - Append one row to the progress log, then check the stop condition. When it holds, write a DONE line.
   - Stop and write a STOPPED line if two iterations in a row make no commit.
6. Task list: a checklist, with "Iteration 0: restore green" first when the baseline is red.
7. Progress log: an empty table with the columns `#`, `Time`, `Task`, `Result`, `Commit`.
8. Launch lines (below).
9. Monitor and stop (below).
10. Manual fallback: the user sends the prompt "Run exactly one iteration of the steps in `.kiro/ecc/plans/<slug>.loop.md`, then stop" up to cap times, and reads the progress log between runs.

### Pattern details

- `sequential`: the task list is ordered. One task per iteration.
- `continuous-pr`: each iteration takes one task on its own branch, runs the tests, and opens a pull request with `gh pr create` (if `gh auth status` fails, the iteration stops and says so). The loop never merges. Add the recipe skeleton below.
- `rfc-dag`: the task list is a table of units with a `depends on` column. An iteration takes the units whose dependencies are done. Units run one after another unless they touch disjoint files, because Kiro starts parallel branches at the same time in one workspace. Add the recipe skeleton below, with the same status file.
- `infinite`: there is no fixed task list. Each iteration picks the most valuable next change that moves toward the stop condition. The cap and the no-progress stop both stay.

### Recipe skeleton (continuous-pr and rfc-dag only)

Also write `.kiro/ecc/plans/<slug>.status.json` containing `{"complete": false}`. Put this skeleton in the runbook as text. Do not write it to `.kiro/workflows`: that folder always asks for approval, and the user decides whether to save it. Fill in `<slug>`, `<N>` and `<test command>`.

```json
{
  "name": "<slug>",
  "description": "Repeat: do the next runbook item, run the tests, open a pull request",
  "steps": [
    {
      "type": "repeat",
      "id": "loop",
      "maxIterations": <N>,
      "onMaxIterations": "pause",
      "stopCondition": { "fileCheck": { "path": ".kiro/ecc/plans/<slug>.status.json", "jsonPath": "complete", "value": true } },
      "steps": [
        {
          "type": "step",
          "id": "implement",
          "agent": "wf-coder",
          "prompt": "Follow .kiro/ecc/plans/<slug>.loop.md. Do the next unchecked item on its own branch, run `<test command>`, commit only on green, tick the item, and set complete to true in .kiro/ecc/plans/<slug>.status.json when the stop condition holds."
        },
        {
          "type": "step",
          "id": "submit",
          "agent": "wf-pr-submitter",
          "prompt": "Open a pull request for the branch from the previous step. Do not merge."
        }
      ]
    }
  ]
}
```

For `rfc-dag`, replace the `submit` step with a read-only `wf-planner` step that marks which units are now ready.

### Launch lines

Put these in the runbook and print them. Give the objective and stop condition in plain words, because the agent derives its acceptance criteria from that text.

```text
git switch -c loop/<slug>
/goal --max <N> <objective>. Done when <stop condition>. Follow .kiro/ecc/plans/<slug>.loop.md and append to its progress log.
```

For the two recipe patterns, add: "Workflows recipe: save the skeleton above as `.kiro/workflows/<slug>.workflow.json`, then start it from the Kiro CLI or the IDE Workflows panel." Mark it usable or not usable, as step 4 decided.

### Monitor and stop

- `/ecc-loop-status` reads the runbook, the progress log and git, and recommends continue, pause or stop.
- The Kiro CLI command `/goal clear` stops an active goal. Work already done stays on disk, and `git switch` back to the starting branch drops the loop branch from view.
- For the recipe, use the Workflows panel or the CLI workflow command to list runs and see a run's status.

## Step 6: print the result

Print, in this order: the runbook path, the baseline result, the goal check and workflows check text, the launch lines, and the next step. If the goal check did not confirm `/goal`, say that the user must type `/goal` in the Kiro CLI to see whether it exists, and that no loop has been started.
