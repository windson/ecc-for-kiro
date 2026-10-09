#!/usr/bin/env node
// ecc-hookify: the script behind the hook file .kiro/hooks/ecc-hookify.json.
//
// ecc-kiro-setup installs this file as .kiro/ecc/scripts/hookify-guard.mjs. The hook runs it as
// `node .kiro/ecc/scripts/hookify-guard.mjs <event>` where <event> is bash, file, prompt or stop.
// It uses Node built-ins only and imports nothing from the skill, because it runs where the skill is not.
//
// Rules are Markdown files in .kiro/ecc/hookify/<name>.local.md, in the format of ECC's hookify command:
//
//   ---
//   name: no-force-delete
//   enabled: true
//   event: bash            bash | file | prompt | stop | all
//   action: block          block | warn
//   pattern: "rm\s+-rf"    a regular expression (not used by stop rules)
//   ---
//   The message shown when the rule fires.
//
// Kiro sends the hook event as JSON on stdin: { hook_event_name, cwd, session_id, tool_name, tool_input }
// for the tool triggers, { ..., prompt } for UserPromptSubmit, and { hook_event_name, cwd, session_id } for
// Stop (checked in a headless run of kiro-cli 2.28.0, V3). What a rule is tested against:
//   bash    tool_input.command
//   file    tool_input.path
//   prompt  prompt
//   stop    nothing; a stop rule fires whenever the agent finishes (a blocking one only once per session)
//
// Exit 0 lets the event go on. Exit 2 blocks a tool call or a prompt, and Kiro gives stderr to the agent.
// Exit 1 is a warning: Kiro shows stderr to the user and carries on. A block on Stop is a JSON line on
// stdout, {"decision":"block","reason":"..."}, which makes the agent continue. Because the agent then stops
// again, a stop rule blocks once per session and is let through the second time.
//
// A broken event, a rule that cannot be read or a pattern that is not a regular expression never stops
// work: they are skipped, with a warning on stderr.

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RULE_DIR = '.kiro/ecc/hookify';
export const RULE_SUFFIX = '.local.md';
export const EVENTS = Object.freeze(['bash', 'file', 'prompt', 'stop']);
export const RULE_EVENTS = Object.freeze([...EVENTS, 'all']);
export const ACTIONS = Object.freeze(['block', 'warn']);

const STDIN_TIMEOUT_MS = 5000;
const MAX_RULES = 200;
const MAX_RULE_BYTES = 64 * 1024;
const MAX_SUBJECT_CHARS = 100_000;
const STOP_STATE_PREFIX = 'ecc-hookify-stop-';

// ---- reading a rule ------------------------------------------------------------------------------------

/** The value of a `key: value` line, with one level of quotes removed. */
function unquote(raw) {
  const text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  return text;
}

/**
 * Read one rule file. Returns { rule } or { problem }.
 * @param {string} text the file contents
 * @param {string} stem the file name without `.local.md`
 */
export function parseRule(text, stem) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { problem: 'the file does not start with a --- header' };
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closing === -1) return { problem: 'the --- header is not closed' };
  const fields = {};
  for (const line of lines.slice(1, closing)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) return { problem: `not a "key: value" line: ${line.trim().slice(0, 60)}` };
    fields[line.slice(0, colon).trim()] = unquote(line.slice(colon + 1));
  }
  const name = fields.name === undefined || fields.name === '' ? stem : fields.name;
  const event = fields.event ?? 'all';
  if (!RULE_EVENTS.includes(event)) return { problem: `event must be one of ${RULE_EVENTS.join(', ')}` };
  const action = fields.action ?? 'warn';
  if (!ACTIONS.includes(action)) return { problem: `action must be block or warn` };
  const enabled = fields.enabled === undefined ? true : !['false', 'no', 'off', '0'].includes(fields.enabled.toLowerCase());
  let pattern = null;
  if (fields.pattern !== undefined && fields.pattern !== '') {
    try {
      pattern = new RegExp(fields.pattern);
    } catch (error) {
      return { problem: `pattern is not a regular expression (${error.message})` };
    }
  }
  if (pattern === null && event !== 'stop') return { problem: `a ${event} rule needs a pattern` };
  const message = lines.slice(closing + 1).join('\n').trim();
  return { rule: { name, enabled, event, action, pattern, message: message === '' ? `The rule "${name}" matched.` : message } };
}

/** Every rule file in the rule folder of the project, in file name order. */
export function loadRules(cwd) {
  const dir = path.join(cwd, ...RULE_DIR.split('/'));
  const rules = [];
  const warnings = [];
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(RULE_SUFFIX)).sort();
  } catch {
    return { rules, warnings };
  }
  for (const file of names.slice(0, MAX_RULES)) {
    const where = `${RULE_DIR}/${file}`;
    try {
      const full = path.join(dir, file);
      if (statSync(full).size > MAX_RULE_BYTES) {
        warnings.push(`${where}: larger than ${MAX_RULE_BYTES} bytes, skipped`);
        continue;
      }
      const parsed = parseRule(readFileSync(full, 'utf8'), file.slice(0, -RULE_SUFFIX.length));
      if (parsed.problem) warnings.push(`${where}: ${parsed.problem}, skipped`);
      else rules.push(parsed.rule);
    } catch (error) {
      warnings.push(`${where}: ${error.message}, skipped`);
    }
  }
  if (names.length > MAX_RULES) warnings.push(`${names.length - MAX_RULES} rule files beyond the first ${MAX_RULES} were not read`);
  return { rules, warnings };
}

// ---- the event -----------------------------------------------------------------------------------------

const text = (value) => (typeof value === 'string' ? value : undefined);

/** The string a rule of this event is tested against, or undefined when the event carries none. */
export function subjectOf(event, payload) {
  const input = payload.tool_input !== null && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  let subject;
  if (event === 'bash') subject = text(input.command) ?? (Array.isArray(input.command) ? input.command.filter((item) => typeof item === 'string').join(' ') : undefined);
  else if (event === 'file') subject = text(input.path) ?? text(input.file_path) ?? text(input.filePath);
  else if (event === 'prompt') subject = text(payload.prompt) ?? text(process.env.USER_PROMPT);
  return subject === undefined ? undefined : subject.slice(0, MAX_SUBJECT_CHARS);
}

/** The rules that apply to this event and match what it carries. */
export function matchRules(rules, event, payload) {
  const subject = subjectOf(event, payload);
  return rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (rule.event !== 'all' && rule.event !== event) return false;
    if (event === 'stop') return true;
    if (rule.pattern === null || subject === undefined) return false;
    return rule.pattern.test(subject);
  });
}

// ---- stop rules fire once per session ------------------------------------------------------------

const safeId = (value) => (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : null);

function stopStatePath(sessionId, tmp) {
  return path.join(tmp, `${STOP_STATE_PREFIX}${sessionId}.json`);
}

/** The names of the stop rules that already blocked in this session. null when that cannot be known. */
function readStopState(sessionId, tmp) {
  const id = safeId(sessionId);
  if (id === null) return null;
  const file = stopStatePath(id, tmp);
  if (!existsSync(file)) return [];
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : null;
  } catch {
    return null;
  }
}

function writeStopState(sessionId, names, tmp) {
  const id = safeId(sessionId);
  if (id === null) return false;
  try {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(stopStatePath(id, tmp), JSON.stringify(names), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

// ---- deciding ----------------------------------------------------------------------------------------------

/**
 * Decide what to do with one hook event.
 * @param {string} event bash, file, prompt or stop
 * @param {string} input the text Kiro sent on stdin
 * @param {{ cwd?: string, tmp?: string }} [options] where to look for rules, and where the once-per-session state of stop rules lives
 * @returns {{ exitCode: 0 | 1 | 2, stdout: string, stderr: string }}
 */
export function evaluate(event, input, { cwd, tmp = os.tmpdir() } = {}) {
  const quiet = (stderr) => ({ exitCode: 0, stdout: '', stderr: stderr === '' ? '' : `ecc hookify: ${stderr}\n` });
  if (!EVENTS.includes(event)) return quiet(`unknown event "${event}" (expected ${EVENTS.join(', ')}); nothing was checked.`);
  if (input.trim() === '') return quiet('the hook event is empty; nothing was checked.');
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return quiet('the hook event is not valid JSON; nothing was checked.');
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return quiet('the hook event is not a JSON object; nothing was checked.');

  const root = cwd ?? (typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd());
  const { rules, warnings } = loadRules(root);
  const notes = warnings.map((warning) => `ecc hookify: ${warning}\n`).join('');
  let matched = matchRules(rules, event, payload);
  if (matched.length === 0) return { exitCode: 0, stdout: '', stderr: notes };

  if (event === 'stop') {
    // The agent stops again after a block, so each stop rule may block once per session. If that cannot be
    // recorded, nothing blocks: a rule that fires forever would trap the agent.
    const done = readStopState(payload.session_id, tmp);
    const fresh = done === null ? [] : matched.filter((rule) => !done.includes(rule.name));
    const blocking = fresh.filter((rule) => rule.action === 'block');
    if (blocking.length > 0 && writeStopState(payload.session_id, [...(done ?? []), ...blocking.map((rule) => rule.name)], tmp)) {
      matched = fresh;
    } else {
      matched = fresh.filter((rule) => rule.action === 'warn');
    }
  }

  const blocking = matched.filter((rule) => rule.action === 'block');
  const warning = matched.filter((rule) => rule.action === 'warn');
  const lines = (rules_) => rules_.map((rule) => `[${rule.name}] ${rule.message}`).join('\n');
  if (blocking.length > 0) {
    const message = `${lines(blocking)}${warning.length > 0 ? `\n${lines(warning)}` : ''}`;
    if (event === 'stop') return { exitCode: 0, stdout: `${JSON.stringify({ decision: 'block', reason: message })}\n`, stderr: notes };
    return { exitCode: 2, stdout: '', stderr: `${notes}${message}\n` };
  }
  if (warning.length > 0) return { exitCode: 1, stdout: '', stderr: `${notes}${lines(warning)}\n` };
  return { exitCode: 0, stdout: '', stderr: notes };
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
  const event = process.argv[2] ?? '';
  const input = await readInput(process.stdin);
  const result = input === null ? { exitCode: 0, stdout: '', stderr: 'ecc hookify: no hook event arrived on stdin; nothing was checked.\n' } : evaluate(event, input);
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  await main();
}
