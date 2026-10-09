#!/usr/bin/env node
// ecc-git-push-review: a PreToolUse hook for the shell tool. It blocks `git push` until the agent
// has been through the pre-push checklist.
//
// ecc-kiro-setup installs this file as .kiro/ecc/scripts/git-push-guard.mjs, and the hook file
// ecc-git-push-review.json runs it as `node .kiro/ecc/scripts/git-push-guard.mjs`. It uses Node
// built-ins only and imports nothing from the skill, because it runs where the skill is not.
//
// Kiro sends the hook event as JSON on stdin: { hook_event_name, cwd, session_id, tool_name, tool_input }.
// The guard looks for `git push` in the string values of tool_input, so it does not depend on the
// name of the field that holds the command.
//
// Exit 0 lets the tool run. Exit 2 blocks it, and Kiro gives stderr to the agent. An event that cannot
// be read exits 0 with a warning on stderr, so a broken hook never stops work.
//
// This is a reminder for the agent, not a security control. The agent writes the acknowledgement
// itself, and a push that this reader does not recognise gets through. Known limits: quotes are not
// tracked, so a `; git push` inside a quoted argument or a here-document is taken for a push, and
// options that come between `sudo` or `env` and `git` are not skipped.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ACK_VARIABLE = 'ECC_PUSH_REVIEWED';

/** ECC's pre-push checklist, from its git-push-review hook. */
export const CHECKLIST = Object.freeze([
  'All tests pass.',
  'The code has been reviewed.',
  'The commit messages are clear.',
  'The target branch is correct.',
]);

const STDIN_TIMEOUT_MS = 5000;

// ---- finding git push -----------------------------------------------------------------------------

/** Where one command ends and the next begins. Quotes are not tracked, so a command inside quotes is seen too. */
const SEPARATORS = /[;&|()`\n\r]/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Words that run the word after them, or that start a shell statement. */
const PREFIX_WORDS = new Set(['sudo', 'command', 'builtin', 'exec', 'time', 'nice', 'nohup', 'env', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
/** Options of git itself that take the next word as their value. */
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const MAX_DEPTH = 3;

const basename = (word) => word.slice(word.lastIndexOf('/') + 1);

/** Split one command into words. Quotes group words and are dropped; an open quote runs to the end. */
function wordsOf(segment) {
  const words = [];
  let word = '';
  let started = false;
  let quote = null;
  for (const char of segment) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

/** The word after git and its own options: `git -C dir push` gives `push`. */
function gitSubcommand(words, from) {
  let i = from;
  while (i < words.length && words[i].startsWith('-')) i += GIT_OPTIONS_WITH_VALUE.has(words[i]) ? 2 : 1;
  return words[i];
}

/** Whether one command (already split into words) is git push, or runs text that contains it. */
function runsGitPush(words, depth) {
  let i = 0;
  while (i < words.length && (ASSIGNMENT.test(words[i]) || PREFIX_WORDS.has(words[i]))) i += 1;
  if (i === words.length) return false;
  const name = basename(words[i]);
  if (name === 'git') return gitSubcommand(words, i + 1) === 'push';
  // eval joins its arguments and runs the result; sh -c runs the one word after -c. Both run text.
  if (name === 'eval') return scan(words.slice(i + 1).join(' '), depth + 1);
  if (SHELLS.has(name)) {
    const flag = words.findIndex((word, index) => index > i && /^-[a-z]*c$/.test(word));
    return flag !== -1 && flag + 1 < words.length && scan(words[flag + 1], depth + 1);
  }
  return false;
}

function scan(text, depth) {
  if (depth > MAX_DEPTH) return false;
  return text.split(SEPARATORS).some((segment) => runsGitPush(wordsOf(segment), depth));
}

/** Whether a command line runs git push. */
export const containsGitPush = (text) => scan(text, 0);

/** Whether a command line starts with the acknowledgement that the checklist was gone through. */
export const isAcknowledged = (text) => new RegExp(`^\\s*${ACK_VARIABLE}=1(?=\\s)`).test(text);

// ---- reading the event ----------------------------------------------------------------------------------

/** Every string in a value, however deep, and for a list of strings also the words joined into one line. */
function stringsOf(value, found = [], depth = 0) {
  if (found.length >= 200 || depth > 6) return found;
  if (typeof value === 'string') {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) stringsOf(item, found, depth + 1);
    if (value.length > 1 && value.every((item) => typeof item === 'string')) found.push(value.join(' '));
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) stringsOf(item, found, depth + 1);
  }
  return found;
}

/** The checklist, as the text the agent is given when a push is blocked. */
export const blockMessage = () =>
  [
    'ECC pre-push check: this command runs git push, so it was not run.',
    'Before you push, make sure that:',
    ...CHECKLIST.map((item, index) => `  ${index + 1}. ${item}`),
    `When all four are true, run the same command again with ${ACK_VARIABLE}=1 in front of it, for example:`,
    `  ${ACK_VARIABLE}=1 git push origin main`,
    '',
  ].join('\n');

const warning = (reason) => ({ exitCode: 0, stderr: `ecc git-push-guard: ${reason}; the command was not checked.\n` });

/**
 * Decide what to do with one hook event.
 * @param {string} input the text Kiro sent on stdin
 * @returns {{ exitCode: 0 | 2, stderr: string }}
 */
export function evaluate(input) {
  if (input.trim() === '') return warning('the hook event is empty');
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    return warning('the hook event is not valid JSON');
  }
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return warning('the hook event is not a JSON object');
  if (event.tool_input === undefined) return warning('the hook event has no tool_input');

  const pushes = stringsOf(event.tool_input).filter(containsGitPush);
  if (pushes.length === 0 || pushes.every(isAcknowledged)) return { exitCode: 0, stderr: '' };
  return { exitCode: 2, stderr: blockMessage() };
}

/**
 * Read a stream to the end. Resolves to null when nothing can arrive (a terminal), when the stream
 * fails, or when it stays open for longer than `timeoutMs`, so a stuck sender cannot stall the agent.
 */
export function readInput(stream, timeoutMs = STDIN_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (stream.isTTY) {
      resolve(null);
      return;
    }
    const chunks = [];
    const timer = setTimeout(() => {
      stream.destroy();
      resolve(null);
    }, timeoutMs);
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    stream.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function main() {
  const input = await readInput(process.stdin);
  const result = input === null ? warning('no hook event arrived on stdin') : evaluate(input);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  await main();
}
