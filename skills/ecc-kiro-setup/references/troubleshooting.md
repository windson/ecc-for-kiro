# Troubleshooting

Short answers for the problems that come up most. Run `doctor --json` first; its findings name a fix for each one.

## The script cannot be found

Check the three places in order: the project copy at `.kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs`, the global copy under `$KIRO_HOME/skills` or `~/.kiro/skills`, then the Power under `$KIRO_HOME/powers/installed` or the `~/.kiro` default. If `KIRO_HOME` is set, the global and Power paths use it. The project copy wins when more than one exists.

## doctor reports the skill's own SKILL.md as invalid

`selfCheck.valid` is false means this skill is broken, not the project. Repair `SKILL.md` before installing anything.

## kiro-cli agent list does not show the ECC agents

That is expected on `kiro-cli` 2.x. Markdown agents need the V3 engine and `agent list` reads JSON agents only. Verify with a `--v3` headless run instead.

## plan refuses with always-on-too-large

The always-on steering set is over 25,000 bytes. This happens only if the profile or the baseline files grow. Nothing in a normal install triggers it.

## update stops with not-installed

`update` needs an earlier install recorded in `.kiro/ecc/install-state.json`. Run `install` first.

## A command still shows Claude Code wording

The lint blocks any command whose final text contains a Claude-only construct, so such a command is not installed and is reported instead. The fix is a Kiro-native overlay for that command, which is a maintainer task, not something to do by hand in the project.

## An overlay is reported as stale

The overlay's recorded hash no longer matches the ECC file it was written from, usually after an ECC version change. The command is left out until the overlay is rewritten. This build pins ECC v2.2.3.

## A conflict appears in the plan

A planned path already holds a file the installer does not own, a symbolic link, or a folder. The installer leaves it alone and reports it. Resolve it by moving your file aside, or accept that the ECC file is skipped there.

## The install record was lost

Without `.kiro/ecc/install-state.json` the installer treats every ECC file as the user's own and reports conflicts. It does not adopt files by content. Restore the record from a backup, or remove the ECC files and reinstall.

## .kiroignore does not hide other harness folders

In the Kiro CLI it did not in testing, so do not rely on it there. In the IDE, add `.kiroignore` to the Agent Ignore Files setting (`kiroAgent.agentIgnoreFiles`), then confirm by asking Kiro to read a file in an ignored folder.

## A hook keeps firing

A hook that reviews a write can fire again when the agent fixes what it finds. Turn such hooks on one at a time. Every hook ships off; turning one on is a deliberate step.

## The git push guard blocks a push

That is the reminder working. Review the checklist it prints, then run the same command again with `ECC_PUSH_REVIEWED=1` in front of it. The guard is a reminder for the agent, not a security control.

## A run stopped half way

The install writes an install record that lists what it has written. There is no rollback. Run the same command again to finish; it continues from where it stopped.
