---
source: "commands/orch-review.md"
sha256: "e95a1cee19945fa6280791cda1e1eee55d0f6c62ef510ac5fc9625c918ae6271"
credit: ["Adapted from ECC (https://github.com/affaan-m/ECC) v2.2.3: commands/orch-review.md and workflows/orch-review.workflow.js. MIT License, Copyright (c) 2026 Affaan Mustafa."]
description: "Review a diff (local uncommitted changes or a GitHub PR) with the ecc-orch-review workflow: parallel reviewers, duplicate merge, a fresh skeptic per blocking finding, then a verdict. Needs Workflows enabled and fails closed when they are off. For the checklist pass use /ecc-code-review, for the multi-agent pass use /ecc-review-pr."
---
# Orchestrated review

This command gathers a diff, starts the workflow recipe `ecc-orch-review`, and reports the result. The recipe (`.kiro/workflows/ecc-orch-review.workflow.json`) owns the fan-out: one reviewer per dimension, duplicate merge, and an independent skeptic for every CRITICAL or HIGH finding. This command owns the input and the report. It never edits source files and never commits.

Fail closed. If the review could not fully run, say so. Never print APPROVE in that case, never fall back to a review you write yourself, and never describe the diff as approved.

## Modes

Decide the mode from ARGS.

- Empty: local mode, review the uncommitted changes.
- A whole number, or a PR URL: PR mode.
- The word `report`: report mode. Skip to Phase 3. Use it after a run that was started earlier.
- Anything else: stop and say that the input is not a PR number, a PR URL or empty.

## Phase 1: gather

Create the work folder and clear the files of any earlier run. A stale `verify-state.json` or `verdict.json` would make the recipe skip work or report an old result.

```bash
mkdir -p .kiro/ecc/reviews/orch-review
rm -f .kiro/ecc/reviews/orch-review/input.diff .kiro/ecc/reviews/orch-review/findings.json .kiro/ecc/reviews/orch-review/verify-state.json .kiro/ecc/reviews/orch-review/verdict.json
```

Local mode:

```bash
git diff --name-only HEAD
git diff HEAD > .kiro/ecc/reviews/orch-review/input.diff
```

If git reports that this is not a repository, or that HEAD does not exist, stop and say so. Files that git does not track yet are not in the diff. If `git status --short` lists untracked source files, tell the user they are left out, and that `git add -N <file>` would include them.

PR mode needs the `gh` command. If it is missing, stop and suggest local mode on a checked-out branch. Never pass ARGS to the shell. Take a safe number from it first:

- A whole number of up to 9 digits: that is `<NUMBER>`.
- A URL that matches `^https://github\.com/([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)/pull/([0-9]{1,9})/?$`: the last group is `<NUMBER>`, and the first two are `<OWNER>` and `<REPO>`.
- Anything else, including extra text, shell characters, or a URL that is not a pull request: stop with an error.

Use only the extracted values. For a plain number:

```bash
gh pr diff <NUMBER> > .kiro/ecc/reviews/orch-review/input.diff
gh pr view <NUMBER> --json files --jq '.files[].path'
```

For a URL, add `--repo <OWNER>/<REPO>` to both commands. If the PR is not found, stop with an error.

Then check the diff file:

- If it is empty, print "Nothing to review." and stop. Start no run.
- If it is larger than about 300 KB, tell the user the review will be slow, and carry on.

Work out two values from the list of changed files and the diff:

- `language`: the dominant source language of the changed files (`.ts` and `.tsx` mean typescript, `.js`, `.jsx` and `.mjs` javascript, `.py` python, `.go` go, `.rs` rust, `.java` java, `.kt` kotlin, `.cpp` and `.cc` cpp, `.cs` csharp, `.rb` ruby, `.php` php, `.swift` swift). Use `none` for a mixed or non-code change. Ignore binary and generated files.
- `security`: `yes` when a changed path or an added line touches authentication, sessions, tokens, passwords, secrets, cryptography, permissions, SQL or other queries, file uploads, shell execution, deserialization, or HTML built from input. Use `no` only when the change is clearly documentation, tests, styles or configuration with no such content. When unsure, use `yes`.

## Phase 2: start the recipe

Check that Workflows are on. The script exits 0 only when it can confirm the setting.

```bash
node .kiro/ecc/scripts/feature-check.mjs workflows
```

If it exits with any other code, print its output as it is (it holds the steps to enable Workflows) and stop. Do not start a run and do not review the diff yourself. If the script is missing, say that the install is incomplete and stop.

Check that `.kiro/workflows/ecc-orch-review.workflow.json` exists. If not, stop and say the recipe is not installed.

Start the recipe with the workflow tool, with these inputs, and tell the user the workflow id when you have it:

- `diff_file`: `.kiro/ecc/reviews/orch-review/input.diff`
- `language`: the value from Phase 1
- `security`: the value from Phase 1

Run one review at a time, because the recipe writes to a fixed folder. If you have no tool that can start a workflow, say that this session cannot start one and stop. Do not review the diff by hand. Tell the user to start `ecc-orch-review` with those three inputs from the Workflows panel of the IDE, or from the workflow monitor of the CLI (the built-in workflow command), and to run this command again with `report` when the run has finished.

Wait for the run to finish by checking its status. If it ends as failed or aborted, report that, name the step that failed, and stop. If it is still running when you must end your turn, give the workflow id and say that `report` shows the result when the run is done.

## Phase 3: report

Read `.kiro/ecc/reviews/orch-review/verdict.json`. The file is the result. Do not use a verdict written in a step's chat message in its place.

- The file is missing, is not valid JSON, or has no `verdict`: say the review did not complete and print no verdict.
- Lead with `verdict` and a stats line (dimensions, how many raw findings became how many unique ones).
- List every `blocking` finding with its file, severity and evidence. They must be cleared before a commit. A finding with a note that it could not be verified stays blocking: call it out as needing manual confirmation.
- List the `advisory` findings briefly (MEDIUM, LOW, and items the skeptic refuted).
- If `incomplete` is true, name the dimensions in `failedDimensions` that did not run, and say the verdict is not a clean approval.
- Print APPROVE only when the file says APPROVE and `incomplete` is not true.

This command makes the human review gate. It commits nothing.

## Edge cases

- Binary and generated files: they add noise and no reviewable content. Leave them out of your language and security judgment.
- A PR diff is not applied to the working tree. The recipe knows this and judges findings from the diff only.
- The recipe names the agents `code-reviewer`, `security-reviewer`, `wf-review-aggregator` and `wf-planner`. If the run fails because one of them is missing, report which one, and stop.
