#!/usr/bin/env node
// Usage reports over Kiro's local session log. The script behind /ecc-cost-report and /ecc-skill-health.
//
// ecc-kiro-setup installs this file as .kiro/ecc/scripts/usage-report.mjs. It uses Node built-ins only and
// imports nothing from the skill.
//
//   node usage-report.mjs cost   [--days N] [--csv] [--json] [--utc]
//   node usage-report.mjs skills [--days N] [--json] [--utc] [--installed <name,name,...>]
//
// Kiro keeps one folder per session: ${KIRO_HOME:-~/.kiro}/sessions/<hash>/sess_<id>/ with a session.json
// (modelId, workspacePaths) and a messages.jsonl. Each line of messages.jsonl is { id, timestamp, payload }.
// Two kinds of payload are read:
//   usage_summary  promptTurnSummaries[].usage, in credits
//   tool_call      toolName "disclose_context" with args.name: a skill was activated
// Nothing else is read. The script never prints message text, tool arguments or tool output. Only numbers,
// dates, tool names, model ids, workspace paths and skill names reach the output.
//
// The log format is internal to Kiro (schemaVersion 1.0.0 when this was written), so anything unknown is
// skipped and counted, not reported as an error. The report says credits, not dollars. /usage in the
// Kiro CLI gives the balance.

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_COST_DAYS = 7;
const DEFAULT_SKILL_DAYS = 30;
const MAX_LOG_BYTES = 200 * 1024 * 1024;
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The folder with Kiro's sessions. KIRO_HOME wins over the home folder, as it does for Kiro. */
export function sessionsDir(env = process.env, home = os.homedir()) {
  const kiroHome = env.KIRO_HOME !== undefined && env.KIRO_HOME !== '' ? env.KIRO_HOME : path.join(home, '.kiro');
  return path.join(kiroHome, 'sessions');
}

const readDir = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** Read a JSON file; null when it is missing or broken. */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const isoDay = (date, utc) => {
  const pad = (n) => String(n).padStart(2, '0');
  return utc ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Walk the session folders and return one entry per session with the records this script reads.
 * @returns {{ sessions: { id: string, modelId: string, workspace: string, usage: { at: Date, credits: number }[], skills: { at: Date, name: string }[] }[], skipped: { sessions: number, lines: number } }}
 */
export function readSessions(dir) {
  const sessions = [];
  const skipped = { sessions: 0, lines: 0 };
  for (const hash of readDir(dir)) {
    for (const folder of readDir(path.join(dir, hash))) {
      if (!folder.startsWith('sess_')) continue;
      const base = path.join(dir, hash, folder);
      const meta = readJson(path.join(base, 'session.json'));
      let text;
      try {
        const log = path.join(base, 'messages.jsonl');
        if (statSync(log).size > MAX_LOG_BYTES) {
          skipped.sessions += 1;
          continue;
        }
        text = readFileSync(log, 'utf8');
      } catch {
        skipped.sessions += 1;
        continue;
      }
      const session = {
        id: folder,
        modelId: typeof meta?.modelId === 'string' && meta.modelId !== '' ? meta.modelId : 'unknown',
        workspace: Array.isArray(meta?.workspacePaths) && typeof meta.workspacePaths[0] === 'string' ? meta.workspacePaths[0] : 'unknown',
        usage: [],
        skills: [],
      };
      for (const line of text.split('\n')) {
        if (line === '') continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          skipped.lines += 1;
          continue;
        }
        const payload = record?.payload;
        const at = new Date(record?.timestamp);
        if (payload === null || typeof payload !== 'object' || Number.isNaN(at.getTime())) {
          skipped.lines += 1;
          continue;
        }
        if (payload.type === 'usage_summary' && Array.isArray(payload.promptTurnSummaries)) {
          const credits = payload.promptTurnSummaries.reduce((sum, turn) => sum + (typeof turn?.usage === 'number' && Number.isFinite(turn.usage) && turn.usage >= 0 ? turn.usage : 0), 0);
          session.usage.push({ at, credits });
        } else if (payload.type === 'tool_call' && payload.toolName === 'disclose_context' && typeof payload.args?.name === 'string' && SKILL_NAME.test(payload.args.name)) {
          session.skills.push({ at, name: payload.args.name });
        }
      }
      sessions.push(session);
    }
  }
  return { sessions, skipped };
}

const round = (n) => Math.round(n * 10_000) / 10_000;
const sortedEntries = (map) => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Credits per day, per model and per workspace for the last `days` days (today counts as one).
 * @param {ReturnType<typeof readSessions>['sessions']} sessions
 * @param {{ days?: number, now?: Date, utc?: boolean }} [options]
 */
export function summarizeCost(sessions, { days = DEFAULT_COST_DAYS, now = new Date(), utc = false } = {}) {
  const since = new Date(now.getTime() - (days - 1) * DAY_MS);
  const first = isoDay(since, utc);
  const byDay = new Map();
  const byModel = new Map();
  const byWorkspace = new Map();
  let total = 0;
  let turns = 0;
  for (const session of sessions) {
    for (const item of session.usage) {
      const day = isoDay(item.at, utc);
      if (day < first || item.at.getTime() > now.getTime() + DAY_MS) continue;
      byDay.set(day, (byDay.get(day) ?? 0) + item.credits);
      byModel.set(session.modelId, (byModel.get(session.modelId) ?? 0) + item.credits);
      byWorkspace.set(session.workspace, (byWorkspace.get(session.workspace) ?? 0) + item.credits);
      total += item.credits;
      turns += 1;
    }
  }
  const rows = (map) => sortedEntries(map).map(([key, credits]) => ({ key, credits: round(credits) }));
  return { unit: 'credits', days, since: first, total: round(total), requests: turns, perDay: rows(byDay), perModel: rows(byModel).sort((a, b) => b.credits - a.credits), perWorkspace: rows(byWorkspace).sort((a, b) => b.credits - a.credits) };
}

/**
 * Skill activations over the last `days` days: how often, when last, and which installed skills never ran.
 * @param {ReturnType<typeof readSessions>['sessions']} sessions
 * @param {{ days?: number, now?: Date, installed?: string[], utc?: boolean }} [options]
 */
export function summarizeSkills(sessions, { days = DEFAULT_SKILL_DAYS, now = new Date(), installed = [], utc = false } = {}) {
  const since = new Date(now.getTime() - days * DAY_MS);
  const counts = new Map();
  const last = new Map();
  for (const session of sessions) {
    for (const item of session.skills) {
      if (item.at < since || item.at.getTime() > now.getTime() + DAY_MS) continue;
      counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
      if (!last.has(item.name) || item.at > last.get(item.name)) last.set(item.name, item.at);
    }
  }
  const known = new Set(installed);
  const used = sortedEntries(counts)
    .map(([name, activations]) => ({ name, activations, lastUsed: isoDay(last.get(name), utc), installed: known.size === 0 ? null : known.has(name) }))
    .sort((a, b) => b.activations - a.activations || (a.name < b.name ? -1 : 1));
  const never = [...known].filter((name) => !counts.has(name)).sort();
  return { days, installedKnown: known.size > 0, used, neverUsed: never };
}

// ---- output ----------------------------------------------------------------------------------------------

const csvCell = (value) => {
  const text = String(value);
  // A cell that starts with = + - or @ would be read as a formula by a spreadsheet.
  const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export function formatCostCsv(report) {
  const rows = [['kind', 'key', 'credits']];
  for (const [kind, list] of [['day', report.perDay], ['model', report.perModel], ['workspace', report.perWorkspace]]) {
    for (const item of list) rows.push([kind, item.key, item.credits]);
  }
  rows.push(['total', 'all', report.total]);
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export function formatCostText(report, skipped) {
  const lines = [`Credits used in the last ${report.days} day${report.days === 1 ? '' : 's'} (since ${report.since}): ${report.total} in ${report.requests} usage records`, ''];
  const block = (title, list) => {
    lines.push(title);
    if (list.length === 0) lines.push('  (none)');
    for (const item of list) lines.push(`  ${item.key}  ${item.credits}`);
    lines.push('');
  };
  block('Per day', report.perDay);
  block('Per model', report.perModel);
  block('Per workspace', report.perWorkspace);
  lines.push('These are credits, not dollars. Run /usage in the Kiro CLI for your balance.');
  if (skipped.sessions + skipped.lines > 0) lines.push(`Skipped: ${skipped.sessions} unreadable sessions, ${skipped.lines} lines that were not understood.`);
  return `${lines.join('\n')}\n`;
}

export function formatSkillsText(report, skipped) {
  const lines = [`Skill activations in the last ${report.days} days`, ''];
  if (report.used.length === 0) lines.push('  (no activations)');
  for (const item of report.used) lines.push(`  ${item.name}  ${item.activations}  last used ${item.lastUsed}${item.installed === false ? '  (not installed here)' : ''}`);
  if (report.installedKnown) {
    lines.push('', `Installed and never activated in this period (${report.neverUsed.length}):`);
    lines.push(report.neverUsed.length === 0 ? '  (none)' : `  ${report.neverUsed.join(', ')}`);
  }
  lines.push('', 'Success rates and failure clusters are not available: Kiro does not record the outcome of a skill run.');
  if (skipped.sessions + skipped.lines > 0) lines.push(`Skipped: ${skipped.sessions} unreadable sessions, ${skipped.lines} lines that were not understood.`);
  return `${lines.join('\n')}\n`;
}

// ---- the command line --------------------------------------------------------------------------------------

/** Folder names under .kiro/skills in the project and in the Kiro home folder. */
export function installedSkills({ cwd, env = process.env, home = os.homedir() }) {
  const kiroHome = env.KIRO_HOME !== undefined && env.KIRO_HOME !== '' ? env.KIRO_HOME : path.join(home, '.kiro');
  const names = new Set();
  for (const dir of [path.join(cwd, '.kiro', 'skills'), path.join(kiroHome, 'skills')]) {
    for (const name of readDir(dir)) {
      try {
        if (SKILL_NAME.test(name) && statSync(path.join(dir, name)).isDirectory()) names.add(name);
      } catch {
        // a broken link is not a skill
      }
    }
  }
  return [...names].sort();
}

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (command !== 'cost' && command !== 'skills') return { error: 'usage: usage-report.mjs <cost|skills> [--days N] [--csv] [--json] [--utc] [--installed a,b]' };
  const options = { command, days: command === 'cost' ? DEFAULT_COST_DAYS : DEFAULT_SKILL_DAYS, csv: false, json: false, utc: false, installed: null };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--csv') options.csv = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--utc') options.utc = true;
    else if (arg === '--days' || arg.startsWith('--days=')) {
      const value = arg === '--days' ? rest[(i += 1)] : arg.slice('--days='.length);
      const days = Number(value);
      if (!Number.isInteger(days) || days < 1 || days > 3650) return { error: '--days needs a whole number from 1 to 3650' };
      options.days = days;
    } else if (arg === '--installed' || arg.startsWith('--installed=')) {
      const value = arg === '--installed' ? rest[(i += 1)] : arg.slice('--installed='.length);
      if (typeof value !== 'string') return { error: '--installed needs a comma-separated list of skill names' };
      options.installed = value.split(',').map((name) => name.trim()).filter((name) => SKILL_NAME.test(name));
    } else return { error: `unknown option ${arg}` };
  }
  if (options.csv && command !== 'cost') return { error: '--csv only applies to cost' };
  return { options };
}

/**
 * Run the report and return the text to print.
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, home?: string, cwd?: string, now?: Date }} [context]
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
export function run(argv, { env = process.env, home = os.homedir(), cwd = process.cwd(), now = new Date() } = {}) {
  const parsed = parseArguments(argv);
  if (parsed.error) return { exitCode: 2, stdout: '', stderr: `${parsed.error}\n` };
  const { options } = parsed;
  const { sessions, skipped } = readSessions(sessionsDir(env, home));
  if (options.command === 'cost') {
    const report = summarizeCost(sessions, { days: options.days, now, utc: options.utc });
    if (options.json) return { exitCode: 0, stdout: `${JSON.stringify({ ...report, skipped }, null, 2)}\n`, stderr: '' };
    return { exitCode: 0, stdout: options.csv ? formatCostCsv(report) : formatCostText(report, skipped), stderr: '' };
  }
  const installed = options.installed ?? installedSkills({ cwd, env, home });
  const report = summarizeSkills(sessions, { days: options.days, now, installed, utc: options.utc });
  return { exitCode: 0, stdout: options.json ? `${JSON.stringify({ ...report, skipped }, null, 2)}\n` : formatSkillsText(report, skipped), stderr: '' };
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const result = run(process.argv.slice(2));
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
