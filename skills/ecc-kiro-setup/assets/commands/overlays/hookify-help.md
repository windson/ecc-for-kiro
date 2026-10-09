---
source: commands/hookify-help.md
sha256: 11c4beec77187548978f4022cf76b3e077c0a04365f0b0d2464d06ca053c91a2
credit: ["Adapted from ECC (https://github.com/affaan-m/ECC) v2.2.3: commands/hookify-help.md. MIT License, Copyright (c) 2026 Affaan Mustafa. Rewritten for Kiro hooks."]
description: "Explain the hookify rule system on Kiro: rule format, events, how rules are enforced and how to turn enforcement on."
---
Print the help below to the user. Do not read or change files. Do not run commands. Answer in your own words if ARGS asks a specific question about it, using only the facts below.

## How hookify works on Kiro

A hookify rule is a Markdown file in `.kiro/ecc/hookify/`. Kiro hooks run a small script, `.kiro/ecc/scripts/hookify-guard.mjs`, which reads the enabled rules and tests them against what is about to happen. A rule can block the action or show a warning.

The hooks are in `.kiro/hooks/ecc-hookify.json`. They ship switched off. To enforce rules, the user turns the hooks they need on in the Agent Hooks panel of the IDE, or sets `"enabled": true` on them in that file. Kiro always asks before the agent changes `.kiro/hooks`, so the commands in this family never edit that file.

## Events

| event | tested against | hook name | Kiro trigger |
|---|---|---|---|
| `bash` | the full shell command | `ecc-hookify-bash` | PreToolUse on the shell tool |
| `file` | the path of the file being written | `ecc-hookify-file` | PreToolUse on the write tool |
| `prompt` | the text of the prompt | `ecc-hookify-prompt` | UserPromptSubmit |
| `stop` | nothing, it fires when the agent finishes | `ecc-hookify-stop` | Stop |
| `all` | every event above | all four hooks | all four triggers |

A `file` rule tests the path only. It does not read the content of the file.

## Rule file format

The file is `.kiro/ecc/hookify/<name>.local.md`:

```
---
name: descriptive-name
enabled: true
event: bash
action: block
pattern: 'regex pattern to match'
---
Message shown when the rule triggers.
It may use several lines.
```

- `event` is `bash`, `file`, `prompt`, `stop` or `all`.
- `action` is `block` or `warn`.
- `pattern` is a JavaScript regular expression on one line. It is case sensitive. Single quotes keep backslashes as written. A `stop` rule needs no pattern.
- The text after the header is the message. On a block the agent reads it, so say what to do instead.
- The `.local.md` files are personal by ECC convention. Add `.kiro/ecc/hookify/*.local.md` to `.gitignore` to keep them out of the repository.

## What happens when a rule fires

- `block` on `bash`, `file` or `prompt` stops the action. The guard exits with code 2 and the message goes to the agent.
- `warn` shows the message to the user and the work goes on. The guard exits with code 1.
- `block` on `stop` makes the agent continue once per session, then the agent may stop.
- A rule file that cannot be read or has a bad pattern is skipped, with a warning. It never stops work.

## Commands

- `/ecc-hookify <description>` writes a rule. With no description it looks for candidates in the conversation.
- `/ecc-hookify-list` shows the rules and whether the hooks are on.
- `/ecc-hookify-configure` switches rules on or off.
- `/ecc-hookify-help` shows this page.

## Pattern tips

- Match the full command string for `bash` and the path for `file`.
- Keep patterns narrow. A broad `block` pattern on `prompt` can stop every message. Switch the rule off with `/ecc-hookify-configure` or turn off the hook in `.kiro/hooks/ecc-hookify.json`.
- Test a pattern before relying on it. `/ecc-hookify` tests each new rule with the guard script.
- The `hookify-rules` skill has more pattern examples. Its folder names are ECC's own. Use `.kiro/ecc/hookify/` here.
