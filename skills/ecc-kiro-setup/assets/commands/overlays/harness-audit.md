---
source: "commands/harness-audit.md"
sha256: "dc420f85cdbfab6671338227b5673b4feed564c4294a12c304b6d79cf0346ec2"
credit: ["Kiro rewrite of the harness-audit command in ECC (https://github.com/affaan-m/ECC) v2.2.3, commands/harness-audit.md. The output contract and the category names follow the original. MIT License, Copyright (c) 2026 Affaan Mustafa."]
description: "Score a project's Kiro setup with a fixed, repeatable rubric and return a prioritized scorecard. For a security-specific audit use the security-scan command."
---
# Harness Audit

Run the repeatable audit of this project's Kiro setup and return a scorecard with the top actions. The scoring is done by a script. You report what it says and never score anything yourself.

## What it checks

The script `audit` in the ecc-kiro-setup skill scores a project against a fixed rubric. Each category is normalized to 0 to 10:

1. Tool Coverage: custom agents, skills, hooks, and manually included steering that works as a slash command.
2. Context Efficiency: size of the always-on steering (25,000 bytes is the limit), `AGENTS.md`, steering that loads only for matching files, skill descriptions.
3. Quality Gates: a test command, a lint command, a gate script or a hook that runs a check.
4. Memory Persistence: steering or `AGENTS.md`, the instinct observer hook, specs.
5. Eval Coverage: a test folder, CI that runs the tests.
6. Security Guardrails: `.kiroignore`, `.env` in `.gitignore`, a git push guard, agents that list their tools.
7. Cost Efficiency: lean always-on steering, few agent-prompt hooks switched on, no oversized always-on file.
8. GitHub Integration: a workflow, a pull request template, CODEOWNERS or issue templates.

The scores come from files that exist, so the same project gives the same scorecard. The script only reads. It never opens MCP settings, `.env` files or message text. The scorecard is advice and does not fail a build. This rubric replaces ECC's own script, which checks a different layout.

## Read ARGS

Usage: `/ecc-harness-audit [scope] [--format text|json] [--root path]`

- `scope` is one of `repo` (the default), `hooks`, `skills`, `commands` or `agents`. For any other word, say so, list the five scopes and stop.
- `--format` is `text` (the default) or `json`.
- `--root` audits another folder instead of the current project. The value must be a path that exists. Quote it for the shell. If it does not exist, say so and stop.

## Run it

Find the script. Use the first of these that exists:

1. `.kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs` in the project
2. `~/.kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs` (or under `$KIRO_HOME`)

If neither exists, say that the ecc-kiro-setup skill is not installed, so there is nothing to run, and stop. Do not write a replacement scorer and do not score by hand.

Run it from the project root with the shell tool:

```bash
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs audit repo --format text
node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs audit hooks --format json --root "/path/to/other/project"
```

Use the path you found in the first step and only the options that ARGS asked for. If the command exits with an error, show the message it printed and stop.

## Report

- If the format is `json`, your final answer is the script output unchanged in a `json` code block, with no sentence before or after it.
- If the format is `text`, show the scorecard and then report:
  1. `overall_score` out of `max_score`. The maximum depends on the scope, so never assume a fixed total.
  2. The categories with the lowest scores.
  3. The failed checks that matter most, each with its exact path.
  4. The top actions, in the order the script gave them.
  5. Skills that help with the weak categories, only from this list: `tdd-workflow` and `verification-loop` for Quality Gates, `eval-harness` and `e2e-testing` for Eval Coverage, `security-review` for Security Guardrails, `context-budget` for Context Efficiency and Cost Efficiency, `continuous-learning-v2` for Memory Persistence, `hookify-rules` for hooks.

Do not invent dimensions, extra points or checks. If the user disagrees with a score, point to the check id and its path, and offer to fix the cause.
