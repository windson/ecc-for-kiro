# Command adaptation map: ECC v2.2.3 commands to Kiro

Scope: all 94 files in `~/.cache/ecc-kiro/ECC-v2.2.3-c05b2d6/commands/`. Read-only investigation on 2026-10-07. Kiro CLI 2.28.0, V3 engine (`--v3`). Three headless probes ran in a scratch project that was removed afterwards. Upstream files outside the profile were fetched into scratch only; the cache was not touched.

## Summary

- Every command can ship as a Kiro-native `/ecc-<name>` manual steering file. None has to be excluded.
- Classes: **57 A** (deterministic rewrites only), **24 B** (Kiro-native rewrite), **13 C** (cannot work with the installed set until a small piece is added).
- The 13 C commands are the 7 `epic-*`, the 5 `orch-*` wrappers and `plan-canvas`. Each has a named missing piece and an alternative (part 2). Kiro itself blocks none of them.
- Keep manual steering as the vehicle. The IDE lists it in the `/` menu (documented), the CLI V3 resolves it (probed), the model never auto-activates it, and it adds nothing to the skill catalog. Skills substitute `$ARGUMENTS` only in the CLI. Prompt files (`.kiro/prompts`) are CLI V3 only.
- Arguments (probe 1): `/ecc-foo bar` reaches the agent as the raw user message. The steering body arrives as a separate `steering_inclusion` record with the frontmatter removed. `$ARGUMENTS`, `$1` and `$@` are not substituted. Each `$ARGUMENTS` must become a named value that a header defines once.
- Validation (probes 1 to 3): `kiro-cli chat --v3 --no-interactive --trust-tools=read,write,shell,subagent "/ecc-<name> <args>"` resolves the steering file, writes artifacts and delegates to installed Markdown agents. Trust flags reach sub-agents.
- Ship text as overlays: deterministic rules (part 1) for A, authored overlay files for B. Both are pinned to the sha256 of the ECC file they came from, so a new ECC release flags them stale. The plan's "body verbatim" rule is replaced.
- New owned pieces for B: `hookify-guard.mjs` plus a disabled hook file, `usage-report.mjs`, an `ecc-kiro.mjs audit` subcommand (and `update` from Task 8), three read-only panel agents, one workflow recipe, and a lint test.
- One claim is not proven: that a sub-agent applies the `model:` in its agent file. Docs say so for agents and for workflow steps. Probe 3 could not show it. The multi-model commands need the check in B2.
- Seven decisions are in part 5. The largest is whether the profile may grow beyond the Kimi-derived set (unblocks 12 of the 13 C commands).

## 1. Rewrite rules

Each installed file is: frontmatter (`inclusion: manual`, quoted `description`), header S1, then the ECC body with rules R1 to R16 applied. B commands replace the body with an authored overlay. Counts are hits / files over the 94 commands.

Snippets:
- S1 header: "Invoked as `/ecc-<name>`. ARGS is the text after `/ecc-<name>` in the user's latest message. If invoked with `#ecc-<name>`, ARGS is the rest of that message. Empty ARGS follows the no-argument path. Usage: `/ecc-<name> <argument-hint>`."
- S2 delegation: "Delegate with the sub-agent tool by agent name. The sub-agent returns its result when done. If the agent is missing, do the work yourself and say so."
- S3 skill limits: "Skill folder name equals `name`, lowercase letters, digits and hyphens, at most 64 characters. Description at most 1024 characters."

| # | ECC construct (hits / files) | Kiro rewrite | Doc |
|---|---|---|---|
| R1 | `$ARGUMENTS` (71 / 31) | Replace with `ARGS`; add S1. Steering does no substitution (probe 1). | https://kiro.dev/docs/ide/chat/slash-commands.md |
| R2 | Slash references to ECC commands (402 / 79), `/ccg:plan`, `/ccg:execute`, `/project:gan-build`, bare `/workflow`, `/verify` | Prefix `/ecc-`. `/ccg:plan` to `/ecc-multi-plan`, `/ccg:execute` to `/ecc-multi-execute`, `/project:gan-build` to `/ecc-gan-build`, `/workflow` (multi-workflow) to `/ecc-multi-workflow`, `/verify` (checkpoint) to skill `verification-loop`. Match only after line start, whitespace, backtick, quote or bracket. `/plan`, `/checkpoint`, `/sessions`, `/workflow` are Kiro CLI built-ins. | https://kiro.dev/docs/reference/slash-commands.md |
| R3 | Frontmatter `argument-hint` (12), `name` (9), `command` (8), `disable-model-invocation` (2), `allowed-tools` (2), `agent` (1), `subtask` (1) | Keep `inclusion: manual` and `description`. Move `argument-hint` into S1. Turn `agent: ecc:X` plus `subtask: true` into one sentence using S2. Drop the rest; tool limits exist only on agents. The model never sees frontmatter (probe 1). | https://kiro.dev/docs/steering.md |
| R4 | `~/.claude/skills`, `.claude/skills` (17 / 9, incl. instinct CLI paths) | `~/.kiro/skills`, `.kiro/skills`; add S3 where skills are written. | https://kiro.dev/docs/skills.md |
| R5 | `~/.claude/session-data`, `~/.claude/sessions`, `session-aliases.json` (17 / 3) | `${KIRO_HOME:-$HOME/.kiro}/ecc/session-data/` and `.../ecc/session-aliases.json`. Legacy folder lookup removed. | https://kiro.dev/docs/reference/settings.md |
| R6 | `${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py` and `~/.claude/skills/...` fallback (27 / 9), 11 `node -e` root resolvers (4 files; the 2 `node -e` report scripts in cost-report are replaced in B5), `~/.claude/homunculus` (9 / 5) | `python3 .kiro/skills/continuous-learning-v2/scripts/instinct-cli.py <sub>`, else `~/.kiro/skills/...`. Delete the resolver blocks. Data dir is what the CLI prints (default `~/.local/share/ecc-homunculus/`, override `CLV2_HOMUNCULUS_DIR`; `instinct-cli.py` `_resolve_homunculus_dir`, lines 54 to 67). | https://kiro.dev/docs/skills.md |
| R7 | `.claude/{plans,plan,prds,reviews,PRPs,campaigns,checkpoints.log,docs,scripts,commands}` and `.claude/hookify.*`, `.claude/package-manager.json` (73 / 23) | `.kiro/ecc/<same>` (for example `.kiro/ecc/plans/x.plan.md`). Exceptions: `.claude/commands/*.md` (pm2) to `.kiro/steering/*.md`; hookify rules to `.kiro/ecc/hookify/`. Undeclared `.kiro` folders ask only while the workspace is untrusted; `.kiro/agents`, `hooks`, `workflows`, `powers` always ask. | https://kiro.dev/docs/permissions.md |
| R8 | `CLAUDE.md` (11 / 4), `.claude/docs`, `MEMORY.md` | `AGENTS.md` and `.kiro/steering/`. | https://kiro.dev/docs/steering.md |
| R9 | `Task tool`, `Agent tool`, `subagent_type` (10 / 6); `AskUserQuestion` (6 / 5); `mcp__srv__tool` (12 / 5); `WebFetch`, `WebSearch` (2 / 1); `TodoWrite` (0); `TaskOutput`, `run_in_background` | "Delegate to sub-agent X" (S2). "Ask in chat and wait" (Kiro has no question tool). `@srv/tool`. Web tools. `todo_list` does not exist in V3. Polling is unneeded; sub-agents return to the parent. | https://kiro.dev/docs/custom-agents/subagents.md, https://kiro.dev/docs/tools.md |
| R10 | `Claude Code` (14 / 11), bare `Claude` (58 / 19), `Anthropic` (2 / 2), `opus`/`sonnet`/`haiku` (10 / 4) | "Kiro" or "the agent". No model literals; B commands read the live model list. | https://kiro.dev/docs/models/available-models.md |
| R11 | ECC-repo scripts and env: `scripts/*.js` references (17 commands), `ECC_*` (16 / 5), `codeagent-wrapper` (20 / 6), `.ccg/` prompts (41 / 6) | Only scripts installed to `.kiro/ecc/scripts/` may be named (`quality-gate.sh`, `format.sh`). Everything else is class B or C. | plan Task 6 |
| R12 | Hook ids and events: `PreToolUse`, `PostToolUse` (4 / 2), ECC hook ids `post:quality-gate`, `stop:cost-tracker` (5 / 2) | `Stop`, `PreToolUse`, `PostToolUse` keep their names in Kiro v1; other triggers are `UserPromptSubmit`, `SessionStart`, `PostFileSave`. Exit 2 blocks. ECC hook ids are dropped (B5, B10). Claude's `PreCompact` and `SubagentStop` have no Kiro trigger. | https://kiro.dev/docs/hooks/types.md |
| R13 | 27 uninstalled skill names in 31 commands | Append "(optional skill, not installed)". The six `orch-*` names are not optional (class C). | https://kiro.dev/docs/skills.md |
| R14 | `ecc:` agent prefix (1 / 1) | Bare agent name. | https://kiro.dev/docs/custom-agents/creating.md |
| R15 | `everything-claude-code` (55 / 4), `marketplaces/` (22 / 4) | Removed with the resolver blocks (R6). | n/a |
| R16 | `~/.claude/{metrics,loops,projects,bin,.ccg}` (62 / 9) | Handled by B designs only. | part 3 |

Lint: none of these may appear in an installed command (run on the final text).

```
~/.claude  $HOME/.claude  (^|[^\w/])\.claude/  CLAUDE\.md  CLAUDE_[A-Z_]+  ECC_(HOOK|QUALITY|ROOT)
\$ARGUMENTS  \$[1-9@]  \bTask tool  \bAgent tool  subagent_type  TodoWrite  AskUserQuestion
TaskOutput  run_in_background  mcp__  Claude Code  \bClaude\b  Anthropic  \b(opus|sonnet|haiku)\b
everything-claude-code  marketplaces/  codeagent-wrapper  \.ccg/  /ccg:  /project:  node -e
(allowed-tools|agent|subtask|command|disable-model-invocation|argument-hint):   (frontmatter)
(^|[\s`"'(])/(plan|checkpoint|sessions|workflow|<any ECC command name>)\b     (needs ecc- prefix)
stop:cost-tracker  post:quality-gate  scripts/hooks/  session-manager
a backticked uninstalled skill name without "(optional skill, not installed)"
```

Required: frontmatter is the first content; `inclusion: manual`; header S1 present.

## 2. Per-command table

Every row also gets S1, R3 and R2 (where slash references exist). Class B rows point to part 3. Class C rows give the missing piece and an alternative below the table.

| Command | Claude-specific constructs | Class | Target Kiro feature, rules or missing piece |
|---|---|---|---|
| aside | none | A | R2. Native extra: CLI `/tangent` |
| auto-update | `CLAUDE_PLUGIN_ROOT`, `node -e` resolver, `scripts/auto-update.js` | B | B7. `ecc-kiro.mjs update`; blocked until Task 8 |
| build-fix | none | A | header only |
| checkpoint | ARGS, `.claude/checkpoints.log`, `/verify quick` | A | R1 R2 R7. Native extra: IDE checkpoints, CLI `/rewind` |
| code-review | ARGS, `.claude/{prds,plans,reviews,PRPs}`, `CLAUDE.md` | A | R1 R7 R8 |
| cost-report | `~/.claude/metrics/costs.jsonl`, `stop:cost-tracker`, Claude Code | B | B5 usage-report over Kiro sessions |
| cpp-build | dangling `cpp-coding-standards` | A | R13 |
| cpp-review | dangling `cpp-coding-standards`, `cpp-testing` | A | R13 |
| cpp-test | dangling `cpp-testing` | A | R13 |
| ecc-guide | none; name equals installed skill | A | Do not register. Skill gives `/ecc-guide`; add Kiro path map to harness steering (Q6) |
| epic-claim | `node scripts/github-coordination.js claim` | C | Missing: coordination closure (C1). Alt: C1 |
| epic-decompose | same script | C | C1 |
| epic-publish | same script | C | C1 |
| epic-review | same script | C | C1 |
| epic-sync | same script, `/work-items` | C | C1 |
| epic-unblock | same script | C | C1 |
| epic-validate | same script | C | C1 |
| evolve | `~/.claude/homunculus`, `CLAUDE_PLUGIN_ROOT`, `model: sonnet`, Claude-format output | B | B9 |
| fastapi-review | dangling `fastapi-patterns`, `security-scan` | A | R13 |
| feature-dev | none | A | header only |
| flutter-build | dangling `flutter-dart-code-review` | A | R13 |
| flutter-review | dangling `flutter-dart-code-review` | A | R13 |
| flutter-test | dangling `flutter-dart-code-review` | A | R13 |
| gan-build | ARGS, `Task tool` x3 | A | R1 R9. Default eval mode `playwright` needs a Playwright MCP server; test with `code-only` |
| gan-design | ARGS, `/project:gan-build` | A | R1 R2 |
| go-build | dangling `golang-patterns` | A | R13 |
| go-review | dangling `golang-patterns`, `golang-testing` | A | R13 |
| go-test | dangling `golang-testing` | A | R13 |
| gradle-build | none | A | header only |
| harness-audit | ARGS, `node scripts/harness-audit.js`, Claude-layout checks | B | B6 |
| hookify | `.claude/hookify.*.local.md`, Claude Code hooks | B | B1 |
| hookify-configure | `.claude/hookify.*.local.md` | B | B1 |
| hookify-help | Claude Code hook system | B | B1 |
| hookify-list | `.claude/hookify.*.local.md` | B | B1 |
| instinct-export | frontmatter `name`, `command` | A | R3 |
| instinct-import | `~/.claude/homunculus`, `CLAUDE_PLUGIN_ROOT`, python3 | A | R3 R6 |
| instinct-status | same, plus `node -e` resolver | A | R3 R6 |
| jira | dangling `jira-integration`, MCP tool `jira_get_issue` | A | R13. Needs MCP server `jira` from `.kiro/ecc/mcp.json.example` |
| kotlin-build | dangling `kotlin-patterns` | A | R13 |
| kotlin-review | dangling `kotlin-patterns`, `kotlin-testing` | A | R13 |
| kotlin-test | dangling `kotlin-testing` | A | R13 |
| learn | `~/.claude/skills`, Claude Code | A | R4 R10 |
| learn-eval | `~/.claude/skills`, `.claude/skills`, `MEMORY.md`, Claude Code | A | R4 R8 R10 |
| loop-start | ARGS, `.claude/plans`, `ECC_HOOK_PROFILE`, dangling `continuous-agent-loop` | B | B3 |
| loop-status | ARGS, `~/.claude/projects`, `ScheduleWakeup`, `npx ecc loop-status`, `~/.claude/loops` | B | B3 |
| marketing-campaign | `allowed-tools`, `.claude/campaigns/`, dangling skill `marketing-campaign` | A | R3 R7 R13 |
| model-route | ARGS, opus/sonnet/haiku | B | B11 |
| multi-backend | ARGS, `codeagent-wrapper`, `.ccg/` roles, `AskUserQuestion`, `mcp__ace-tool__*`, `.claude/plan/` | B | B2 |
| multi-execute | same, plus `Task(Explore)`, SESSION_ID resume | B | B2 |
| multi-frontend | same as multi-backend | B | B2 |
| multi-plan | same, plus `Task(Explore)` | B | B2 |
| multi-workflow | same, plus bare `/workflow` | B | B2 |
| orch-add-feature | ARGS; skills `orch-add-feature`, `orch-pipeline` missing | C | C2 |
| orch-build-mvp | ARGS; skills `orch-build-mvp`, `orch-pipeline` missing | C | C2 |
| orch-change-feature | ARGS; skills `orch-change-feature`, `orch-pipeline` missing | C | C2 |
| orch-fix-defect | ARGS; skills `orch-fix-defect`, `orch-pipeline` missing | C | C2 |
| orch-refine-code | ARGS; skills `orch-refine-code`, `orch-pipeline` missing | C | C2 |
| orch-review | ARGS, `Workflow()` tool, `workflows/orch-review.workflow.js` | B | B12 (needs Workflows enabled) |
| plan | `.claude/plans`, Task tool sentence | A | R2 R7 R9. Built-in `/plan` is separate |
| plan-canvas | `ecc-plan-canvas` CLI, `.claude/plans`, Stop hook | C | C3 |
| plan-prd | ARGS, `.claude/prds` | A | R1 R7 |
| pm2 | ARGS, `.claude/commands`, `.claude/scripts`, `CLAUDE.md` | B | B8 |
| pr | ARGS, `.claude/{prds,plans,PRPs}` | A | R1 R7 |
| project-init | `install-plan.js`, `install-apply.js`, `--target claude`, `CLAUDE.md` | B | B7 |
| projects | `~/.claude/homunculus`, `CLAUDE_PLUGIN_ROOT` | A | R3 R6 |
| promote | same | A | R3 R6 |
| prp-commit | ARGS | A | R1 |
| prp-implement | ARGS, `.claude/PRPs` | A | R1 R7 |
| prp-plan | ARGS, `.claude/PRPs` | A | R1 R7 |
| prp-pr | ARGS, `.claude/PRPs` | A | R1 R7 |
| prp-prd | ARGS, `.claude/PRPs` | A | R1 R7 |
| prune | same as promote | A | R3 R6 |
| python-review | dangling `python-patterns`, `python-testing` | A | R13 |
| quality-gate | hook stdin JSON, `scripts/hooks/quality-gate.js`, `ECC_QUALITY_GATE_*`, `post:quality-gate` | B | B10 |
| react-build | dangling `react-patterns` | A | R13 |
| react-review | dangling `accessibility`, `react-patterns`, `react-testing` | A | R13 |
| react-test | dangling `accessibility`, `react-testing` | A | R13 |
| refactor-clean | none | A | header only |
| resume-session | `~/.claude/session-data`, legacy `~/.claude/sessions` | A | R5 R2 |
| review-pr | `CLAUDE.md` | A | R8 |
| rust-build | dangling `rust-patterns` | A | R13 |
| rust-review | dangling `rust-patterns`, `rust-testing` | A | R13 |
| rust-test | dangling `rust-patterns`, `rust-testing` | A | R13 |
| santa-loop | Agent tool with `subagent_type` and `model: opus`, `codeagent-wrapper`, external CLIs | B | B2 |
| save-session | `~/.claude/session-data`, `session-manager.js`, Claude Code | A | R5 R10 |
| security-scan | `agent: ecc:security-reviewer`, `subtask`, `.claude/` example, `npx ecc-agentshield` | A | R3 R7 R14. Scanner coverage of `.kiro/` is unverified |
| sessions | `session-manager`, `session-aliases` via `node -e`, `CLAUDE_PLUGIN_ROOT` | B | B4 |
| setup-pm | `scripts/setup-package-manager.js`, `CLAUDE_PACKAGE_MANAGER`, `.claude/package-manager.json` | B | B7 |
| skill-create | `.claude/skills`, `~/.claude/skills`, Claude Code, `allowed-tools` | A | R3 R4 R10 |
| skill-health | `scripts/skills-health.js`, `lib/skill-evolution`, `~/.claude/state/skill-runs.jsonl` | B | B5 (reduced panels) |
| test-coverage | none | A | header only |
| update-codemaps | none | A | header only |
| update-docs | none | A | header only |
| vue-review | dangling `vue-patterns` | A | R13 |

Missing pieces (class C), with evidence:
- C1 `epic-*` (7). The bodies are 22 to 26 line stubs around `node scripts/github-coordination.js <verb>`. The closure is 13 files: 8 coordination files (1,384 lines: `scripts/github-coordination.js`, `scripts/lib/github-coordination.js`, six files in `scripts/lib/github-coordination/`) and the 5-file `scripts/lib/state-store/` (1,975 lines; needs npm `sql.js@1.14.2` and `ajv@8.20.0`; `store.js` line 5 requires it at load, and `state-store/index.js` line 21 defaults to `~/.claude/ecc/state.db`, overridable with `--db`). Only that default path is harness-specific, and none of it is in the profile. Smallest fix: add the 13 files plus the two npm packages, then the commands become class A. Alternative without ECC code: drive `gh issue` directly in the command body; this loses the coordination-block grammar and policy checks.
- C2 `orch-*` (5). The wrappers say "invoke the X skill". Six markdown skills are missing: `orch-pipeline`, `orch-add-feature`, `orch-build-mvp`, `orch-change-feature`, `orch-fix-defect`, `orch-refine-code` (43 to 121 lines each, no tool-specific constructs beyond `/gan-build` and `CLAUDE.md`). Smallest fix: add those six to the profile (class A after that). Alternative: inline the skill text into each overlay.
- C3 `plan-canvas` (1, and the installed skill of the same name). It needs the `ecc-plan-canvas` CLI: `scripts/plan-canvas.js`, `scripts/lib/plan-canvas/{markdown,sdk,server,sessions,ui}.js`, `scripts/lib/platform-launch.js`, `scripts/lib/loopback-guard.js` (about 2,800 lines, Node built-ins only), a long-running `await` process, and the Claude Stop hook `stop:plan-canvas-pending`. The only Claude-specific code path in it is the state folder `~/.claude/plan-canvas` (`sessions.js` line 22, overridable with `ECC_PLAN_CANVAS_STATE_DIR`). The same CLI ships in npm `ecc-universal@2.2.3` (MIT, github.com/affaan-m/ECC, 19.5 MB). Smallest fix: those nine files or `npx --package ecc-universal@2.2.3 ecc-plan-canvas`, plus a Kiro `Stop` hook that blocks while feedback is pending. Alternative (recommended): Kiro plan mode and spec approval, or `/ecc-plan` whose confirmation gate already exists.

## 3. Designs and validation recipes

Common harness: `mktemp -d` scratch project, sandbox install (`ecc-kiro.mjs install --root <scratch> --yes`), then the probed command form (part 4). Evidence is stdout, artifacts, and the records in `~/.kiro/sessions/<hash>/sess_*/messages.jsonl`.

A-class check (57 commands): lint passes; the session log has a `steering_inclusion` record with `displayName` `ecc-<name>`; plus one smoke test per family.
- Review (`*-review`, `code-review`, `review-pr`): seeded defect in an uncommitted change. Proof: the finding cites that file and line, and the log has `sub_agent_start` for the named reviewer.
- Build and test (`*-build`, `build-fix`, `*-test`, `test-coverage`, `refactor-clean`, `gradle-build`): one compile error or one missing test. Proof: the build or test command exits 0 afterwards with a minimal diff.
- Planning (`plan`, `plan-prd`, `prp-*`, `feature-dev`): proof is the artifact under `.kiro/ecc/{plans,prds,PRPs}/` with the template headings, and `git status` shows no other change (plan commands wait for confirmation).
- Git (`pr`, `prp-pr`, `prp-commit`): local bare remote. Proof: the commit or push lands there; `gh` steps stop with a clear message when unauthenticated.
- State (`save-session`, `resume-session`, `checkpoint`, `learn`, `learn-eval`, `skill-create`, `instinct-*`, `projects`, `promote`, `prune`): proof is the session file, a line in `.kiro/ecc/checkpoints.log`, a `SKILL.md` folder that passes the skill validator, or instinct CLI output from a seeded `CLV2_HOMUNCULUS_DIR`.
- Others: `aside` (answer ends with the "Back to task" line, no file changes); `gan-build` and `gan-design` with `--eval-mode code-only --max-iterations 1` (`gan-harness/spec.md`, `feedback/feedback-001.md`, two `sub_agent_start` records); `security-scan` (a fixture secret is found; confirm the scanner reads `.kiro/`); `jira` (no MCP server gives a clear setup message); `marketing-campaign` (files under `.kiro/ecc/campaigns/`); `update-codemaps`, `update-docs` (generated docs).

### B1 Hookify (hookify, hookify-list, hookify-configure, hookify-help)
Target: v1 hooks in `.kiro/hooks/*.json`. https://kiro.dev/docs/hooks.md
- Rules keep ECC's format in `.kiro/ecc/hookify/<name>.local.md` (name, enabled, event `bash|file|stop|prompt|all`, action `block|warn`, pattern).
- The installer ships one static file `.kiro/hooks/ecc-hookify.json`, disabled: `PreToolUse` on `shell` and on `write`, `UserPromptSubmit`, and `Stop`, each running `node .kiro/ecc/scripts/hookify-guard.mjs <event>`.
- The guard is new owned code (about 80 lines, no dependencies). It reads the hook JSON on stdin and tests enabled rules against `tool_input.command`, `tool_input.path` (session logs show `args.command` and `args.path`) or the prompt text. `block` exits 2 with the rule message on stderr; on `Stop` it prints `{"decision":"block","reason":"..."}`. `warn` exits 1, which shows a warning and lets the run continue.
- `/ecc-hookify` writes rule files only, so it never touches the always-ask `.kiro/hooks` folder. list and configure read and edit the same files. help documents the Kiro event mapping.
Validate: enable the hook in the scratch project. Run `/ecc-hookify never run rm -rf`, then headless "run: rm -rf victim" with `--trust-tools=shell`. Proof: `victim/` still exists and the block message shows. Also `echo '{"tool_input":{"command":"rm -rf x"}}' | node hookify-guard.mjs bash` exits 2.

### B2 Model panel (multi-plan, multi-execute, multi-backend, multi-frontend, multi-workflow, santa-loop)
Target: sub-agents with their own `model:`. https://kiro.dev/docs/custom-agents/subagents.md, https://kiro.dev/docs/cli/v3/agent-config.md
- Install three read-only agents `ecc-panel-backend`, `ecc-panel-frontend`, `ecc-panel-reviewer` (`tools: ["read"]`). This keeps ECC's rule that external models never write; the main agent is the only writer. Role prompts are short owned text because ccg-workflow's `.ccg/prompts/*` are not in ECC.
- The installer sets `model:` from `kiro-cli chat --list-models` by family (one GPT model for backend, another family for frontend and reviewer) and omits it when none is found. Today's list has `gpt-5.6-terra`, `gpt-5.6-luna`, `claude-opus-5`, `deepseek-3.2`, `glm-5`, `minimax-m2.5` and no Gemini model, so the Antigravity role falls to another family.
- Phases stay. Analysis and plan drafts: two sub-agent calls in one turn (parallel), the main agent synthesizes and saves `.kiro/ecc/plan/<feature>.md`, then stops. Execute: panel agents return a unified diff as text, the main agent refactors and applies it, panel reviewers audit in parallel.
- Removed: `codeagent-wrapper`, polling, SESSION_ID resume (the plan file carries context), `AskUserQuestion`. The `ace-tool` steps apply only if an `@ace-tool` MCP server exists; otherwise use `code`, `grep_search` and the built-in context-gatherer sub-agent.
- santa-loop: Reviewer A is `code-reviewer`, Reviewer B is `ecc-panel-reviewer`. The `codex exec --sandbox read-only` and `gemini -p` branches stay as optional shell detection; the antigravity wrapper branch goes. The three-round cap, fresh reviewers per round and push-only-after-NICE stay.
- Workflows variant (optional): a `parallel` node with per-step `modelId`. https://kiro.dev/docs/workflows/authoring.md
Validate: scratch git repo with one seeded bug; `/ecc-santa-loop src/bug.ts` with `--trust-tools=read,write,shell,subagent`. Proof: two `sub_agent_start` records (`code-reviewer`, `ecc-panel-reviewer`) and a `SANTA VERDICT` block. For model proof, run with `--output-format stream-json` and look for a model per sub-session. If none shows, the command must label the panel "multi-perspective".

### B3 Loops (loop-start, loop-status)
Target: `/goal` (CLI) and recipes in `.kiro/workflows/`, both opt-in. https://kiro.dev/docs/cli/chat/goal.md
- loop-start keeps the safety checks (tests green first, explicit stop condition, branch strategy) and writes the runbook `.kiro/ecc/plans/<loop>.loop.md`.
- Instead of `claude -p` commands, the runbook holds a paste-ready `/goal --max <N> <objective and verifiable stop condition>`. For `continuous-pr` and `rfc-dag` it also holds a recipe skeleton (`repeat` with `maxIterations` and `stopCondition`, `parallel` branches, per-step `modelId` and `effortLevel`). The agent cannot run slash commands, so it prints them.
- `--mode safe` runs tests before each iteration; `fast` runs them at the end. The `ECC_HOOK_PROFILE` check goes.
- loop-status reads runbooks, `git log` and `git status`, and tells the user to run `/workflow list` and `/workflow status <id>` (CLI) or open the Workflows panel (IDE). The transcript scanner and `npx ecc loop-status` parts go.
- Both features are off in the probe sessions (`workflows.enabled` and `goal.enabled` false). The commands say how to enable them (`/settings`, Features) and fall back to a bounded in-chat loop.
Validate: scratch repo with one failing test; `/ecc-loop-start sequential --mode safe`. Proof: `.kiro/ecc/plans/*.loop.md` exists with a `/goal --max` line whose stop condition names the test command. The loop itself needs an interactive CLI with goal enabled; run the printed line once and confirm the test passes.

### B4 Saved sessions (sessions)
Target: plain files plus Kiro's native history. https://kiro.dev/docs/cli/chat/session-management.md
- save-session and resume-session (class A) own the files in `${KIRO_HOME:-$HOME/.kiro}/ecc/session-data/`.
- sessions becomes list, load, alias, unalias, aliases and info using shell and read tools. `ls -1t` finds `*-session.tmp`; headers come from the first lines; aliases live in `.../ecc/session-aliases.json`. The `session-manager` and `session-aliases` modules go.
- The command ends with pointers to native history (CLI V3 `/sessions`, `/chat resume`, `--list-sessions`, IDE history). Those list chat transcripts, not handoff files.
Validate: write `2099-01-01-adaptmap-session.tmp` into the session folder; run `list`, `alias adaptmap test-alias`, `load test-alias`. Proof: the list shows the file, `session-aliases.json` has the alias, load prints the file. Delete both files afterwards.

### B5 Usage reports (cost-report, skill-health)
Target: Kiro's local session log. Each `messages.jsonl` holds `usage_summary` records (`promptTurnSummaries[].usage`, unit credit) and `tool_call` records. A skill activation is `tool_call` with `toolName: disclose_context` and `args.name`. The local store had 69 sessions and 149 usage records.
- New owned script `.kiro/ecc/scripts/usage-report.mjs` (no dependencies). It reads numbers, dates, tool names and `session.json` fields (`modelId`, `title`, `workspacePaths`) and never prints message text. It honors `KIRO_HOME`.
- cost-report: credits per day, per model id, per workspace, last seven days, CSV with `csv`. It says credits, not dollars. `/usage` (CLI) still gives the balance.
- skill-health: activations per installed skill over 30 days, last used, never used. Success rate, failure clusters, amendments and version history are dropped: ECC's tracker writes `~/.claude/state/skill-runs.jsonl` (`tracker.js` line 29) from Claude hooks, and nothing feeds it in Kiro.
- Risk: the log format is internal (`schemaVersion` 1.0.0). The script must skip unknown records.
Validate: run any headless prompt, then `/ecc-cost-report`. Proof: today's total includes that session's `usage_summary` value (compare with `python3` on the same `messages.jsonl`). For skill-health, run a prompt that activates `tdd-workflow` and check the count rises by one.

### B6 Harness audit (harness-audit)
Target: a Kiro rubric in `ecc-kiro.mjs audit [scope] --json`, next to `doctor`.
- ECC's `harness-audit.js` runs, but its consumer checks look for `.claude/plugins`, `.claude/settings.json`, `hooks/hooks.json` and `.opencode/commands` (lines 827 to 873). A Kiro project would score low for the wrong reasons. Keep the file pinned as reference only.
- Keep the categories and the output contract (`overall_score`, `max_score`, `categories[]`, `checks[]`, `top_actions[]`), but probe Kiro surfaces: always-on steering size (25 KB cap), `.kiro/skills`, `.kiro/agents`, `.kiro/hooks` guards, `.kiro/settings/mcp.json`, `AGENTS.md`, `.kiroignore`, package test and lint scripts, `.github/workflows`.
- Until the subcommand exists the command runs `doctor --json` plus the rubric in its body and calls the score advisory.
Validate: two fixtures (empty project; project with steering, tests and `AGENTS.md`). Run `/ecc-harness-audit repo --format json` on both. Proof: valid JSON, a higher score on the second, and identical output on a repeat run.

### B7 Installer-facing commands (setup-pm, project-init, auto-update)
- setup-pm: keep the detection order (env `ECC_PACKAGE_MANAGER`, `.kiro/ecc/package-manager.json`, `package.json` `packageManager`, lock file, `~/.kiro/ecc/package-manager.json`, then pnpm, bun, yarn, npm). The agent does it with shell checks; `--list` uses `command -v`. The harness steering gets one line telling the agent to read the config, because nothing else consumes it.
- project-init: keep the stack signals and the dry-run-first rule. The engine becomes `ecc-kiro.mjs doctor --json`, then `plan --json`, then `install --yes` only after approval. Other `--target` values go. The `CLAUDE.md` starter becomes an `AGENTS.md` starter that is never overwritten. `config/project-stack-mappings.json` is not installed, so stacks map to the installed `ecc-*` language steering.
- auto-update: `ecc-kiro.mjs update --dry-run`, then `update --yes` (Task 8). It re-syncs managed files with the pinned release. Pulling upstream ECC at runtime is not possible because the profile is hash-pinned; new ECC versions arrive as a new ecc-for-kiro release. Until `update` exists the command says it is unavailable and stops.
Validate: project-init in a scratch Node project with `--trust-tools=read,shell`; proof: the output quotes the `plan --json` counts and `find .kiro -newer` shows no writes. setup-pm `--project pnpm`: proof is `.kiro/ecc/package-manager.json` containing `pnpm`. auto-update after Task 8: `update --dry-run` reports zero changes on a fresh sandbox install.

### B8 PM2 (pm2)
Target: generated manual steering. https://kiro.dev/docs/steering.md
- Service detection, `ecosystem.config.cjs` and port rules are unchanged.
- The per-service files ECC writes to `.claude/commands/pm2-*.md` become `.kiro/steering/pm2-*.md` with `inclusion: manual`, so `/pm2-all`, `/pm2-<port>` and `/pm2-status` appear in the `/` menu. PowerShell helpers go to `.kiro/ecc/scripts/pm2/`.
- The "update CLAUDE.md" step writes `.kiro/steering/pm2-services.md` with `inclusion: auto` and a description about starting, stopping and inspecting services.
Validate: scratch project with `package.json` and `vite.config.ts`; `/ecc-pm2` with `--trust-tools=read,write,shell`. Proof: `ecosystem.config.cjs`, `.kiro/steering/pm2-all.md` (`inclusion: manual`) and `pm2-services.md` exist. A second headless run of `/pm2-status` resolves the generated file.

### B9 Evolve (evolve)
- Run `python3 .kiro/skills/continuous-learning-v2/scripts/instinct-cli.py evolve` and show the analysis.
- With `--generate` the CLI writes Claude-format files (`instinct-cli.py` lines 1955 to 2047): skill folders (valid for Kiro), commands with `command:` frontmatter, agents with `model: sonnet` and `tools: Read, Grep, Glob`.
- The command then offers Kiro-form installs, one by one with approval: skills to `.kiro/skills/<name>/`, commands to `.kiro/steering/<name>.md` (`inclusion: manual`), agents to `.kiro/agents/<name>.md` (`tools: ["read"]`, no `model`). `.kiro/agents` always asks.
Validate: set `CLV2_HOMUNCULUS_DIR` to scratch, import a fixture with three instincts that share a trigger, run `/ecc-evolve --generate`. Proof: an evolved skill folder exists and its Kiro-form install passes the skill validator. The agent step needs interactive approval.

### B10 Quality gate (quality-gate)
- No path: `bash .kiro/ecc/scripts/quality-gate.sh` (build, type check, lint, tests).
- With a path: run the formatter in check mode by extension (Biome or Prettier, `gofmt -l`, `ruff format --check`) and report fixes. `--fix` runs `bash .kiro/ecc/scripts/format.sh <path>`.
- The hook stdin pipe and the `ECC_QUALITY_GATE_*` toggles go.
Validate: scratch project with Prettier and one badly formatted file. `/ecc-quality-gate src/a.ts` reports it; with `--fix` it changes it. Proof: `git diff` shows formatting only and a second run passes.

### B11 Model routing (model-route)
- Replace haiku/sonnet/opus with the live list: `kiro-cli chat --list-models -f json` (CLI; in the IDE ask the user to read the model picker). It gives credit multipliers (today haiku 0.40x, sonnet 1.30x, opus 2.20x, auto 1.00x) and `--effort` levels.
- Output keeps ECC's four fields (model, confidence, reason, fallback) and adds effort. `auto` is the default fallback. No ids are hard-coded in the installed text.
Validate: `/ecc-model-route refactor the auth module --budget low` with `--trust-tools=shell`. Proof: the recommended id appears in `kiro-cli chat --list-models`.

### B12 Orchestrated review (orch-review)
Target: a workflow recipe. https://kiro.dev/docs/workflows/authoring.md
- Port `workflows/orch-review.workflow.js` (parallel review, dedup, adversarial verify) to `.kiro/workflows/ecc-orch-review.workflow.json`: a `parallel` node of reviewer steps (`code-reviewer`, the language reviewer, `security-reviewer` when the trigger regex matches), a dedup step, a verify step per CRITICAL or HIGH finding, and a `verdict.json` artifact.
- The command keeps Phase 1 (git diff, or `gh pr diff <N>` with the numeric-id check) and Phase 3 (report). It starts the recipe from chat (IDE) or `/workflow run` (CLI).
- Fail closed stays: if Workflows are off or the run errors, say so with the enable steps. Never fall back to a hand-written review and never print APPROVE.
- `.kiro/workflows` always asks on write, so the installer ships the recipe.
Validate (user enables Workflows): scratch repo whose diff adds SQL string concatenation. Proof: `verdict.json` has `CHANGES_REQUESTED` with at least one blocking finding. An empty diff prints "Nothing to review" and starts no run.

## 4. Arguments and invocation

### 4.1 How text after the command reaches the agent
- Probe 1 (CLI V3, headless): scratch `ecc-probe.md` with `inclusion: manual` and the line `Placeholder line: ARGS=[$ARGUMENTS] FIRST=[$1] ALL=[$@]`. Command: `kiro-cli chat --v3 --no-interactive --trust-tools=read "/ecc-probe foo bar"`. The agent reported the marker visible, the placeholder line unchanged, and the user message `/ecc-probe foo bar`.
- The session log agrees: a `user` record with content `/ecc-probe foo bar`, then a `steering_inclusion` record (`displayName` `ecc-probe`, `scope` `workspace`) whose content is the file body without frontmatter.
- Result: no substitution of `$ARGUMENTS`, `$1` or `$@` in steering; the text stays in the user message; `description` and `argument-hint` never reach the model.
- Probe 2 shows the rewrite works: steering that says "take the text that follows /ecc-probe2 in the user's message" made the agent write `probe-out/args.txt` containing `alpha beta`.
- IDE: not probed. The slash-command page shows the same pattern (`/bug-fix The login page throws a 403 ...`) and says placeholder substitution exists only for skills, in the CLI. Treat the IDE as "text passed along, no substitution" and confirm once by hand. https://kiro.dev/docs/ide/chat/slash-commands.md, https://kiro.dev/docs/skills.md
- Rejected vehicles: skills (CLI substitutes, IDE does not; 94 more names and descriptions in discovery; the model may self-activate) and prompt files (substitute `$ARGUMENTS` and `$1`, CLI V3 only, not in the IDE menu). https://kiro.dev/docs/cli/chat/manage-prompts.md
- CLI engine: the steering page says V3 supports all four inclusion modes and V1/V2 are partial, so commands need `--v3` like the Markdown agents. V2 was not probed. Whether the interactive CLI `/` menu lists manual steering is not stated in the CLI reference; resolution is proven headless. https://kiro.dev/docs/steering.md

### 4.2 Non-interactive validation
- Best form (used in all three probes): `kiro-cli chat --v3 --no-interactive --trust-tools=read,write,shell,subagent "/ecc-<name> <args>"`, run inside the scratch project. The headless page lists interactive pickers such as `/model` as unavailable; steering commands still resolve. Trust tags that worked: `read`, `write`, `shell`, `subagent`. Other tags from the agent docs (`web`, `@<mcp-server>`) were not tried. https://kiro.dev/docs/cli/headless.md
- Probe 3: a steering command delegated to an installed Markdown agent (`.kiro/agents/probe-writer.md`). The sub-agent wrote `probe-out/sub.txt` with `SUB_OK gamma` and no prompt appeared, so trust flags reach sub-agents. The log shows `sub_agent_start` and `sub_agent_complete`.
- Paths Kiro always asks about (`.kiro/agents`, `.kiro/hooks`, `.kiro/workflows`, `.kiro/powers`, `.git/**`, `.kiroignore`) cannot be pre-approved, so headless runs cannot write them. Validate those steps interactively or let the installer write them. https://kiro.dev/docs/permissions.md
- Evidence beyond stdout: `messages.jsonl` record types `user`, `steering_inclusion`, `tool_call`, `sub_agent_start`, `sub_agent_complete`, `usage_summary`; `session.json` has `modelId`. `--output-format stream-json` emits ACP events as JSON lines.
- Noise: filter `[INFO]` and `ExperimentalWarning`, strip ANSI codes. There is no `timeout` binary on macOS.
- Cost: 12 s, 20 s and 24 s wall time; 0.14 to 0.35 credits per probe.
- Not usable headless: `/goal` and `/workflow` (interactive built-ins). Workflows can start when the agent is asked in a headless prompt (headless page example: "Run the release-check workflow").
- Not proven by any probe: per-agent `model:` on sub-agents, IDE argument pass-through, V2 behavior, AgentShield coverage of `.kiro/`, and the hook payload field names for `write` (assumed `tool_input.path`).

## 5. Open questions

1. Artifact root. Plans, PRDs, reviews, campaigns and checkpoints go to `.kiro/ecc/` (recommended: no clash with Kiro-declared folders, one place to document and lint) or to `.kiro/`?
2. Profile scope. May the Kimi-derived set grow? (a) six `orch-*` skills (small markdown) unblock 5 commands; (b) eight coordination files plus `sql.js` and `ajv` unblock 7 `epic-*` commands; (c) `plan-canvas` needs nine files and is not recommended; (d) 21 optional skills named by dangling references (language patterns, `accessibility`, `jira-integration` and others).
3. Panel models. Let the installer read the local model list and set `model:` on the three panel agents (recommended, omit when unknown), or ask for two model ids?
4. New owned code: `hookify-guard.mjs`, `usage-report.mjs`, `ecc-kiro.mjs audit`, the panel agents and the orch-review recipe. Accept these as part of Tasks 6 and 7?
5. Instincts. Wire `continuous-learning-v2/hooks/observe.sh` as disabled Kiro hooks so `/ecc-instinct-*` and `/ecc-evolve` have data? Kiro's hook payload differs from Claude's and must be checked first.
6. `ecc-guide`. Keep the skill as the only entry (`/ecc-guide`) and add a Kiro path map to `ecc-kiro-harness.md` (the skill reads `README.md`, `manifests/` and `agent.yaml`, which do not exist in a Kiro project), or register a differently named command?
7. Opt-in features. `loop-start` and `orch-review` need `/goal` or Workflows, which are off by default and account-gated. Is failing closed with enable instructions acceptable?

## 6. Recommendations

1. Build the rules engine, the snippets and the lint first, then run them on all 94. A commands (57) are done when lint and the load test pass.
2. Implement B in two waves. Wave one needs no new code: sessions, setup-pm, project-init, pm2, model-route, quality-gate, evolve, loop-start, loop-status, harness-audit (rubric only). Wave two adds owned pieces: hookify, usage reports, panel agents, orch-review.
3. Settle question 2 to unlock C. Until then ship C as "pending" in the plan output with the reason and the missing files.
4. Validate with the part 4 harness and keep `stream-json` logs as evidence.

## Sources

- Kiro docs (fetched 2026-10-07): https://kiro.dev/docs/steering.md, https://kiro.dev/docs/skills.md, https://kiro.dev/docs/ide/chat/slash-commands.md, https://kiro.dev/docs/reference/slash-commands.md, https://kiro.dev/docs/cli/chat/manage-prompts.md, https://kiro.dev/docs/hooks.md, https://kiro.dev/docs/hooks/types.md, https://kiro.dev/docs/hooks/actions.md, https://kiro.dev/docs/ide/whats-new-v1/hooks.md, https://kiro.dev/docs/custom-agents/subagents.md, https://kiro.dev/docs/custom-agents/configuration-reference.md, https://kiro.dev/docs/cli/v3/agent-config.md, https://kiro.dev/docs/workflows.md, https://kiro.dev/docs/workflows/authoring.md, https://kiro.dev/docs/cli/chat/goal.md, https://kiro.dev/docs/tools.md, https://kiro.dev/docs/reference/built-in-tools.md, https://kiro.dev/docs/cli/chat/session-management.md, https://kiro.dev/docs/checkpoints.md, https://kiro.dev/docs/permissions.md, https://kiro.dev/docs/cli/headless.md, https://kiro.dev/docs/reference/settings.md.
- Upstream ECC v2.2.3 (raw files read into scratch): `skills/continuous-learning-v2/scripts/instinct-cli.py` (cache), `scripts/harness-audit.js` (cache), `scripts/github-coordination.js` and `scripts/lib/{github-coordination,state-store,skill-evolution,plan-canvas}/*`, `scripts/ecc.js`, `workflows/orch-review.workflow.js`, `skills/orch-*`. Registry checks: `ecc-universal@2.2.3` and `ecc-agentshield@1.6.0` (both MIT, repositories under github.com/affaan-m).
- Probe sessions remain in Kiro's store under `~/.kiro/sessions/bc710c9e83dbc160/`: `sess_24953e75-f843-4587-a73a-f017df0825c5`, `sess_ac898e40-724c-4153-bddc-f3db577d62e7`, `sess_92956301-1089-4f24-a49f-1a378fc0360e`. They are harmless; delete them with `kiro-cli chat --delete-session <id>` if wanted.
