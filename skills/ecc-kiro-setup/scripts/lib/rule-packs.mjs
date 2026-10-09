// Language rule packs: ECC's rules/<pack>/*.md turned into one Kiro steering file per pack.
//
// ECC's own Kiro adapter has steering for ten languages but none for these eleven packs. Each rule
// file in a pack names the file paths it applies to (`paths:` in its frontmatter). A pack becomes a
// single fileMatch steering file, loaded when a file of any of those kinds is in play, so the
// patterns are the union of the paths of its files. assets/language-globs.json can replace that
// union for a pack.
//
// Pure: text in, text out.

import { ECC_VERSION } from './constants.mjs';
import { CodedError } from './exit.mjs';
import { FrontmatterError, parseFrontmatter } from './frontmatter.mjs';
import { compareStrings } from './paths.mjs';
import { HARNESS_STEM, globProblem, steeringDest, steeringName, writeSteering } from './steering.mjs';

/** The packs this build turns into steering, and how their rules are described. */
export const PACKS = Object.freeze({
  angular: 'Angular',
  arkts: 'HarmonyOS ArkTS',
  csharp: 'C#',
  dart: 'Dart and Flutter',
  fsharp: 'F#',
  nuxt: 'Nuxt',
  perl: 'Perl',
  react: 'React',
  'react-native': 'React Native and Expo',
  vue: 'Vue',
  web: 'Web frontend',
});

export const LANGUAGE_GLOBS_SCHEMA = 'ecc-kiro.language-globs.v1';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Stem of the steering file of a pack: `react` becomes `react-rules`, installed as `ecc-react-rules.md`. */
export const packStem = (pack) => `${pack}-rules`;

// ---- the override file --------------------------------------------------------------

/**
 * Check the contents of assets/language-globs.json.
 * @param {unknown} value
 * @returns {{ code: string, message: string }[]} empty when the file is fine
 */
export function validateLanguageGlobs(value) {
  const problems = [];
  const bad = (message) => problems.push({ code: 'language-globs-invalid', message });
  if (!isObject(value)) {
    bad('the file must be a JSON object');
    return problems;
  }
  if (value.schema !== LANGUAGE_GLOBS_SCHEMA) bad(`unsupported schema ${JSON.stringify(value.schema ?? null)}; expected ${LANGUAGE_GLOBS_SCHEMA}`);
  if (!isObject(value.packs)) {
    bad('"packs" must be an object that maps a pack name to a list of globs');
    return problems;
  }
  for (const [pack, globs] of Object.entries(value.packs)) {
    if (!Object.hasOwn(PACKS, pack)) {
      bad(`"${pack}" is not a pack this build knows (${Object.keys(PACKS).join(', ')})`);
      continue;
    }
    if (!Array.isArray(globs) || globs.length === 0) {
      bad(`"${pack}" needs a non-empty list of globs`);
      continue;
    }
    for (const glob of globs) {
      const why = globProblem(glob);
      if (why !== null) bad(`"${pack}": the pattern ${JSON.stringify(glob)} ${why}`);
    }
  }
  return problems;
}

// ---- reading a rule file ---------------------------------------------------------------

/** Trim blank lines at both ends and end with one line break. */
const tidy = (text) => `${text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')}\n`;

/**
 * Split a rule file into the globs of its `paths:` list and its body.
 * @returns {{ paths: string[], body: string }}
 */
export function parseRuleFile({ path: sourcePath, text }) {
  let doc;
  try {
    doc = parseFrontmatter(text);
  } catch (error) {
    if (error instanceof FrontmatterError) throw new CodedError('rule-frontmatter', `${sourcePath}: ${error.message}`);
    throw error;
  }
  if (!doc.hasFrontmatter) throw new CodedError('rule-paths', `${sourcePath}: the rule has no frontmatter, so it names no file paths`);
  const unknown = Object.keys(doc.data).filter((key) => key !== 'paths');
  if (unknown.length > 0) {
    throw new CodedError('rule-key-unknown', `${sourcePath}: unexpected frontmatter key(s): ${unknown.join(', ')}`, {
      fix: 'Decide what the key means in Kiro, then teach lib/rule-packs.mjs about it.',
    });
  }
  const { paths } = doc.data;
  if (!Array.isArray(paths) || paths.length === 0) throw new CodedError('rule-paths', `${sourcePath}: "paths" must be a non-empty list of globs`);
  for (const glob of paths) {
    const why = globProblem(glob);
    if (why !== null) throw new CodedError('rule-paths', `${sourcePath}: the path ${JSON.stringify(glob)} ${why}`);
  }
  return { paths: [...paths], body: tidy(doc.body) };
}

// ---- links --------------------------------------------------------------------------------

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_LINK = /\[([^\]\n]*)\]\(([^)\s]*)\)/g;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Each line of a text, and whether it is part of a fenced code block (the fence lines count as code). */
function classifyLines(text) {
  let fence = null;
  return text.split('\n').map((line) => {
    const open = FENCE_OPEN.exec(line);
    if (fence !== null) {
      if (open !== null && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = null;
      return { line, code: true };
    }
    if (open !== null) {
      fence = open[1];
      return { line, code: true };
    }
    return { line, code: false };
  });
}

/** Run `fn` on each line that is not inside a fenced code block. */
const mapOutsideFences = (text, fn) => classifyLines(text).map(({ line, code }) => (code ? line : fn(line))).join('\n');

/** GitHub-style anchor for a heading: `React Hooks` becomes `#react-hooks`. */
const anchorOf = (heading) => `#${heading.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/ /g, '-')}`;

/** The anchor of the first level-one heading of a body, or null. */
function firstHeadingAnchor(body) {
  for (const { line, code } of classifyLines(body)) {
    const match = code ? null : /^# +(.+?) *$/.exec(line);
    if (match !== null) return anchorOf(match[1]);
  }
  return null;
}

/**
 * Make the relative links of a rule file point at files that exist in the install.
 *
 * ECC's rule files link to their siblings and to the common rules with paths such as
 * `../common/security.md`. In the install:
 * - `../common/<x>.md` and `../typescript/<x>.md` are the steering files `ecc-<x>` and
 *   `ecc-typescript-<x>`, when the adapter has them;
 * - `../common/hooks.md` is about Claude Code hooks; `ecc-kiro-harness` maps those to Kiro;
 * - a link to a file that is not installed becomes plain text;
 * - a sibling in the same pack is a section of the same file, so it links to the heading;
 * - a skill link points at the installed skill folder.
 * Links inside code blocks and code spans are left alone. A relative link this does not
 * recognize stops the conversion, so a new kind of link cannot slip through as a dead one.
 *
 * @param {string} text
 * @param {object} context
 * @param {string} context.where the file, for messages
 * @param {ReadonlySet<string>} context.steering stems of the adapter steering files that get installed
 * @param {ReadonlySet<string>} context.skills names of the skills that get installed
 * @param {ReadonlyMap<string, string>} context.siblings file name in the pack -> anchor of its heading
 * @returns {{ text: string, mapped: number, unlinked: number }}
 */
export function rewriteRuleLinks(text, { where, steering, skills, siblings }) {
  let mapped = 0;
  let unlinked = 0;

  const resolve = (label, target) => {
    const skill = /^\.\.\/\.\.\/skills\/([a-z0-9][a-z0-9-]*)\/SKILL\.md$/.exec(target);
    if (skill !== null) {
      if (skills.has(skill[1])) {
        mapped += 1;
        return `[${label}](../skills/${skill[1]}/SKILL.md)`;
      }
      unlinked += 1;
      return label;
    }

    const other = /^\.\.\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\.md$/.exec(target);
    if (other !== null) {
      const [, dir, name] = other;
      const stem = dir === 'common' ? name : `${dir}-${name}`;
      // A label that is a file name (`common/security.md`) names a file that no longer exists; other labels stay.
      const link = (to) => {
        mapped += 1;
        return `[${label.endsWith('.md') ? steeringName(to) : label}](${steeringName(to)}.md)`;
      };
      if (steering.has(stem)) return link(stem);
      if (dir === 'common' && name === 'hooks') return link(HARNESS_STEM);
      unlinked += 1;
      return label;
    }

    const sibling = /^(?:\.\/)?([a-z0-9][a-z0-9-]*\.md)$/.exec(target);
    if (sibling !== null && siblings.has(sibling[1])) {
      mapped += 1;
      return `[${label}](${siblings.get(sibling[1])})`;
    }
    throw new CodedError('rule-link-unknown', `${where}: cannot place the link to ${JSON.stringify(target)}`, {
      fix: 'Teach rewriteRuleLinks in lib/rule-packs.mjs about this kind of link.',
    });
  };

  const rewriteLine = (line) => {
    if (!line.includes('](')) return line;
    const spans = [...line.matchAll(/`[^`]*`/g)].map((match) => [match.index, match.index + match[0].length]);
    return line.replace(INLINE_LINK, (whole, label, target, offset) => {
      if (target === '' || target.startsWith('#') || HAS_SCHEME.test(target)) return whole;
      if (spans.some(([from, to]) => offset >= from && offset < to)) return whole;
      return resolve(label, target);
    });
  };

  return { text: mapOutsideFences(text, rewriteLine), mapped, unlinked };
}

// ---- building a pack -------------------------------------------------------------------------

/** Patterns of several files, each once, in the order first seen. */
export function unionGlobs(lists) {
  const seen = [];
  for (const list of lists) for (const glob of list) if (!seen.includes(glob)) seen.push(glob);
  return seen;
}

const topicOf = (file) => file.replace(/\.md$/, '').replaceAll('-', ' ');

// The hooks sections of the packs say where Claude Code reads its hooks. Followed literally in Kiro,
// that sends the agent to write into another tool's settings file, so the sentence names Kiro's place.
const CLAUDE_HOOKS_LOCATION = /Configure in `~\/\.claude\/settings\.json`:/g;
const KIRO_HOOKS_LOCATION = 'Configure as Kiro hooks (`.kiro/hooks/*.json`):';

const CLAUDE_HOOK_WORDING = /PostToolUse|PreToolUse|~\/\.claude|\$CLAUDE_/;

/**
 * One fileMatch steering file for a pack.
 * @param {object} input
 * @param {string} input.pack folder name, a key of PACKS
 * @param {{ path: string, file: string, text: string }[]} input.files the pack's rule files
 * @param {string[]} [input.override] globs from assets/language-globs.json; replace the derived ones
 * @param {ReadonlySet<string>} input.steering see rewriteRuleLinks
 * @param {ReadonlySet<string>} input.skills see rewriteRuleLinks
 */
export function buildRulePack({ pack, files, override, steering, skills }) {
  if (!Object.hasOwn(PACKS, pack)) throw new TypeError(`unknown pack ${JSON.stringify(pack)}`);
  if (files.length === 0) throw new CodedError('pack-empty', `rules/${pack}: the pack has no rule files`);
  const label = PACKS[pack];

  const parsed = [...files]
    .sort((a, b) => compareStrings(a.file, b.file))
    .map((file) => ({ ...file, ...parseRuleFile(file) }));
  const siblings = new Map(parsed.flatMap((file) => {
    const anchor = firstHeadingAnchor(file.body);
    return anchor === null ? [] : [[file.file, anchor]];
  }));

  let mapped = 0;
  let unlinked = 0;
  const sections = parsed.map((file) => {
    const linked = rewriteRuleLinks(file.body.replace(CLAUDE_HOOKS_LOCATION, KIRO_HOOKS_LOCATION), { where: file.path, steering, skills, siblings });
    mapped += linked.mapped;
    unlinked += linked.unlinked;
    return linked.text;
  });

  const derived = unionGlobs(parsed.map((file) => file.paths));
  const patterns = override ?? derived;
  const topics = parsed.map((file) => topicOf(file.file));
  const joined = sections.join('\n');
  const hookNote = CLAUDE_HOOK_WORDING.test(joined)
    ? ` The hook examples use Claude Code names; ${steeringName(HARNESS_STEM)} explains how they map to Kiro hooks.`
    : '';
  const intro = `> ECC rules for ${label} (${topics.join(', ')}), from rules/${pack}/ in ECC v${ECC_VERSION}.${hookNote}`;
  const stem = packStem(pack);

  return {
    pack,
    stem,
    name: steeringName(stem),
    dest: steeringDest(stem),
    content: writeSteering({
      inclusion: 'fileMatch',
      patterns,
      description: `${label} rules from ECC: ${topics.join(', ')}`,
      body: `\n${intro}\n\n${joined}`,
    }),
    inclusion: 'fileMatch',
    patterns,
    derivedPatterns: derived,
    overridden: override !== undefined,
    files: parsed.length,
    sources: parsed.map((file) => file.path),
    linksMapped: mapped,
    linksUnlinked: unlinked,
  };
}
