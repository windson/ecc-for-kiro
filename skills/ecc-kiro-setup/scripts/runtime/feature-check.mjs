#!/usr/bin/env node
// Is an opt-in Kiro feature on? The script behind the fail-closed steps of /ecc-loop-start,
// /ecc-loop-status and /ecc-orch-review.
//
// ecc-kiro-setup installs this file as .kiro/ecc/scripts/feature-check.mjs. It uses Node built-ins only and
// imports nothing from the skill.
//
//   node feature-check.mjs workflows [--json]
//   node feature-check.mjs goal [--json]
//
// Exit 0: the feature is confirmed on. Exit 1: it is off, or it cannot be confirmed from here. The commands
// that call this treat anything but 0 as "off": they print the instructions below and stop, and they never
// carry on as if the feature were available.
//
// What can be known (Kiro docs, read 2026-10-07):
//   workflows  The Kiro CLI stores the choice as the setting chat.enableWorkflows, read here with
//              `kiro-cli settings chat.enableWorkflows`. The IDE keeps it as kiroAgent.workflows.enabled in
//              its own settings, which this script cannot read. Without a CLI answer it fails closed.
//   goal       /goal is a built-in of the interactive Kiro CLI. Kiro documents no setting for it and no way
//              to ask from a script, so this script never confirms it. It prints how to check by hand.
//
// A running CLI session reads these settings when it starts, so a change needs a restart.

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FEATURES = Object.freeze(['workflows', 'goal']);
const SETTINGS_TIMEOUT_MS = 60_000;

export const INSTRUCTIONS = Object.freeze({
  workflows: [
    'Workflows are off, or this check could not confirm that they are on.',
    'To turn them on:',
    '  Kiro CLI: run /settings, choose Features, enable Workflows, then exit and start Kiro CLI again.',
    '  Kiro IDE: open Workspace Configuration for the project, choose Workflows, enable them, then start a new chat session.',
    'If Workflows do not appear in those menus, they are not available for your account yet.',
  ],
  goal: [
    'This check cannot confirm that /goal is available. /goal is a command of the interactive Kiro CLI, and Kiro documents no setting that a script can read.',
    'To check by hand: start the Kiro CLI, type /goal and look for it in the command list.',
    'If it is not there, it is off or not available for your account. Do not start an open-ended loop in its place.',
  ],
});

/**
 * Run `kiro-cli settings <key>` and return its trimmed output. A setting that was never set makes the CLI exit
 * with "No value associated", which is an empty answer. Any other failure (no CLI, a timeout) is null.
 */
export function readCliSetting(key, run = execFile) {
  return new Promise((resolve) => {
    try {
      run('kiro-cli', ['settings', key], { timeout: SETTINGS_TIMEOUT_MS, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (!error) resolve(String(stdout).trim());
        else resolve(typeof error.code === 'number' && /no value associated/i.test(String(stderr)) ? '' : null);
      });
    } catch {
      resolve(null);
    }
  });
}

const TRUE_WORDS = new Set(['true', 'on', 'enabled', 'yes', '1']);

/**
 * Decide whether a feature is confirmed on.
 * @param {string} feature workflows or goal
 * @param {{ readSetting?: (key: string) => Promise<string | null> }} [deps]
 * @returns {Promise<{ feature: string, enabled: boolean, status: 'on' | 'off' | 'unknown', detail: string, instructions: string[] }>}
 */
export async function checkFeature(feature, { readSetting = readCliSetting } = {}) {
  if (!FEATURES.includes(feature)) throw new RangeError(`unknown feature "${feature}" (expected ${FEATURES.join(' or ')})`);
  if (feature === 'goal') {
    return { feature, enabled: false, status: 'unknown', detail: 'Kiro documents no setting for /goal and no way to ask from a script.', instructions: [...INSTRUCTIONS.goal] };
  }
  const value = await readSetting('chat.enableWorkflows');
  if (value === null) {
    return { feature, enabled: false, status: 'unknown', detail: 'kiro-cli did not answer in time (it may be busy, it may not be installed, or this is the IDE). The IDE setting kiroAgent.workflows.enabled cannot be read from here.', instructions: [...INSTRUCTIONS.workflows] };
  }
  // `kiro-cli settings` prints the value, possibly with a note such as "(global)".
  const word = value.toLowerCase().split(/\s+/)[0] ?? '';
  if (TRUE_WORDS.has(word)) return { feature, enabled: true, status: 'on', detail: 'chat.enableWorkflows is on.', instructions: [] };
  return { feature, enabled: false, status: 'off', detail: `chat.enableWorkflows is ${value === '' ? 'not set' : value}.`, instructions: [...INSTRUCTIONS.workflows] };
}

/**
 * @param {string[]} argv
 * @param {{ readSetting?: (key: string) => Promise<string | null> }} [deps]
 * @returns {Promise<{ exitCode: 0 | 1 | 2, stdout: string, stderr: string }>}
 */
export async function run(argv, deps) {
  const json = argv.includes('--json');
  const names = argv.filter((arg) => !arg.startsWith('--'));
  const unknownFlags = argv.filter((arg) => arg.startsWith('--') && arg !== '--json');
  if (names.length !== 1 || !FEATURES.includes(names[0]) || unknownFlags.length > 0) {
    return { exitCode: 2, stdout: '', stderr: `usage: feature-check.mjs <${FEATURES.join('|')}> [--json]\n` };
  }
  const result = await checkFeature(names[0], deps);
  if (json) return { exitCode: result.enabled ? 0 : 1, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' };
  const head = `${result.feature}: ${result.status === 'on' ? 'on' : result.status === 'off' ? 'off' : 'not confirmed'}. ${result.detail}`;
  const text = `${[head, ...result.instructions].join('\n')}\n`;
  return result.enabled ? { exitCode: 0, stdout: text, stderr: '' } : { exitCode: 1, stdout: '', stderr: text };
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const result = await run(process.argv.slice(2));
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
