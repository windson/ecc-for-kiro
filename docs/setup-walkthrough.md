# ECC for Kiro: setup walkthrough and running notes

The plan of record is [ecc-kiro-setup-plan.md](ecc-kiro-setup-plan.md), a verbatim copy of the approved plan. It is not edited. Anything learned after the plan, or anything that differs from it, is recorded here.

Last updated: 2026-10-08 (command layer).

Working rules for every agent that reads this file:
- Scratch directories go under `/tmp/ecc-scratch/<name>` (create them with `mkdir -p`). Do not use a bare `mktemp -d`: on macOS it lands in random `/private/var/folders/...` paths, and the user's permission rules cannot match them, so every file read there asks for approval. Delete your scratch directory when done.
- Decision O8 (made by the orchestrator, the user may veto): narrow the wide `.ts` patterns of the `arkts`, `react-native` and `vue` rule packs through `assets/language-globs.json` (arkts: `*.ets` and the HarmonyOS config files; vue: `*.vue`; react-native: React Native specific names such as `*.native.tsx`, `*.ios.tsx`, `*.android.tsx`, `metro.config.*`, checked against the pack's own text). A plain TypeScript file then does not load about 50 KB of unrelated rules. Applied in Task 5, round 2: the skill ships these patterns in `assets/language-globs.json` and tests pin them (see "Task 5 results, round 2"). The decision does not cover the `angular` and `react` packs; that is open item O9.

## Status

| Task | State |
|---|---|
| 1. Preflight and skill scaffold | Done. Preflight passed (H0). Skill scaffolded with a working `doctor`; 149 unit tests pass. |
| 2. Pinned source, profile, integrity | Done. `verify` and `profile` work; `assets/profiles/kimi-parity-v2.2.3.json` has 476 entries, all matching the tag's hashes; 252 unit tests pass (see "Task 2 results"). |
| 3. Install engine, starting with agents | Built and tested (385 unit tests). The 68 agents convert, install into a sandbox project, load in `kiro-cli chat --v3`, and re-running reports no changes. Not installed in this workspace yet; see "Task 3 results". |
| 4. Skills | Built and tested (436 unit tests). All 82 skills (147 files) plan without problems, copy byte for byte, keep their execute bits, and show up in headless `kiro-cli` runs, including for custom agents. Not installed in this workspace yet. |
| 5. Steering and baseline | Built and tested (587 unit tests; round 2 after review). The 35 steering files (22 adapter files fixed for Kiro, 11 language rule packs, and the always-on `ecc-agents` and `ecc-kiro-harness`) plan without problems and install into a sandbox. The always-on set is 20,840 of 25,000 bytes. Two headless runs show that a custom agent without `resources` inherits the always-on steering and that array `fileMatchPattern` values load. Run 2 reported five of the six file-type files it should have loaded (`ecc-typescript-security` was not reported, cause unknown, open item O10). The `arkts`, `react-native` and `vue` packs now ship narrow file patterns (O8). Not installed in this workspace yet; see "Task 5 results". |
| 6. Commands as `/ecc-<name>` | Built and tested (694 unit tests). The deterministic layer of the command adaptation map is done, as the user's decision changed the plan (see "Task 6 results"). 57 of the 94 commands register as manual steering (56 class A plus `quality-gate`), and all 57 are lint clean. The lint blocks any command it would install. 35 commands (23 class B, 12 class C) are pending and not installed, and 2 are left to the skill of the same name. `quality-gate.sh` and `format.sh` go to `.kiro/ecc/scripts/` with their execute bits. In the sandbox, `/ecc-quality-gate` and `/ecc-checkpoint list` ran in headless `kiro-cli` (V3). Overlays and the new owned pieces are not built (O5). The always-on steering is 21,285 of 25,000 bytes now. Not installed in this workspace yet. |
| 7. Hooks | Built and tested (857 unit tests; 17 of them read the real ECC files). The 13 hooks of ECC's Kiro adapter become 12 v1 hook files, `.kiro/hooks/ecc-<name>.json`, every one with `"enabled": false` written in the file, plus the git push guard in `.kiro/ecc/scripts/`. A validator for the documented v1 fields checks each file before anything is written. In headless `kiro-cli` (V3) the guard blocked `git push` with the hook on and was not run with it off; Kiro's own session record shows the hook ran. The 11 agent-prompt hooks and the IDE were not run (O15). Not installed in this workspace yet; see "Task 7 results". |
| 8. Isolation, MCP example, license, update, uninstall | Built and tested (1021 unit tests; 11 of them read the real files). The install lifecycle is complete. Three new parts: `mcp` (`.kiro/ecc/mcp.json.example` with 38 servers, every one `"disabled": true`, and a table of what they are), `license` (ECC's LICENSE and a generated THIRD_PARTY_NOTICES.md) and `isolation` (a marked block in `.kiroignore`, only for harness folders that exist). `update` removes owned, unedited files that are no longer planned. `uninstall` previews first, then removes what the install created, the block, the empty folders it created and last the install record, and never touches the `ecc-kiro-setup` skill. `--dry-run` works for both. A whole install of this workspace plans 327 files with no conflict. Round trips and repeated runs are tested in temp projects, with fixtures and with the real files. Two headless `kiro-cli` runs showed that the V3 CLI 2.28.0 does not enforce `.kiroignore` (O17). Not installed in this workspace yet; see "Task 8 results". |
| 6b. Command layer (overlays, owned pieces, orch skills) | Built, tested and run in real Kiro. 92 of 94 commands are registered as `/ecc-<name>` (62 deterministic, 30 through overlays), none is pending, 2 are left to the skills of the same name, and all 92 are lint clean. Six `orch-*` skills joined the profile (88 skills, 153 files, 482 profile entries). The owned part installs 9 files: `hookify-guard`, `usage-report` and `feature-check` in `.kiro/ecc/scripts/`, two disabled hook files, three read-only panel agents and the `orch-review` recipe. A whole install plans 377 files. 1197 unit tests pass. Every registered command was run once in real Kiro (CLI, V3 engine) and the results are in [command-validation.md](command-validation.md): 0 fail, 5 partial rows. Not installed in this workspace yet; see "Command layer results". |
| 9 to 12 | Not started. |

Written to the workspace so far: the docs in `.kiro/docs/` and the skill in `.kiro/skills/ecc-kiro-setup/` (see the task results below). Nothing from ECC is installed in this workspace. All temporary probe directories and throwaway scripts were deleted. The ECC source cache lives outside the workspace at `~/.cache/ecc-kiro/`. The sandbox project `/tmp/ecc-sbx/project` has all the parts installed except the `.kiroignore` block, which it has no folder for (326 files, current output after Task 8). It is kept for the command workflow after Task 8, and is on the Task 12 cleanup list under "Next actions". Its `planner` agent carried a leftover test edit until round 2 of Task 5; that is fixed (see "Task 5 results, round 2").

## Environment (Task 1 preflight)

- `kiro-cli` 2.28.0. The V3 engine is opt-in with `--v3` (Kiro Agent Server 0.66.26). `chat --agent-engine` defaults to `v2`. Signed in through IAM Identity Center. `chat.defaultModel` is `auto`.
- Node v22.22.0 and git 2.42.0. Partial clone works (Task 2 uses it; sparse checkout is no longer used, see "Task 2 results").
- H0 passed: `kiro-cli chat --v3 --no-interactive --trust-tools=read "Reply with exactly the word OK..."` returned `OK` in about 24 seconds. Headless runs work. Use `--v3` on every headless run.
- AWS MCP cross-check: the `aws-mcp` documentation search agrees with kiro.dev that steering files in `.kiro/steering/` are included in conversations and that hooks are event-driven. AWS's own docs show a custom agent needing `"resources": ["skill://.kiro/skills/**/SKILL.md"]` to see installed skills, which supports the reading that custom agents do not inherit skills automatically. The AWS docs do not cover the v1 hook schema or `.kiroignore`, so kiro.dev stays the authority for those.

## Findings that affect later tasks

### F1. Markdown agents need the V3 engine (resolved)

- Default V2 engine: in a temporary workspace, `kiro-cli agent list` listed JSON agents, including one using V3 fields (tags, `permissions.rules`, `resources`), which it tagged "(v3 format)". It did not list a Markdown agent, and `kiro-cli agent validate --path x.md` fails with "Json supplied ... is invalid" because the validator only reads JSON. `agent list` also prints an unrelated error about a missing prompt file under `/Applications/KiroCrew.app/...`; that comes from a global agent, not from ECC.
- V3 engine: headless runs with `kiro-cli chat --v3 --no-interactive --agent <name> --trust-tools=` loaded both a `.md` agent (it answered with its sentinel string) and a `.json` agent in a workspace under `/tmp`, so headless runs do not seem to be blocked by workspace trust.
- Decision: keep Markdown agents as planned. They work in the IDE and in the V3 engine (`kiro-cli --v3`, or `kiro-cli settings chat.agentEngine v3`). They will not appear in `kiro-cli agent list` on today's default engine. The doctor says so, the skill's verification uses `--v3`, and the README must state it. Do not ship `.md` and `.json` under one name.
- Consequence for the Task 3 demo: `kiro-cli agent list` cannot show the 68 agents. Use a headless `--v3 --agent planner` run (and one or two more agents) plus the unit tests instead.

### F2. Shape of the Kimi install state

- `.kimi-code/ecc-install-state.json` has 483 operations: 482 `copy-file` and 1 `merge-json` (the chrome-devtools entry in `mcp.json`).
- By module: rules-core 122, agents-core 148, commands-core 96, platform-configs 8, skill-unified-memory 1, workflow-quality 102, ito-compute 4, nasiko-control-plane 2.
- agents-core 148 is 68 agents, `AGENTS.md`, and 79 files under `.agents/skills/` (the Codex mirror).
- The modules Kimi skipped include framework-language, database, security and devops-infra. That is why skills such as `python-patterns` and `golang-patterns` are not in the parity set.
- The destination list has no duplicates.

### F3. Skill sources in the Kimi install

- There are 82 skill directories, and every one has a `SKILL.md`.
- 30 of the `SKILL.md` files were copied from the Codex mirror (`.agents/skills/<name>/SKILL.md`), not from `skills/<name>/`. They are: api-design, article-writing, backend-patterns, benchmark-methodology, brand-discovery, brand-voice, bun-runtime, coding-standards, competitive-platform-analysis, competitive-report-structure, content-engine, crosspost, deep-research, dmux-workflows, documentation-lookup, ecc-conventions, exa-search, fal-ai-media, frontend-patterns, frontend-slides, investor-materials, investor-outreach, market-research, mcp-server-patterns, mle-workflow, nextjs-turbopack, product-capability, security-review, video-editing, x-api.
- 41 `agents/openai.yaml` files are Codex-only metadata and should be dropped for Kiro.
- About 60 other nested files are plain supporting files (scripts, references, fixtures, hooks). They are inert in Kiro unless a skill invokes them.
- Default: install what Kimi installed, verified by its recorded hash, so the profile includes the `.agents/skills/...` source paths for those 30. Confirmed in Task 2: all 30 match the tag byte for byte (O6).

### F4. Agent frontmatter (all 68 Kimi agents)

- Keys: `name`, `description`, `model`, `tools` on all 68; `color` on 5. Every name matches its filename. No CRLF.
- `tools` is always a comma-separated string. Models: sonnet 58, haiku 6, opus 4.
- Tool names seen: Read, Grep, Glob, Write, Edit, Bash, WebSearch, WebFetch, `mcp__context7__resolve-library-id`, `mcp__context7__query-docs` (docs-lookup), and eight `mcp__playwright__browser_*` tools (e2e-runner). No Task, Agent or MultiEdit.

### F5. Commands (94) and the plan's exclusion rules

All 94 have frontmatter. Keys: `description` 94, `argument-hint` 12, `name` 9, `command` 8, `disable-model-invocation` 2, `allowed-tools` 2, `agent` 1 (security-scan), `subtask` 1. 31 use `$ARGUMENTS`.

| Group | Commands | Why | Handling |
|---|---|---|---|
| Needs the Claude-only runtime | multi-backend, multi-execute, multi-frontend, multi-plan, multi-workflow, santa-loop | `~/.claude/bin/codeagent-wrapper` and ccg-workflow | reference only |
| Invokes a skill that is not installed | orch-add-feature, orch-build-mvp, orch-change-feature, orch-fix-defect, orch-refine-code | no `orch-*` skills in the parity set | reference only |
| Needs a workflow script | orch-review | `workflows/orch-review.workflow.js` | reference only |
| Duplicates a skill | plan-canvas, ecc-guide | named in the plan | reference only |
| Needs ECC scripts not in the parity set | epic-claim, epic-decompose, epic-publish, epic-review, epic-sync, epic-unblock, epic-validate; project-init; sessions; auto-update; skill-health; setup-pm | missing `github-coordination.js`, `install-plan.js`, `install-apply.js`, `session-manager`, or `./lib/...` | reference only |
| Runs but audits a `.claude/` layout | harness-audit | `--help` works, but its checks are Claude-specific | decide at Task 6 |
| Replaced by a merged command | quality-gate | needs `scripts/hooks/quality-gate.js` | register as `/ecc-quality-gate` using the adapter's `quality-gate.sh` |
| Use `instinct-cli.py` | evolve, instinct-import, instinct-status, projects, promote, prune | the script is installed with `continuous-learning-v2`, but the commands point at `$CLAUDE_PLUGIN_ROOT` and `~/.claude` | register; `ecc-kiro-harness` should give the Kiro path `.kiro/skills/continuous-learning-v2/scripts/instinct-cli.py` |
| Use Claude state paths | save-session, resume-session, cost-report, loop-status, hookify, hookify-configure, hookify-help, hookify-list, learn, learn-eval, skill-create, checkpoint, loop-start, pm2 | `~/.claude/...`, `.claude/...` | the plan's four rules do not cover these; decide at Task 6 |

Commands that only name uninstalled skills under "Related" or "Links" (python-patterns, golang-*, rust-*, react-*, cpp-*, kotlin-*, flutter-dart-code-review, vue-patterns, jira-integration, security-scan, accessibility) are soft references and register normally.

With only the plan's four rules, about 67 commands register, not the 75 to 85 the plan estimated. Excluding the Claude-state group as well would bring it near 60. Any extra exclusion needs the user's OK.

Update after Task 6: the four rules were dropped on the user's decision, and no command is excluded by them. The table above describes ECC's files, not what the skill does. The classes of the adaptation map decide what is registered (57), pending (35) or left to a skill (2). Measured with the four rules in Task 6, they would have excluded 26 commands (6 for Claude-only tooling, 2 for duplicating a skill, 5 for a missing skill, 13 for a missing script), so about 68 would have registered. See "Task 6 results".

### F6. The four Kimi helper scripts

`auto-update.js`, `setup-package-manager.js` and `skills-health.js` crash standalone with `Cannot find module './lib/...'`, because ECC's `scripts/lib/` is not part of the parity set. `harness-audit.js` runs and prints usage. None should be installed as working tools, which matches the plan's "only if it works" rule.

### F7. Adapter and rules facts for Tasks 5 to 8

- Adapter steering (22): 8 `auto` core files with `name` and `description`; 11 `fileMatch` files whose patterns are single comma-joined strings (cpp `"*.cpp,*.hpp,*.h,*.cc,*.cxx"`, typescript-patterns `"*.ts,*.tsx"`, typescript-security `"*.ts,*.tsx,*.js,*.jsx"`, and one glob each for go, java, kotlin, php, python, ruby, rust, swift); 3 `manual` files with only a `description`, each ending in an "Invocation" section that mentions `#dev-mode`, `#review-mode` or `#research-mode`.
- The adapter's `performance.md` is already written for Kiro. `rules/common/performance.md` is not: it mentions Option+T, `~/.claude/settings.json` and `MAX_THINKING_TOKENS`.
- `lessons-learned.md` has user-editable sections and a "Kiro Hooks" section that describes `install.sh` and the `extract-patterns` hook.
- `rules/common` has 10 files and no frontmatter. `common/agents.md` refers to `ecc:`-scoped `subagent_type` calls and `common/hooks.md` to TodoWrite and `~/.claude.json`.
- The language packs carry Claude-style `paths:` globs in frontmatter (seen in angular, arkts, cpp, csharp, dart and react). Task 5 can derive `fileMatchPattern` arrays from those, with `assets/language-globs.json` as an override or fallback.
- The 21 non-common rule directories: angular, arkts, cpp, csharp, dart, fsharp, golang, java, kotlin, nuxt, perl, php, python (plus `fastapi.md`), react, react-native (8 files), ruby, rust, swift, typescript, vue, web (7 files).
- Adapter hooks (13): the triggers are in the plan. `extract-patterns` points at `.kiro/steering/lessons-learned.md`. `quality-gate` runs `bash .kiro/scripts/quality-gate.sh`. `scripts/quality-gate.sh` detects the package manager and runs build, type check, lint and tests; `scripts/format.sh` runs biome or prettier.
- MCP: ECC's catalog `mcp-configs/mcp-servers.json` has 34 servers (23 with `command`, 11 with `url`; `env` on 10, `headers` on 2) plus a `_comments` key. The adapter's `settings/mcp.json.example` has 4 servers.

## Source cache

- Location: `~/.cache/ecc-kiro/ECC-v2.2.3-c05b2d6`, 5.1 MB. Override with `$ECC_KIRO_CACHE` or `$XDG_CACHE_HOME`.
- Created by the skill itself (`verify --fetch` or `profile --fetch`), not by hand: a partial clone (`--depth 1 --filter=blob:none --no-checkout --branch v2.2.3`), then one batched download of exactly the profile's files (see "Task 2 results").
- `HEAD` is `c05b2d6614f62f6db0047669aa4eefb223d478f9`, tag `v2.2.3`, as pinned. The clone keeps `remote.origin.partialclonefilter = blob:none`.
- The working tree holds exactly the 476 profile files; the other 3,700 files of the tag are tracked but absent, so `git status` in the cache shows them as deleted. That is expected. The cache is read only, and nothing in the workspace depends on it after an install.

## Open items

| # | Item | Status |
|---|---|---|
| O1 | The plan says to stop and ask if `kiro-cli` is older than 3.0. It reports 2.28.0, but the V3 engine works through `--v3` and H0 passed. | Raised with the user; they replied "please continue". Closed. |
| O2 | Markdown vs JSON agents (F1). | Closed: keep Markdown, require V3 for the CLI. |
| O3 | Do custom agents inherit workspace steering and skills? The configuration reference says yes; the steering page, the skills page and the AWS docs suggest no. | Closed, for what the runs showed. Skills: yes (Task 4). Steering (Task 5, headless, V3): a `planner` agent with `tools: ["read"]` and no `resources` field had all 10 always-on ECC files in its context, and `fileMatchPattern` written as an array is read by Kiro CLI V3 (file-type files loaded for a `.py` and a `.ts` file). The agents stay as converted. Not settled by the runs: whether every matching file-type file loads when several match (run 2 reported five of six, see O10). |
| O4 | Does `.kiroignore` stop `.kimi-code/AGENTS.md` from loading? | Settled by H2 at Task 10, in the IDE. Task 8 added a fact: `kiro-cli` 2.28.0 with `--v3` did not enforce `.kiroignore` at all in two headless runs (O17), so the CLI cannot settle it. |
| O5 | Registered command count and the Claude-state group (F5). | Closed. 92 of 94 commands are registered and lint clean; the other 2 are served by the skills `ecc-guide` and `plan-canvas`. The class B commands got Kiro-native overlays and the class C `epic-*` commands were rebuilt on `gh` (design C1), so no command is excluded for Claude-only paths. See "Command layer results". |
| O6 | Source path for the 30 skills (F3). | Closed: the Kimi-hashed `.agents/skills/...` files are in the profile and match the tag. |
| O7 | Name collisions with Kiro's built-in slash commands and agent names. | Closed. Agent names were checked in Task 3 (no `kiro_` or `kiro-` prefix). Command names were checked in Task 6 against 82 skills, 68 agents, 35 steering files, the user's global skills and agents, and 52 Kiro built-in commands (kiro.dev, 2026-10-07): no `/ecc-<name>` clashes, and a clash is a blocking problem. Without the prefix, `checkpoint`, `plan` and `sessions` would clash. The list of built-ins is a constant in `lib/slash-commands.mjs`, so it must be refreshed by hand when Kiro adds commands (standing chore, see O14). |
| O8 | Wide file patterns in the rule packs. The rules of `arkts`, `react-native` and `vue` name `**/*.ts` (`react-native` also `**/*.tsx`), and a pack is one file, so with the union of the paths a plain `.ts` file loaded 5 file-type steering files (55,021 bytes) and a `.tsx` file 6 (79,252 bytes), on top of the always-on files. The ArkTS rules, for example, apply to HarmonyOS projects, not to every TypeScript project. | Decided by the orchestrator (the user may veto) and applied in Task 5, round 2. `assets/language-globs.json` now ships: `arkts` = `**/*.ets`, `**/module.json5`, `**/oh-package.json5`, `**/build-profile.json5`, `**/ohosTest/**`; `vue` = `**/*.vue`; `react-native` = `**/*.native.ts(x)`, `**/*.ios.ts(x)`, `**/*.android.ts(x)`, `**/metro.config.*`, `**/eas.json`. A plain `.ts` file now loads 2 files (3,293 bytes) and a `.tsx` file 4 (50,203 bytes: the React and Web packs plus the two TypeScript files). To use the patterns of the rules again, delete the pack's entry. Angular and React are not covered: O9. |
| O9 | Wide file patterns in the Angular and React packs. Angular names `**/*.spec.ts` and `**/*.test.ts`, React names `**/app/**/*.ts`, `**/pages/**/*.ts`, `**/hooks/**/*.ts` and `**/use-*.ts`. They match ordinary TypeScript files. `src/app/foo.spec.ts` loads the Angular and React packs plus the two TypeScript files: 54,695 bytes on top of the 20,840 that are always on (it was 106,423 before the O8 narrowing). An Angular component under `src/app/` also loads the React pack. | Open, for the user. Default kept, so behaviour is unchanged: narrowing these changes which rules load in your Angular and Next.js projects, and that is your call. A test pins today's behaviour. To narrow, add entries to `assets/language-globs.json` and update the snapshot. One option: drop `**/*.spec.ts` and `**/*.test.ts` from `angular` and `**/app/**/*.ts` and `**/pages/**/*.ts` from `react`. Then `src/app/foo.spec.ts` loads only the two TypeScript files, and a Next.js route handler under `app/` loses the React rules. |
| O10 | Run 2 of the headless check reported five of the six file-type files it should have loaded. Not reported: `ecc-typescript-security` (patterns `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`). Either the model left it out of its summary or Kiro did not load it. The record cannot tell which: the raw output was not saved. | Open. No new headless run was made in round 2 (the cap stays at two). Check it in Task 10, H2 (see "Next actions"). If the file is missing again, treat it as Kiro dropping a matching file when several file-type files match. |
| O11 | Kiro's permission store holds an allow rule for a script that no longer exists: `~/.kiro/settings/permissions.yaml`, line 136, under the `shell` capability, allows `/tmp/ecc-t5-scratch/mutate.sh *`. It was most likely written by Kiro when an approval was given during the Task 5 mutation check. Nothing in the skill writes there. | Open, user action: remove that line. A file recreated at that path would run without a prompt. Agents must not edit the file. Checked again in Task 6: it is still the only rule that names a script of this project, and the Task 6 scripts (a throwaway mutation runner under `/tmp/ecc-scratch`) added none. |
| O12 | Overlays, the ECC notice and the new owned pieces. | Closed. 30 overlays ship in `assets/commands/overlays/`, each with a header (source path, sha256 of the ECC file, credit line, description) and an original Kiro-native body. `overlays/NOTICE-ECC.md` holds ECC's MIT notice and the PRP credit, and the loader skips it. The owned part (`hookify-guard`, `usage-report`, `feature-check`, two disabled hook files, three panel agents, the `orch-review` recipe), the `audit` subcommand and the six `orch-*` skills are built. |
| O13 | Claude Code wording left in pending commands. | Closed. Each of the 18 commands that still matched the lint now has an overlay, and `plan --json` reports no command with Claude wording left (`stillClaudeSpecific` is empty). The lint decides, and it blocks any command it would install. |
| O14 | What the command layer could not prove. (1) Only the CLI was run. That the IDE lists manual steering in its `/` menu and passes argument text the same way is not proven. (2) A sub-agent using the `model:` of its agent file is not proven; the panel commands say "multi-perspective" and name a model only if a sub-agent reports one. (3) `orch-review` was run only on its fail-closed path, because Workflows are off on this machine (`chat.enableWorkflows` unset); the recipe, its input mapping and the `CHANGES_REQUESTED` verdict are unvalidated. (4) `/goal` cannot be confirmed from a script. (5) The real AgentShield scanner reading `.kiro/` was stubbed. (6) `santa-loop --external` was tested on its shell block only. (7) The list of 52 Kiro built-in commands is a constant and goes stale (a chore for each ECC or Kiro update). | Open. (1), (3) and (4) are checked in Task 10, H2, by someone with the IDE and Workflows on. (7) is a standing chore. |
| O15 | What Task 7 could not prove. (1) The IDE was not run: that the Agent Hooks panel lists the 12 hooks, all off, and that its eye icon sets `enabled` in the file (and whether it rewrites the whole file, which the installer would then report as an edit). (2) Only the command hook ran. The 11 agent-prompt hooks were not run, because they cost credits and the cap of two headless runs was used. So it is not known whether Kiro tells the agent which file a file trigger fired for. The prompts do not use `{{filePath}}`, because Kiro documents it only for command actions. (3) The regular expression engine of the surfaces is not documented, so the validator refuses lookahead, lookbehind and backreferences; every matcher the install writes is plain. (4) Kiro's pages disagree on the timeout: `timeout` in seconds with a default of 60 on the hooks page, `timeout_ms` with a default of 30 seconds on the CLI pages. No hook sets a timeout. (5) The older CLI engine (V2) was not run; Kiro's documentation keeps its hooks inside agent configs. (6) Whether an unanchored matcher such as `write` also catches tools whose name only contains the word was not tried. | Open. (1), (2) and (5) are checked in Task 10, H2, in the IDE and with one agent-prompt hook switched on in a scratch project. (3), (4) and (6) stay as they are unless Kiro documents more. |
| O16 | Choices of Task 7 that the user may veto. (a) `doc-file-warning` fires for any Markdown, MDX or reStructuredText file the agent creates, for any README or CHANGELOG, and for anything under `docs/`, so also for Markdown that Kiro itself writes (specs, steering, skills). It is a switched-off hook, and the agent decides in its reply, but each firing is an agent run. (b) The guard accepts an acknowledgement only at the start of the command line, as the plan says, and one acknowledgement covers the whole line. (c) The validator refuses the triggers that exist on one surface only (SessionEnd, Manual, AgentSpawn). | Open, defaults kept. To narrow (a), edit `DOC_MATCHER` in `lib/hooks.mjs` and the snapshot. |
| O17 | The `.kiroignore` block was not enforced by the V3 CLI. In two headless runs of `kiro-cli` 2.28.0 with `--v3` (Agent Server 0.66.26), in a project that is not a git repository, the agent read `.claude/sentinel.txt` and `.kimi-code/sentinel.txt` and a search found them. Run 1 used the block as the installer writes it. Run 2 used plain lines in four forms (`.claude/`, `.kimi-code`, one named file, `*.secret`), and every file was readable. Kiro's page on `.kiroignore` says the V3 CLI blocks such reads and searches. Either this build does not enforce it yet, or it needs something these runs lacked. The IDE was not run. | Open. The wording in `SKILL.md` and in the plan note now says so, and the isolation part stays, because the IDE is documented to honor it once `.kiroignore` is in the Agent Ignore Files setting. Task 10, H2, checks it in the IDE: add `.kiroignore` to the setting, ask Kiro to read a file in `.claude/`, and see whether `.kimi-code/AGENTS.md` still loads (O4). Try the CLI again after a Kiro update. |
| O18 | Choices of Task 8 that the user may veto. (a) The MCP example drops `autoApprove`: two servers of the adapter's example carry a list, and one of them includes `manage_agentcore_memory`, which would run without asking once the server is switched on. (b) The table of what each MCP server is comes from ECC's descriptions, so it is generated at install time into `.kiro/ecc/mcp-servers.md`, not stored in the skill's `references/` as the plan said. (c) `--only` is literal: a partial install such as `--only agents` does not carry ECC's LICENSE unless `license` is named. (d) The block lists a folder as `<name>/`, which matches that folder at any depth, not only at the project root. (e) `isolation` runs by default, and `--only` without it leaves `.kiroignore` alone. (f) `THIRD_PARTY_NOTICES.md` lists four credited projects and their holders as the license review read them on 2026-10-07. | Open, defaults kept. For (a), add `autoApprove` back by hand in your own `mcp.json`. For (b), the table can move into `references/` if you accept ECC text in the repo, with ECC's notice beside it. For (c), ask for `license` to be implied by any other part. |
| O19 | What Task 8 could not prove. (1) The IDE: the Agent Ignore Files setting, whether `.kiroignore` hides a folder, and the Agent Hooks and `/` menu items of earlier tasks. (2) That Kiro never loads `.kiro/ecc/mcp.json.example` as MCP configuration. One headless run listed the servers the agent could use, and none carried a name from the example, but the IDE was not run. (3) Windows: line breaks in `.kiroignore` are tested with `\r\n` text on this machine, and nothing was run on Windows. (4) The wizard flow for update and uninstall (Task 9). | Open. (1) and (2) belong to Task 10, H2. (4) is Task 9. |

## Task 1 results

Files in `.kiro/skills/ecc-kiro-setup/`:

```
SKILL.md                       build-status note; only `doctor` is documented
scripts/ecc-kiro.mjs           entry point
scripts/lib/cli.mjs            command routing, option parsing, exit codes (0 ok, 1 check failed, 2 usage or not built yet)
scripts/lib/constants.mjs      pinned ECC tag and commit, schema ids, paths, markers
scripts/lib/doctor.mjs         collectDoctor() and formatDoctor()
scripts/lib/frontmatter.mjs    split, parse and write frontmatter
scripts/lib/yaml-lite.mjs      scalar, quoted-string and flow-collection reader
scripts/lib/skills.mjs         SKILL.md validator (agentskills.io rules)
scripts/lib/version.mjs        version parsing and comparison
scripts/io/probes.mjs          real environment probes (no shell; argument arrays only)
scripts/test/*.test.mjs        149 tests (run: node --test test/*.test.mjs from scripts/)
```

Design decisions made while building it:

- The frontmatter reader supports what the real ECC files use and rejects everything else with a line number: plain, double- and single-quoted scalars; one-line flow lists and maps; block lists (indented or not); one-level block maps; folded and literal block scalars. Block scalars had to be supported because 22 skill descriptions use `>` or `>-`.
- A plain value containing `: ` is rejected, because strict YAML parsers reject it too, so anything this reader accepts is something Kiro's own parser accepts.
- The writer always double-quotes strings and writes lists and maps as one-line JSON-style YAML, for example `tools: ["read", "shell"]`. The reader parses that back, and a test round-trips awkward strings (newlines, U+2028, DEL, `*.ts`, `@user`, `true`, `null`).
- `doctor` takes a `probes` object, so every check runs against an in-memory fake in tests. The real probes run programs without a shell.
- `doctor` validates this skill's own `SKILL.md` and reports it as `selfCheck`; a test keeps the version in `SKILL.md` equal to `constants.mjs`.

Checked against real ECC files (throwaway script, since deleted):

- The frontmatter reader parsed every file that has frontmatter: 68 Kimi agents, 94 commands, 82 skills, 111 rule files (11 rule files have none), and the adapter's 22 steering files, 33 agents and 43 skills.
- The validator passes all 82 Kimi skills with no errors. Warnings: 7 skills exceed 500 body lines. Non-standard frontmatter fields seen: `origin`, `author`, `repo`, `argument-hint`, `tools`.
- The adapter's 43 skills also pass. Four of them (golang-patterns, golang-testing, python-patterns, python-testing) carry a non-string `metadata.globs`, which the validator reports as a warning.

Real `doctor` run in this workspace: ok. Node 22.22.0, git 2.42.0 (sparse checkout yes), kiro-cli 2.28.0 (V3 via `--v3`); `.kiro` has `docs` and `skills`; no `.kiroignore`; harness folders `.claude` and `.kimi-code`; no ECC install; the pinned checkout is in the cache; the skill's own `SKILL.md` is valid; the only finding is the info note that `--v3` is needed.

## Task 2 results

Added to the skill: `lib/paths.mjs`, `lib/hash.mjs`, `lib/exit.mjs`, `lib/options.mjs`, `lib/profile.mjs`, `io/source.mjs`, `io/git.mjs`, `io/services.mjs`, `io/files.mjs`, `lib/commands/{doctor,verify,profile}.mjs`, the profile file, and tests. 252 tests pass (`node --test` from `scripts/`).

### Commands

```
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs verify  [--fetch] [--source <dir>] [--profile <file>] [--json]
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs profile [--fetch] [--write] [--kimi <file>] [--source <dir>] [--out <file>] [--json]
```

- `verify` is offline by default and only downloads with `--fetch`. It checks the commit and every file hash, and exits 1 on any missing or changed file.
- `profile` is for maintainers. Without `--write` it is a drift check and exits 1 if the profile file is missing or differs. With `--write` it writes the file, but only after every Kimi hash agreed with the ECC checkout.

### The profile

`assets/profiles/kimi-parity-v2.2.3.json` (schema `ecc-kiro.profile.v1`) has 476 entries, sorted by category and then byte-order path, each with `category`, `path`, its metadata and `sha256`.

| Category | Files |
|---|---|
| agent | 68 |
| skill | 147 (82 skill folders) |
| command | 94 |
| rule | 122 |
| agents-md | 1 |
| mcp-catalog | 1 |
| script | 4 |
| adapter-steering | 22 |
| adapter-hook | 13 |
| adapter-script | 2 |
| adapter-mcp-example | 1 |
| license | 1 |

Rules, AGENTS.md, the MCP catalog and the four helper scripts are in the profile so that later tasks can choose what to install. The profile also lists 46 files it leaves out: 41 Codex `agents/openai.yaml` files, 3 under `.pi/`, `.kimi/README.md`, and `.mcp.json`.

### Hash check

Kimi's install state records 482 `copy-file` operations and one `merge-json`, every copy with a source path and a sha256. 437 of those copies are in the profile, and for every one the recorded hash equals the hash of the same path at tag v2.2.3. The other 45 copies are the excluded files above, and `.mcp.json` is the source of the `merge-json` operation. So the Kimi install is byte for byte the tag, and the profile can be verified without trusting the Kimi folder at all. `profile` enforces this: a disagreement stops it with a `hash-mismatch` problem and nothing is written (covered by a test).

`verify --fetch` from an empty cache took 5.5 s and reported all 476 files matching. Offline `verify` takes 0.3 s. `profile` on the existing file reports "unchanged".

### Fetch strategy and the one git gotcha

The first version used the fetch the plan described (sparse checkout, then checkout of the profile's paths). It worked but took about 9 minutes. Cause: with a `blob:none` partial clone, `git checkout HEAD -- <paths>` downloads each missing blob on demand, one round trip per file, about a second each.

The fix is one batched download, then a local checkout:

1. `git clone --depth 1 --filter=blob:none --no-checkout --branch v2.2.3 <url> <dir>`
2. `git ls-tree -r -z HEAD` for the object ids of the wanted paths.
3. `git -c fetch.negotiationAlgorithm=noop fetch origin --no-tags --no-write-fetch-head --recurse-submodules=no --filter=blob:none --stdin`, with those ids on stdin.
4. `git read-tree HEAD`, then `git checkout-index -f -- <paths>`.

The `noop` negotiation setting matters. Without it the server sends nothing (the client claims to have the commit, so it assumes it has the blobs too), and `checkout-index` quietly falls back to the slow per-file download.

Also considered and rejected: `git sparse-checkout set --no-cone` (needs git 2.35 or newer) and the GitHub tarball (it carries the whole tag, about 4,200 files, and has no commit to check).

### Deviations from the plan

- The plan said sparse checkout on git 2.27 or newer, falling back to a full shallow clone. The build uses a partial clone plus the batched download instead. The doctor field is now `partialClone`, the finding code is `git-old`, and the threshold is `MIN_GIT_PARTIAL` 2.25.0. That number is deliberately conservative; the exact oldest git that supports `fetch --stdin` with a filter was not verified.
- If the clone fails with a message matching `filter`, `partial clone`, `unknown option`, `unrecognized option` or `usage:`, the build falls back to a plain shallow clone and says so.

### Facts worth remembering

- This machine's git has a global `core.hookspath` pointing at `/usr/local/amazon/var/git-defender/hooks`. Clone and fetch worked with it in place.
- The frontmatter reader parsed all 464 real ECC files that have frontmatter.
- A test gotcha: `{ __proto__: 1 }` in an object literal sets the prototype and creates no own key. Use `JSON.parse('{"__proto__": 1}')` to test hostile keys.

## Task 3 results

Added to the skill: `lib/agents.mjs` (conversion), `lib/plan.mjs` (parts and planned files), `lib/state.mjs` (install state and the ownership rules), `io/apply.mjs` (reading the project and applying changes), `lib/commands/plan.mjs` (`plan` and `install`), `readVerifiedFiles` in `io/source.mjs`, `writeFileAtomic` in `io/files.mjs`, and tests. 385 tests pass (`node --test` from `scripts/`); the 68-agent tests are skipped on a machine without the source cache.

### What runs

```
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs plan    [--only agents] [--root <dir>] [--source <dir>] [--fetch] [--json]
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs install [--only agents] --yes | --dry-run  [same options]
```

- `plan` reads the profile and the ECC source, checks every source file against its profile hash, converts, looks at the project, and prints what would happen. It never writes. Report schema `ecc-kiro.plan.v1`.
- `install --yes` applies that plan. Report schema `ecc-kiro.apply.v1`. Without `--yes` it refuses (exit 2); `--dry-run` is the same as `plan`.
- Any hash mismatch, conversion error, unreadable state file or unsafe destination stops the run before anything is written (exit 1).
- The preview lists the paths Kiro always asks about (`.kiro/agents` here), with file counts, because the installer writes them itself once the user confirms.

### Agent conversion

Frontmatter is rewritten; the body is copied byte for byte.

| ECC | Kiro |
|---|---|
| `tools: Read, Grep, Glob` | `tools: ["read"]` |
| `Write`, `Edit`, `MultiEdit` | `write` |
| `Bash` | `shell`, plus `permissions.rules` (below) |
| `WebFetch`, `WebSearch` | `web` |
| `Task`, `Agent` | `subagent` (none of the 68 use it) |
| `mcp__context7__query-docs` | `@context7/query-docs` |
| `model`, `color` | dropped (68 and 5 agents), reported in a note |

The 68 agents come out as: 27 `read+shell`, 21 `read+write+shell`, 10 `read`, 4 `read+shell+write`, 2 `read+write`, 2 `read+web`, docs-lookup (`read` plus 2 Context7 tools), and one browser agent (`read+write+shell` plus 8 Playwright tools). 53 of them have `shell`, so 53 get the permission rule. The expected tool list of every agent is pinned in `scripts/test/snapshots/agent-tools-v2.2.3.json`.

The permission rule for agents with `shell` is the one in the plan, with one addition:

```
permissions: {"rules": [{"capability": "shell", "match": ["git diff*", "git log*", "git status*", "git show*"], "exclude": ["*--output*"], "effect": "allow"}]}
```

`exclude` keeps `git diff --output=<file>` (and the same option on `log` and `show`) from being allowed silently, because that option writes a file.

Anything unexpected stops the conversion with a code: an unknown tool, an unknown frontmatter key, a name that differs from the file name, is not `[a-z0-9-]`, is longer than 64 characters, or starts with `kiro_` or `kiro-` (Kiro's built-ins are `kiro_default`, `kiro_help` and `kiro_planner`). None of the 68 names collide with them.

### Ownership and state

`.kiro/ecc/install-state.json` (schema `ecc-kiro.install.v1`) lists every file the installer owns with its path, category, ECC source and sha256, the folders it created, and a status of `complete` or `partial`. It is validated as hostile input when read: paths must be safe, inside `.kiro/` (or `.kiroignore`), and never under `.kiro/settings/`.

| At the destination | `install` | `update` (not wired up yet) | `uninstall` (not wired up yet) |
|---|---|---|---|
| nothing | create | create | n/a |
| owned, unchanged | update if ECC's content changed | same | remove |
| owned, edited | keep, report | keep, report | keep, report, stop tracking |
| not owned | skip, report conflict | skip, report conflict | untouched |
| owned, no longer planned | report as stale | remove if unedited | remove if unedited |
| owned, deleted by the user | restore (if planned) | restore (if planned) | forget |

The rules are implemented and unit-tested for all three modes in `reconcile()`; only `install` is reachable from the command line until Task 8. Other behaviour worth knowing:

- Running `install` again changes nothing, not even the state file (its timestamp only moves when something changed).
- A planned path that holds a symbolic link, folder or anything that is not a regular file is reported as a conflict and left alone.
- A planned `.kiro/agents/<name>.md` whose `<name>.json` already exists is a conflict, because Kiro would see two agents with one name.
- Every destination is checked twice (plan and apply): it must be a managed path, and no folder on the way may be a link that leaves the project. The installer refuses a `--root` whose `.kiro` is the global Kiro folder (for example the home folder).
- A failure in the middle stops the run, saves a `partial` state that lists exactly the files written, and the next run continues. There is no rollback. A hard kill (SIGKILL) between a file write and the state write would leave an unlisted file, which the next run reports as a conflict; that is safe and easy to fix by hand.
- If the state file is lost, every ECC file looks like the user's own and is reported as a conflict. The plan does not adopt files by content; delete the files or restore the state.

### Checks against Kiro (sandbox project in `/tmp`, headless, `kiro-cli chat --v3 --no-interactive`)

- `planner` (tools `read`) loaded, answered from its own instructions, and listed only the read tools.
- `docs-lookup` loaded even though no `context7` MCP server is configured. Kiro ignores the two `@context7/...` tools and the agent says Context7 is not available. If the user later adds a server named `context7` to `.kiro/settings/mcp.json`, the names already match.
- `code-reviewer` (with the permission block) loaded and ran git commands.
- The permission syntax was checked with a throwaway agent that denied `git diff*` except `*--stat*`: `git diff --output=...` was blocked, `git diff --stat` and an unrelated `touch` ran. So agent-scoped rules in Markdown frontmatter, the `*` suffix wildcard and `exclude` all work as documented.
- The allow rule itself cannot be tested on this machine: `~/.kiro/settings/permissions.yaml` already allows a long list of shell commands, and a control agent without any rules also ran `git diff --output=...` and `touch` unprompted. The rule only matters on machines with stricter settings. Kiro's documented default policy already allows common read-only git commands (status, log, diff, branch and similar), so the rule mostly makes that explicit.
- Open item O3 (do custom agents inherit workspace steering and skills?): the configuration reference says they do by default (`chat.disableInheritingDefaultResources` is `false`). Task 5 still confirms it with a sandbox run before relying on it.

### Decisions and deviations

- The plan says "Apply to this workspace" in Task 3. Installing is a step that needs the user's confirmation, and the plan's Task 8 does "a full install here, with one confirmation", so the workspace install is deferred to Task 8 and everything until then is verified in `/tmp` sandboxes. Say so if you want the agents installed earlier.
- `install` creates and updates but never removes; `update` (Task 8) also removes owned files that are no longer planned. The plan only described `update`'s removal, so this split is a choice.
- `plan` and `install` accept `--only`, `--dry-run` and `--action` (`install` only for now); the plan did not name them.
- `kiro-cli agent list` cannot show Markdown agents (see F1), so the demo is the headless runs above plus the "edited agent is reported as kept" run: after appending a line to `planner.md` in the sandbox, `plan` reported `kept (edited) 1` with the path and `install --yes` left the edit alone.

## Task 4 results

The `skills` part (`--only skills`) is in `lib/plan.mjs`; the repair helper is in `lib/skills.mjs`; `readVerifiedFiles` now also reports which files are executable. 436 tests pass. The tests over the real 82 skills (`test/real-skills.test.mjs`) are skipped on a machine without the source cache.

- **Copy.** Every file of a skill goes to `.kiro/skills/<skill>/<path inside the skill>` as the exact bytes the profile pins. The 41 Codex-only `agents/openai.yaml` files are not in the profile. Compared with `.kimi-code/skills`, an install into a sandbox is identical apart from those 41 files: same bytes, same 14 executable files.
- **Validation.** Each `SKILL.md` is checked against the Agent Skills rules and Kiro's limits before anything is written: name equals the folder, lowercase letters, digits and hyphens, at most 64 characters, description present and at most 1024 characters. All 82 pass as they are, so nothing was repaired. The repair code exists for the plan's case: an overlong description is rewritten at a sentence boundary (or a word boundary), nothing else in the file changes, the repair is listed in the plan, and it raises a warning. Any other rule violation stops the run before anything is written.
- **Information only.** 7 skills have bodies over 500 lines (the specification recommends shorter). 5 skills use frontmatter fields outside the standard (`argument-hint`, `author`, `origin`, `repo`, `tools`). Both are reported and left alone; those skills load in Kiro anyway (see the checks below).
- **Execute bits.** Git records them and the hash does not. The installer reads the mode from the ECC checkout and gives installed files mode 755 when the source has an execute bit (14 files, e.g. `continuous-learning-v2/scripts/instinct-cli.py`). This is a refinement of the plan.
- **Folders that belong to someone else.** If `.kiro/skills/<name>/SKILL.md` exists and is not ECC's, none of that skill's files are added to the folder. Without this rule, `references/` files would end up next to another skill's `SKILL.md`. Implemented as an `anchor` on each planned file.
- **Overlaps.** Project skills win over global ones with the same name. The plan lists overlaps with `~/.kiro/skills` (folders and links to folders only). This machine has 52 global skills and none overlaps. None of the 82 names equals a Kiro slash command.
- **Report.** `plan --only skills --json` has `details.skills` (total, valid, files, executable, repaired, long bodies, extra fields, overlaps); the text form prints "Skills: 82 skills, 147 files; all valid, 14 executable, 7 with bodies over 500 lines".

### Checks against Kiro (sandbox project, headless)

- The default agent lists `tdd-workflow, ck, continuous-learning, continuous-learning-v2, council, council-multi-model` as skills it has, so skills with extra frontmatter fields load.
- The converted `planner` agent, which has no `resources` field, lists the same skills. **So custom agents do inherit workspace skills in the V3 engine**, as the configuration reference says and the skills page does not. Steering is still to be checked in Task 5.

## Task 5 results

The `steering` part of `plan` and `install` is built. It reads 151 ECC files (22 adapter steering files, AGENTS.md, 68 agents and the 60 rule files of 11 packs) and writes 35 steering files. 587 unit tests pass (`node --test` from `scripts/`), 151 more than after Task 4 (576 after round 1, 11 added in round 2, see "Task 5 results, round 2"). The tests over the real files (`test/real-steering.test.mjs`) are skipped on a machine without the source cache.

Added to the skill: `lib/steering.mjs` (writer, adapter conversion, text rewrites), `lib/rule-packs.mjs` (the packs and their links), `lib/baseline.mjs` (`ecc-agents.md` and `ecc-kiro-harness.md`), the `steering` part in `lib/plan.mjs`, `assets/language-globs.json`, and the tests. `lib/commands/plan.mjs` loads the override file and prints one steering line. `lib/constants.mjs` has the 25,000 byte limit.

### What runs

```
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs plan    [--only steering] [--root <dir>] [--json]
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs install [--only steering] --yes [--root <dir>]
```

Without `--only`, both now cover agents, skills and steering: 250 files (68 agents, 147 skill files, 35 steering files). `plan --json` has `details.steering` (file counts per inclusion mode, link counts, roster rows, always-on bytes). The text form adds one line: "Steering: 35 files (22 from the ECC adapter, 11 language rule packs, 2 baseline); always on: 10 files, 20,840 of 25,000 bytes". When `assets/language-globs.json` narrows packs, `plan` also lists them in its notes.

### What it installs

Every file is `.kiro/steering/ecc-<name>.md`. Nothing else is written, and `.kiro/steering` is not one of the folders Kiro asks about.

| Kind | Files | Inclusion | Comes from |
|---|---|---|---|
| Core rules: coding-style, development-workflow, git-workflow, lessons-learned, patterns, performance, security, testing | 8 | always | the adapter's `auto` files |
| `ecc-agents` | 1 | always | ECC's AGENTS.md |
| `ecc-kiro-harness` | 1 | always | written by this tool |
| Language files: cpp, golang, java, kotlin, php, python, ruby, rust, swift, typescript-patterns, typescript-security | 11 | fileMatch | the adapter |
| Rule packs `ecc-<pack>-rules`: angular, arkts, csharp, dart, fsharp, nuxt, perl, react, react-native, vue, web | 11 | fileMatch | 60 files in `rules/<pack>/` |
| Modes: dev-mode, review-mode, research-mode | 3 | manual | the adapter |

The always-on files are 20,840 bytes: ecc-agents 8,332, ecc-lessons-learned 2,389, ecc-kiro-harness 2,167, ecc-coding-style 1,578, ecc-performance 1,488, ecc-patterns 1,187, ecc-development-workflow 1,096, ecc-security 1,026, ecc-testing 905, ecc-git-workflow 672. The limit is 25,000, so there are 4,160 bytes of room (round 1 had 20,666 and 4,334; the `$CLAUDE_FILE_PATHS` row of the harness note added 174). `plan` refuses a set over the limit (`always-on-too-large`), and tests pin the boundary at exactly 25,000 and 25,001 bytes. All 22 file-type files together are 200,428 bytes (200,342 with the patterns of the rules), loaded only when a matching file is in play.

### Conversion rules

- Frontmatter is the first thing in every file. `inclusion` and `name` are plain words, as in Kiro's examples. The description and the pattern list are JSON-style YAML written with `lib/frontmatter.mjs`.
- `auto` becomes `always`, the change ECC pull request 3322 makes. Core files keep `name` (now with the prefix) and `description`, as that pull request does.
- `fileMatchPattern: "*.ts,*.tsx"` becomes `["**/*.ts", "**/*.tsx"]`: split at the commas, with `**/` in front of a pattern that has no folder part. Each glob is checked: no spaces, backslashes, `..`, absolute paths, commas or unbalanced brackets.
- A pack is the rule files of `rules/<pack>/` in file-name order, each under its own heading, after a one-line origin note. Its patterns are the union of the `paths:` lists of its files, in the order first seen. `assets/language-globs.json` can replace them for a pack. Since round 2 it ships replacements for `arkts`, `react-native` and `vue` (O8); the other eight packs use the union.
- Links in the packs: `../common/<x>.md` and `../typescript/<x>.md` point at the steering file of that name when the adapter has one (65 links). `../common/hooks.md` describes Claude Code hooks, so it points at `ecc-kiro-harness.md`. A link to a file that is not installed becomes plain text (2 links in the React pack: `typescript/coding-style.md` and `typescript/testing.md`). A link to a sibling rule of the same pack points at that rule's heading in the same file (3 links). The skill link points at `../skills/e2e-testing/SKILL.md`. Links in code blocks and code spans are left alone. A relative link of any other kind stops the run, so a dead link cannot slip in.
- The three manual modes: `#dev-mode` becomes `#ecc-dev-mode`, and likewise for the other two (3 references).
- Hooks sections of the packs: five of them say "Configure in `~/.claude/settings.json`". Followed in Kiro, that sends the agent to write into another tool's settings file, so the sentence now says "Configure as Kiro hooks (`.kiro/hooks/*.json`)". Ten packs, every pack with a hooks section except React (whose hooks are React hooks), also get a note after the origin line: the examples use Claude Code names and `ecc-kiro-harness` explains how they map to Kiro hooks.
- Two adapter files have text that is wrong for this install, so a rewrite with a stated reason is applied, and it must match exactly once or the run stops. `git-workflow` loses its note about `includeCoAuthoredBy` in `~/.claude/settings.json`. `lessons-learned` loses its "Kiro Hooks" lessons (about the adapter's `install.sh` and the retired `.kiro.hook` format, neither of which exists here) and gets a short "ECC Install" section that says the installer keeps edited files; its first list item now reads "If you turn on the `ecc-extract-patterns` hook, it suggests patterns after agent sessions". All its user-editable sections are untouched. The other 20 adapter bodies are copied byte for byte apart from the `#mode` references.

### ecc-agents.md and ecc-kiro-harness.md

- `ecc-agents.md` is built at install time from the downloaded AGENTS.md. It keeps the Core Principles section, the Agent Orchestration list with the `ecc:` prefix removed, and the Available Agents table, under short Kiro headings. The 68 table rows match the 68 agents exactly, so no row had to be filled in from an agent description (the code does that for an agent the table lacks, and says so in the notes). The counts (68 agents, 82 skills) come from the profile. The rest of AGENTS.md (security, coding style, testing, git, performance) is already in the core rules, so it is not repeated.
- `ecc-kiro-harness.md` is a table of what ECC's Claude Code wording means in Kiro: Task and Agent tool, TodoWrite, the tool names, the Skill tool, `/plan` to `/ecc-plan`, `~/.claude` and `$CLAUDE_PLUGIN_ROOT`, `$CLAUDE_FILE_PATHS` (added in round 2: it becomes `{{filePath}}` in the command of a PostFileSave or PostFileCreate hook, and Kiro also sends the path as JSON on the command's stdin), CLAUDE.md, `$ARGUMENTS`, hook events to Kiro triggers, model aliases, `ecc:` prefixes, and `configure-ecc` to `ecc-kiro-setup`. It names `.kiro/skills/continuous-learning-v2/scripts/instinct-cli.py` as the Kiro path of the instinct script (F5). A test checks that this path is in the profile. Another test checks that every `$CLAUDE_` variable that the other installed files still show (today only `$CLAUDE_FILE_PATHS`, in the Dart pack) is explained in the harness note, so a new one in a later ECC release fails the test.

### Decisions and deviations from the plan

- One install category, `steering`, for all 35 files. The plan did not split it.
- The plan said `ecc-agents.md` comes "from a template adapted from AGENTS.md". The build reads the sections from the downloaded AGENTS.md instead, so none of ECC's text is copied into this tool (see "Publishing plan"). Only the Kiro sentences are ours.
- The plan said to generate the packs "using `assets/language-globs.json`". The task notes changed that to the union of the rules' own `paths:` with the file as an override, and that is what is built. The file is listed in the plan's layout, so it is kept. Round 1 shipped it with no overrides; round 2 ships three (O8), which departs from "the union of the rules' paths" for those three packs on the orchestrator's decision.
- Pack file names are `ecc-<pack>-rules.md`, not `ecc-<pack>.md`, so a pack can never share a name with an `/ecc-<command>` such as `ecc-react-review`. The plan did not name them.
- Packs include their `hooks.md` rules, because the pack sizes in the task notes (5 KB for Perl to 32 KB for React) include them.
- The plan expected `resources` on the agents if they did not inherit steering. They do, so the agents are unchanged and `install` for agents reports nothing to change.
- Added beyond the plan: the rewrite table for two adapter files, the hooks sentence and note in the packs, the size check in `plan`, and `details.steering`.
- Existing tests that assumed two parts were updated: the part lists, the "unknown part" case (now `hooks`), and the all-parts counts, and the install fixture now has steering sources. The fixtures are synthetic.

### Checks against Kiro (two headless runs, V3, in the sandbox project `/tmp/ecc-sbx/project`)

Both runs used `kiro-cli chat --v3 --no-interactive --agent planner --trust-tools=read`. The `planner` agent was the converted one plus a leftover test edit (see run 1), so it was not the pristine conversion. Its frontmatter is `tools: ["read"]` with no `resources`. All 35 steering files were installed first, with the patterns of the rules (the O8 narrowing came later). The raw output of the two runs was not saved, and no new headless run was made in round 2.

- Run 1, no tools allowed in the prompt, asked what is in the agent's context. It listed exactly the 10 always-on files (ecc-testing, ecc-security, ecc-performance, ecc-patterns, ecc-lessons-learned, ecc-kiro-harness, ecc-git-workflow, ecc-development-workflow, ecc-coding-style, ecc-agents), quoted a short phrase from three of them ("ALWAYS create new objects, NEVER mutate existing ones", "Delegate to specialized agents for domain tasks", "ECC v2.2.3 was written for Claude Code"), and said that `ecc-python-patterns` (file type) and `ecc-dev-mode` (manual) were not loaded. It answered in Dutch. Cause, found in the Task 5 review: the sandbox `planner.md` ended with the line `My own rule: answer in Dutch.`, left over from the Task 3 "kept (edited)" experiment. So the agent was the converted one plus that edit, not the converted one as it is. It does not change what the run shows about steering: the edit is agent text, and the frontmatter has no `resources`. A directory listing would have shown 35 files, so the answer is the context and not a file listing.
- Run 2 asked it to read `hello.py` and `index.ts` (both created for the test and deleted afterwards), then say which file-type files were loaded. With the patterns of the rules, those two files select six files (the snapshot test and an in-memory build of the real files agree): `ecc-python-patterns` for the `.py` file, and `ecc-typescript-patterns`, `ecc-typescript-security`, `ecc-arkts-rules`, `ecc-react-native-rules` and `ecc-vue-rules` for the `.ts` file. The agent reported five, each with its first heading: ecc-python-patterns, ecc-typescript-patterns, ecc-arkts-rules, ecc-react-native-rules, ecc-vue-rules. It reported ecc-golang-patterns and ecc-react-rules as not loaded, which is right. So it reported five of the six expected files, and only four of the five that match a `.ts` file. **`ecc-typescript-security` (patterns `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`) was expected and is missing from the report.** Either the model left it out of its summary or Kiro did not load it. The record cannot tell which: the raw output was not saved, and the raw output of the earlier session is not available to this round, so I cannot say whether the file was in it. The earlier wording ("the expected set", "the wide `.ts` patterns do load five files") was wrong: five counted the Python file in with the TypeScript files. This is open item O10.
- What the runs show: a custom agent without `resources` has the always-on ECC steering in its context (run 1: all 10 files, three quoted phrases); `fileMatchPattern` written as an array is read by Kiro CLI V3, because file-type files loaded for a `.py` and a `.ts` file (run 2); the plain `inclusion: always` and the quoted descriptions parse. O3 is closed for those points only. What they do not show: that every matching file loads when several match (O10). They also say nothing about the narrowed patterns of O8, because both runs happened before it was applied.
- Not checked here: the Kiro IDE (opening a `.py` file should load `ecc-python-patterns`; the CLI run shows the same mechanism), and the default agent without `--agent` (H2 in Task 10).

### Verification that was run (round 1)

- Whole suite: `cd .kiro/skills/ecc-kiro-setup/scripts && node --test --test-reporter=spec test/*.test.mjs`: 576 tests, 576 pass, 0 fail.
- Fresh temp project, all parts: `plan --root <dir> --json` gave `create 250`, 0 problems, protected `.kiro/agents` (68 files). `install --yes` wrote 250 files (68 agents, 147 skill files, 35 steering files; state `complete`, 251 files under `.kiro`). A second `install --yes` printed "Nothing to change". After appending a line to `.kiro/steering/ecc-security.md`, `plan` reported `unchanged 249   kept (edited) 1` with that path, and `install --yes` left the edit in place. The folder was deleted.
- Sandbox project: `install --only steering --yes` wrote 35 files on top of the earlier agents and skills (250 files tracked); the second run changed nothing.
- Mutation check on copies of the skill in `/tmp` (deleted afterwards). One rule broken per copy, and the suite failed each time: `auto` left as `auto` (41 failures), comma pattern not split (21), size limit raised to 100,000 (6), `#mode` references not rewritten (7), common links not mapped (11), pack patterns from the first file only (8), `ecc:` prefix kept (5), a blank line before the frontmatter (35).

### Not installed, and other limits

- Not part of the plan, so not installed: `rules/common/agents.md`, `rules/common/code-review.md`, `rules/common/hooks.md`, `rules/README.md`, and the rule packs of the languages the adapter already covers: cpp, golang, java, kotlin, php, python, ruby, rust, swift and typescript (51 files). The other 7 common rules are the adapter's core files. A test lists these.
- Language and pack text mentions 18 skills that are not among the 82 installed: angular-developer, compose-multiplatform-patterns, cpp-coding-standards, flutter-dart-code-review, golang-patterns, jpa-patterns, laravel-patterns, laravel-security, laravel-tdd, nuxt4-patterns, perl-patterns, perl-security, perl-testing, python-patterns, springboot-patterns, swift-actor-persistence, swift-protocol-di-testing and vite-patterns. They are "See skill" pointers and are left as written. Every agent they name is installed.
- The pack hooks sections still describe Claude hook events and show some Claude settings JSON (dart, arkts, web). The sentence and note above, and the harness table, say how to read them. They are not rewritten as Kiro hooks. The one Claude variable they still show, `$CLAUDE_FILE_PATHS` in the Dart pack, is explained in the harness table since round 2.
- `ecc-lessons-learned` mentions the `ecc-extract-patterns` hook (Task 7, off by default) and `ecc-kiro-harness` mentions `/ecc-*` commands (Task 6). Until those tasks are done, a sandbox install has the words but not the hooks or commands.
- The size of a pack follows the rules: React is 31,486 bytes, Dart 23,293, ArkTS 22,668, Angular 19,916, React Native 18,371 (with the narrowed patterns of O8; the union patterns gave 22,679 and 18,251).

### Task 5 results, round 2 (after the review)

The review of round 1 asked for changes and had six findings. What was done for each one:

1. Run 2 record (medium). "Checks against Kiro" now says that five of the six expected file-type files were reported and that `ecc-typescript-security` was not. The words "the expected set" and "do load five files" are gone. O3 stays closed only for what the runs showed. New open item O10, and a new H2 step for Task 10 (see "Next actions"). No headless run was made: the cap of two stays, and the raw output of run 2 was not saved.
2. Leftover edit in the sandbox agent (low). The cause of the Dutch answer is named under run 1. I removed the edited `/tmp/ecc-sbx/project/.kiro/agents/planner.md` and ran `install --yes --root /tmp/ecc-sbx/project` with the current skill: `create 1   update 4   unchanged 245` (the four updates are the harness note and the three narrowed packs). A second run said "Nothing to change". The sandbox now holds the pristine conversion of the 68 agents and the current output of all three parts (250 files), and `planner.md` ends with the agent's own last line. The brief said to leave `/tmp/ecc-sbx` alone; I read that as "do not delete it", because it also said the sandbox may be reused, and the change went through the installer.
3. Angular and React globs (low). The orchestrator's O8 decision is applied for the three packs it names, with tests (next paragraphs). Angular and React are not narrowed. Narrowing them changes which rules load in the user's Angular and Next.js projects, so I kept today's behaviour, pinned it in a test, and recorded it as O9 with one option. The O8 row now matches the decision.
4. Sandbox retained (low). `/tmp/ecc-sbx` stays for Tasks 6 to 8 and is on the Task 12 cleanup list under "Next actions".
5. Permission rule (low). Not touched: agents must not edit `~/.kiro`. O11 names the line for the user to remove. I confirmed it is still there (line 136, under `shell`).
6. `$CLAUDE_FILE_PATHS` (low). The harness note has a new row: `$CLAUDE_FILE_PATHS` in a hook command becomes `{{filePath}}` in the command of a PostFileSave or PostFileCreate hook. The review said the path arrives in the hook's JSON input. The Kiro pages (kiro.dev/docs/ide/whats-new-v1/hooks.md and kiro.dev/docs/hooks.md) also give file triggers the `{{filePath}}` template variable in command actions, which is what a converted `dart format $CLAUDE_FILE_PATHS` needs, so the row names both. The always-on total is 20,840 bytes, 4,160 below the limit.

#### The O8 narrowing

`assets/language-globs.json` now holds three entries. `arkts` is the derived list without `**/*.ts`. `vue` is `**/*.vue`; only `vue/hooks.md` named `.ts` and `.tsx`. `react-native` is `**/*.native.ts(x)`, `**/*.ios.ts(x)`, `**/*.android.ts(x)`, `**/metro.config.*` and `**/eas.json`. The pack's own text names `Component.ios.tsx`, `Component.android.tsx` and `eas.json`, and a test checks that. `.native` and `metro.config.*` come from the decision. `app.config.*` is left out although the pack mentions `app.config.ts`, because Nuxt uses the same name and both packs would load.

| File | Loaded before (patterns of the rules) | Loaded now |
|---|---|---|
| `src/index.ts` | 5 files, 55,021 bytes | 2 files, 3,293 bytes |
| `src/App.tsx` | 6 files, 79,252 bytes | 4 files, 50,203 bytes |
| `src/Settings.ios.tsx` | 6 files, 79,252 bytes | 5 files, 68,574 bytes |
| `nuxt.config.ts` | 6 files, 66,048 bytes | 3 files, 14,320 bytes |
| `src/Button.vue` | 3 files, 37,249 bytes | 3 files, 37,226 bytes |
| `entry/src/main/ets/entryability/EntryAbility.ets` | 1 file, 22,679 bytes | 1 file, 22,668 bytes |
| `metro.config.js` | 1 file, 2,210 bytes | 2 files, 20,581 bytes |
| `eas.json` | none | 1 file, 18,371 bytes |
| `src/app/foo.spec.ts` (O9) | 7 files, 106,423 bytes | 4 files, 54,695 bytes |

The cost of the narrowing: a plain `.tsx` file in an Expo app loads the React and Web packs but not the React Native pack, which now loads for platform files, `metro.config.*` and `eas.json`. The user may veto; deleting an entry restores the patterns of the rules.

#### Tests added in round 2

- `test/real-steering.test.mjs`, block "the file patterns the skill ships in assets/language-globs.json" (10 tests): the file is valid and narrows exactly the three packs, as the snapshot says; the effective patterns equal the snapshot and the other 19 file-type files are untouched; only the three packs differ from the union build, and only in their pattern line; the always-on files are the same; the React Native names against the pack text; which files and how many bytes load for 13 sample paths; no arkts, react-native or vue for a plain `.ts` or `.tsx` file; each narrowed pack still loads for its own files; Angular and React stay wide (O9, so a change there fails loudly and needs a decision); `plan` with no options on the real skill folder and the real cache reports the three packs as overridden and writes nothing.
- `test/real-steering.test.mjs`: one more test, every `$CLAUDE_` variable that the other installed files show is explained in the harness note.
- `test/baseline.test.mjs`: the mapping test now checks the `$CLAUDE_FILE_PATHS` row.
- `test/snapshots/steering-v2.2.3.json`: new keys `shipped` (the three lists) and `loads` (13 sample paths with the files and bytes they load).

#### Verification that was run (round 2)

- Whole suite: `cd .kiro/skills/ecc-kiro-setup/scripts && node --test --test-reporter=spec test/*.test.mjs 2>&1 | grep -vE '^\s+✔' | grep -vE '^(▶|✔) '`: 587 tests, 587 pass, 0 fail, 0 skipped (the real-data tests ran).
- Fresh temp project under `/tmp/ecc-scratch`, all parts: `plan --json` gave `create 250`, no problems, notes `agent-model-dropped`, `skill-extra-fields` and `steering-globs-overridden` (arkts, react-native, vue), protected `.kiro/agents` (68 files), always on 20,840 of 25,000 bytes. `install --yes` wrote 250 files. A second `install --yes` said "Nothing to change". After appending a line to `.kiro/steering/ecc-security.md`, `plan` reported `unchanged 249   kept (edited) 1` with that path, and `install --yes` left the edit. The folder was deleted.
- Sandbox project: see item 2 above.
- Mutation check on five copies of the skill under `/tmp/ecc-scratch` (deleted afterwards), one rule broken per copy. Each made the suite fail, in the tests that should notice: harness row removed (2 failures: the mapping test and the variable test); Vue widened to `**/*.ts` (4); overrides emptied (8); `**/eas.json` dropped from React Native (4); `plan` made to ignore the shipped file (2, among them the `plan`-with-no-options test).

### Open for the user after Task 5

O8 (veto, if you want the wide patterns back), O9 (Angular and React), O10 (checked at H2), O11 (remove the permission line). Nothing else blocks Task 6.

## Task 6 results

The `commands` part of `plan` and `install` is built. It reads the 94 ECC commands and the two scripts of ECC's Kiro adapter, and writes 57 steering files and 2 scripts. 694 unit tests pass (`node --test` from `scripts/`), 107 more than after Task 5. The tests over the real files (`test/real-commands.test.mjs`, 25 tests) are skipped on a machine without the source cache.

Added to the skill: `lib/slash-commands.mjs` (the engine), four data files in `assets/commands/`, the `commands` part in `lib/plan.mjs`, the data loader and two report lines in `lib/commands/plan.mjs`, one row in `lib/baseline.mjs`, a Commands section in `SKILL.md`, and the tests: `test/slash-commands.test.mjs` (48), `test/real-commands.test.mjs` (25), a block of 22 in `test/plan.test.mjs`, a block of 9 in `test/install.test.mjs`, a few changed or added tests in existing blocks, the helper `test/command-assets.mjs` and `test/snapshots/commands-v2.2.3.json`.

### A change of plan from the user

The plan said: register the commands as `/ecc-<name>` manual steering with the body as ECC wrote it, leave out four kinds of command (it duplicates a skill, it needs Claude-only tooling, it names a skill that is not installed, it needs a script that is not installed), and keep reference copies of the left-out ones in `.kiro/ecc/commands/`. The user's decision after Task 4 ("Kiro-native, no compromise", see "Decisions after Task 4") overrides that. It reached this task in two notices from the orchestrator, both carrying out that decision:

1. First notice: the four exclusion rules no longer apply, all 94 commands are registered, rewrites and overlays are data-driven, the lint only reports, credit lines and license text must survive every rewrite, and the deviation is recorded.
2. Second notice, which replaces the first where they differ. It came after `.kiro/docs/command-adaptation-map.md` was written. Build the deterministic layer of the map (parts 1, 2 and 4) as data files. Only class A commands are registered after the rules. The lint is blocking for everything that is registered. Class B and C are pending, not installed, and listed in `plan --json`. `ecc-guide` and `plan-canvas` are not registered, because the installed skills of the same names give those entries. No overlay and none of the new owned pieces are built in this task. `quality-gate` stays as in the plan. Open item O5 becomes "deterministic layer done, overlays pending".

So the task delivers the second notice. The first one survives in three places: the credit and license protection, the overlay loader, and this record. The four rules are not in the code. Measured against the real files before they were dropped, they would have excluded 26 commands: 6 for Claude-only tooling, 2 for duplicating a skill, 5 for a missing skill and 13 for a missing script. The classes register 57 where the rules would have left 68. The difference is on purpose: the rules left out what lacked a dependency, and the classes register only what is Kiro-native today.

### What runs

```
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs plan    [--only commands] [--root <dir>] [--json]
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs install [--only commands] --yes [--root <dir>]
```

Without `--only`, all four parts run: 309 files (68 agents, 147 skill files, 35 steering files, 57 commands and 2 scripts). `--only commands` alone plans 59 files. The text form of `plan` adds two lines:

```
Commands: 57 of 94 registered as /ecc-<name> (423 replacements in 49 commands); 35 pending (class B and C, not installed); 2 left to a skill of the same name; 2 scripts
  Lint, which stops the plan for a command it would install: 74 clean, 18 still have Claude Code wording (pending commands only)
```

`plan --json` has `details.commands`: `total`, `registered`, `clean`, `stillClaudeSpecific` and `matches` (the lint patterns each pending command still matches), `withOverlay` and `overlays`, `pending` (name, class, reason, missing piece, design), `skipped`, `rewrites` (commands changed, replacements, count per rule, protected lines), `scripts`, `names` (what was checked, collisions, names the prefix saved) and `dropped` (frontmatter settings left out). The notes are `commands-pending`, `commands-skipped`, `command-fields-dropped` and `command-names`.

### What it installs

| Kind | Files | Comes from |
|---|---|---|
| Class A commands, `.kiro/steering/ecc-<name>.md` | 56 | ECC's `commands/<name>.md` after the rewrite rules |
| `ecc-quality-gate` | 1 | built by the installer from ECC's command and the Kiro adapter's script |
| `.kiro/ecc/scripts/quality-gate.sh` and `format.sh` | 2 | the Kiro adapter, with the execute bit of the checkout (mode 755) |

Every command file starts with its frontmatter: `inclusion: manual` and the quoted description. Then comes the header S1, then the body. S1 says how the command is invoked and what `ARGS` is. For `/ecc-checkpoint` it reads: "Invoked as `/ecc-checkpoint`. ARGS is the text after `/ecc-checkpoint` in the user's latest message. If invoked with `#ecc-checkpoint`, ARGS is the rest of that message. Empty ARGS follows the no-argument path." Steering does no substitution, so every `$ARGUMENTS` of ECC's text became `ARGS`, which S1 defines. The `argument-hint` of a command goes into the usage line of S1. The 57 files total 277,049 bytes (the largest is `ecc-prp-prd`, 14,340). A manual file loads only when it is picked, so the commands add nothing to the always-on set.

### How a command is built

1. The four data files must be there and valid, or the plan stops (`command-assets-missing`, `command-assets-invalid`). A command with no class stops it too (`command-class-missing`), so a command added by a later ECC release cannot slip in unclassified.
2. The command is parsed. An unknown frontmatter key stops the plan (`command-key-unknown`). `agent` and `subtask` become one sentence that delegates to the agent (only `security-scan` has them). `allowed-tools`, `disable-model-invocation`, `agent` and `subtask` are not carried over, and the plan says which commands lose which.
3. Credit and license lines are set aside (see below).
4. The rules run in file order. A rule with a `commands` list touches only those commands, and its `expect` is the exact number of matches: if an ECC change makes the count differ, the plan stops (`command-rule-missed`). A rule can `append` the snippet S2 (delegation) or S3 (skill limits) once, at the end.
5. The file is rendered: frontmatter, S1, the body, the appended snippets.
6. Required checks, whatever the data says: the frontmatter is the first content, it says `inclusion: manual`, and S1 is there.
7. The lint runs on the final text. A registered command that matches a pattern, or fails a required check, is not written and the plan stops (`command-lint`). So no text with Claude-only constructs is ever installed.
8. For a pending command the same text is built and linted for the report only (`matches`), to show how far it is from clean. It is not written.

### The data files (`assets/commands/`)

- `classes.json`: the class of each of the 94 commands, from the table of the map: 57 A, 24 B, 13 C. B and C entries have `reason`, `missing` and `design` (the map's B number). `skill` marks the two commands left to a skill and `builtin` marks `quality-gate`. The counts add up like this. `ecc-guide` is class A and is left to its skill, so 56 class A commands are registered. `quality-gate` is class B in the map and is registered. `plan-canvas` is class C and is left to its skill. So 57 registered (56 A and quality-gate), 35 pending (23 B and 12 C), 2 left to a skill, and 57 + 35 + 2 = 94.
- `rewrite-rules.json`: 41 ordered rules, each with an `id`, the map's `rule` number, a `pattern`, a `replacement` and a `why`. They carry R1, R2, R4 to R10, R13 and R14. R3 (frontmatter) is in the code. R11, R12, R15 and R16 are not rewrites: the lint catches them and the commands that use them are pending. `uninstalledSkills` lists the 21 optional skills that R13 marks "(optional skill, not installed)". The plan subtracts the skills that are installed. The six `orch-*` names are not in it, because they are not optional.
- `snippets.json`: S1, S2, S3, the delegate sentence and the headings for S2 and S3.
- `lint-patterns.json`: 33 patterns. They cover `~/.claude` and `.claude/`, `CLAUDE.md`, `$ARGUMENTS` and positional placeholders, the Claude tool names, model names, `ECC_*` variables, ECC hook ids and scripts, and a slash reference without the `ecc-` prefix.

Every file is checked when it is read: the schema name, unknown keys, regular expressions that do not compile, unknown placeholders and `append` values. A fault stops the plan with a code and the file name. A test loads the shipped files, and another lints all 57 registered commands with patterns written apart from the data file.

What the rules did to the real files: 423 replacements in 49 commands. The largest counts are `command-names` (R2) 247, `project-artifacts` (R7) 47, `uninstalled-skills` (R13) 33 and `arguments-placeholder` (R1) 20. The snapshot pins the count per rule.

### Credit and license text

A line that credits someone or carries license text is never rewritten and never linted. The engine finds these lines with code constants, not with the data files: a credit phrase ("adapted from", "inspired by", "credits", "courtesy of", "authors:", "originally by", the ECC repository address), "written by" or "thanks to" followed by a name or a link, license lines (license, copyright, SPDX, "permission is hereby granted") together with the rest of their paragraph or fenced block, and the whole section under a heading such as License, Credits, Acknowledgments or Notice. The lines are masked, the rules run over the whole text, and the lines are put back. If a rule swallowed one, the plan stops (`command-rewrite-dropped-protected`). In the real data 9 lines are protected: the credit lines of `code-review`, `gan-build`, `marketing-campaign`, the five `prp-*` commands and `skill-create`. The tests use synthetic input (a credit line full of text that every rule would change, a license paragraph, a fenced license block, a Credits section) and the real files (the 9 lines are in the snapshot and must come out unchanged). An overlay's `credit` lines are shown at the top of the installed file as `> Credit: ...`.

One effect of exempting these lines from the lint: the credit line of `gan-build` says the loop is inspired by Anthropic's harness design paper, and the lint has a pattern for `Anthropic`. The protected line is exempt, so the credit stays. Nothing else in that file may use the word.

### Overlays

The loader is built and tested with synthetic overlays. No overlay ships. An overlay is `assets/commands/overlays/<name>.md`: a header with `source` (`commands/<name>.md`), `sha256` (of the ECC file it was written from), `credit` (one or more lines) and an optional `description`, then the body. A malformed overlay stops the plan (`command-overlay-invalid`). An overlay is used only while its `sha256` equals the hash of the ECC file in the profile; then it replaces the ECC body, is lint-checked like everything else, and registers its command whatever the class. A stale overlay (the hash differs) is reported (`command-overlay-stale`) and not used: a class A command falls back to the ECC text with the rules, and a class B or C command stays pending. An overlay with no command of that name is reported (`command-overlay-orphan`) and ignored.

### Decisions and deviations from the plan

- The four exclusion rules and the reference copies in `.kiro/ecc/commands/` are gone (see "A change of plan from the user"). The plan's layout still lists that folder, and nothing writes it.
- The body is not verbatim any more: the rules change it. This is the user's decision after Task 4.
- No blanket `.claude` rewrite. The rules name the paths they know (R4 to R7) and send them to `.kiro/skills`, `.kiro/ecc/` or the user folders above. An unknown `.claude` path is not renamed; the lint stops the plan, and the command stays pending until someone decides what the path means in Kiro. Because the lint blocks every `.claude` path in a registered command, the `.kiroignore` block of Task 8 (which hides `.claude/`) cannot hide anything a command needs.
- `quality-gate` is built in code (`qualityGateParts`), not as an overlay, because this task builds no overlays and the notice says it stays as in the plan. ECC's command checks one file through a hook script the install does not have. The adapter's `quality-gate.sh` checks the whole project: it picks pnpm, yarn, bun or npm from the lock file, runs build, type check, lint and tests, skips a check with nothing to run, prints one line per check and a summary, and exits 1 if a check failed. The command runs `bash .kiro/ecc/scripts/quality-gate.sh` and then reports each failure with remediation steps. If ARGS asks for formatting in one file, it runs `bash .kiro/ecc/scripts/format.sh <path>` (that script takes one file). A credit line names ECC, the adapter and the MIT license. The map's design B10 is richer (a formatter check by file type for a path); it is the work of the later overlay workflow, and the engine prefers a current overlay over the built-in text.
- Scripts: only the two adapter scripts are installed (category `command-script`, mode 755 from the exec bit of the checkout). None of the four helper scripts of the Kimi install is installed: three crash on `./lib/...` (F6) and `harness-audit.js` checks a Claude layout (the map's B6). The plan said "only if it works", and none qualifies.
- `ecc-guide` and `plan-canvas` are left to their skills (map question 6 and default 2), reported under `skipped`. `ecc-kiro-harness.md` got one row: the ECC-repo paths that the `ecc-guide` skill reads (`README.md`, `manifests/`, `agent.yaml`) become `.kiro/skills`, `.kiro/agents`, `.kiro/steering/ecc-*.md`, `.kiro/hooks` and `.kiro/ecc/install-state.json`, and install questions go to `ecc-kiro-setup`. The file grew from 2,167 to 2,612 bytes. The always-on set is 21,285 of 25,000 bytes (3,715 spare). The 20,840 of Task 5 and the figures built on it were right for that round.
- The artifact root of a project is `.kiro/ecc/` (map default 1), through R7: plans, PRDs, PRPs, reviews, campaigns, the checkpoint log, `hookify/` and `package-manager.json` go there. Two things leave the project, as the map says. Session data and aliases (R5) go to `${KIRO_HOME:-$HOME/.kiro}/ecc/`, and the instinct data folder (R6) is the one `instinct-cli.py` prints, `~/.local/share/ecc-homunculus`. The commands of the instinct CLI use `.kiro/skills/continuous-learning-v2/scripts/instinct-cli.py`, or `~/.kiro/skills/...` when the skill is installed for the user.
- `gan-design` has a sentence that says "the same mode Anthropic used for their frontend design experiments". It is not a credit line, so R10 applies. The rewrite reads "the harness design paper used for its frontend design experiments (credited in /ecc-gan-build)", because "Kiro" would be false there. The credit line of `gan-build` is kept as it is.
- The lint skips protected lines (above), and pending commands are linted on their would-be text for the report only. Only a registered command can be stopped by the lint.
- Names: every command is `ecc-<name>`. A clash with a skill, an agent, another steering file, one of the 52 Kiro built-in commands, or the user's global skills and agents is a blocking problem (`command-name-collision`). The list of built-ins is the constant `KIRO_BUILTIN_COMMANDS`, taken from kiro.dev on 2026-10-07. There are no clashes now. Without the prefix, `checkpoint`, `plan` and `sessions` would clash.
- Rejected: Kiro prompts or skills as the vehicle for commands (map 4.1), a generic `.claude` catch-all rewrite, a hard-coded list of Claude-state commands, and reference copies with a note stamp.
- Existing tests were updated: the part lists, `--only` cases and counts in `plan.test.mjs` and `install.test.mjs`. The install tests now build a real temporary skill folder with command data as their default `skillDir`, so the synthetic installs do not depend on the shipped data.
- Not built, by instruction: overlays, `hookify-guard`, `usage-report`, the `audit` subcommand, the panel agents, the `orch-review` recipe, and the profile additions for the six `orch-*` skills (O12). A `NOTICE-ECC.txt` and one overlay (`quality-gate`) were written early in the task and deleted when the second notice arrived.

### Checks against Kiro (two headless runs, V3, in the sandbox project `/tmp/ecc-sbx/project`)

Both runs used `kiro-cli chat --v3 --no-interactive --trust-tools=read,shell` with the default agent, after the full install (309 files). The raw output was not saved in the workspace. For ground truth I read Kiro's own session record of each run (the kind of each record, the steering that was included, and the tool calls), not only the model's answer. Session ids are left out on purpose.

- Run 1, `/ecc-quality-gate`. The record shows the user message `/ecc-quality-gate`, two steering inclusion records (the always-on files, then the command's file), and one shell call: `bash .kiro/ecc/scripts/quality-gate.sh`. The installed script ran and reported 0 passed, 0 failed and 4 skipped, so the gate passed. That is expected: the sandbox has no `package.json`, TypeScript config, linter config or tests, so each of the four checks was skipped. The agent reported it that way.
- Run 2, `/ecc-checkpoint list`. The record shows the user message `/ecc-checkpoint list`, the same two inclusion records (the second is `ecc-checkpoint`, with the header that defines ARGS), and two directory listings (`.kiro`, then `.kiro/ecc`) that look for the log. The agent took the "List Checkpoints" path with ARGS = `list`, found no `.kiro/ecc/checkpoints.log` and said no checkpoint exists yet. It named the rewritten path, not a `.claude` one, and it created no file.
- What the runs show: in the V3 CLI, `/ecc-<name>` loads the manual steering file of that name for that turn, the text after the name reaches the agent and is read as ARGS, the agent uses the rewritten artifact path, and the installed script is executable and runs.
- What they do not show (O14): the IDE `/` menu and IDE argument pass-through, the `#ecc-<name>` form, a command with a sub-agent sentence (`security-scan`), and a command that writes (`/ecc-checkpoint create` needs git and writes the log). The cap of two headless runs is used.

### Verification that was run

- Whole suite: `cd .kiro/skills/ecc-kiro-setup/scripts && node --test --test-reporter=spec test/*.test.mjs 2>&1 | grep -vE '^\s+✔' | grep -vE '^(▶|✔) '`: 694 tests, 694 pass, 0 fail, 0 skipped (the real-data tests ran).
- Fresh temp project under `/tmp/ecc-scratch`, all parts: `plan --json` gave `create 309`, no problems, the notes `agent-model-dropped`, `skill-extra-fields`, `steering-globs-overridden`, `commands-pending`, `commands-skipped`, `command-fields-dropped` and `command-names`, protected `.kiro/agents` (68 files), and always on 21,285 of 25,000 bytes. `install --yes` wrote 309 files (68 agents, 147 skill files, 35 steering files, 57 commands, 2 scripts). A second `install --yes` said "Nothing to change". After appending a line to `.kiro/steering/ecc-plan.md`, `plan` reported `unchanged 308   kept (edited) 1` and `install --yes` left the edit. Both scripts are `-rwxr-xr-x`. The folder was deleted.
- Sandbox project: `plan` showed `create 59   update 1` (the 57 commands, the 2 scripts, and the harness note), `install --yes` wrote 60 files, and a second `install --yes` changed nothing. The state is `complete` with 309 files (agent 68, skill 147, steering 35, command 57, command-script 2). A read-only `plan` at the end of the task says `unchanged 309`, and both scripts are executable.
- `doctor`: ok with no findings, and the `SKILL.md` self check is valid.
- Mutation check on copies of the skill under `/tmp/ecc-scratch` (deleted afterwards), one rule broken per copy. Two controls first: an unchanged copy and a copy with the two data files only re-serialized both gave 694 of 694. Then every break made the suite fail:

| Broken in the copy | Failing tests |
|---|---|
| an overlay is used whatever its hash | 3 |
| credit and license lines are not protected from the rules | 5 |
| the lint no longer skips protected lines | 23 |
| `inclusion: manual` written as `always` | 49 |
| the required-content check never reports | 1 |
| lint pattern `codeagent-wrapper` deleted | 2 |
| rule `project-artifacts` deleted, so `.claude/` paths stay | 9 |
| that rule and lint pattern `claude-project-dir` both deleted | 5 |
| execute bit of the adapter scripts dropped | 4 |
| `expect` counts of targeted rules ignored | 2 |
| name collisions no longer reported | 1 |
| the lint no longer blocks a registration | 4 |
| class B commands registered | 22 |
| `ecc-guide` and `plan-canvas` not left to their skills | 22 |
| overlay credit lines not rendered | 5 |

The double deletion matters most: with a rule and its lint pattern both gone, the `.claude/` path would pass the plan, and the real-data tests still catch it because they lint the installed text with patterns written apart from the data file.

### Not installed, and other limits

- Pending, class B (23): auto-update, cost-report, evolve, harness-audit, hookify, hookify-configure, hookify-help, hookify-list, loop-start, loop-status, model-route, multi-backend, multi-execute, multi-frontend, multi-plan, multi-workflow, orch-review, pm2, project-init, santa-loop, sessions, setup-pm and skill-health. Pending, class C (12): the 7 `epic-*` commands and orch-add-feature, orch-build-mvp, orch-change-feature, orch-fix-defect and orch-refine-code. `plan --json` gives the reason and the missing piece for each (O12, O13).
- Registered, but they need something that arrives later: `/ecc-jira` needs the `jira` MCP server, whose example file comes in Task 8. The six instinct commands (`instinct-export`, `instinct-import`, `instinct-status`, `projects`, `promote`, `prune`) read or change instincts, and five of them run `instinct-cli.py` from the installed skill. Nothing records instincts until the observer hook of map default 5 is wired, so they work on empty data. `/ecc-security-scan` relies on AgentShield, and the map says its coverage of `.kiro/` is unverified.
- 33 mentions of skills that are not installed carry "(optional skill, not installed)" (R13).
- `ecc-lessons-learned` still mentions the `ecc-extract-patterns` hook (Task 7, off by default).

### Open for the user after Task 6

O5 changed, and O12 to O14 are new. Nothing blocks Task 7. The earlier items O8 (veto), O9, O10 and O11 stand. One call is open for you: the rewrite of the Anthropic sentence in `gan-design` is mine, so say so if you want ECC's wording kept there. It would take a protected-line exception or a rule that skips that sentence.

## Task 7 results

The `hooks` part of `plan` and `install` is built. It reads the 13 hooks of ECC's Kiro adapter and writes 12 hook files and 1 script. 857 unit tests pass (`node --test` from `scripts/`), 163 more than after Task 6. The tests over the real files (`test/real-hooks.test.mjs`, 17 tests) are skipped on a machine without the source cache.

Added to the skill: `lib/hook-schema.mjs` (the v1 format and its validator), `lib/hooks.mjs` (the glob translator, the reader of the old format, the converter and the three adaptations), `scripts/runtime/git-push-guard.mjs` (the guard), the `hooks` part in `lib/plan.mjs`, a loader for the guard and one report line in `lib/commands/plan.mjs`, a Hooks section in `SKILL.md`, and the tests: `test/hook-schema.test.mjs` (50), `test/hooks.test.mjs` (40), `test/git-push-guard.test.mjs` (32), `test/real-hooks.test.mjs` (17), a block of 10 and one more test in `test/plan.test.mjs`, a block of 13 in `test/install.test.mjs`, the helper `test/hook-assets.mjs` and `test/snapshots/hooks-v2.2.3.json`. Existing tests that count the parts or the files of an all-parts install were updated (five parts now, 322 files).

### What runs

```
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs plan    [--only hooks] [--root <dir>] [--json]
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs install [--only hooks] --yes [--root <dir>]
```

Without `--only`, all five parts run: 322 files (68 agents, 147 skill files, 35 steering files, 57 commands and 2 scripts, 12 hooks and 1 script). `--only hooks` alone plans 13 files. The text form of `plan` adds one line and the preview lists `.kiro/hooks/ (12 files)` among the paths Kiro asks about:

```
Hooks: 12 hooks in .kiro/hooks, all switched off; actions: 11 agent prompts (credits when on), 1 script; not converted: quality-gate; 1 script file installed
```

`plan --json` has `details.hooks`: `total`, `converted`, `disabled`, `agentActions`, `commandActions`, `byTrigger`, `adapted` (name and reason), `skipped` (name and reason) and `scripts`. The notes are `hooks-disabled`, `hooks-adapted` and `hooks-skipped`.

### What it installs

| Kind | Files | Comes from |
|---|---|---|
| `.kiro/hooks/ecc-<name>.json`, one hook per file, `"enabled": false` | 12 | the adapter's `.kiro/hooks/<name>.kiro.hook` files, converted at install time |
| `.kiro/ecc/scripts/git-push-guard.mjs` | 1 | `scripts/runtime/git-push-guard.mjs` in the skill (our code, no ECC source, no execute bit: the hook runs it with `node`) |

The state categories are `hook` and `hook-script`. The 12 hooks, as the snapshot pins them:

```
ecc-auto-format             PostFileSave    \.(ts|tsx|js)$                                        agent
ecc-code-review-on-write    PostToolUse     write                                                 agent
ecc-console-log-check       PostFileSave    \.(js|ts|tsx)$                                        agent
ecc-doc-file-warning        PostFileCreate  \.(md|mdx|rst)$|(^|/)(README|CHANGELOG)[^/]*$|(^|/)docs/   agent
ecc-extract-patterns        Stop            (none)                                                agent
ecc-git-push-review         PreToolUse      shell                                                 command
ecc-python-lint-on-edit     PostFileSave    \.py$                                                 agent
ecc-rust-check-on-edit      PostFileSave    \.rs$                                                 agent
ecc-security-check-on-create PostFileCreate (^|/)(auth|api|middleware)/                          agent
ecc-session-summary         Stop            (none)                                                agent
ecc-tdd-reminder            PostFileCreate  \.(ts|tsx)$                                           agent
ecc-typecheck-on-edit       PostFileSave    \.(ts|tsx)$                                           agent
```

Five hooks are on PostFileSave, three on PostFileCreate, two on Stop, one on PostToolUse and one on PreToolUse. Eleven run an agent prompt, which costs credits each time it fires. One runs a script and costs none.

### How a hook is converted

1. The source is read as JSON. An unknown key, a name that differs from the file name, an unknown action or a pattern list of the wrong kind stops the conversion with a code, so a field that a later ECC release adds is never dropped by accident.
2. The trigger comes from the table in Kiro's migration page (`lib/hook-schema.mjs` has all ten 0.x names). A trigger that tests a file path takes the patterns, one that tests a tool name takes the tool types, and the others take neither (patterns on those are an error).
3. File patterns become a matcher: `*.ts` is `\.ts$`, `**/auth/**` is `(^|/)auth/`, several patterns of one shape share a group, and both shapes are joined with `|`. Any other pattern stops the conversion. Tool types join with `|` (`write`, `shell`). `*` is refused.
4. `askAgent` becomes an agent action with the prompt as it was, and `runCommand` a command action. The description is kept.
5. The name is `ecc-<name>` and `enabled` is `false`, whatever the source says.
6. Three hooks are adapted by hand after that step (below). Each adaptation checks that the source is the kind of hook it was written for, and each text change must match exactly once or the plan stops.
7. The converted hook is checked against the v1 format with every hook required to be off. A failure stops the plan (`hook-invalid`) and nothing is written.
8. A hook that is started by hand (`userTriggered`) has no v1 trigger and is left out. That is `quality-gate`; the commands part installs it as `/ecc-quality-gate`.

The three adaptations:

| Hook | What changes | Why |
|---|---|---|
| `git-push-review` | Command action `node .kiro/ecc/scripts/git-push-guard.mjs` instead of the agent prompt. Still `PreToolUse` on `shell`. | A v1 tool matcher cannot look at the command, so an agent prompt on the shell tool would run on every shell call. A script that acts only on `git push` needs no agent run and no credits. |
| `doc-file-warning` | `PostFileCreate` on documentation paths instead of `PreToolUse` on `write`. Four short phrases of the prompt change so that it reads right after the write ("A file was just created", "remove it", "Otherwise carry on"). The description changes too. | A v1 tool matcher cannot look at the file path, so a hook on the write tool would run on every write. The file triggers can, but they run after the write. |
| `extract-patterns` | The path `.kiro/steering/lessons-learned.md` becomes `.kiro/steering/ecc-lessons-learned.md`, in the prompt and in the description. | The steering part installs the file with the `ecc-` prefix. |

### The validator

`validateHookFile(value, { requireDisabled })` in `lib/hook-schema.mjs` checks a parsed file against the fields Kiro documents. It is strict about keys on purpose: a misspelled `enabled` would leave a hook on. It returns every problem it finds, each with a code.

- File: an object with only `version` and `hooks`; version `"v1"`; a non-empty list of hooks.
- Hook: only `name`, `description`, `trigger`, `matcher`, `action`, `timeout`, `enabled` and `confirm`; a text name that is unique in the file.
- Trigger: one of the ten that IDE 1.0 and the CLI share (SessionStart, Stop, UserPromptSubmit, PreTaskExec, PostTaskExec, PreToolUse, PostToolUse, PostFileCreate, PostFileSave, PostFileDelete). Text only, and case sensitive. A 0.x name gets the name it became, `userTriggered` gets the steering file advice, and SessionEnd, Manual and AgentSpawn get the reason they are one-surface only.
- Matcher: a regular expression that compiles, with no lookahead, lookbehind or backreference. It is refused on the triggers that do not test one (Stop, SessionStart, PreTaskExec, PostTaskExec), because the hook would always fire. `*` is allowed on the two tool triggers, where Kiro uses it for every tool.
- Action: `type` is `command` or `agent`; a command action has `command` and no `prompt`, and the other way round.
- `timeout`: a number of seconds, 0 or more, and not on an agent action, where Kiro ignores it. `enabled`: true or false. With `requireDisabled`, `enabled` must be `false` and written out.
- `confirm`: only on a command action on Stop, with a question, options that have an id, a label and a run flag, and optionally a `confirmCommand`.
- `{{filePath}}` in a command: only on the file triggers, and no other `{{...}}` variable.

The tests found two bugs in the first version of the validator: a trigger given as a list (`["Stop"]`) was accepted because a list becomes a property name, and the message for an agent action said "a agent". Both are fixed and pinned.

### The git push guard

`scripts/runtime/git-push-guard.mjs` uses Node built-ins only and imports nothing from the skill, so it runs where the skill is not. It reads the hook event on stdin and looks for `git push` in the string values of `tool_input`, whatever the field is called.

- Exit 0 and no output for any other command. Exit 2 with ECC's four-point checklist on stderr for a push, which Kiro gives to the agent. The message says to run the same command again with `ECC_PUSH_REVIEWED=1` in front of it, and that form exits 0.
- It finds a push in `git push`, `git -C dir push`, `git -c k=v push`, `/usr/bin/git push`, after `&&`, `||`, `;`, a pipe, a newline, `(`, `$(` or a backtick, after variable assignments and `sudo`, `env`, `exec`, `time` and the like, and inside `sh -c "..."` and `eval`, to three levels. It leaves `git stash push`, `git pull`, `echo "git push"` and a sentence that mentions a push alone.
- It exits 0 with a warning on stderr when the event is empty, not JSON, not an object or has no `tool_input`, and when nothing arrives on stdin within 5 seconds, so a broken hook never stops work. It does not wait on a terminal.
- Limits, stated in the file: quotes are not tracked, so `; git push` inside a quoted argument or a here-document is taken for a push; options between `sudo` or `env` and `git` are not skipped; and the acknowledgement is written by the agent, so this is a reminder for the agent and not a security control.

### Decisions and deviations from the plan

- Sources: the four pages the task named (`hooks.md`, `hooks/types.md`, `hooks/actions.md`, `ide/whats-new-v1/hooks.md`), plus `hooks/management.md`, `hooks/examples.md`, `hooks/troubleshooting.md`, `cli/v3/hooks-migration.md` and the hooks field of `custom-agents/configuration-reference.md`, all read on 2026-10-07. Several pages lost their JSON examples when fetched, so the stdin shape of a tool event comes from the MCP example on the types page (`tool_name` and `tool_input`) and was then confirmed by the headless run below. The `aws-mcp` documentation search was not repeated: Task 1 recorded that AWS's pages do not cover the v1 hook schema.
- Upstream pull request 2287 (open) was read as a cross-check and nothing was copied. It agrees on the trigger names and on regular expression matchers. It differs from this build in four ways: it leaves 5 of its 13 hooks on; it keeps git-push-review as an agent prompt on `execute_bash`; it makes quality-gate a `PostTaskExec` hook; and it matches tools by internal names (`fs_write|str_replace|fs_append`). This build keeps every hook off, uses a script for the push hook, leaves the manual hook to `/ecc-quality-gate`, and uses the category names `write` and `shell` that the types page documents.
- The plan's hook table has five 0.x types. The converter handles all ten of Kiro's migration table, because the trigger table drives it and each type needed no code of its own. A test walks all ten.
- The plan said "regexes that compile". The validator also refuses lookahead, lookbehind and backreferences (decision 3 under O15).
- The plan said to point extract-patterns at `ecc-lessons-learned.md`. The prompt and the description both name it now.
- The guard follows the plan's sketch (stdin, `tool_input` strings, exit 2 with the checklist, `ECC_PUSH_REVIEWED=1`, exit 0 with a warning on bad input). Added beyond it: a 5 second limit on reading stdin, a list of words (`["git", "push"]`) is read as a command, and the shell prefixes, `git -C dir push` and `sh -c` forms.
- The guard is installed only when a converted hook runs it. A profile without git-push-review gets no script.
- No hook sets `timeout` or `confirm`; the validator accepts both because Kiro documents them.
- The agent prompts are ECC's text, unchanged apart from the adaptations. They have no file name in them, as in ECC. Kiro documents `{{filePath}}` for command actions only, so it is not used in a prompt (O15).
- No ECC prose is stored in this tool: the hook files are made from the downloaded ECC files at install time, the snapshot holds triggers, matchers and names only, and the tests use synthetic prompts. The adaptations hold four short phrases of ECC's text as the anchors they replace.
- `ecc-kiro-harness` and the steering rewrites needed no change: they already say ECC hooks ship switched off and name `ecc-extract-patterns`.

### Checks against Kiro (two headless runs, V3)

Both runs used `kiro-cli chat --v3 --no-interactive --trust-tools=read,shell` with the same prompt, in a fresh scratch git project with no remote and no commits, with only the hooks part installed. The prompt asked the agent to run `git push origin main`, to quote any message that stopped it word for word, and to follow the message once if it said how to proceed. The two projects differed in one value: run 1 had `"enabled": true` on `ecc-git-push-review.json`, run 2 had the file as installed (`false`). For ground truth I read Kiro's own session record of each run, not only the answer.

- Run 1 (hook on). The first `execute_bash` call has status `denied`. The agent quoted the checklist word for word, then ran `ECC_PUSH_REVIEWED=1 git push origin main`, which has status `completed`. Git itself then failed (`src refspec main does not match any`, exit 1) because the repository has no commits. The session record has two `ContextualHookInvoked` entries for `ecc-git-push-review`, action type `runCommand`, status `completed`, with the hook file path as the id: one for the blocked call and one for the acknowledged call.
- Run 2 (hook off, as installed). One `execute_bash` call, `completed`, and no hook record. The same git error, and no message from the hook.
- What the runs show, for the V3 CLI of `kiro-cli` 2.28.0: it loads a v1 hook file from `.kiro/hooks`; the matcher `shell` matches the shell tool, whose internal name is `execute_bash`; the command runs from the project root, so the relative path `.kiro/ecc/scripts/git-push-guard.mjs` works; the event reaches the script on stdin and the command is found in `tool_input`; exit 2 blocks the call and the text on stderr reaches the agent; exit 0 lets the acknowledged form through; and `"enabled": false` is honored.
- What they do not show (O15): the IDE and its Agent Hooks panel, the 11 agent-prompt hooks, the file triggers and Stop, the V2 engine, and how the eye icon changes a file. The cap of two headless runs is used.

### Verification that was run

- Whole suite: `cd .kiro/skills/ecc-kiro-setup/scripts && node --test --test-reporter=spec test/*.test.mjs 2>&1 | grep -vE '^\s+✔' | grep -vE '^(▶|✔) '`: 857 tests, 857 pass, 0 fail, 0 skipped (the real-data tests ran).
- Fresh scratch project, all parts: `plan --json` gave `create 322`, no problems, protected `.kiro/agents` (68 files) and `.kiro/hooks` (12 files). `install --yes` wrote 322 files. A second `install --yes` said "Nothing to change". I read each of the 12 installed hook files: every one has `"enabled": false`. After setting `"enabled": true` in `ecc-auto-format.json`, `plan` reported `unchanged 321   kept (edited) 1` with that path, and `install --yes` left the edit. The folder was deleted.
- Sandbox project `/tmp/ecc-sbx/project`: `plan` showed `create 13   unchanged 309`, `install --yes` wrote 13 files, and a second run changed nothing. The state is `complete` with 322 files (agent 68, skill 147, steering 35, command 57, command-script 2, hook 12, hook-script 1), and all 12 hook files are off.
- `doctor` from the workspace root: ok, with the one info note that v1 hooks need `--v3` on `kiro-cli` 2.x, and a valid `SKILL.md`. The workspace itself was not touched: `.kiro` still holds only `docs` and `skills`.
- Mutation check on copies of the skill under `/tmp/ecc-scratch` (deleted afterwards), one rule broken per copy. The control, an unchanged copy, gave 857 of 857. Every break made the suite fail:

| Broken in the copy | Failing tests |
|---|---|
| hooks written with `enabled: true` | 58 |
| `enabled: true` and the converter no longer requires hooks to be off | 12 |
| the validator no longer reports a hook that is not off | 2 |
| the validator accepts any trigger | 8 |
| the validator allows a lookahead in a matcher | 2 |
| the translator drops the `$` of an extension | 11 |
| the translator drops the slash after a folder | 8 |
| the reader accepts an unknown key in a source hook | 1 |
| the hook that is started by hand is no longer left out | 30 |
| extract-patterns keeps the old lessons path | 3 |
| doc-file-warning stays on PreToolUse | 4 |
| the documentation matcher loses `docs/` | 2 |
| the guard command points at the wrong file | 4 |
| the plan does not plan the guard script | 14 |
| the hooks part forgets the script category in its scope | 1 |
| the installer never loads the guard from the skill folder | 22 |
| the guard no longer sees `&&` as a separator | 5 |
| the guard blocks with exit 1 instead of 2 | 10 |
| the guard takes every push for acknowledged | 11 |
| the guard accepts the acknowledgement anywhere in the line | 2 |

The second row matters most: with the hooks written on and the check that would object also gone, the tests that read the real files still fail, because they read each planned file and require `enabled` to be exactly `false`.

### Not installed, and other limits

- Nothing is installed in this workspace. The hooks, like everything else, wait for the confirmed install after Task 8 and the command workflow.
- If ECC's own `.kiro/install.sh` was ever run in a project, that project has the old `.kiro.hook` files, which are on. They are the user's files and are left alone, but they would run next to the new ones once switched on. Doctor does not look for them.
- A hook that asks the agent to review a write (`ecc-code-review-on-write`) can fire again when the agent fixes what it finds. This is how ECC's hook behaves too. Switch such hooks on one at a time.
- `ecc-doc-file-warning` also fires for Markdown that Kiro writes under `.kiro/` (O16).
- The folder matchers use `/` (`(^|/)auth/`). If Kiro hands a matcher a path with backslashes on Windows, `ecc-security-check-on-create` would not match. The extension matchers do not care. Not tried.
- The guard's limits are listed above. It does not look at `tool_name`; the matcher `shell` does that job.
- Task 11 must copy `scripts/runtime/` into the global copy and the Power, or the install from there cannot find the guard.

### Open for the user after Task 7

O15 (what is unproven) and O16 (choices you may veto). The earlier items O8 (veto), O9, O10 and O11 stand, and so does the `gan-design` wording. Nothing blocks Task 8.

## Task 8 results

The install lifecycle is complete. `plan` and `install` have three new parts, `mcp`, `license` and `isolation`, and `update` and `uninstall` are real commands. 1021 unit tests pass (`node --test` from `scripts/`), 164 more than after Task 7. The tests over the real files (`test/real-lifecycle.test.mjs`, 11 tests) are skipped on a machine without the source cache.

Added to the skill: `lib/kiroignore.mjs` (the block), `lib/mcp.mjs` (the MCP examples), `lib/notices.mjs` (the license files), the three parts in `lib/plan.mjs`, one factory for install, update and uninstall in `lib/commands/plan.mjs` with `prepareUninstall`, the harness folder scan and the reports, the block and the end of an uninstall in `io/apply.mjs`, the ownership rules for the block in `lib/state.mjs`, the wiring in `lib/cli.mjs`, new sections in `SKILL.md`, and the tests: `test/kiroignore.test.mjs` (25), `test/mcp.test.mjs` (21), `test/notices.test.mjs` (6), `test/apply-lifecycle.test.mjs` (29), `test/entry.test.mjs` (6), `test/real-lifecycle.test.mjs` (11), `test/snapshots/lifecycle-v2.2.3.json`, and new blocks in `test/install.test.mjs`, `test/plan.test.mjs`, `test/state.test.mjs` and `test/cli.test.mjs`. Existing tests that counted parts, files or the reserved commands were updated (eight parts now, 327 files for this workspace).

### What runs

```
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs plan      [--action install|update|uninstall] [--only <parts>] [--root <dir>] [--json]
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs install   [--only <parts>] (--yes | --dry-run) [--root <dir>]
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs update    [--only <parts>] (--yes | --dry-run) [--root <dir>]
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs uninstall [--only <parts>] (--yes | --dry-run) [--root <dir>]
```

The parts, in the order they run: `agents`, `skills`, `steering`, `commands`, `hooks`, `mcp`, `license`, `isolation`. Without `--only` all eight run. All three commands refuse to change anything without `--yes` (exit 2 with the way to preview), and `plan --action <name>` is the same preview as `<name> --dry-run`. `update` takes the options of `install`. `uninstall` takes no `--source`, `--fetch` or `--profile`, because it reads no ECC source. For this workspace the plan is 327 files: agents 68, skills 147, steering 35, commands 59 (57 commands and 2 scripts), hooks 13 (12 hooks and the guard), mcp 2, license 2 and isolation 1. The text form of `plan` adds three lines:

```
MCP examples: 38 servers (27 local, 11 remote) in .kiro/ecc/mcp.json.example, every one switched off; 4 of them from the Kiro adapter of ECC
License: .kiro/ecc/LICENSE and .kiro/ecc/THIRD_PARTY_NOTICES.md
Isolation: a block in .kiroignore asks Kiro to ignore 2 folders of other harnesses (.claude, .kimi-code)
```

`plan --json` has `details.mcp` (servers, where from, local and remote, what was left out, the two files), `details.license` and `details.isolation` (the folders and whether there is a block). The notes are `mcp-examples`, `mcp-left-out`, `isolation-ide` and `isolation-none`. For an uninstall the report has `source: null`, `profile.file: null` and `stateFile` (`path` and whether it is removed), and the apply report's `state` gained `removed`.

### What the new parts install

| Kind | Files | Comes from |
|---|---|---|
| `.kiro/ecc/mcp.json.example`, `{"mcpServers": {...}}` with 38 entries | 1 | the catalog of ECC (34 servers) and the example of its Kiro adapter (4), converted at install time |
| `.kiro/ecc/mcp-servers.md`, a table of server, source, how it starts, what to fill in, and ECC's description | 1 | the same two files |
| `.kiro/ecc/LICENSE` | 1 | ECC's LICENSE, byte for byte, checked against the hash in the profile |
| `.kiro/ecc/THIRD_PARTY_NOTICES.md` | 1 | written by the tool (`lib/notices.mjs`): ECC, its holder, the release, the commit and the hash of the LICENSE; the four projects the installed ECC files credit, with their holders; a line about third-party services; trademark lines |
| a block in `.kiroignore` | 1 or 0 | the tool, for the folders of `HARNESS_DIRS` that exist: `.claude/` and `.kimi-code/` here |

The state categories are `mcp`, `license` and `kiroignore`. The block is recorded as one owned "file" whose hash is the hash of the block text, not of `.kiroignore`.

### The MCP examples

Each entry keeps `command`, `args`, `url`, `headers` and `env` as ECC has them, so every `YOUR_..._HERE` placeholder, path and version pin is kept, and adds `"disabled": true`. Left out: `description` (34, it goes to the table), `type` (11, Kiro does not use it) and `autoApprove` (2). `_comments` of the catalog is dropped. A source field the converter does not know stops the plan (`mcp-unknown-field`), so a field that a later ECC release adds is never dropped unseen. The other stops are `mcp-invalid-json`, `mcp-shape`, `mcp-server-name`, `mcp-server-shape` (neither or both of `command` and `url`, wrong kinds, a `url` that is not http or https) and `mcp-duplicate`. Names, commands and URLs are data: the table writes each cell on one line, with pipes and control characters made harmless. The file is in `.kiro/ecc/` and never in `.kiro/settings/`, where Kiro would start the servers and the agent may not write. The `jira` entry is the one `/ecc-jira` needs.

### The .kiroignore block

- The block is five lines for two folders: a begin marker, one comment line, one `<folder>/` line per folder (sorted, at most the 13 of `HARNESS_DIRS`, only those that are folders in the project), and an end marker. The markers are the constants from Task 1.
- Everything outside the markers is the user's and is never rewritten, not even its line breaks. A new block goes after the user's lines with one blank line between. A file with Windows line breaks gets a block with Windows line breaks. A block that is replaced keeps the line breaks it had.
- If there is no `.kiroignore`, the installer creates it and records `createdFile: true` on the entry (an optional field that only that entry may carry, so records from earlier builds stay valid). An uninstall takes the block out and the blank line before it, and deletes the file only if it was created by the installer and nothing else is in it. A `.kiroignore` of the user, even an empty one, is never deleted.
- Ownership is the one of every file. An edit inside the block makes it an edit: `install` and `update` keep it and say a newer version was not applied, and `uninstall` keeps it and stops tracking it. A block with no record, a link, a folder, text that is not UTF-8 or a damaged marker line is left alone and reported as a conflict.
- The block is written and removed last in its group of decisions, so a run that stops early has not touched the file.
- The scan of the project for harness folders happens when the plan is made, so `update` follows the project: a new `.cursor/` is added to the block, and when the last folder is gone the block goes.

### update and uninstall

- `update` plans like `install`, with the mode `update`, so a file that the record owns, the user has not edited and the plan no longer includes is removed (where `install` calls it stale). An edited file is kept and no longer tracked. Folders the install created are removed when they are empty. Without a record it stops with `not-installed` and the fix "Run install first" (exit 1).
- `uninstall` reads the record and the project and nothing else: no profile, no ECC source, no cache, no git, so it works when the cache is gone. Without `--only` it takes every file the record lists, whatever its category. With `--only` it takes the files of those parts and keeps the record of the rest. The order: the files, the block, the folders it created, then the record, then the folders the record was the last file of. If a file stops the run, the record lists what is left and a second run finishes. Without a record it says "Nothing to remove." and exits 0.
- The skill is protected twice. No write or removal may name a path in `.kiro/skills/ecc-kiro-setup/` (`managedPathProblem`), and a record that lists such a path, or lists a folder of the skill as one the install created, is refused as `state-invalid`. The record is validated before anything else happens. Folders are removed only with `rmdir`, so a folder that holds anything is never removed.
- A record may not call `.kiroignore` a plain file, because an uninstall would then delete the whole file, and may not give the category `kiroignore` to another path.
- The previews list the paths Kiro asks about (`.kiro/agents/`, `.kiro/hooks/`, `.kiroignore`), because the installer, not the agent, removes them. The text of an uninstall preview names the record and says the skill is not touched.

### Decisions and deviations from the plan

- Three small parts, not one: the plan names three jobs (the block, the example, the license), and `isolation` has to be a choice the wizard can leave out. `--only` stays literal, so a partial install has no license unless it names the part (O18).
- The descriptions of the MCP servers are a table, as the plan said, but the table is installed at `.kiro/ecc/mcp-servers.md` and generated from ECC's file, not written into `references/` of the skill. The license review says the repo should hold no ECC text, and this task makes no new Markdown file in the repo. O18 has the way back.
- `autoApprove` is dropped from the example (O18 a). It is the conservative choice. The plan said only "every server `disabled: true` with placeholders kept".
- `THIRD_PARTY_NOTICES.md` is installed because the license review (gate 3) and "Next actions" asked for it in Task 8. The brief of this task did not list it. The credits are the ones the review read on 2026-10-07. The test that credit lines survive conversion is the one from Task 6.
- The reserved-command mechanism is gone from `lib/cli.mjs`: the `reserved` helper, the `implemented` flags, the `[not available yet]` marker and the exit-code wording. Nothing could use it any more. The usage text is shorter by that and the tests of the mechanism were replaced.
- `prepare` reads the install record before it opens the ECC source, so a damaged record stops a run before any download.
- The install report's `state` gained `removed` (always false for install and update), so the three reports have one shape.
- The note of the isolation part, the line of the report and the text in `SKILL.md` say "asks Kiro to ignore", not "hides", because of what the runs below showed.

### Checks against Kiro (two headless runs, V3)

Both runs used `kiro-cli chat --v3 --no-interactive --trust-tools=read` in a scratch project under `/tmp/ecc-scratch` that is not a git repository, with a sentinel text file in `.claude/`, in `.kimi-code/` and in `src/`. For ground truth I read Kiro's own session record of each run.

- Run 1: the project had the block as the installer writes it (`install --only isolation,mcp,license`), plus the example and the license files. The agent read all three sentinel files (each tool result has `success: true`) and a search found all three. Asked for the MCP servers it could use, it named three servers of the user's own configuration and four Powers, and none of `jira`, `nexus`, `ito-compute` or `ecc-memory-vault`. Cost: 0.357 credits.
- Run 2: the project had plain lines and no markers: `.claude/`, `.kimi-code`, `src/only-this.txt` and `*.secret`, with a sentinel file for each and one control. Five reads, five `success: true`, and the search listed all five. Cost: 0.970 credits.
- What the runs show, for the V3 CLI of `kiro-cli` 2.28.0 in headless mode: it did not enforce `.kiroignore` in any of the four forms or in the block. The example was not loaded as MCP configuration. What they do not show (O17, O19): why, whether a newer CLI enforces it, and what the IDE does. The cap of two headless runs is used.

### Verification that was run

- Whole suite: `cd .kiro/skills/ecc-kiro-setup/scripts && node --test --test-reporter=spec test/*.test.mjs 2>&1 | grep -vE '^\s+✔' | grep -vE '^(▶|✔) '`: 1021 tests, 1021 pass, 0 fail, 0 skipped (the real-data tests ran).
- Fresh temp project (since deleted) with `.claude/`, `.kimi-code/`, `src/`, a `.kiroignore` of three lines and a copy of this skill in `.kiro/skills/ecc-kiro-setup` (90 files): `plan` gave create 327, no problems, protected `.kiro/agents` (68), `.kiro/hooks` (12) and `.kiroignore` (1), and wrote nothing. `install --yes` wrote 327 files and the block, after the user's three lines. A second `install --yes` said "Nothing to change". `update --dry-run` and `update --yes` changed nothing. `uninstall --dry-run` listed remove 327 and changed nothing (every file hash equal to the hashes after the install). `uninstall --yes` removed 327 files and the record: the project was byte for byte as before (the same 90 files and hashes), the skill was in place, `.kiroignore` was back to its three lines, and `.kiro/ecc` was gone.
- Sandbox project `/tmp/ecc-sbx/project`, whose record was written by the build of Task 7: `plan` showed `create 4   unchanged 322` (an earlier record stays valid), `install --yes` wrote the 4 files, a second `install` and `update` changed nothing, and `uninstall --dry-run` showed remove 326 without applying it. The record is complete with 326 files. It has no other harness folder, so no block.
- This workspace, read only: `plan --json --root <workspace>` gave ok, create 327, conflicts 0, problems 0, and the workspace was not changed (`.kiro` still holds `docs` and `skills`, and there is no `.kiroignore`).
- `doctor` from the workspace root: ok, with the one info note that v1 hooks need `--v3` on `kiro-cli` 2.x, and a valid `SKILL.md` (no "in progress" or "reserved" wording is left in it).
- Mutation check on copies of the skill under `/tmp/ecc-scratch` (deleted afterwards), one rule broken per copy. The control, an unchanged copy, gave 1021 of 1021. Every break made the suite fail:

| Broken in the copy | Failing tests |
|---|---|
| the folder of the skill is no longer refused | 5 |
| a record may list a folder of the skill as one the install created | 1 |
| `.kiroignore` may be tracked as a plain file | 1 |
| the uninstall leaves the state file | 21 |
| folders the install created are never removed | 21 |
| a `.kiroignore` the installer made is kept when it is empty | 9 |
| the mark "the installer made the file" is never recorded | 13 |
| the mark is lost when the block is updated | 2 |
| the blank line before the block is left when it is removed | 11 |
| the block replaces the lines of the user | 13 |
| a damaged marker is taken for no block | 6 |
| the block is written before the files of its part | 1 |
| the block lists folders that do not exist | 14 |
| a block the user edited is replaced on update | 15 |
| a server keeps the "disabled" of its source | 7 |
| the `autoApprove` list of the adapter is carried over | 3 |
| the MCP example is written under `.kiro/settings` | 38 |
| the placeholders of `env` are not kept | 8 |
| the servers of the adapter are left out | 17 |
| a field of a server that the converter does not know is dropped | 3 |
| the LICENSE is not copied as it is | 17 |
| the notices leave out the hash of the license | 5 |
| update only reports what the install no longer includes | 12 |
| uninstall removes files the user edited | 6 |
| uninstall runs without `--yes` | 4 |
| `--dry-run` applies the changes | 6 |
| uninstall goes through the install path and reads the ECC source | 17 |
| a full uninstall only removes the categories this build has parts for | 1 |
| the uninstall does not check the paths for links out of the project | 1 |
| the uninstall preview does not name the paths Kiro asks about | 9 |
| removing the install record is not counted as a change | 2 |
| update without an install does not stop | 2 |
| uninstall without a record is an error | 3 |
| a record is written again after an uninstall deleted it | 1 |
| update is not wired in | 15 |

### Not installed, and other limits

- Nothing is installed in this workspace. The confirmed install is a shell command for you to approve: its exact form is in `.kiro/docs/files-task8.md`, under "WORKSPACE INSTALL COMMAND". It needs no ECC download, because the cache holds the pinned checkout.
- The command workflow is not done: 35 commands are pending (O5, O13), and the overlays, the six `orch-*` skills and the other new owned pieces are not built (O12).
- The `.kiroignore` block was not shown to hide anything (O17). It is documented for the IDE, with the Agent Ignore Files setting, and not tried there.
- The `update` of a project whose record was written by a much older build is only covered by the sandbox project above: the record format did not change, except for the optional mark on the block.
- Uninstall removes empty folders only if the install created them and the record says so. A folder that was empty before the install stays.
- A crash between writing a file and saving the record leaves a file that looks like the user's, as before.
- Task 11 must copy the new `lib/` modules with the rest of the skill. Nothing else in the layout changed.

### Open for the user after Task 8

O17 (the CLI does not enforce `.kiroignore`), O18 (choices you may veto) and O19 (what is unproven). O5 and O12 stand. The earlier items O8 (veto), O9, O10 and O11 stand, and so do O13 to O16. Nothing blocks the command workflow or the Task 9 wizard.

## Command layer results
Build: three phases. Phase A built the engine (the owned part, the `audit` subcommand, profile extras, the six `orch-*` skills). Phase B wrote the overlays in seven branches and ran each command in real Kiro. Phase C (the integrator) merged the results, wrote the last three overlays and closed the gaps. The per-command evidence is in [command-validation.md](command-validation.md).

### Counts
- Commands: 94 in ECC. 92 registered as `/ecc-<name>`: 62 deterministic (61 class A plus `quality-gate`) and 30 through overlays. 2 are left to skills (`ecc-guide`, `plan-canvas`). 0 pending.
- Classes in `classes.json`: 62 A, 31 B, 1 C. The `epic-*` entries moved from C to B because the overlay is now the delivery.
- Skills: 88 (153 files). Profile: 482 entries. A whole install plans 377 files (agents 68, skills 153, steering 35, commands 94, hooks 13, owned 9, mcp 2, license 2, isolation 1). Always-on steering is unchanged at 21,285 of 25,000 bytes.
- Tests: 1197, all passing.

### Overlays (30)
- Hookify: hookify, hookify-list, hookify-configure, hookify-help.
- Multi-model: multi-plan, multi-execute, multi-backend, multi-frontend, multi-workflow, santa-loop, model-route.
- Learning and loops: loop-start, loop-status, evolve.
- Sessions, usage and audit: sessions, cost-report, skill-health, harness-audit, auto-update.
- Epics: epic-claim, epic-decompose, epic-validate, epic-review, epic-publish, epic-sync, epic-unblock. They drive `gh` directly and keep one snapshot per epic in `.kiro/ecc/epics/`. They need `gh` and a signed-in session, nothing else. Differences from ECC all lean to caution (for example, `epic-review` never assumes an approval).
- Orchestration: orch-review (needs Workflows).
- Project setup (written by the integrator): pm2, project-init, setup-pm. `pm2` writes `ecosystem.config.cjs` and a service table, not one command file per service. `project-init` plans with the installer's own `doctor` and `plan`. `setup-pm` records the choice in `.kiro/ecc/package-manager.json`, which is a record only: `quality-gate.sh` still picks a manager from the lock file.

### Decisions made while merging (the user may veto)
1. New rewrite rule `orch-load-skill`. The five `orch-*` wrappers said "Invoke the skill", which did nothing in Kiro: the Phase B runs never read a skill and three of five skipped or approved Gate 1 themselves. The rule now tells the agent to read the skill file and `orch-pipeline`, to stop at each gate, and never to approve a gate itself. Re-run once per command: all five read the skill files and none committed.
2. `feature-check.mjs`: the settings timeout is 60 seconds, not 10, and the unreachable message says it may be busy. Fail closed is unchanged.
3. The loader skips `NOTICE-ECC.md` in `overlays/`.
4. Not done, left for the user: an optional `hint` key for the usage line of an overlay, a lint exemption for the `/workflow` built-in, and whether `checkpoint` and `gan-build` should ask before running `git init` in a folder that is not a repository.
5. Review fix round 1: the seven `epic-*` commands check label names before a name reaches a shell line. A label name from the policy file `.kiro/ecc/github-native-coordination.json` or from an issue must match `^[A-Za-z0-9][A-Za-z0-9 :._/-]{0,49}$`. A label on an issue that fails is skipped with a warning. A label in the policy file that fails stops the command with an error that names it, before any issue is read or written. All 11 default labels pass. A name with an emoji, a parenthesis or a comma would not. The reason: the names land in double-quoted `gh` arguments, where `coordination:$(cmd)` would run `cmd`. A rule that refuses only quotes, `$`, backticks, backslashes, commas and control characters would keep names with an emoji or parentheses, at the cost of a rule that is harder to audit. Say if you prefer it. The evidence is in [command-validation.md](command-validation.md), "Review fix round 1".
6. Review fix round 2: `epic-validate`, `epic-unblock` and `epic-publish` check dependency numbers before a number reaches a shell line. A dependency read from the stored block of an issue must match `^[1-9][0-9]{0,8}$`. Any other entry is not looked up: it counts as not closed, with a warning that names it, the same as a lookup that fails. So a bad entry fails validation, keeps an epic blocked in a sweep and stops a publish. Real issue numbers pass, and the runs with clean data behaved as before. A hand-edited block that stores `"#12"` as text instead of `12` would be flagged. The reason: the block is JSON in the body of an issue, so whoever can edit the body picks the entries, `epic-unblock` reads every open issue, and an entry such as `5$(cmd)` inside the double quotes of `gh issue view` would run `cmd`. Say if you want `#12` accepted as well (the hash would be dropped before the lookup). The evidence is in [command-validation.md](command-validation.md), "Review fix round 2".

### Facts worth remembering
- Instinct hooks: Kiro's real hook payload fits ECC's `observe.sh` unchanged, so the hooks call it directly. All hook files ship `enabled: false`.
- Headless stdout can end before the last assistant message. Read `messages.jsonl` in `~/.kiro/sessions` for the final text.
- Under `--trust-tools=shell` an agent may install tools. In one run `rust-build` installed the stable Rust toolchain with rustup; `rustup toolchain uninstall stable` removes it.
- A stub on `PATH` also intercepts Kiro's own MCP launchers that use `npx`, and cannot shadow a tool that `~/.zprofile` puts back on the path.


## Next actions

1. The one confirmed install in this workspace. Task 8 is done (see "Task 8 results"), so the whole lifecycle exists: it is a shell command that needs your approval, and its exact form is in `.kiro/docs/files-task8.md` under "WORKSPACE INSTALL COMMAND". Its read-only preview now gives 377 files for a project with a harness folder, no conflict and no problem (the command layer added 50 files to the 327 of Task 8). After it, run the same command again (it must say "Nothing to change"), then `doctor`, and then `uninstall --dry-run` to see what a removal would take. The earlier decision (see "Decisions after Task 4") put this install after the command workflow below, so say if you want it earlier. Installing first and running `update` after the overlays works too, because `update` handles files that arrive or leave.
2. The command workflow is done (see "Command layer results"). What remains for it: the review step, then the workspace install.
3. Task 10, H2, added from the Task 5 review (the plan file is not edited, so the addition lives here). Besides the plan's checks, read a `.py` file and a `.ts` file with the default agent and ask it to list the file-type steering files that are loaded, one name per line, and keep the raw output under `.kiro/docs/smoke-test/`. Expected with the shipped patterns (O8): `ecc-python-patterns` for the `.py` file, `ecc-typescript-patterns` and `ecc-typescript-security` for the `.ts` file, and none of `ecc-arkts-rules`, `ecc-react-native-rules` and `ecc-vue-rules`. With the patterns of the rules a `.ts` file matches five files: typescript-patterns, typescript-security, arkts, react-native and vue. If `ecc-typescript-security` is missing from the list, record it as a finding under O10: it would mean Kiro drops a matching file when several file-type files match. H2 also gets the isolation checks of Task 8 (O17, O4, O19): in the IDE, add `.kiroignore` to the Agent Ignore Files setting, ask Kiro to read a file in `.claude/` and see whether it is refused, check whether the instructions of `.kimi-code/AGENTS.md` are still loaded, and confirm that no MCP server of `.kiro/ecc/mcp.json.example` is listed in the MCP panel. If the IDE does not enforce the block either, say so in the README (Task 12) and in `SKILL.md`, and consider another way to keep the other harnesses' instructions out, which is your call. H2 also gets the IDE part of O14: open the project in the Kiro IDE, type `/` and check that the `ecc-*` manual steering files are listed, then run one command with an argument (for example `/ecc-checkpoint list`) and check that the argument text reaches the agent. H2 also gets the hooks part of O15, in a scratch project and not in this workspace: open it in the IDE and check that the Agent Hooks panel lists the 12 `ecc-*` hooks, all off; switch one agent-prompt hook on with the eye icon and look at what changed in its file; save a file that matches its matcher and see whether the prompt reaches the agent with the file named; and run `/hooks` in a `kiro-cli chat --v3` session to see the same list. Each agent-prompt run costs credits.
4. For the user, any time: O9 (should the Angular and React patterns be narrowed too), a veto on O8, O11 (remove the stale allow rule from `~/.kiro/settings/permissions.yaml`), the `gan-design` wording under "Open for the user after Task 6", and the choices in O16 (how wide the documentation hook is, and the acknowledgement of the push guard) and in O18 (the dropped `autoApprove`, the table of MCP servers installed as a file, `--only` being literal, the folder patterns, isolation on by default, the credits in the notices).
5. Task 9, added from Task 8: the wizard previews with `plan --action update|uninstall --json` or `<command> --dry-run --json`, shows `counts`, `keepModified`, `protected` and `stateFile`, asks once, and applies with `--yes --json`. `update` without a record fails with the error code `not-installed`, and `uninstall` without one succeeds with `changes: 0`. It must tell the user to add `.kiroignore` to the Agent Ignore Files setting and that the CLI did not enforce it (O17), offer to leave `isolation` out, and name `license` whenever it passes `--only`. Task 11, added from Task 7: the export to the global copy and to the Power must include `scripts/runtime/` (and `assets/`), or an install from there cannot find the guard. A test of `package-power --check` should fail when the guard is missing from a copy.
6. Task 12 cleanup list: delete `/tmp/ecc-sbx` once the command workflow no longer needs it (it holds 326 files installed by the build of Task 8), confirm no `/tmp/ecc-scratch` is left (Task 8 deleted its own), look at the folder `ecc-probe2.*` in the system temp folder (`$TMPDIR`, from 2026-10-07 17:49, an earlier task's probe that Task 8 did not make and did not remove), and confirm that O11 was handled.

## Publishing plan (agreed with the user)

- Repo: `ecc-for-kiro`, public, MIT for our own code. A license review of ECC, Kiro's terms and the open specs is being written to `.kiro/docs/license-review.md`.
- Layout: `plugin.json` at the root (a Power the IDE can import from a GitHub URL), the skill in `skills/ecc-kiro-setup/` (the IDE's skill import needs a subfolder, and `npx skills add` finds `skills/*/SKILL.md`), a `package.json` with a `bin` so `npx github:<owner>/ecc-for-kiro` works without publishing to npm (pin a tag: `#v0.1.0`), tests in a top-level `test/` folder so they are not copied into users' projects, `docs/` for this walkthrough and the Kiro findings, and CI for the tests plus a weekly `verify --fetch` and new-tag check.
- Do not vendor ECC. The repo holds original code and the hash-pinned profile only; test fixtures stay synthetic.
- Order: finish Tasks 5 to 8 first (the user's priority), then Tasks 9 to 12 with Task 11 reshaped into the repo layout. Publishing happens last, only on the user's go-ahead, from a new folder (this workspace stays a non-repo).
- Roadmap after v0.1.0: derive the profile from ECC's `manifests/install-modules.json` so a version bump needs no Kimi install (ECC releases often: v2.2.1 on Sep 8, v2.2.2 on Sep 30, v2.2.3 on Oct 1), and talk to upstream (PRs #3322 and #2287 are still open; the maintainer offered to review a generator plus a manifest entry).
- Workspace install: Task 8 is done and the command is ready (see "Next actions"). It still needs the user's confirmation. Everything before that is verified in `/tmp` sandboxes.

## Decisions after Task 4 (from the user)

- Repo: https://github.com/windson/ecc-for-kiro . It is private for now and holds only an MIT LICENSE with the user as holder. Nothing is pushed yet.
- O5, commands: Kiro-native, no compromise, because this project targets Kiro only. No command is excluded for using Claude paths or tools. Each affected command gets a Kiro-native rewrite and is validated in Kiro. This overrides the plan's "body verbatim" and its four exclusion rules: the reference-only groups in F5 are re-examined too, and a command is left out only with evidence that no Kiro-native version is possible with what is installed, and only with the user's approval of that list.
- Why the plan kept ECC's text unchanged: it keeps files hash-verifiable and easy to sync with new ECC releases. Rewrites are owned text, so they are stored as overlays pinned to the sha256 of the ECC file they were adapted from. A new ECC release that changes the source flags the overlay as stale. Analysis of each command is in `.kiro/docs/command-adaptation-map.md` when it is written.
- Skills and agents stay as ECC wrote them (byte for byte, hash-verified), with the harness steering explaining Claude wording. If testing shows a skill fails in Kiro, that skill gets adapted. Open question for the user: rewrite all of them instead?
- Workspace install: approved ("sure, try it"), to run once after Tasks 5 to 8 and the command adaptation. Method evaluated: run the installer directly from the shell after a plan preview (one plan, one install --yes for all parts), then doctor, a second install that must report no changes, and a headless smoke test. Rejected: staging by part (more approvals, no benefit because each part is idempotent and resumable), installing through the skill wizard (costs credits and is not deterministic; it stays the path for other users and a dry-run smoke test), and the Power or global copy (distribution paths, not for one project).

## License review outcome (details in license-review.md)

- MIT for our code is confirmed and nothing blocks publishing. ECC v2.2.3 is MIT with no differing license in the 476 pinned files. Kiro and AWS terms do not restrict sharing steering, agents, skills, hooks or Powers from GitHub. The Powers Publisher Terms (with an indemnity) apply only if we submit to the Kiro registry.
- Overlay decision (from O5), chosen by the orchestrator: hybrid. Deterministic rewrites (class A) are applied to the downloaded ECC text at install time, so the repo holds only rules. Whole-command Kiro-native rewrites (class B) are stored as overlays in `assets/commands/overlays/` with a header (ECC source path, sha256, credit lines) and ECC's MIT notice beside them. The README disclaimer then says the repo includes adapted ECC command text under MIT. Credit lines (for example the PRP commands by Rasmus Widing) are kept.
- Gates before the repo goes public:
  1. Replace the 39-word ECC description in `scripts/test/frontmatter.test.mjs` (around lines 370 to 393) with synthetic text.
  2. Add a LICENSE inside `skills/ecc-kiro-setup/`, `license` in `plugin.json` and `package.json`, a `files` allowlist, `THIRD_PARTY_NOTICES.md` (ECC, credited projects, specs, trademark lines) and a README with the disclaimer, a Privacy section, a support contact and the `skills` CLI telemetry note.
  3. Task 8 also installs `.kiro/ecc/THIRD_PARTY_NOTICES.md` next to `.kiro/ecc/LICENSE` (tool-owned, removed on uninstall), and a test with synthetic input shows ECC credit lines survive conversion. Done in Task 8 (the installed files) and Task 6 (the credit-line test). The repo-level notices file and README are still for the publishing step.
  4. Do not commit `.kimi-code/`, `.claude/`, the ECC cache, installer output, or docs that contain local paths (`/Users/...`). Publish cleaned docs.
  5. The owner accepts the name risk: Kiro is an AWS trademark, the name fits AWS's "X for Kiro" form, the repo description starts with "Unofficial", and a rename stays ready.
  6. Do not submit to the Kiro Powers registry before reading the Publisher Terms.
  7. CI: `verify --fetch` must fail if the sha256 of ECC's LICENSE changes.

## Command adaptation map: outcome and defaults (orchestrator, the user may veto)

The investigation is in `.kiro/docs/command-adaptation-map.md`. Result: all 94 commands can be Kiro-native: 57 class A (deterministic rules only), 24 class B (authored Kiro-native overlay), 13 class C (a small piece is missing). Text after a steering slash command reaches the agent as the raw user message; `$ARGUMENTS` is not substituted, so each one becomes a named value defined by a header. Headless validation form: `kiro-cli chat --v3 --no-interactive --trust-tools=read,write,shell,subagent "/ecc-<name> <args>"`.

Defaults chosen for the seven open questions in part 5:
1. Artifact root is `.kiro/ecc/`.
2. Profile scope grows only where a registered command needs it: add the six `orch-*` skills (unblocks 5 commands). Do not add ECC's 13 coordination files with the npm packages `sql.js` and `ajv` (no new dependencies): the 7 `epic-*` commands become Kiro-native overlays that drive `gh` directly. `plan-canvas` and `ecc-guide` are not registered as commands, because the installed skills of the same names already give `/plan-canvas` and `/ecc-guide`; the harness steering gets a Kiro path note. The 21 optional skills named in soft references stay out of the profile.
3. Panel agents (multi-model commands): the installer reads the local model list and sets `model:` where known, and omits it when unknown.
4. New owned code is accepted: `hookify-guard.mjs` with a disabled hook file, `usage-report.mjs`, an `audit` subcommand of `ecc-kiro.mjs`, three read-only panel agents, and the `orch-review` workflow recipe.
5. Instinct capture (`continuous-learning-v2/hooks/observe.sh`) is wired as disabled Kiro hooks, after checking Kiro's hook payload; an adapter script is written if the payload differs.
6. `ecc-guide` stays a skill only (see 2).
7. Opt-in features (`loop-start`, `orch-review`) fail closed with instructions when `/goal` or Workflows are not enabled.

Design rule: nothing with Claude-only constructs is ever installed. The lint is blocking for every registered command. Commands that still lack an overlay or a missing piece are listed as pending in `plan --json` and are not installed. The final acceptance is that the pending list is empty apart from `ecc-guide` and `plan-canvas`.

Sequence: Task 6 (deterministic layer, class A), Tasks 7 and 8, then one more workflow for overlays, the orch skills, the new owned pieces and a real Kiro validation run per command, then the workspace install.

## Workspace install (done, by the orchestrator, with the user's approval)

- Run: `node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs install --yes` from the workspace root, after a `plan` preview (create 377, 0 problems, 0 conflicts). The record says installedAt 2026-10-09T04:00:05Z.
- Result: 377 files tracked in `.kiro/ecc/install-state.json` (status complete): 68 agents and 3 panel agents, 88 skills (153 files), 35 steering files and 92 commands in `.kiro/steering` (10 always-on, 22 fileMatch, 95 manual), 14 hooks all switched off, 1 workflow recipe, the mcp example, license and notices, scripts, and the `.kiroignore` block.
- A second `install --yes` reported unchanged 377. `doctor` is ok. The IDE session in this workspace now loads the always-on steering.
- The user's IDE setting `kiroAgent.agentIgnoreFiles` is not set, so the IDE default applies. For the `.kiroignore` block to take effect in the IDE the user adds `.kiroignore` to Agent Ignore Files (optional, one setting).
- Side effect of the validation runs: `cargo` made rustup install the stable Rust toolchain (2.3 GB in `~/.rustup`, created 2026-10-08 14:30; rustup itself dates from June). Undo with `~/.cargo/bin/rustup toolchain uninstall stable`. Two commands ran `git init` inside scratch folders under `/tmp/ecc-scratch` only.
- From here on, changes to the installed ECC files go through `update`, never through manual edits of ECC-owned files.
