---
source: commands/hookify.md
sha256: af90c5e6a9094ab68df605458628bfc09e2f19d0571665964c94d1eb0e8002ce
credit: ["Adapted from ECC (https://github.com/affaan-m/ECC) v2.2.3: commands/hookify.md. MIT License, Copyright (c) 2026 Affaan Mustafa. Rewritten for Kiro hooks."]
description: "Create hookify rules that block or warn on unwanted agent behavior. Give a description of the behavior, or give none to find candidates in the current conversation."
---
Create hookify rules that stop unwanted agent behavior. A rule is a small Markdown file in `.kiro/ecc/hookify/`. The Kiro hook file `.kiro/hooks/ecc-hookify.json` runs `node .kiro/ecc/scripts/hookify-guard.mjs <event>` before shell commands and file writes, when a prompt is sent and when the agent stops. The script tests every enabled rule.

This command only writes rule files. It never edits `.kiro/hooks`, because Kiro always asks before changing that folder.

## Step 1: Check the setup

- Look for `.kiro/ecc/scripts/hookify-guard.mjs`. If it is missing, say the ECC for Kiro owned part is not installed. Still write the rules, and say they are not enforced.
- Read `.kiro/hooks/ecc-hookify.json` if it exists. Note which of its four hooks have `"enabled": true`. They ship switched off.

## Step 2: Gather the behavior

- If ARGS is not empty, ARGS is the description of the behavior to prevent. That text is the user's instruction. Go to step 3.
- If ARGS is empty, find behaviors worth preventing in this conversation. Delegate to the `conversation-analyzer` sub-agent by name. The sub-agent returns its result when done. If the agent is missing, do the work yourself and say so. Look for explicit corrections, frustration at repeated mistakes, reverted changes and repeated similar issues.
  Then show each candidate: the behavior, the event, the pattern and the action. Ask in chat which ones to create and wait for the answer. Do not write a file before the user answers.

## Step 3: Design each rule

Choose the event. It decides what the pattern is tested against.

| event | tested against | Kiro trigger |
|---|---|---|
| `bash` | the full shell command | PreToolUse on the shell tool |
| `file` | the path of the file being written | PreToolUse on the write tool |
| `prompt` | the text of the user's prompt | UserPromptSubmit |
| `stop` | nothing, the rule fires when the agent finishes | Stop |
| `all` | any of the above | every trigger |

Choose the action.

- `block` stops a shell command, a write or a prompt. Use it when the user says never, do not or prevent.
- `warn` shows the message and lets the work go on. Use it for reminders. Use `warn` as the default for `prompt` and `stop` rules unless the user asked for a block.
- A blocking `stop` rule makes the agent continue once per session.

Write the pattern as a JavaScript regular expression on one line. It is case sensitive and has no flags. Keep it narrow so it does not catch harmless commands. Put it in single quotes so backslashes stay as written, for example `'rm\s+-rf'`. A `stop` rule needs no pattern.

Write the message for the agent. On a block the agent reads it, so say what to do instead.

## Step 4: Write the rule files

For each rule, create `.kiro/ecc/hookify/<name>.local.md`. Make the folder if it is missing. Use a short kebab-case name that matches the `name` field. If the file exists, do not overwrite it. Pick a new name or ask.

```
---
name: rule-name
enabled: true
event: bash
action: block
pattern: 'regex pattern'
---
Message shown when the rule triggers.
```

The `hookify-rules` skill covers pattern syntax. Its folder names are ECC's own. The folder for this install is `.kiro/ecc/hookify/`.

## Step 5: Test each rule

Skip this step if the guard script is missing. From the project root, send the guard a sample event on stdin and read the exit code:

```bash
printf '%s' '{"tool_input":{"command":"rm -rf build"}}' | node .kiro/ecc/scripts/hookify-guard.mjs bash; echo "exit=$?"
```

- Use `{"tool_input":{"path":"src/a.ts"}}` for `file` and `{"prompt":"text"}` for `prompt`. A `stop` rule needs `{"session_id":"test-1"}`.
- Run one sample that should match and one that should not.
- Exit 2 is a block, exit 1 is a warning and exit 0 means the rule did not fire. A `stop` block prints a JSON line and exits 0.
- If a sample contains a single quote, write the JSON with a here-document instead.
- If a result is wrong, fix the pattern and test again.

## Step 6: Report

List each created rule with its event, action and pattern. State whether the rule is enforced now: it is only enforced when the matching hook in `.kiro/hooks/ecc-hookify.json` is enabled. If it is not, show the user what to change. The user turns the matching hook on in the Agent Hooks panel of the IDE, or sets `"enabled": true` on it in that file. Name the hooks: `ecc-hookify-bash`, `ecc-hookify-file`, `ecc-hookify-prompt` and `ecc-hookify-stop`.

Then point to `/ecc-hookify-list` to see the rules, `/ecc-hookify-configure` to switch them on or off and `/ecc-hookify-help` for the format.
