---
source: commands/hookify-configure.md
sha256: a059c23f885d36e3597daa03b7bf77cbb79a2a87e5856ca4bede4eb3b816082a
credit: ["Adapted from ECC (https://github.com/affaan-m/ECC) v2.2.3: commands/hookify-configure.md. MIT License, Copyright (c) 2026 Affaan Mustafa. Rewritten for Kiro hooks."]
description: "Switch hookify rules in .kiro/ecc/hookify/ on or off. Name the rules in the message, or pick from the list."
---
Switch hookify rules on or off by changing the `enabled:` line in their files. This command edits rule files only. It never edits `.kiro/hooks`, because Kiro always asks before changing that folder.

## Steps

1. Find `.kiro/ecc/hookify/*.local.md`. If there are none, say so, point to `/ecc-hookify` and stop.
2. Read the header of each file. Note its `name`, `enabled`, `event` and `action`. A missing `enabled` counts as true.
3. Decide which rules to change.
   - If ARGS names rules, use that. Accepted forms are `<rule> on`, `<rule> off`, `<rule>` alone (toggle it), `all on` and `all off`. Several rules may be listed. A rule is matched by its `name` or its file name without `.local.md`. Do not ask anything. ARGS is the user's instruction.
   - If ARGS is empty, show the list with the current state and ask in chat which rules to toggle. Wait for the answer.
   - If a name matches no rule, say so and change nothing for that name.
4. For each chosen rule, change only the `enabled:` line inside the header to `enabled: true` or `enabled: false`. If the header has no `enabled:` line, add one under `name:`. Do not touch the pattern, the message or any other line. Skip a rule that is already in the state asked for.
5. Read each changed file again and confirm the header is intact.
6. Report a short table of what changed: rule, old state, new state.

## Enforcement

Read `.kiro/hooks/ecc-hookify.json` if it exists. A rule only acts when the hook for its event has `"enabled": true`: `ecc-hookify-bash`, `ecc-hookify-file`, `ecc-hookify-prompt` or `ecc-hookify-stop`. A rule with the event `all` needs all four. If a hook that a switched-on rule needs is off, tell the user. The user turns that hook on in the Agent Hooks panel of the IDE, or sets `"enabled": true` on it in `.kiro/hooks/ecc-hookify.json`. Do not edit that file.
