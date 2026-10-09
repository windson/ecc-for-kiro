// ECC's slash commands as Kiro steering files.
//
// An ECC command is a Markdown file: a short frontmatter and instructions for the model, typed as
// /plan in Claude Code. Kiro has no command files, but a steering file with `inclusion: manual` is
// listed in the `/` menu and loads only when it is picked (https://kiro.dev/docs/steering.md). So the
// command `plan` becomes the steering file `ecc-plan.md`, typed as `/ecc-plan`. The prefix keeps
// ECC's names apart from Kiro's own commands (`/plan` and `/checkpoint` are both built in) and from
// the user's steering.
//
// The text is Claude Code text, so it is made Kiro-native with data that ships in assets/commands,
// following docs/command-adaptation-map.md. The code here only applies that data:
//   - classes.json: the class of each command. A: deterministic rewrites are enough, so it is
//     registered. B: needs a Kiro-native rewrite. C: needs a piece the install does not have. B and C
//     are pending: they are listed in the plan and not installed.
//   - rewrite-rules.json: rules R1 to R16, applied in order to the ECC text at install time.
//   - snippets.json: the header S1 of every installed command, and S2 and S3.
//   - lint-patterns.json: Claude Code wording. A command whose final text still matches is not
//     installed: the lint stops the plan.
//   - overlays/<name>.md: a complete Kiro-native body for one command. Used instead of the ECC text
//     only while the hash in its header is the hash of the ECC file it was written from.
//
// Credit lines and license text in a command are ECC's and the people it credits, so no rule may
// change them and the lint does not look at them.
//
// Pure: text in, text out.

import { CodedError } from './exit.mjs';
import { FrontmatterError, parseFrontmatter } from './frontmatter.mjs';
import { SHA256_PATTERN } from './hash.mjs';
import { compareStrings } from './paths.mjs';
import { steeringDest, steeringName, writeSteering } from './steering.mjs';

export const COMMAND_CATEGORY = 'command';
export const SCRIPT_CATEGORY = 'command-script';

/** Where the scripts the commands run are installed. */
export const SCRIPT_DIR = '.kiro/ecc/scripts';

export const CLASSES_SCHEMA = 'ecc-kiro.command-classes.v1';
export const REWRITE_RULES_SCHEMA = 'ecc-kiro.command-rewrites.v1';
export const SNIPPETS_SCHEMA = 'ecc-kiro.command-snippets.v1';
export const LINT_PATTERNS_SCHEMA = 'ecc-kiro.command-lint.v1';

/** The command the engine builds itself, from ECC's command and the Kiro adapter's script. */
export const QUALITY_GATE = 'quality-gate';

/**
 * Names Kiro uses for its own slash commands, as listed on kiro.dev on 2026-10-07:
 * https://kiro.dev/docs/reference/slash-commands.md (CLI) and https://kiro.dev/docs/ide/chat/slash-commands.md (IDE).
 */
export const KIRO_BUILTIN_COMMANDS = Object.freeze([
  'agent', 'changelog', 'chat', 'checkpoint', 'clear', 'code', 'compact', 'config', 'context', 'copy', 'editor',
  'effort', 'experiment', 'fullscreen', 'goal', 'guide', 'help', 'hooks', 'issue', 'knowledge', 'load', 'logdump',
  'mcp', 'model', 'paste', 'plan', 'powers', 'prompts', 'quit', 'reply', 'rewind', 'save', 'session-id', 'sessions',
  'settings', 'spawn', 'spec', 'stats', 'tangent', 'theme', 'title', 'todos', 'tools', 'transcript', 'upgrade-agent',
  'usage', 'workflow',
  // the IDE
  'architecture-selection', 'bug-fix', 'context-gatherer', 'general-task-execution', 'quick-spec',
]);

/** Frontmatter keys an ECC command may carry. Anything else is a surprise and stops the conversion. */
const KNOWN_KEYS = Object.freeze(['description', 'argument-hint', 'name', 'command', 'disable-model-invocation', 'allowed-tools', 'agent', 'subtask']);

/** Claude Code settings that Kiro steering has no equivalent for. They are reported, not carried over. */
const DROPPED_KEYS = Object.freeze(['allowed-tools', 'agent', 'disable-model-invocation', 'subtask']);

const COMMAND_STEM = /^[a-z0-9][a-z0-9-]*$/;
const RULE_ID = /^[a-z][a-z0-9-]*$/;
const SKILL_NAME = /^[a-z][a-z0-9-]*$/;

const fileStem = (sourcePath) => {
  const base = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `/ecc-plan`: what the user types for the command `plan`. */
export const slashName = (name) => `/${steeringName(name)}`;

/** Project-relative path of the steering file of a command. */
export const commandDest = (name) => steeringDest(name);

/** Project-relative path of an installed script, given its file name. */
export const scriptDest = (fileName) => `${SCRIPT_DIR}/${fileName}`;

// ---- reading a command -------------------------------------------------------------------------

function hintText(value, where) {
  if (value === undefined) return null;
  // `argument-hint: [csv]` is a one-item list to a YAML reader, but Claude Code means the text.
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) return `[${value.join(', ')}]`;
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  throw new CodedError('command-argument-hint', `${where}: argument-hint must be text`);
}

/**
 * Read one ECC command file.
 * @param {{ path: string, text: string }} input `path` is the ECC-relative path, for example `commands/plan.md`
 */
export function parseCommand({ path: sourcePath, text }) {
  let doc;
  try {
    doc = parseFrontmatter(text);
  } catch (error) {
    if (error instanceof FrontmatterError) throw new CodedError('command-frontmatter', `${sourcePath}: ${error.message}`);
    throw error;
  }
  if (!doc.hasFrontmatter) throw new CodedError('command-frontmatter', `${sourcePath}: the command has no frontmatter`);

  const unknown = Object.keys(doc.data).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new CodedError('command-key-unknown', `${sourcePath}: unexpected frontmatter key(s): ${unknown.join(', ')}`, {
      fix: 'Decide what the key means in Kiro, then teach lib/slash-commands.mjs about it.',
    });
  }

  const name = fileStem(sourcePath);
  if (!COMMAND_STEM.test(name)) {
    throw new CodedError('command-name', `${sourcePath}: ${JSON.stringify(name)} is not a valid command name (lowercase letters, digits and hyphens)`);
  }
  if (doc.data.name !== undefined && doc.data.name !== name) {
    throw new CodedError('command-name', `${sourcePath}: name ${JSON.stringify(doc.data.name)} does not match the file name ${JSON.stringify(name)}`);
  }
  const { description, agent, subtask } = doc.data;
  if (typeof description !== 'string' || description.trim() === '') {
    throw new CodedError('command-description', `${sourcePath}: the command has no description`);
  }
  if (agent !== undefined && (typeof agent !== 'string' || agent.trim() === '')) {
    throw new CodedError('command-frontmatter', `${sourcePath}: agent must be a name`);
  }
  if (subtask !== undefined && typeof subtask !== 'boolean') {
    throw new CodedError('command-frontmatter', `${sourcePath}: subtask must be true or false`);
  }

  return {
    path: sourcePath,
    name,
    description: description.trim(),
    hint: hintText(doc.data['argument-hint'], sourcePath),
    // ECC names agents `ecc:planner` because it ships as a Claude plugin. Here they are plain names.
    agent: agent === undefined ? null : agent.trim().replace(/^ecc:/, ''),
    subtask: subtask === true,
    body: doc.body,
    dropped: DROPPED_KEYS.filter((key) => Object.hasOwn(doc.data, key)),
  };
}

// ---- credit and license text ----------------------------------------------------------------------

// A line that credits someone is kept as it is. A line of license text keeps its whole paragraph (or
// fenced block). A heading such as "License" or "Credits" keeps its whole section.
const CREDIT_PHRASE = /\b(?:adapted from|inspired by|credits?|courtesy of|originally (?:written|created|from|by))\b|\bauthors?\s*:|\bpart of \[?ECC\b|github\.com\/affaan-m\/ECC\b/i;
// "written by the tracker" is prose. "Written by Jane" (a capital, an @handle or a link) names someone.
const CREDIT_NAMED = /\b(?:[Tt]hanks to|[Dd]erived from|(?:[Ww]ritten|[Cc]reated|[Aa]uthored|[Cc]ontributed|[Dd]eveloped|[Mm]aintained) by):?\s+(?:[A-Z@]|https?:)/;
const LICENSE_LINE = /\blicen[cs](?:e|ed|es|ing)\b|\bcopyright\b|©|\(c\)\s*(?:19|20)\d\d|\bspdx-license-identifier\b|\bpermission is hereby granted\b|\bwithout warranty of any kind\b/i;
const NOTICE_HEADING = /^(#{1,6})[ \t]+(?:licen[cs]es?|copyright|credits?|acknowledg(?:e)?ments?|attribution|notices?)\b/i;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

const isCreditLine = (line) => CREDIT_PHRASE.test(line) || CREDIT_NAMED.test(line);

/** For each line, whether it is part of a fenced code block (the fence lines count as code). */
export function fencedLines(lines) {
  let fence = null;
  return lines.map((line) => {
    const open = FENCE_OPEN.exec(line);
    if (fence !== null) {
      if (open !== null && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = null;
      return true;
    }
    if (open !== null) {
      fence = open[1];
      return true;
    }
    return false;
  });
}

/**
 * The lines that must survive every rewrite unchanged, and that the lint does not look at.
 * @param {string[]} lines
 * @returns {Set<number>} line numbers, counted from 0
 */
export function protectedLines(lines) {
  const fenced = fencedLines(lines);
  const kept = new Set();
  const keep = (from, to) => {
    for (let i = from; i <= to; i += 1) kept.add(i);
  };
  const blank = (line) => line.trim() === '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isCreditLine(line)) kept.add(i);
    if (LICENSE_LINE.test(line)) {
      let from = i;
      let to = i;
      if (fenced[i]) {
        while (from > 0 && fenced[from - 1]) from -= 1;
        while (to < lines.length - 1 && fenced[to + 1]) to += 1;
      } else {
        while (from > 0 && !blank(lines[from - 1]) && !fenced[from - 1]) from -= 1;
        while (to < lines.length - 1 && !blank(lines[to + 1]) && !fenced[to + 1]) to += 1;
      }
      keep(from, to);
    }
    const heading = fenced[i] ? null : NOTICE_HEADING.exec(line);
    if (heading !== null) {
      let to = i;
      while (to < lines.length - 1) {
        const next = /^(#{1,6})[ \t]/.exec(lines[to + 1]);
        if (next !== null && !fenced[to + 1] && next[1].length <= heading[1].length) break;
        to += 1;
      }
      keep(i, to);
    }
  }
  return kept;
}

// ---- templates and patterns -------------------------------------------------------------------------

const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;

/** Fill `{{name}}` placeholders. A placeholder without a value is a mistake in the data. */
function fill(template, values, where) {
  return template.replace(PLACEHOLDER, (whole, key) => {
    if (!Object.hasOwn(values, key)) throw new CodedError('command-assets-invalid', `${where}: unknown placeholder ${whole}`);
    return values[key];
  });
}

/** Names as a regular expression alternative, longest first, so `plan-prd` is tried before `plan`. */
const alternation = (names) =>
  names.length === 0 ? '(?!)' : `(?:${[...names].sort((a, b) => b.length - a.length || compareStrings(a, b)).map(escapeRegExp).join('|')})`;

/** Put the command names and the uninstalled skills in place of the placeholders of a pattern. */
const expandPattern = (pattern, { commands, uninstalledSkills }) =>
  pattern.replaceAll('{{commands}}', alternation(commands)).replaceAll('{{uninstalledSkills}}', alternation(uninstalledSkills));

const SAMPLE_NAMES = Object.freeze({ commands: ['x'], uninstalledSkills: ['x'] });
const FLAGS = /^[imsu]*$/;

/** Check `id`, `pattern`, `flags` and `why` of a rule or a lint pattern. Pushes a message per fault. */
function checkPattern(entry, where, bad) {
  if (!isObject(entry)) {
    bad(`${where} must be an object`);
    return false;
  }
  if (typeof entry.id !== 'string' || !RULE_ID.test(entry.id)) {
    bad(`${where}: "id" must be lowercase letters, digits and hyphens`);
    return false;
  }
  const label = `"${entry.id}"`;
  if (typeof entry.why !== 'string' || entry.why.trim() === '') bad(`${label}: "why" must say in words what the entry is for`);
  if (typeof entry.pattern !== 'string' || entry.pattern === '' || entry.pattern.length > 600) {
    bad(`${label}: "pattern" must be a regular expression of up to 600 characters`);
    return false;
  }
  if (entry.flags !== undefined && (typeof entry.flags !== 'string' || !FLAGS.test(entry.flags))) {
    bad(`${label}: "flags" may only hold the letters i, m, s and u`);
    return false;
  }
  const unknown = /\{\{(?!commands\}\}|uninstalledSkills\}\})[^}]*\}\}/.exec(entry.pattern);
  if (unknown !== null) {
    bad(`${label}: unknown placeholder ${unknown[0]} (the patterns know {{commands}} and {{uninstalledSkills}})`);
    return false;
  }
  let regex;
  try {
    regex = new RegExp(expandPattern(entry.pattern, SAMPLE_NAMES), `${entry.flags ?? ''}g`);
  } catch (error) {
    bad(`${label}: "pattern" is not a valid regular expression (${error.message})`);
    return false;
  }
  if (regex.test('')) bad(`${label}: "pattern" matches the empty text, so it would match everywhere`);
  return true;
}

const header = (value, schema, bad) => {
  if (!isObject(value)) {
    bad('the file must be a JSON object');
    return false;
  }
  if (value.schema !== schema) bad(`unsupported schema ${JSON.stringify(value.schema ?? null)}; expected ${schema}`);
  return true;
};

function problemsOf(check) {
  const problems = [];
  check((message) => problems.push({ code: 'command-assets-invalid', message }));
  return problems;
}

const unknownKeys = (entry, allowed, label, bad) => {
  const unknown = Object.keys(entry).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) bad(`${label}: unknown key(s) ${unknown.join(', ')}`);
};

// ---- snippets -------------------------------------------------------------------------------------------

const SNIPPET_PLACEHOLDERS = Object.freeze({ S1: ['slash', 'ref', 'usage'], S2: [], S3: [], delegateCommand: ['agent', 'S2'] });

/**
 * Check the contents of assets/commands/snippets.json.
 * @returns {{ code: string, message: string }[]} empty when the file is fine
 */
export function validateSnippets(value) {
  return problemsOf((bad) => {
    if (!header(value, SNIPPETS_SCHEMA, bad)) return;
    if (!isObject(value.snippets)) return bad('"snippets" must be an object');
    for (const [key, allowed] of Object.entries(SNIPPET_PLACEHOLDERS)) {
      const text = value.snippets[key];
      if (typeof text !== 'string' || text.trim() === '') {
        bad(`snippet "${key}" must be text`);
        continue;
      }
      for (const match of text.matchAll(PLACEHOLDER)) {
        if (!allowed.includes(match[1])) bad(`snippet "${key}": unknown placeholder ${match[0]}`);
      }
    }
    if (typeof value.snippets.S1 === 'string' && !value.snippets.S1.includes('{{slash}}')) bad('snippet "S1" must use {{slash}}');
    if (!isObject(value.labels) || typeof value.labels.S2 !== 'string' || typeof value.labels.S3 !== 'string') bad('"labels" must give a heading for S2 and S3');
  });
}

// ---- classes --------------------------------------------------------------------------------------------

const CLASS_KEYS = Object.freeze(['class', 'reason', 'missing', 'design', 'skill', 'builtin']);

/**
 * Check the contents of assets/commands/classes.json.
 * @returns {{ code: string, message: string }[]} empty when the file is fine
 */
export function validateClasses(value) {
  return problemsOf((bad) => {
    if (!header(value, CLASSES_SCHEMA, bad)) return;
    if (!isObject(value.commands)) return bad('"commands" must be an object that maps a command name to its class');
    for (const [name, entry] of Object.entries(value.commands)) {
      if (!COMMAND_STEM.test(name) || !isObject(entry)) {
        bad(`"${name}" must be a command name with an object`);
        continue;
      }
      unknownKeys(entry, CLASS_KEYS, `"${name}"`, bad);
      if (!['A', 'B', 'C'].includes(entry.class)) bad(`"${name}": "class" must be A, B or C`);
      for (const key of ['reason', 'missing', 'design', 'skill', 'builtin']) {
        if (entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].trim() === '')) bad(`"${name}": "${key}" must be text`);
      }
      const pending = entry.class !== 'A' && entry.skill === undefined && entry.builtin === undefined;
      if (pending && (typeof entry.reason !== 'string' || typeof entry.missing !== 'string')) bad(`"${name}": a class ${entry.class} command needs a "reason" and a "missing" piece`);
    }
  });
}

// ---- rewrite rules ---------------------------------------------------------------------------------------

const RULE_KEYS = Object.freeze(['id', 'rule', 'commands', 'expect', 'pattern', 'flags', 'replacement', 'append', 'why']);
export const APPENDABLE = Object.freeze(['S2', 'S3']);

/**
 * Check the contents of assets/commands/rewrite-rules.json.
 * @returns {{ code: string, message: string }[]} empty when the file is fine
 */
export function validateRewriteRules(value) {
  return problemsOf((bad) => {
    if (!header(value, REWRITE_RULES_SCHEMA, bad)) return;
    if (!Array.isArray(value.uninstalledSkills) || value.uninstalledSkills.some((name) => typeof name !== 'string' || !SKILL_NAME.test(name)) || new Set(value.uninstalledSkills).size !== value.uninstalledSkills.length) {
      bad('"uninstalledSkills" must be a list of skill names, each once');
    }
    if (!Array.isArray(value.rules)) return bad('"rules" must be a list');
    const seen = new Set();
    for (const [index, rule] of value.rules.entries()) {
      if (!checkPattern(rule, `rules[${index}]`, bad)) continue;
      const label = `"${rule.id}"`;
      if (seen.has(rule.id)) bad(`${label} appears twice`);
      seen.add(rule.id);
      unknownKeys(rule, RULE_KEYS, label, bad);
      if (typeof rule.rule !== 'string' || !/^R\d{1,2}$/.test(rule.rule)) bad(`${label}: "rule" must be the number of a map rule, for example R7`);
      if (typeof rule.replacement !== 'string') bad(`${label}: "replacement" must be text`);
      if (rule.commands !== undefined && (!Array.isArray(rule.commands) || rule.commands.length === 0 || rule.commands.some((name) => typeof name !== 'string' || !COMMAND_STEM.test(name)))) {
        bad(`${label}: "commands" must be a list of command names`);
      }
      if (rule.expect !== undefined && (!Number.isInteger(rule.expect) || rule.expect < 1 || rule.commands === undefined)) bad(`${label}: "expect" is a number of matches, at least 1, and needs "commands"`);
      if (rule.append !== undefined && !APPENDABLE.includes(rule.append)) bad(`${label}: "append" must be one of ${APPENDABLE.join(', ')}`);
    }
  });
}

/**
 * Turn validated rules into regular expressions.
 * @param {{ uninstalledSkills: string[], rules: any[] }} data the contents of rewrite-rules.json
 * @param {object} context
 * @param {string[]} context.commands names that get the ecc- prefix in `{{commands}}`
 * @param {ReadonlySet<string>} context.installedSkills skills the install has; they are not uninstalled
 */
export function compileRewriteRules(data, { commands, installedSkills }) {
  const names = { commands, uninstalledSkills: data.uninstalledSkills.filter((name) => !installedSkills.has(name)) };
  return {
    uninstalledSkills: names.uninstalledSkills,
    rules: data.rules.map((rule) => ({
      id: rule.id,
      rule: rule.rule,
      commands: rule.commands === undefined ? null : new Set(rule.commands),
      expect: rule.expect,
      append: rule.append,
      replacement: rule.replacement,
      regex: new RegExp(expandPattern(rule.pattern, names), `${rule.flags ?? ''}g`),
    })),
  };
}

const MASK = '\u0001';

/**
 * Apply rewrite rules to a text, in order. Credit and license lines are hidden from the rules and put
 * back, and a rule that would swallow one stops the plan.
 * @param {string} text
 * @param {ReturnType<typeof compileRewriteRules>['rules']} rules
 * @param {{ name: string, check?: boolean }} options `check`: enforce `expect` of the rules that name this command
 * @returns {{ text: string, applied: Record<string, number>, appended: string[], protectedLines: number }}
 */
export function applyRewriteRules(text, rules, { name, check = true }) {
  const applied = {};
  const appended = [];
  if (rules.length === 0) return { text, applied, appended, protectedLines: 0 };
  const lines = text.split('\n');
  const kept = protectedLines(lines);
  let current = lines.map((line, index) => (kept.has(index) ? `${MASK}${index}${MASK}` : line)).join('\n');

  for (const rule of rules) {
    const scoped = rule.commands !== null;
    if (scoped && !rule.commands.has(name)) continue;
    const count = (current.match(rule.regex) ?? []).length;
    if (check && scoped && rule.expect !== undefined && count !== rule.expect) {
      throw new CodedError('command-rule-missed', `${name}: the rule "${rule.id}" should match ${rule.expect} time${rule.expect === 1 ? '' : 's'} and matched ${count}`, {
        fix: 'The ECC file changed. Check the rule in assets/commands/rewrite-rules.json.',
      });
    }
    if (count === 0) continue;
    current = current.replace(rule.regex, rule.replacement);
    applied[rule.id] = (applied[rule.id] ?? 0) + count;
    if (rule.append !== undefined && !appended.includes(rule.append)) appended.push(rule.append);
  }

  for (const index of kept) {
    const token = `${MASK}${index}${MASK}`;
    const parts = current.split(token);
    if (parts.length !== 2) {
      throw new CodedError('command-rewrite-dropped-protected', `${name}: a rewrite rule changed a credit or license line (line ${index + 1})`, {
        fix: 'Credit and license text must survive every rewrite. Narrow the pattern of the rule.',
      });
    }
    current = parts.join(lines[index]);
  }
  return { text: current, applied, appended, protectedLines: kept.size };
}

// ---- the lint ----------------------------------------------------------------------------------------------

const LINT_KEYS = Object.freeze(['id', 'pattern', 'flags', 'in', 'why']);

/**
 * Check the contents of assets/commands/lint-patterns.json.
 * @returns {{ code: string, message: string }[]} empty when the file is fine
 */
export function validateLintPatterns(value) {
  return problemsOf((bad) => {
    if (!header(value, LINT_PATTERNS_SCHEMA, bad)) return;
    if (!Array.isArray(value.patterns)) return bad('"patterns" must be a list');
    const seen = new Set();
    for (const [index, entry] of value.patterns.entries()) {
      if (!checkPattern(entry, `patterns[${index}]`, bad)) continue;
      if (seen.has(entry.id)) bad(`"${entry.id}" appears twice`);
      seen.add(entry.id);
      unknownKeys(entry, LINT_KEYS, `"${entry.id}"`, bad);
      if (entry.in !== undefined && entry.in !== 'frontmatter') bad(`"${entry.id}": "in" can only be "frontmatter"`);
    }
  });
}

/** @param {{ id: string, pattern: string, flags?: string, in?: string }[]} patterns */
export const compileLintPatterns = (patterns, names) =>
  patterns.map((entry) => ({ id: entry.id, in: entry.in ?? 'text', regex: new RegExp(expandPattern(entry.pattern, names), entry.flags ?? '') }));

/**
 * The ids of the lint patterns that an installed command still matches, in the order of the file.
 * Credit and license lines are not looked at.
 * @param {string} content the whole file: frontmatter, header and body
 */
export function lintCommand(content, patterns) {
  const lines = content.split('\n');
  const closing = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const kept = protectedLines(lines);
  const text = lines.map((line, index) => (kept.has(index) ? '' : line)).join('\n');
  const frontmatter = closing === -1 ? '' : lines.slice(0, closing + 1).join('\n');
  return patterns.filter((entry) => entry.regex.test(entry.in === 'frontmatter' ? frontmatter : text)).map((entry) => entry.id);
}

// ---- overlays --------------------------------------------------------------------------------------------------

const OVERLAY_KEYS = Object.freeze(['source', 'sha256', 'credit', 'description']);
const OVERLAY_CREDIT_MAX = 500;

/**
 * Read an overlay: a complete Kiro-native body for one command, with a header that says which ECC
 * file it was written from and whom it credits.
 *
 *   source       the ECC path of the command, `commands/<name>.md`
 *   sha256       the hash of that ECC file when the overlay was written
 *   credit       one or more credit lines, shown at the top of the installed file
 *   description  optional; replaces the description of the ECC command
 *
 * @param {{ name: string, text: string }} input
 */
export function parseOverlay({ name, text }) {
  const where = `assets/commands/overlays/${name}.md`;
  const fail = (message) => {
    throw new CodedError('command-overlay-invalid', `${where}: ${message}`, {
      fix: 'Fix or delete the overlay. Without it the command is pending or uses the ECC text.',
    });
  };
  let doc;
  try {
    doc = parseFrontmatter(text);
  } catch (error) {
    if (error instanceof FrontmatterError) return fail(error.message);
    throw error;
  }
  if (!doc.hasFrontmatter) return fail('the overlay has no header');
  const unknown = Object.keys(doc.data).filter((key) => !OVERLAY_KEYS.includes(key));
  if (unknown.length > 0) return fail(`unexpected header key(s): ${unknown.join(', ')}`);
  const { source, sha256, credit, description } = doc.data;
  if (source !== `commands/${name}.md`) return fail(`"source" must be commands/${name}.md`);
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) return fail('"sha256" must be the 64 hex characters of the ECC file');
  if (!Array.isArray(credit) || credit.length === 0 || credit.some((line) => typeof line !== 'string' || line.trim() === '' || /[\r\n]/.test(line) || line.length > OVERLAY_CREDIT_MAX)) {
    return fail(`"credit" must be a list of credit lines, each on one line and at most ${OVERLAY_CREDIT_MAX} characters`);
  }
  if (description !== undefined && (typeof description !== 'string' || description.trim() === '')) return fail('"description" must be text');
  if (doc.body.trim() === '') return fail('the overlay has no body');
  return { name, source, sha256, credit: credit.map((line) => line.trim()), description: description === undefined ? null : description.trim(), body: doc.body };
}

// ---- building a file ------------------------------------------------------------------------------------------------

const tidyStart = (text) => text.replace(/^(?:[ \t]*\r?\n)+/, '');
const tidyEnd = (text) => `${text.replace(/\s+$/, '')}\n`;

/** The header S1 of a command: how it is invoked and what ARGS is. */
export const renderHeader = (snippets, { name, hint }) => {
  const slash = slashName(name);
  return fill(snippets.snippets.S1, { slash, ref: steeringName(name), usage: hint === null ? slash : `${slash} ${hint}` }, 'snippet "S1"');
};

/**
 * The installed file of one command: frontmatter (manual inclusion and the description), the header
 * S1, the body, and the snippets that rules asked to append.
 *
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.description already rewritten
 * @param {string | null} input.hint the argument hint for the usage line
 * @param {string | null} [input.agent] the agent a command runs in, from its `agent` setting
 * @param {string} input.body already rewritten, or an overlay body
 * @param {string[]} [input.credit] credit lines from an overlay header
 * @param {string[]} [input.appended] snippet keys to add at the end (S2, S3)
 * @param {{ snippets: Record<string, string>, labels: Record<string, string> }} input.snippets contents of snippets.json
 * @returns {{ dest: string, content: string, header: string }}
 */
export function renderCommand({ name, description, hint, agent = null, body, credit = [], appended = [], snippets }) {
  const s1 = renderHeader(snippets, { name, hint });
  const paragraphs = [s1];
  if (agent !== null) paragraphs.push(fill(snippets.snippets.delegateCommand, { agent, S2: snippets.snippets.S2 }, 'snippet "delegateCommand"'));
  for (const line of credit) paragraphs.push(`> Credit: ${line}`);
  // The sentence about the agent already carries S2.
  const extra = appended.filter((key) => !(key === 'S2' && agent !== null)).map((key) => `## ${snippets.labels[key]}\n\n${snippets.snippets[key]}`);
  const text = [...paragraphs, tidyEnd(tidyStart(body)).replace(/\n$/, ''), ...extra].join('\n\n');
  return { dest: commandDest(name), content: writeSteering({ inclusion: 'manual', description, body: `\n${text}\n` }), header: s1 };
}

/**
 * /ecc-quality-gate: ECC's quality-gate command merged with the Kiro adapter's script. ECC's text
 * checks one file through a hook script that the install does not have. The adapter's script checks
 * the whole project and is installed, so this command runs that.
 * @param {{ script: string, format: string }} paths installed paths of quality-gate.sh and format.sh
 */
export function qualityGateParts({ script, format }) {
  return {
    description: 'Run the ECC quality gate for the project (build, type check, lint and tests) and report remediation steps.',
    hint: '[path]',
    credit: ["Adapted from ECC (https://github.com/affaan-m/ECC) v2.2.3: commands/quality-gate.md, and the quality-gate hook and script of ECC's Kiro adapter. MIT License, Copyright (c) 2026 Affaan Mustafa."],
    body: [
      "ECC's own command checks one file through a hook script that this install does not have. The Kiro adapter's script checks the whole project and is installed, so this command runs that script.",
      '',
      '## Run it',
      '',
      'Run this from the project root with the shell tool:',
      '',
      '```bash',
      `bash ${script}`,
      '```',
      '',
      'The script picks the package manager (pnpm, yarn, bun or npm) from the lock file, then runs four checks: build, type check, lint and tests. A check with nothing to run is skipped. It prints one line per check and a summary, and exits 1 if any check failed.',
      '',
      '## Then report',
      '',
      'Report every failed check with the first errors from its output and concrete remediation steps. If ARGS names a file, start with the findings for that file.',
      '',
      `If ARGS asks for formatting fixes in one file, run \`bash ${format} <path>\`. It rewrites the file with Biome or Prettier, whichever the project uses.`,
    ].join('\n'),
  };
}

/**
 * The checks every installed command must pass whatever the data says: the frontmatter is the first
 * content, the inclusion is manual, and the header S1 is there.
 * @returns {string[]} what is wrong, empty when the file is fine
 */
export function requiredProblems(content, headerText) {
  const problems = [];
  const lines = content.split('\n');
  const closing = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (closing === -1) problems.push('the frontmatter is not the first content of the file');
  else if (!lines.slice(1, closing).includes('inclusion: manual')) problems.push('the frontmatter does not say inclusion: manual');
  if (!content.includes(headerText)) problems.push('the header S1 is missing');
  return problems;
}

// ---- names ----------------------------------------------------------------------------------------

/**
 * Check the `/ecc-<name>` names of the commands against everything else that can be typed after a
 * slash or referenced with `#`: skills, agents, other steering files, Kiro's own commands, and the
 * user's global skills and agents. Also lists the ECC names that would have clashed without the prefix.
 * @param {object} input
 * @param {string[]} input.commands names of the commands
 * @param {ReadonlySet<string>} input.skills
 * @param {ReadonlySet<string>} input.agents
 * @param {ReadonlySet<string>} input.steering names of the other steering files, with their `ecc-` prefix
 * @param {readonly string[]} [input.builtins]
 * @param {ReadonlySet<string>} [input.globalSkills]
 * @param {ReadonlySet<string>} [input.globalAgents]
 * @returns {{ collisions: { name: string, with: string }[], avoided: { name: string, with: string }[] }}
 */
export function findNameCollisions({ commands, skills, agents, steering, builtins = KIRO_BUILTIN_COMMANDS, globalSkills = new Set(), globalAgents = new Set() }) {
  const builtin = new Set(builtins);
  const spaces = (name) =>
    [
      [builtin.has(name), 'a Kiro built-in command'],
      [skills.has(name), 'a skill'],
      [agents.has(name), 'an agent'],
      [steering.has(name), 'another steering file'],
      [globalSkills.has(name), 'one of your global skills'],
      [globalAgents.has(name), 'one of your global agents'],
    ]
      .filter(([taken]) => taken)
      .map(([, label]) => label);

  const collisions = [];
  const avoided = [];
  for (const name of [...commands].sort(compareStrings)) {
    for (const label of spaces(steeringName(name))) collisions.push({ name: steeringName(name), with: label });
    for (const label of spaces(name)) avoided.push({ name, with: label });
  }
  return { collisions, avoided };
}

/** The frontmatter settings that commands carry and Kiro steering cannot, by setting. */
export function droppedSettings(commands) {
  const dropped = {};
  for (const command of commands) {
    for (const key of command.dropped) (dropped[key] ??= []).push(command.name);
  }
  return Object.fromEntries(
    Object.entries(dropped)
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([key, names]) => [key, names.sort(compareStrings)]),
  );
}

