# ecc-for-kiro

Unofficial. An independent community project that sets up [ECC](https://github.com/affaan-m/ECC) for the [Kiro](https://kiro.dev) IDE and the Kiro CLI.

## What it is

ECC is an AI coding toolkit written for Claude Code: a set of agents, skills, rules, slash commands and hooks. ecc-for-kiro is a setup wizard that brings a pinned ECC release into a Kiro project. It downloads one tagged ECC release from github.com, converts each piece into the format Kiro reads, and writes the result under your project's `.kiro` folder. It installs nothing by itself until you preview the plan and confirm.

The wizard ships as a single Kiro skill, `ecc-kiro-setup`. The skill is also a small command-line tool (`ecc-kiro`) that runs on Node with no third-party dependencies.

This repository does not contain ECC. It holds the wizard, a hash-pinned list of the ECC files it expects, and tests. ECC is downloaded on your machine at install time.

## Requirements

- Node 18 or newer.
- git 2.25 or newer (a partial clone is used to download only the files the wizard needs).
- Kiro CLI 2.x or the Kiro IDE. On the CLI, the agent engine must be V3; pass `--v3` on `kiro-cli` 2.x, or set `kiro-cli settings chat.agentEngine v3`.

## Install

There are four ways to get the wizard. All of them end at the same place: a `plan` preview, then an `install` you confirm.

### 1. Power import by GitHub URL (Kiro IDE)

In the Kiro IDE, import this repository as a Power using its GitHub URL:

```
https://github.com/windson/ecc-for-kiro
```

The IDE reads `plugin.json` at the repository root and loads the `ecc-kiro-setup` skill. Then run the skill from the project you want to set up.

### 2. `npx skills add` (vercel-labs/skills CLI)

```
npx skills add windson/ecc-for-kiro
```

This copies the `skills/ecc-kiro-setup/` folder (found through `skills/*/SKILL.md`) into your project. See the telemetry note below for the skills CLI.

### 3. Run a command straight from GitHub, pinned to a tag

```
npx github:windson/ecc-for-kiro#v0.1.0 plan
```

This runs the `ecc-kiro` tool from the tagged release without installing anything to npm. Replace `plan` with any subcommand (for example `doctor` or `verify`). Pin the tag (`#v0.1.0`) so you always run a known version.

### 4. Clone and run with node

```
git clone https://github.com/windson/ecc-for-kiro
cd ecc-for-kiro
node skills/ecc-kiro-setup/scripts/ecc-kiro.mjs --help
```

Real output of `--help` is a usage block listing the subcommands (`doctor`, `verify`, `profile`, `plan`, `install`, `update`, `uninstall`, `audit`) and exits 0.

## First run

From the project you want to set up:

```
node skills/ecc-kiro-setup/scripts/ecc-kiro.mjs doctor
node skills/ecc-kiro-setup/scripts/ecc-kiro.mjs plan
node skills/ecc-kiro-setup/scripts/ecc-kiro.mjs install --yes
```

- `doctor` checks your Node, git and Kiro CLI, and reports one info note that v1 hooks need `--v3` on Kiro CLI 2.x.
- `plan` downloads the pinned ECC release (first run only; it is cached after), checks every file against its recorded sha256, converts, reads your project, and prints what it would write. It writes nothing.
- `install --yes` applies that plan. Without `--yes` it refuses and tells you how to preview.

A `plan` in a project that has another harness folder reports:

```
create 377   conflicts 0   problems 0
```

Running `install --yes` a second time reports `Nothing to change`.

## What gets installed

A full install writes 377 files under `.kiro`, all tracked:

| Part | Count |
|---|---|
| Agents | 71 (68 ECC agents plus 3 read-only panel agents) |
| Skills | 88 skills (153 files) |
| Steering files | 35 (10 always-on, 22 file-type, and the manual modes) |
| Commands | 92, registered as `/ecc-<name>` manual steering |
| Hooks | 14, every one switched off |
| Other | MCP example, LICENSE, THIRD_PARTY_NOTICES.md, scripts, and a `.kiroignore` block |

Agents become Kiro Markdown agents (the ECC tool names map to Kiro's `read`, `write`, `shell`, `web` and `subagent`, and `Bash` agents get a narrow git permission rule). Skills are copied byte for byte and validated against the Agent Skills rules. Steering files carry ECC's rules; 10 are always on (about 21,285 of Kiro's 25,000 byte budget) and the rest load for matching file types or when named. Commands register as manual steering you invoke with `/ecc-<name>`.

## Safety model

- **Hash-pinned release.** The wizard targets one ECC release: tag `v2.2.3`, commit `c05b2d6614f62f6db0047669aa4eefb223d478f9`. It downloads exactly the files on a recorded list and checks each one against its sha256. Any missing or changed file stops the run before anything is written.
- **Writes only under `.kiro` (and `.kiroignore`).** Every destination is checked twice, in `plan` and in `install`. A path outside `.kiro`, or a path reached through a symbolic link that leaves the project, is refused.
- **Never `.kiro/settings`.** The wizard never writes your Kiro settings. The MCP example lands at `.kiro/ecc/mcp.json.example`, not where Kiro would start servers.
- **Ownership record.** `.kiro/ecc/install-state.json` lists every file the wizard owns, with its source and hash, plus the folders it created.
- **Uninstall removes only unedited owned files.** If you edited an installed file, `uninstall` keeps it and stops tracking it. Files that are not owned are left alone.
- **Preview before apply.** `plan` (and `install`, `update`, `uninstall` with `--dry-run`) show the full change set and write nothing. The real change needs `--yes`.

## Hooks are off by default

All 14 hooks install with `"enabled": false` written in each file. None fires until you switch it on in the Kiro IDE's Agent Hooks panel (or by editing the file). Switch them on one at a time.

Each hook run is an agent run and costs credits. Some hooks ask the agent to review a write, and that review can itself trigger the hook again, so turning on many at once can be expensive. The documentation-warning hook, for example, fires for any Markdown the agent writes, including files Kiro itself creates under `.kiro`.

## Isolation and the Agent Ignore Files setting

If your project also has other harness folders (`.claude`, `.kimi-code`, and similar), the installer adds a marked block to `.kiroignore` that lists them, so Kiro can ignore another tool's instructions. The block sits apart from your own lines and is removed cleanly on uninstall.

For the IDE to honour `.kiroignore`, add it to the Agent Ignore Files setting (`kiroAgent.agentIgnoreFiles`). This is one manual setting; the installer cannot set it for you.

A limitation to know: in testing, the Kiro CLI (`kiro-cli` 2.28.0 with `--v3`) did not enforce `.kiroignore` for explicit reads. In the same workspace the CLI default agent did not auto-load `.kimi-code/AGENTS.md` or `.claude/` content as instructions, so it was not contaminated by them, but that is not the same as `.kiroignore` blocking a read. Confirm enforcement in the IDE with the setting above.

## Commands

The 92 registered commands cover planning, code review, builds and tests per language, PRPs, sessions, usage, learning loops, epics on GitHub, and multi-model panels. You invoke each as `/ecc-<name>` (for example `/ecc-plan`, `/ecc-code-review`, `/ecc-checkpoint list`). Two ECC commands, `ecc-guide` and `plan-canvas`, are served by the installed skills of the same name, so they are not registered as separate commands.

Some commands fail closed by design: when a required piece is missing they refuse and print the next steps rather than guessing. Examples from the validation runs:

- `/ecc-jira` with no Jira server or credentials prints setup steps and makes no network call.
- `/ecc-pr` and `/ecc-prp-pr` with no repository or remote refuse to push and show the steps; `/ecc-prp-pr` also flags a secret file to exclude.
- `/ecc-review-pr` with no GitHub access does not invent a review.
- `/ecc-loop-start` in continuous-PR mode, and `/ecc-orch-review`, fail closed when Kiro Workflows are off, write a status file, and start nothing.

Nothing with Claude-only paths or tools is ever installed: a lint blocks any command text that still carries them.

## Limitations

- **Claude wording in skills and agents.** ECC's skills and agents are installed byte for byte, so their text still uses Claude Code wording (the Task tool, `~/.claude`, model aliases, and so on). A always-on steering file, `ecc-kiro-harness`, maps that wording to Kiro. Skills and agents are not rewritten.
- **`ecc-guide` and `plan-canvas`** are served by their skills, not by separate commands.
- **Per-sub-agent model is unproven.** Whether a Kiro sub-agent applies the `model:` from its agent file was not confirmed. The panel commands name a model only when a sub-agent reports one.
- **Kiro CLI 2.x needs `--v3`.** Markdown agents and v1 hooks need the V3 engine on the CLI. They do not appear on the default V2 engine, and `kiro-cli agent list` cannot show Markdown agents.

## Update and uninstall

```
node skills/ecc-kiro-setup/scripts/ecc-kiro.mjs update --dry-run
node skills/ecc-kiro-setup/scripts/ecc-kiro.mjs update --yes
node skills/ecc-kiro-setup/scripts/ecc-kiro.mjs uninstall --dry-run
node skills/ecc-kiro-setup/scripts/ecc-kiro.mjs uninstall --yes
```

- `update` rewrites owned, unedited files whose ECC content changed, removes owned files that are no longer planned, and follows your project (a new harness folder is added to the `.kiroignore` block). An edited file is kept and no longer tracked.
- `uninstall` reads only the ownership record and your project. It removes the files it owns, the block, the folders it created, and last the record. It never touches the `ecc-kiro-setup` skill. In a dry run on a full install it reports `remove 327` and changes nothing.

## Version pin policy

The wizard is pinned to one ECC release (tag `v2.2.3`, commit `c05b2d6`) by sha256. A new ECC release does not change your install until a new version of this project updates the pin. CI runs a weekly check against github.com: it fails if ECC's LICENSE sha256 changes at the pinned tag or at HEAD, and it reports (without failing) when a newer ECC tag exists. The watch talks only to github.com and never scrapes kiro.dev or AWS.

When you run the tool from GitHub, pin the tag (`#v0.1.0`) so you run a known version.

## Privacy

This tool collects nothing. It has no analytics, no telemetry and no network calls of its own beyond one `git clone` (a partial clone, filtered to the files it needs) from github.com to download the pinned ECC release. It writes only under your project's `.kiro` folder and `.kiroignore`. Your code and your settings are never sent anywhere.

## Telemetry note for the skills CLI

Install method 2 uses the third-party [vercel-labs/skills](https://github.com/vercel-labs/skills) CLI, which sends anonymous telemetry by default. For a public repository it sends repository and skill identifiers. Disable it by setting `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`. This is the skills CLI's behavior, not this project's; our code never calls it.

## Manual IDE checklist

A command-line agent cannot open the Kiro IDE, so these checks are left to you after an install:

- **`.kiroignore` enforcement.** Add `.kiroignore` to the Agent Ignore Files setting (`kiroAgent.agentIgnoreFiles`), ask Kiro to read a file under `.claude/`, and check whether `.kimi-code/AGENTS.md` still loads.
- **Agent Hooks panel.** Confirm it lists the ECC hooks all switched off, and that the eye icon toggles `enabled` in the file.
- **Steering and Skills panels.** Confirm the always-on steering and the 88 skills show up.
- **Slash menu.** Confirm `/ecc-*` commands appear and that argument text (for example `/ecc-checkpoint list`) reaches the agent.

## Upstream status

The wizard pins ECC `v2.2.3`. Two ECC pull requests related to this work (the steering `auto` to `always` change, and another) are open upstream, and the ECC maintainer has offered to review a profile generator plus a manifest entry. A later version aims to derive the file list from ECC's own install manifest so a version bump needs no manual step.

## Support

Open an issue at [github.com/windson/ecc-for-kiro/issues](https://github.com/windson/ecc-for-kiro/issues).

## Disclaimer

ecc-for-kiro is an independent community project. It is not affiliated with, endorsed by, or sponsored by Amazon Web Services, Amazon.com, Inc., the Kiro team, or the authors of ECC.

Kiro is a trademark of Amazon.com, Inc. or its affiliates. Claude is a trademark of Anthropic, PBC. All other names belong to their owners.

ECC is a separate open source project by Affaan Mustafa and contributors, under the MIT License. It includes adapted ECC command text under the MIT License. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). The installer downloads a pinned ECC release from github.com and converts it on your machine.

## License

MIT. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
