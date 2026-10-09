---
source: "commands/skill-health.md"
sha256: "da34a0a3c0fe3ccec6795cbf16252a4253b81baa8ea7bf332cd7a0d1cde1efdf"
credit: ["Kiro rewrite of the skill-health command in ECC (https://github.com/affaan-m/ECC) v2.2.3, commands/skill-health.md. The idea of a skill portfolio dashboard is the original's. MIT License, Copyright (c) 2026 Affaan Mustafa."]
description: "Show which installed skills were activated in the last 30 days, when each was last used, and which never were, from Kiro's local session log. For a quality audit of skills use the skill-stocktake skill."
---
# Skill Health

Show how the installed skills are used: how often each was activated, when it was last used, and which ones never were. The numbers come from Kiro's local session log, read by a small script that this install provides.

## What this dashboard has, and what it leaves out

Kiro records that a skill was activated. It does not record whether the run went well. So this command shows usage only:

- Activations per skill in the period, ranked.
- The day each skill was last used.
- Installed skills that were never activated in the period.
- Skills that were activated but are not installed here (for example, a skill that only exists in another project).

It does not show success rates, failure clusters, pending amendments or version history. Do not make those up, and do not infer success from a skill being used. If the user asks for a failure panel, say that this data does not exist in Kiro.

Only sessions on this machine count. Only activations made through the skill tool are seen. A skill that was read as a plain file does not count. Treat low numbers as a hint, not proof.

## Run it

The script is `.kiro/ecc/scripts/usage-report.mjs`. If the file is missing, tell the user that the owned part of the install is not there and that `node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs plan --only owned` shows what it would add, then stop. Do not write a replacement.

Choose the options from ARGS:

| ARGS | Options |
|---|---|
| empty | none: a text report for the last 30 days |
| `json` or `--json` | `--json` |
| `--days N` | `--days N`, a whole number from 1 to 3650 |

Words may be combined. For any other word, say what you did not understand and stop. A `--panel` option from the original command has no meaning here: say so, then run the default report.

```bash
node .kiro/ecc/scripts/usage-report.mjs skills
node .kiro/ecc/scripts/usage-report.mjs skills --json --days 90
```

The script lists skills from `.kiro/skills` in the project and from the Kiro home folder. It never prints message text, and you must not open the session files yourself to get more detail.

## Report

For the text report, show the script output and then add:

1. Most used: the top skills with their counts.
2. Never used: the installed skills with no activation. Say how many there are of the total. With many skills installed, a long unused list is normal, because most skills are meant for specific tasks.
3. Next step, one or two lines: if a skill the user relies on is on the never-used list, its description may be too vague for the agent to pick it. Suggest rewording the description. For a quality review of skills, point to the `skill-stocktake` skill. If `/ecc-evolve` is installed, it can turn repeated patterns into new skills.

For `json`, print the script output unchanged.
