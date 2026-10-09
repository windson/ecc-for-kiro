// Test support for the commands part: the data files of assets/commands, as objects.
// `minimalCommandAssets` is a small valid set for synthetic fixtures. `shippedCommandAssets` reads the
// files that ship in the skill.

import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The folder of the data files that ship in the skill. */
export const SHIPPED_COMMANDS_DIR = path.resolve(HERE, '..', 'skills', 'ecc-kiro-setup', 'assets', 'commands');

const readJson = (dir, file) => JSON.parse(readFileSync(path.join(dir, file), 'utf8'));

/** The overlays in a folder, name -> text. A missing folder has none. */
function readOverlays(dir) {
  const overlays = new Map();
  let names = [];
  try {
    names = readdirSync(path.join(dir, 'overlays')).filter((name) => name.endsWith('.md') && name !== 'NOTICE-ECC.md').sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const file of names) overlays.set(file.slice(0, -3), readFileSync(path.join(dir, 'overlays', file), 'utf8'));
  return overlays;
}

/** The data that ships in the skill, the way the plan loads it. */
export function shippedCommandAssets(dir = SHIPPED_COMMANDS_DIR) {
  return {
    classes: readJson(dir, 'classes.json'),
    rules: readJson(dir, 'rewrite-rules.json'),
    snippets: readJson(dir, 'snippets.json'),
    lint: readJson(dir, 'lint-patterns.json'),
    overlays: readOverlays(dir),
  };
}

/** Three rules and four lint patterns: enough for fixtures that use a command or two. */
export const SAMPLE_RULES = Object.freeze([
  {
    id: 'claude-md',
    rule: 'R8',
    pattern: 'CLAUDE\\.md',
    replacement: 'AGENTS.md',
    why: 'Claude Code reads CLAUDE.md. Kiro reads AGENTS.md.',
  },
  {
    id: 'arguments-placeholder',
    rule: 'R1',
    pattern: '\\$ARGUMENTS',
    replacement: 'ARGS',
    why: 'The header defines ARGS.',
  },
  {
    id: 'command-names',
    rule: 'R2',
    pattern: '(?<![\\w/.:~$}-])/({{commands}})(?![\\w/-])',
    replacement: '/ecc-$1',
    why: 'ECC commands are installed as /ecc-<name>.',
  },
]);

export const SAMPLE_LINT = Object.freeze([
  { id: 'claude-md', pattern: 'CLAUDE\\.md', why: 'Claude Code instruction file.' },
  { id: 'claude-home', pattern: '~/\\.claude', why: 'Claude Code personal folder.' },
  { id: 'arguments-placeholder', pattern: '\\$ARGUMENTS', why: 'Steering does no substitution.' },
  { id: 'unprefixed-slash', pattern: '(?<![\\w/.:~$}-])/(plan|{{commands}})(?![\\w/-])', why: 'Needs the ecc- prefix.' },
]);

/**
 * A small valid set of command data, with the shipped snippets. Pass what the fixture needs.
 * @param {object} [input]
 * @param {Record<string, object>} [input.classes] command name -> entry of classes.json
 * @param {object[]} [input.rules] rules of rewrite-rules.json
 * @param {string[]} [input.uninstalledSkills]
 * @param {object[]} [input.lint] patterns of lint-patterns.json
 * @param {Map<string, string>} [input.overlays] name -> overlay text
 */
export function minimalCommandAssets({ classes = {}, rules = SAMPLE_RULES, uninstalledSkills = [], lint = SAMPLE_LINT, overlays = new Map() } = {}) {
  return {
    classes: { schema: 'ecc-kiro.command-classes.v1', commands: structuredClone(classes) },
    rules: { schema: 'ecc-kiro.command-rewrites.v1', uninstalledSkills: [...uninstalledSkills], rules: structuredClone([...rules]) },
    snippets: readJson(SHIPPED_COMMANDS_DIR, 'snippets.json'),
    lint: { schema: 'ecc-kiro.command-lint.v1', patterns: structuredClone([...lint]) },
    overlays,
  };
}

/** Write command data into `<skillDir>/assets/commands`, the way the skill ships it. */
export async function writeCommandAssets(skillDir, assets) {
  const dir = path.join(skillDir, 'assets', 'commands');
  await mkdir(path.join(dir, 'overlays'), { recursive: true });
  const files = { 'classes.json': assets.classes, 'rewrite-rules.json': assets.rules, 'snippets.json': assets.snippets, 'lint-patterns.json': assets.lint };
  for (const [file, value] of Object.entries(files)) {
    if (value !== undefined) await writeFile(path.join(dir, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  }
  for (const [name, text] of assets.overlays ?? []) await writeFile(path.join(dir, 'overlays', `${name}.md`), text);
}
