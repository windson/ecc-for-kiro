// Steering files: writing them, and converting the ones ECC's Kiro adapter ships.
//
// Pure: text in, text out. Kiro reads steering from .kiro/steering/*.md. The frontmatter must be
// the first thing in the file, `inclusion` says when the file loads, and several file patterns are
// a list, not one comma-joined string (https://kiro.dev/docs/steering.md). The body, which holds
// the actual rules, is copied through, apart from the few rewrites listed below.

import { CodedError } from './exit.mjs';
import { FrontmatterError, formatFlow, parseFrontmatter, quoteString } from './frontmatter.mjs';

/** Where Kiro looks for a project's steering files. */
export const STEERING_DIR = '.kiro/steering';

/** Every steering file this tool installs starts with this, so it cannot collide with the user's own. */
export const STEERING_PREFIX = 'ecc-';

/** The inclusion modes Kiro knows. */
export const INCLUSIONS = Object.freeze(['always', 'fileMatch', 'manual', 'auto']);

/** Frontmatter keys an adapter steering file may carry. Anything else is a surprise and stops the conversion. */
const KNOWN_KEYS = Object.freeze(['inclusion', 'name', 'description', 'fileMatchPattern']);

const STEM = /^[a-z0-9][a-z0-9-]*$/;

/** Stems of the two always-on files this tool writes itself: `ecc-agents` and `ecc-kiro-harness`. */
export const AGENTS_STEM = 'agents';
export const HARNESS_STEM = 'kiro-harness';

/** `coding-style` becomes `ecc-coding-style`. */
export const steeringName = (stem) => `${STEERING_PREFIX}${stem}`;

/** Project-relative path of an installed steering file. */
export const steeringDest = (stem) => `${STEERING_DIR}/${steeringName(stem)}.md`;

const fileStem = (sourcePath) => {
  const base = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
};

// ---- writing ------------------------------------------------------------------------

/**
 * A steering file: the frontmatter Kiro documents, then the body.
 *
 * `inclusion` and `name` are plain words, as in Kiro's own examples. Text and lists are JSON-style
 * YAML, so a colon or a `*` in a value cannot break the file.
 *
 * @param {object} input
 * @param {'always' | 'fileMatch' | 'manual' | 'auto'} input.inclusion
 * @param {string} [input.name] required by Kiro for `auto`; optional otherwise
 * @param {string} [input.description]
 * @param {string[]} [input.patterns] globs; required for `fileMatch` and not allowed for other modes
 * @param {string} input.body Markdown that follows the frontmatter
 */
export function writeSteering({ inclusion, name, description, patterns, body }) {
  if (!INCLUSIONS.includes(inclusion)) throw new TypeError(`unknown inclusion ${JSON.stringify(inclusion)}`);
  if (inclusion === 'fileMatch') {
    if (!Array.isArray(patterns) || patterns.length === 0) throw new TypeError('a fileMatch file needs at least one pattern');
  } else if (patterns !== undefined) {
    throw new TypeError(`patterns only belong in a fileMatch file, not in a ${inclusion} file`);
  }
  if (inclusion === 'auto' && (name === undefined || description === undefined)) throw new TypeError('an auto file needs a name and a description');
  if (name !== undefined && !STEM.test(name)) throw new TypeError(`invalid steering name ${JSON.stringify(name)}`);

  const lines = ['---', `inclusion: ${inclusion}`];
  if (name !== undefined) lines.push(`name: ${name}`);
  if (patterns !== undefined) lines.push(`fileMatchPattern: ${formatFlow(patterns)}`);
  if (description !== undefined) lines.push(`description: ${quoteString(description)}`);
  lines.push('---');
  return `${lines.join('\n')}\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}

// ---- file patterns ------------------------------------------------------------------

/** Why this is not a glob Kiro can use, or null when it is one. */
export function globProblem(glob) {
  if (typeof glob !== 'string' || glob === '') return 'is empty';
  if (glob.length > 200) return 'is longer than 200 characters';
  if (/[\s\\\u0000-\u001f\u007f]/.test(glob)) return 'has whitespace, a backslash or a control character';
  if (glob.startsWith('/') || glob.split('/').includes('..')) return 'must be relative and stay inside the project';
  if (glob.includes(',')) return 'has a comma; give each pattern as its own list item';
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    if (glob.split(open).length !== glob.split(close).length) return `has unbalanced ${open}${close}`;
  }
  return null;
}

/**
 * ECC's adapter joins several patterns in one string (`*.ts,*.tsx`), which Kiro reads as one
 * pattern. Split it into a list. A pattern without a folder part matches in any folder, so it
 * gets `**` in front: `*.ts` becomes `**` + `/*.ts`.
 * @param {unknown} value the string (or list) found in `fileMatchPattern`
 * @returns {string[]}
 */
export function globsFromPatternValue(value, where) {
  const pieces = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : null;
  if (pieces === null) throw new CodedError('steering-pattern', `${where}: fileMatchPattern must be a string or a list of strings`);
  const globs = [];
  for (const piece of pieces) {
    const glob = typeof piece === 'string' ? piece.trim() : '';
    const problem = globProblem(glob);
    if (problem !== null) throw new CodedError('steering-pattern', `${where}: the pattern ${JSON.stringify(piece)} ${problem}`);
    const full = glob.includes('/') ? glob : `**/${glob}`;
    if (!globs.includes(full)) globs.push(full);
  }
  if (globs.length === 0) throw new CodedError('steering-pattern', `${where}: fileMatchPattern is empty`);
  return globs;
}

// ---- rewrites of the adapter's text ------------------------------------------------------

/**
 * Pieces of the adapter's text that are wrong for a Kiro install made by this tool. Each pattern
 * must match exactly once, so a changed file stops the conversion instead of being half fixed.
 * The files are pinned by hash, so this only fires if the pin moves.
 *
 * @type {Readonly<Record<string, { find: RegExp, replace: string, why: string }[]>>}
 */
export const ADAPTER_PATCHES = Object.freeze({
  'git-workflow': [
    {
      // The note describes a setting in Claude Code's own settings file. This install has none.
      find: /\nNote: ECC-managed installs set [^\n]*\n(?=\n## Pull Request Workflow\n)/,
      replace: '',
      why: 'a note about ~/.claude/settings.json, which this install does not touch',
    },
  ],
  'lessons-learned': [
    {
      find: /^1\. The `extract-patterns` hook will suggest patterns after agent sessions$/m,
      replace: '1. If you turn on the `ecc-extract-patterns` hook, it suggests patterns after agent sessions',
      why: 'the hook has the ecc- prefix here and ships switched off',
    },
    {
      // The adapter's "Kiro Hooks" lessons are about its install.sh and its retired hook format.
      find: /^## Kiro Hooks\n[\s\S]*?(?=\n---\n\n## Common Pitfalls\n)/m,
      replace: [
        '## ECC Install',
        '',
        '### Your edits are kept',
        'The ECC installer only updates files it installed and you did not edit. If you change a steering file, a later update keeps your version and tells you so. This file is meant to be edited.',
        '',
      ].join('\n'),
      why: 'the adapter lessons describe install.sh and the retired .kiro.hook format, neither of which exists here',
    },
  ],
});

const countMatches = (text, pattern) => [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].length;

/** Apply patches that must each match exactly once. */
export function applyPatches(body, patches, where) {
  let text = body;
  for (const patch of patches) {
    const found = countMatches(text, patch.find);
    if (found !== 1) {
      throw new CodedError('steering-patch-missed', `${where}: expected to find the text to rewrite (${patch.why}) once, found it ${found} times`, {
        fix: 'The ECC file changed. Check the rewrite in ADAPTER_PATCHES in lib/steering.mjs.',
      });
    }
    text = text.replace(patch.find, () => patch.replace);
  }
  return text;
}

/**
 * `#dev-mode` in chat includes a manual steering file; the installed file has the ecc- prefix.
 * Not matched: a `#` inside a word, an HTML entity, a path, or the anchor of a Markdown link.
 */
const STEERING_REFERENCE = /(?<![\w#&/[-])(?<!\]\()#([a-z0-9][a-z0-9-]*)(?![\w-])/g;

/**
 * Point `#name` references at the installed names.
 * @param {string} body
 * @param {ReadonlySet<string>} known stems of the steering files that get installed
 * @returns {{ text: string, count: number }}
 */
export function rewriteSteeringReferences(body, known) {
  let count = 0;
  const text = body.replace(STEERING_REFERENCE, (match, stem) => {
    if (!known.has(stem)) return match;
    count += 1;
    return `#${steeringName(stem)}`;
  });
  return { text, count };
}

// ---- converting an adapter file ----------------------------------------------------------

/**
 * Convert one steering file of ECC's Kiro adapter.
 *
 * - `auto` becomes `always`: `auto` loads a file only when the request matches its description,
 *   which is not what the core rules need (ECC pull request 3322 makes the same change).
 * - `fileMatchPattern` becomes a list of globs.
 * - `manual` stays manual.
 * - The file gets the `ecc-` prefix, and `#name` references point at the new names.
 *
 * @param {object} input
 * @param {string} input.path ECC-relative path, for example `.kiro/steering/coding-style.md`
 * @param {string} input.text
 * @param {ReadonlySet<string>} [input.known] stems of every adapter file being installed, for reference rewrites
 * @returns {{ stem: string, name: string, dest: string, content: string, inclusion: 'always' | 'fileMatch' | 'manual', patterns: string[] | null, description: string | null, references: number, patched: boolean }}
 */
export function convertAdapterSteering({ path: sourcePath, text, known = new Set() }) {
  let doc;
  try {
    doc = parseFrontmatter(text);
  } catch (error) {
    if (error instanceof FrontmatterError) throw new CodedError('steering-frontmatter', `${sourcePath}: ${error.message}`);
    throw error;
  }
  if (!doc.hasFrontmatter) throw new CodedError('steering-frontmatter', `${sourcePath}: the file has no frontmatter`);

  const unknown = Object.keys(doc.data).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new CodedError('steering-key-unknown', `${sourcePath}: unexpected frontmatter key(s): ${unknown.join(', ')}`, {
      fix: 'Decide what the key means in Kiro, then teach lib/steering.mjs about it.',
    });
  }

  const stem = fileStem(sourcePath);
  if (!STEM.test(stem)) throw new CodedError('steering-name', `${sourcePath}: ${JSON.stringify(stem)} is not a valid steering name (lowercase letters, digits and hyphens)`);
  const { inclusion, name, description, fileMatchPattern } = doc.data;
  if (name !== undefined && name !== stem) {
    throw new CodedError('steering-name', `${sourcePath}: name ${JSON.stringify(name)} does not match the file name ${JSON.stringify(stem)}`);
  }
  if (description !== undefined && (typeof description !== 'string' || description.trim() === '')) {
    throw new CodedError('steering-description', `${sourcePath}: description must be a non-empty string`);
  }

  let mode;
  let patterns = null;
  if (inclusion === 'auto' || inclusion === 'always') {
    mode = 'always';
  } else if (inclusion === 'fileMatch') {
    mode = 'fileMatch';
    if (fileMatchPattern === undefined) throw new CodedError('steering-pattern', `${sourcePath}: a fileMatch file needs a fileMatchPattern`);
    patterns = globsFromPatternValue(fileMatchPattern, sourcePath);
  } else if (inclusion === 'manual') {
    mode = 'manual';
  } else {
    throw new CodedError('steering-inclusion', `${sourcePath}: unknown inclusion ${JSON.stringify(inclusion ?? null)}`);
  }
  if (mode !== 'fileMatch' && fileMatchPattern !== undefined) {
    throw new CodedError('steering-pattern', `${sourcePath}: only a fileMatch file may have a fileMatchPattern`);
  }

  const patches = Object.hasOwn(ADAPTER_PATCHES, stem) ? ADAPTER_PATCHES[stem] : [];
  const patched = applyPatches(doc.body, patches, sourcePath);
  const { text: body, count } = rewriteSteeringReferences(patched, known);
  const installedName = steeringName(stem);
  const cleanDescription = description === undefined ? undefined : description.trim();

  return {
    stem,
    name: installedName,
    dest: steeringDest(stem),
    content: writeSteering({
      inclusion: mode,
      name: mode === 'always' ? installedName : undefined,
      description: cleanDescription,
      patterns: patterns ?? undefined,
      body,
    }),
    inclusion: mode,
    patterns,
    description: cleanDescription ?? null,
    references: count,
    patched: patches.length > 0,
  };
}
