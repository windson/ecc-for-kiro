---
source: "commands/cost-report.md"
sha256: "942a25f185062882e67e77a399d04c88ef12d7eb35033f309e053973bb653710"
credit: ["Kiro rewrite of the cost-report command in ECC (https://github.com/affaan-m/ECC) v2.2.3, commands/cost-report.md. The report layout follows the original. MIT License, Copyright (c) 2026 Affaan Mustafa."]
description: "Report Kiro credit usage from the local session log, by day, model and workspace, as text, JSON or CSV. These are credits, not dollars. The Kiro CLI /usage command shows the balance."
---
# Cost Report

Summarize the credits that Kiro used on this machine, by day, by model and by workspace. The numbers come from Kiro's local session log, read by a small script that this install provides. There is no cost tracker to set up and no hook to turn on.

## What the numbers are

- The unit is the credit, as Kiro records it. This command never converts credits to dollars and never estimates a price. If the user asks for dollars, say that the log has credits only.
- Only sessions stored on this machine count, in the folder `${KIRO_HOME:-$HOME/.kiro}/sessions/`. Chats from another computer or another account are not in it.
- The log format belongs to Kiro and may change. The script skips records it does not understand and reports how many it skipped.
- The script prints numbers, dates, model ids and workspace paths. It never prints message text, and you must not open the session files yourself to get more detail.

## Run it

The script is `.kiro/ecc/scripts/usage-report.mjs`. If the file is missing, tell the user that the owned part of the install is not there and that `node .kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs plan --only owned` shows what it would add, then stop. Do not write a replacement.

Choose the options from ARGS:

| ARGS | Options |
|---|---|
| empty | none: a text report for the last 7 days |
| `csv` | `--csv` |
| `json` | `--json` |
| `--days N` | `--days N`, a whole number from 1 to 3650 |

Words may be combined, for example `csv --days 30`. For any other word, say what you did not understand and stop.

```bash
node .kiro/ecc/scripts/usage-report.mjs cost
node .kiro/ecc/scripts/usage-report.mjs cost --csv
node .kiro/ecc/scripts/usage-report.mjs cost --json --days 30
```

Run only the form that ARGS asks for. A date uses the local time zone, and `--utc` switches to UTC if the user asks for it.

## Report format

For the text report, show the script output and then add these short sections, taken from its numbers only:

1. Summary: credits today, credits yesterday, credits in the whole period, and the number of usage records. Read today and yesterday from the "Per day" lines. A day that is not listed had no usage, so say 0.
2. By model: models ranked by credits.
3. By workspace: workspaces ranked by credits. Point out one that dominates.
4. Last days: the per-day lines in date order.

For `csv`, print the script output unchanged, as a code block. If the user wants a file, ask where to write it, and write it only to a path the user gave. For `json`, print the script output unchanged.

## When there is nothing

If the total is 0 and the lists are empty, say that no usage records were found for the period, and that the folder above is where Kiro keeps them. A fresh machine or a period with no chats looks the same. Do not guess a cause.

## Also useful

- In the Kiro CLI, `/usage` shows the credit balance and the plan. This command does not know the balance.
- `/ecc-skill-health` reports which skills were used, from the same log.
