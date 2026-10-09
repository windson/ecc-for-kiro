# What ECC becomes in Kiro

This file describes the parts the installer writes. Each part can be named with `--only`. The default is every part. Keep `license` in any partial install.

## Agents

Agents are Markdown files in `.kiro/agents`. The installer rewrites ECC's frontmatter and copies the body unchanged. ECC tool names map to Kiro tools: Read, Grep and Glob to `read`; Write, Edit and MultiEdit to `write`; Bash to `shell` with a permission rule for read-only git; WebFetch and WebSearch to `web`; Context7 MCP tools to their `@context7/...` names. The `model` and `color` fields are dropped and reported in a note. There are 68 agents, plus 3 read-only panel agents the owned part writes.

The Kiro IDE 1.0 and the V3 engine of the Kiro CLI load Markdown agents. On `kiro-cli` 2.x use `--v3`, and note that `agent list` does not show them.

## Skills

Every skill file goes to `.kiro/skills/<skill>/...` as the exact bytes the profile pins. Each `SKILL.md` is validated before anything is written: the name equals the folder, lowercase letters, digits and hyphens, at most 64 characters, and a description of at most 1024 characters. Execute bits are kept. Project skills win over global skills with the same name. There are 88 skills in 153 files.

## Steering

Steering goes to `.kiro/steering`, every file with the `ecc-` prefix so it cannot clash with your own.

- Always on: 8 core rules, `ecc-agents` and `ecc-kiro-harness`. Together they stay under 25,000 bytes, because they go with every request, and `plan` refuses a larger set.
- By file type: 11 language files and 11 rule packs built from `rules/<pack>/`. A pack loads when a file matching one of its patterns is in play. `assets/language-globs.json` narrows the arkts, react-native and vue packs so a plain TypeScript file does not pull in unrelated rules.
- Manual: `ecc-dev-mode`, `ecc-review-mode` and `ecc-research-mode`, included with `#ecc-dev-mode` and the like.

Custom agents inherit the workspace steering and skills in the V3 engine, so the converted agents need no `resources` field.

## Commands

ECC's slash commands become manual steering at `.kiro/steering/ecc-<name>.md`, used as `/ecc-<name>`. The `ecc-` prefix keeps them apart from Kiro's own `/plan` and `/checkpoint`. ECC's Claude Code text is made Kiro-native at install time with the data files in `assets/commands` and the map in `docs/command-adaptation-map.md`.

- Deterministic rewrites turn Claude constructs into Kiro ones in order. For example the Claude argument placeholder becomes `ARGS`, which a header defines, and `/plan` becomes `/ecc-plan`.
- A lint blocks any command whose final text still contains Claude-only constructs, so no such text is ever written.
- An overlay supplies a full Kiro-native body for a command that needs more than rewrites. An overlay is used only while its recorded hash matches the ECC file it was written from. After an ECC change it is reported as stale and the command is left out until the overlay is rewritten.

Today 92 of 94 commands register, with no command pending. `ecc-guide` and `plan-canvas` are left to the installed skills of the same names. The seven `epic-*` commands need `gh` and a signed-in session.

The adapter scripts `quality-gate.sh` and `format.sh` go to `.kiro/ecc/scripts/` with their execute bits.

## Hooks

ECC's adapter hooks become Kiro v1 hook files at `.kiro/hooks/ecc-<name>.json`, one hook per file, 12 files. Every one is installed switched off, and `plan` refuses a hook that would not be. Eleven run an agent prompt, which uses credits each time the hook fires. Turning one on is the user's decision, through the eye icon in the Agent Hooks panel or by setting `enabled` to true in the file. A hook that reviews a write can fire again when the agent fixes what it finds, so turn such hooks on one at a time.

Three hooks differ from a one to one conversion. The git push review runs a script, because a v1 tool matcher cannot read the command. The doc file warning runs after a file is created, because a v1 matcher cannot read the path of a write. The extract-patterns hook points at `ecc-lessons-learned.md`. The push guard script is `.kiro/ecc/scripts/git-push-guard.mjs`, a reminder for the agent, not a security control.

## Owned pieces

The owned part installs original MIT-licensed code: `hookify-guard.mjs`, `usage-report.mjs` and `feature-check.mjs` under `.kiro/ecc/scripts/`, two disabled hook files, three read-only panel agents and the `orch-review` workflow recipe. None of it comes from ECC.

## MCP examples

The mcp part writes `.kiro/ecc/mcp.json.example` with 38 servers, every one disabled, and `.kiro/ecc/mcp-servers.md` describing them. Kiro reads neither file, because they sit in `.kiro/ecc` and never in `.kiro/settings`. To use a server, copy its entry into `.kiro/settings/mcp.json` or `~/.kiro/settings/mcp.json`, set `disabled` to false and fill in the placeholders. The agent cannot write to `.kiro/settings`, so the user does this.

## License and isolation

The license part copies ECC's MIT license to `.kiro/ecc/LICENSE` and writes `.kiro/ecc/THIRD_PARTY_NOTICES.md`. The isolation part adds one marked block to `.kiroignore` listing the harness folders that exist. Both are owned, and an uninstall removes them.

## Update and uninstall

`update` does what `install` does and also removes owned, unedited files the install no longer includes. It needs an earlier install and stops with `not-installed` otherwise. `uninstall` removes the files the install created and the user has not edited, takes out the `.kiroignore` block, removes the folders it created when empty, and removes the install record last. It never removes the `ecc-kiro-setup` skill. Both preview with `--dry-run` and refuse to change anything without `--yes`.
