# The Kiro IDE and the Kiro CLI

This skill works on both surfaces. They differ in a few places that matter for installing and verifying ECC.

## Engines

The Kiro IDE 1.0 runs the V3 engine. The Kiro CLI 2.x defaults to the V2 engine and runs V3 only with `--v3`. Markdown agents and v1 hook files need the V3 engine, so on the CLI pass `--v3`, or set `chat.agentEngine` to `v3`. ECC's own model choices (opus, sonnet, haiku) do not apply in Kiro; the session model is used.

## Agents

In the IDE and in the V3 CLI engine, Markdown agents in `.kiro/agents` load and can be addressed by name. On `kiro-cli` 2.x, `agent list` reads JSON agents only and does not show the Markdown agents, so do not use it to verify an install. Verify with a `--v3` headless run instead.

## Commands

A command is a manual steering file at `.kiro/steering/ecc-<name>.md`. In the V3 CLI engine it is used as `/ecc-<name> <text>`, and the text after the name reaches the agent. The `#ecc-<name>` form includes the same file inside a message. The IDE lists manual steering in its `/` menu. The text after the command is read as a named value, not substituted, so there is never a Claude-style argument placeholder in an installed command.

## Hooks

Hooks run in the IDE 1.0 and in the V3 CLI engine. The IDE shows them in the Agent Hooks panel, where the eye icon turns one on and writes `enabled` back into the file. Editing the file this way counts as a user edit, so later runs keep it and report it as edited. Kiro's documentation keeps the older CLI engine's hooks inside agent configs, so that engine should not read these files.

Kiro hook triggers map from ECC's Claude Code events: a file save is `PostFileSave`, a new file is `PostFileCreate`, and `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart` and `Stop` keep their names. A matcher is a regular expression. The template `{{filePath}}` names the file in a command action on a file trigger. ECC's hooks ship on; these ship off.

## Isolation

The `.kiroignore` block asks Kiro to ignore other harness folders. In testing, two headless `kiro-cli` 2.28.0 runs with `--v3` still read and found files under ignored folders, so do not promise the user that the CLI hides them. The IDE honours the ignore file only when `.kiroignore` is listed in the Agent Ignore Files setting (`kiroAgent.agentIgnoreFiles`). Ask the user to add it there, then check in the IDE by asking Kiro to read a file in an ignored folder.

## Settings the agent must not write

Kiro blocks writes to `.kiro/settings/`. MCP server entries and the Agent Ignore Files setting are the user's to change. The installer never writes there, and neither should the agent.

## Headless validation form

A one-shot CLI check that resolves steering, writes nothing on a dry run, and reaches sub-agents:

```bash
kiro-cli chat --v3 --no-interactive --trust-tools=read,shell "Use the ecc-kiro-setup skill to produce a dry-run plan for this project and summarize it."
```

Filter the transcript for readability with `grep -vE '^\[INFO\]|ExperimentalWarning|^\(Use ` + "`" + `node'`.
