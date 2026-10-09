# ECC for Kiro: smoke test (D2)

This is the headless smoke test of the ECC-for-Kiro install in a real workspace. It is
Deliverable D2, run after the `ecc-kiro-setup` skill wizard (D1). It checks what a Kiro
agent actually sees once ECC is installed, and has the installed code reviewed by the
`code-reviewer` agent. Transcripts and the fixes list are in
[`smoke-test/`](smoke-test/).

- Workspace: `<project-root>` (ECC installed here).
- Tooling: `kiro-cli` 2.28.0, V3 engine (`--v3`), Node v22.22.0.
- Headless runs are filtered with `grep -vE '^\[INFO\]|ExperimentalWarning|^\(Use `node'`.
- Run budget for the whole workflow: at most 8 Kiro runs (D1 used 2). D2 used 2 (H2 run 1,
  H3). The planned H2 re-run was not needed (see H2 below), leaving budget unspent.
- Agents cannot open the Kiro IDE, so IDE-only checks are out of scope here. A short
  **manual IDE checklist belongs in the repo README (written by D4)** — see "What agents
  cannot check" at the end.

## H2 — what the default agent sees in this workspace

Headless, this workspace, **default agent** (no `--agent`), `--trust-tools=read`. The prompt
asked the agent to report only from its own current context (not by reading files): the
always-on steering it can see, whether it sees instructions from `.kimi-code/AGENTS.md` or
`.claude/`, the ECC-vs-other-harness precedence, the skills and agents available, and whether
any ECC hooks are active.

Command:
```
kiro-cli chat --v3 --no-interactive --trust-tools=read "<context probe prompt>"
```
Full transcript: [`smoke-test/h2-default-agent-run1.txt`](smoke-test/h2-default-agent-run1.txt).

Results:

| Question | What the agent reported |
|---|---|
| Always-on steering | **10** always-on ECC files: `ecc-agents`, `ecc-kiro-harness`, `ecc-coding-style`, `ecc-development-workflow`, `ecc-git-workflow`, `ecc-lessons-learned`, `ecc-patterns`, `ecc-performance`, `ecc-security`, `ecc-testing`. Matches `plan`'s "always on: 10 files". |
| `.kimi-code/AGENTS.md` or `.claude/` instructions (O4 / O17) | **NO.** The agent does not see those as loaded instructions; the paths appear only as names in the start-of-session file tree. |
| ECC vs other-harness precedence | Not applicable in the CLI — the other-harness instructions are not loaded, so there is nothing to prefer against. `ecc-kiro-harness` does map Claude wording to Kiro. |
| Skills available | **0** auto-loaded. Skills load on demand when a description matches (consistent with Task 4). The roster notes 88 skills exist in the project. |
| Agent roster | Visible: `planner`, `code-reviewer`, `architect`, … — 68 custom agents. |
| ECC hooks active | **None.** All 12 ECC hooks ship switched off; none fired. |

Interpretation:
- Always-on ECC steering loads correctly for the default agent (10 files), as planned.
- **O4 / O17 in the CLI:** the default agent in this workspace is **not** fed
  `.kimi-code/AGENTS.md` or `.claude/` content as instructions. In the Kiro CLI V3 the
  agent does not auto-load those harness files into context — they are only names in the
  file tree. So the CLI default agent is not contaminated by the other harnesses here.
  This is **not** proof that `.kiroignore` enforcement did it; the agent simply does not
  auto-load those files as steering, and O17's separate finding (that `--v3` did not block
  an *explicit read* of those files) still stands. Confirm `.kiroignore` enforcement in the
  **IDE** with `kiroAgent.agentIgnoreFiles` set — this is the IDE checklist item for D4.
- Because the agent does **not** see harness instructions, the conditional edit to
  `scripts/lib/baseline.mjs` ("follow the ECC steering") was **not required** and was **not
  made**. Nothing in `baseline.mjs` changed.

### plan preview, and why `update` was not run
After H2, `plan` was run on the workspace:
```
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs plan
```
Result: `create 0  update 0  unchanged 377  kept 0  conflicts 0  remove 0` — **"Nothing to
change: everything is already up to date."** The single allowed `update --yes` runs only when
`plan` shows changes to ECC-owned files and nothing else; it showed no changes at all, so
`update` was **not** run. `uninstall` was never run on the workspace. Workspace state did not
change, so no H2 re-run was needed.

## H3 — code review of the install engine

Headless, `--agent code-reviewer --trust-tools=read`. The prompt pointed the reviewer at the
two directories by absolute path and asked for severity-tagged findings on path traversal,
command injection, unsafe parsing, atomic-write/race, ReDoS, and swallowed errors, with an
explicit instruction not to manufacture findings.

Command:
```
kiro-cli chat --v3 --no-interactive --agent code-reviewer --trust-tools=read "<review prompt>"
```
Reviewed: `.kiro/skills/ecc-kiro-setup/scripts/lib` and `.../io`.
Full transcript: [`smoke-test/h3-code-reviewer.txt`](smoke-test/h3-code-reviewer.txt).

Result: **0 CRITICAL, 0 HIGH, 0 MEDIUM, 4 LOW. Verdict: APPROVE.** The reviewer confirmed
path confinement (`isSafeRelativePath` / `resolveInside` / `assertInsideProject`), no-shell
`execFile` for all git/exec, hostile-input parsing with `__proto__` rejection and typed
errors, atomic `wx`+rename writes, bounded/length-capped regexes, and narrow intentional
catches.

Findings and what was done, in full, are in [`smoke-test/fixes.md`](smoke-test/fixes.md).
Summary: no CRITICAL/HIGH to fix. One LOW (temp-filename collision in `io/files.mjs`) was
fixed test-first because it is cheap, internal, and user-invisible; the other three LOW items
(a redundant unguarded `stat`, a misleading log line, and a cosmetic anchor-slug difference)
are documented and left unchanged — no correctness or security impact.

### The one fix, test-first
- `io/files.mjs`: extracted an exported `tempName(file)` using 6 random bytes instead of
  `Date.now()`, so two writes in the same millisecond cannot collide. `writeFileAtomic`
  keeps its sibling-then-rename behavior; only the temp filename changed, so callers and
  on-disk results are identical.
- `test/files.test.mjs` (new, 6 tests): RED test freezes `Date.now` and asserts 1000 calls
  give 1000 distinct names (failed before the fix, passes after), plus behavior tests for
  `writeFileAtomic` and `readTextIfExists`.

## Verification

```
cd <project-root>/.kiro/skills/ecc-kiro-setup/scripts
node --test --test-reporter=spec test/*.test.mjs 2>&1 | grep -vE '^\s+\u2714' | grep -vE '^(\u25b6|\u2714) '
```
Final: **tests 1224, pass 1224, fail 0, skipped 0** (baseline 1218 + 6 new in
`files.test.mjs`).

## What agents cannot check (for the D4 README manual IDE checklist)

A Kiro agent cannot open the IDE, so these must be checked by a person and listed in the repo
README:
- **`.kiroignore` enforcement (O4 / O17):** add `.kiroignore` to the IDE's Agent Ignore Files
  setting (`kiroAgent.agentIgnoreFiles`), then ask Kiro to read a file under `.claude/` and
  check whether `.kimi-code/AGENTS.md` still loads. The CLI did not settle this (H2 shows the
  default agent does not auto-load those files, but that is not the same as `.kiroignore`
  blocking an explicit read; the V3 CLI did not block such reads in earlier tests).
- **Agent Hooks panel:** that it lists the 12 ECC hooks all switched off, and that the eye
  icon toggles `enabled` in the file.
- **Steering / Skills panels:** that the always-on steering and the 88 skills show up.
- **Slash menu:** that `/ecc-*` commands appear and pass argument text as expected.
