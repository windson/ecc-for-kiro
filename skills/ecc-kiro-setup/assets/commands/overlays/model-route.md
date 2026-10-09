---
source: commands/model-route.md
sha256: 2e9789cb610bfa1a382dbaa46480a03aa976445d23b9ff719e4358bafa7292eb
credit:
  - "Adapted from ECC (https://github.com/affaan-m/ECC) v2.2.3: commands/model-route.md. MIT License, Copyright (c) 2026 Affaan Mustafa."
description: Recommend a model and effort level for the current task from the models your Kiro account offers, by complexity, risk and budget.
---
# Model route

Recommend the model and effort level for a task. ARGS is an optional task description, with an optional `--budget low|med|high`. This command only recommends. It does not switch models.

## Read the live model list

Models change often, so read them every time and never use a remembered id. In the CLI, run this with the shell tool:

```bash
kiro-cli chat --list-models -f json
```

It prints `models` (each with `model_id`, `description`, `context_window_tokens`, `rate_multiplier`) and `default_model`. The rate multiplier is the credit cost relative to the default. In the IDE, or if the command fails, ask the user to read the model picker and tell you the ids and costs, and wait.

Drop any model whose description says `[EOL]`. Keep `auto` aside: it is a router that picks per task, and it is the default fallback.

## Pick a tier from cost and size

Sort the remaining models by `rate_multiplier`. Use cost as the tier, not the name:

- Low tier: the cheapest models. For mechanical, low-risk, well-specified changes: renames, formatting, small isolated edits, boilerplate.
- Middle tier: mid-priced models. The default for everyday implementation, refactors and test writing.
- High tier: the most capable, dearest models. For architecture, deep review, security-sensitive work, unclear requirements, or changes that cross many modules.

Within a tier, prefer the newer model, and a larger context window when the task needs to hold many files. If the list has fewer than three distinct costs, collapse the tiers and say so.

## Score the task

Judge three things from ARGS and from what you can see in the project:

- Complexity: single file or many; known pattern or new design.
- Risk: touches auth, money, data deletion, migrations or public APIs.
- Ambiguity: clear acceptance criteria or open questions.

Budget changes the pick:

- `--budget low`: step one tier down unless risk is high. Never go below the low tier.
- `--budget med` or no flag: use the score as is.
- `--budget high`: step one tier up when complexity or ambiguity is not trivial.

No ARGS: base the score on the current conversation and say what you assumed.

## Effort

Pick an effort level for the task: `low` for mechanical work, `medium` for ordinary work, `high` for hard work, and `xhigh` or `max` only for the hardest, riskiest tasks and only if the high-tier model supports it. The user can set it with `--effort <level>` when starting a CLI chat, or with the effort command in a session.

## Output

Give exactly these five fields, and nothing hard-coded: every id comes from the list you just read.

- Recommended model: id and its rate multiplier
- Effort: level
- Confidence: low, medium or high, with one clause on what would change it
- Why: two or three sentences tying complexity, risk and budget to the pick
- Fallback: the next model to try if the first attempt fails. Use `auto` unless a model in the next tier up is clearly better for this task.

Close with how to apply it: in the CLI, the model command in a session or `--model` at start; in the IDE, the model picker.
