---
source: commands/hookify-list.md
sha256: b513140d7a93527d5d8beabd4cb1aacaa296c00ac96586bc946466014f31a3cc
credit: ["Adapted from ECC (https://github.com/affaan-m/ECC) v2.2.3: commands/hookify-list.md. MIT License, Copyright (c) 2026 Affaan Mustafa. Rewritten for Kiro hooks."]
description: "List all hookify rules in .kiro/ecc/hookify/ and show whether the Kiro hooks that enforce them are on."
---
Show every hookify rule in one table. This command only reads. It changes no file.

## Steps

1. Find the rule files: `.kiro/ecc/hookify/*.local.md`, in file name order. If the folder or the files are missing, say there are no rules and point to `/ecc-hookify`. Then stop.
2. Read the header of each file. The fields are `name`, `enabled`, `event`, `action` and `pattern`. A missing `enabled` counts as true. A missing `action` counts as warn. A missing `event` counts as all.
3. Show a table:

| Rule | Enabled | Event | Action | Pattern | File |
|------|---------|-------|--------|---------|------|

For a `stop` rule with no pattern, write `none` in the Pattern column.

4. Show the rule count, and how many are enabled.

## Problems

If `.kiro/ecc/scripts/hookify-guard.mjs` exists, ask it to report rule files it cannot use. Run this from the project root:

```bash
printf '%s' '{}' | node .kiro/ecc/scripts/hookify-guard.mjs prompt
```

Every line it prints on stderr that starts with `ecc hookify:` names a file it skips and why. Show those lines under the table as problems. No output means every rule is readable.

## Enforcement

Read `.kiro/hooks/ecc-hookify.json` if it exists. Show a second table with the four hooks (`ecc-hookify-bash`, `ecc-hookify-file`, `ecc-hookify-prompt`, `ecc-hookify-stop`) and whether each has `"enabled": true`. If a hook is off, say that rules for its event are saved but not enforced. If the file is missing, say the owned part of ECC for Kiro is not installed.

Finish with a reminder that `/ecc-hookify-configure` switches single rules on or off, and that the hooks themselves are switched in `.kiro/hooks/ecc-hookify.json`.
