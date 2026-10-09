// The install profile: which files of the pinned ECC release make up an install, and the
// SHA-256 of each. Everything here is pure; file and git access live in io/source.mjs.

import { ECC_COMMIT, ECC_REPO_URL, ECC_TAG, ECC_VERSION, PROFILE_ID, PROFILE_SCHEMA } from './constants.mjs';
import { formatFlow } from './frontmatter.mjs';
import { SHA256_PATTERN } from './hash.mjs';
import { compareStrings, isSafeRelativePath } from './paths.mjs';

/** Category order is also the sort order of profile entries. */
export const CATEGORIES = Object.freeze([
  'agent',
  'skill',
  'command',
  'rule',
  'agents-md',
  'mcp-catalog',
  'script',
  'adapter-steering',
  'adapter-hook',
  'adapter-script',
  'adapter-mcp-example',
  'license',
]);

/** Extra fields each category carries besides `category`, `path` and `sha256`, in output order. */
const FIELDS = Object.freeze({
  agent: ['name'],
  skill: ['skill', 'rel'],
  command: ['name'],
  rule: ['pack', 'file'],
  'agents-md': [],
  'mcp-catalog': [],
  script: ['name'],
  'adapter-steering': ['name'],
  'adapter-hook': ['name'],
  'adapter-script': ['name'],
  'adapter-mcp-example': [],
  license: [],
});

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const FIELD_CHECKS = {
  name: (v) => NAME.test(v),
  skill: (v) => SLUG.test(v),
  rel: (v) => isSafeRelativePath(v),
  pack: (v) => v === '' || SLUG.test(v),
  file: (v) => NAME.test(v),
};

/** Where the Kiro adapter that ships inside the ECC repo keeps the files we reuse. */
export const ADAPTER_PREFIXES = Object.freeze(['.kiro/steering', '.kiro/hooks', '.kiro/scripts', '.kiro/settings']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stripSuffix = (text, suffix) => (text.endsWith(suffix) && text.length > suffix.length ? text.slice(0, -suffix.length) : null);

/**
 * Decide what a path in the ECC repository is.
 * @param {string} rel repo-relative path with forward slashes
 * @returns {{ category: string, fields: Record<string, string> } | { excluded: string } | null}
 *   null means "not a file this build knows how to place"
 */
export function classifyPath(rel) {
  const parts = rel.split('/');
  const [first] = parts;
  const place = (category, fields = {}) => ({ category, fields });

  if (first === '.pi') return { excluded: 'pi-adapter' };
  if (first === '.kimi') return { excluded: 'kimi-adapter' };
  if (rel === '.mcp.json') return { excluded: 'kimi-mcp-config' };

  if (rel === 'LICENSE') return place('license');
  if (rel === 'AGENTS.md') return place('agents-md');
  if (rel === 'mcp-configs/mcp-servers.json') return place('mcp-catalog');

  if (first === 'agents' && parts.length === 2) {
    const name = stripSuffix(parts[1], '.md');
    return name === null ? null : place('agent', { name });
  }
  if (first === 'commands' && parts.length === 2) {
    const name = stripSuffix(parts[1], '.md');
    return name === null ? null : place('command', { name });
  }
  if (first === 'rules' && (parts.length === 2 || parts.length === 3)) {
    return parts.length === 2 ? place('rule', { pack: '', file: parts[1] }) : place('rule', { pack: parts[1], file: parts[2] });
  }
  if (first === 'scripts' && parts.length === 2) return place('script', { name: parts[1] });

  const skillPrefix = first === 'skills' ? 1 : first === '.agents' && parts[1] === 'skills' ? 2 : 0;
  if (skillPrefix > 0 && parts.length >= skillPrefix + 2) {
    const skill = parts[skillPrefix];
    const inner = parts.slice(skillPrefix + 1).join('/');
    if (inner === 'agents/openai.yaml') return { excluded: 'codex-metadata' };
    return place('skill', { skill, rel: inner });
  }

  if (first === '.kiro' && parts.length === 3) {
    const [, dir, file] = parts;
    if (dir === 'steering') {
      const name = stripSuffix(file, '.md');
      return name === null ? null : place('adapter-steering', { name });
    }
    if (dir === 'hooks') {
      const name = stripSuffix(file, '.kiro.hook');
      return name === null ? null : place('adapter-hook', { name });
    }
    if (dir === 'scripts') {
      const name = stripSuffix(file, '.sh');
      return name === null ? null : place('adapter-script', { name });
    }
    if (dir === 'settings' && file === 'mcp.json.example') return place('adapter-mcp-example');
  }
  return null;
}

const categoryIndex = (category) => CATEGORIES.indexOf(category);
const byCategoryThenPath = (a, b) => categoryIndex(a.category) - categoryIndex(b.category) || compareStrings(a.path, b.path);

/** Entry count per category, plus the number of distinct skills. */
export function countEntries(entries) {
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  for (const entry of entries) counts[entry.category] += 1;
  counts.skillDirs = new Set(entries.filter((entry) => entry.category === 'skill').map((entry) => entry.skill)).size;
  return counts;
}

const PROFILE_DESCRIPTION =
  'ECC 2.2.3 as installed for Kimi Code (agents, skills, commands, rules, AGENTS.md, MCP catalog), ' +
  "plus the Kiro adapter files ECC ships (steering, hooks, scripts, MCP example), the license, " +
  'and the extra files listed in "extras", each with the reason it was added. Codex and Pi metadata is left out.';

// ---- the extra entries -------------------------------------------------------------------------------

export const EXTRAS_SCHEMA = 'ecc-kiro.profile-extras.v1';
const EXTRAS_KEYS = Object.freeze(['schema', 'description', 'entries']);
const EXTRA_KEYS = Object.freeze(['path', 'reason']);

/**
 * Check the contents of assets/profiles/extras-<version>.json: files of the pinned ECC release that the
 * Kimi install did not have and that this tool installs anyway. Each one says why.
 * @returns {{ code: string, message: string, path?: string }[]} empty when the file is fine
 */
export function validateExtras(value) {
  const problems = [];
  const bad = (message, path) => problems.push({ code: 'extras-invalid', message, ...(path ? { path } : {}) });
  if (!isObject(value)) return [{ code: 'extras-invalid', message: 'the extras file must be a JSON object' }];
  if (value.schema !== EXTRAS_SCHEMA) bad(`expected schema ${EXTRAS_SCHEMA}, found ${JSON.stringify(value.schema ?? null)}`);
  const unknown = Object.keys(value).filter((key) => !EXTRAS_KEYS.includes(key));
  if (unknown.length > 0) bad(`unexpected key(s): ${unknown.join(', ')}`);
  if (!Array.isArray(value.entries)) {
    bad('"entries" must be a list');
    return problems;
  }
  const seen = new Set();
  for (const [index, entry] of value.entries.entries()) {
    if (!isObject(entry)) {
      bad(`entries[${index}] must be an object`);
      continue;
    }
    const extra = Object.keys(entry).filter((key) => !EXTRA_KEYS.includes(key));
    if (extra.length > 0) bad(`entries[${index}]: unexpected key(s): ${extra.join(', ')}`);
    if (!isSafeRelativePath(entry.path)) {
      bad(`entries[${index}]: unsafe path ${JSON.stringify(entry.path ?? null)}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') bad(`${entry.path}: "reason" must say why the file is added`, entry.path);
    if (seen.has(entry.path)) bad(`${entry.path}: listed twice`, entry.path);
    seen.add(entry.path);
    const placed = classifyPath(entry.path);
    if (placed === null || 'excluded' in placed) bad(`${entry.path}: this build cannot place that path`, entry.path);
  }
  return problems;
}

/**
 * Build the profile from a Kimi install state.
 * @param {object} input
 * @param {any} input.kimiState parsed `ecc-install-state.json` of the Kimi install
 * @param {string[]} [input.adapterPaths] files found under the ECC repo's `.kiro/`
 * @param {Map<string, string>} input.hashes repo-relative path -> SHA-256 of the file in the pinned checkout
 * @param {{ path: string, reason: string }[]} [input.extras] files to add on top (see validateExtras); they come from the pinned checkout like the adapter files
 */
export function buildProfile({ kimiState, adapterPaths = [], hashes, extras = [] }) {
  const problems = [];
  const problem = (code, message, path) => problems.push({ code, message, ...(path ? { path } : {}) });

  if (!isObject(kimiState)) {
    problem('kimi-state', 'the Kimi install state is not a JSON object');
    return { profile: null, problems };
  }
  if (kimiState.schemaVersion !== 'ecc.install.v1') {
    problem('kimi-schema', `unexpected Kimi install schema ${JSON.stringify(kimiState.schemaVersion ?? null)}`);
  }
  if (kimiState.source?.repoVersion !== ECC_VERSION) {
    problem('kimi-version', `the Kimi install is ECC ${kimiState.source?.repoVersion ?? 'unknown'}, this build pins ${ECC_VERSION}`);
  }
  if (!Array.isArray(kimiState.operations)) {
    problem('kimi-operations', 'the Kimi install state has no operations list');
    return { profile: null, problems };
  }

  const entries = [];
  const excluded = [];
  const seenPaths = new Set();
  const seenKeys = new Set();

  const addEntry = (rel, placed, expectedSha) => {
    const actual = hashes.get(rel);
    if (actual === undefined) {
      problem('source-missing', `${rel} is not in the ECC checkout`, rel);
      return;
    }
    if (expectedSha !== undefined && actual !== expectedSha) {
      problem('hash-mismatch', `${rel}: Kimi recorded ${String(expectedSha).slice(0, 12)}, the ECC checkout has ${actual.slice(0, 12)}`, rel);
      return;
    }
    const fields = FIELDS[placed.category].map((field) => placed.fields[field]);
    const key = `${placed.category}\0${fields.join('\0')}`;
    if (seenPaths.has(rel) || seenKeys.has(key)) {
      problem('duplicate-entry', `${rel} maps to a destination another entry already uses`, rel);
      return;
    }
    seenPaths.add(rel);
    seenKeys.add(key);
    entries.push({ category: placed.category, path: rel, ...placed.fields, sha256: actual });
  };

  for (const op of kimiState.operations) {
    const rel = op?.sourceRelativePath;
    if (!isSafeRelativePath(rel)) {
      problem('kimi-path-unsafe', `the Kimi install lists an unsafe path: ${JSON.stringify(rel)}`);
      continue;
    }
    const placed = classifyPath(rel);
    if (placed === null) {
      problem('unclassified-path', `the Kimi install contains a path this build cannot place: ${rel}`, rel);
      continue;
    }
    if ('excluded' in placed) {
      excluded.push({ path: rel, reason: placed.excluded });
      continue;
    }
    if (op.kind !== 'copy-file') {
      problem('kimi-operation-kind', `${rel}: unsupported operation kind ${JSON.stringify(op.kind)}`, rel);
      continue;
    }
    if (typeof op.contentSha256 !== 'string' || !SHA256_PATTERN.test(op.contentSha256)) {
      problem('kimi-hash-invalid', `${rel}: the Kimi install has no valid SHA-256 for this file`, rel);
      continue;
    }
    addEntry(rel, placed, op.contentSha256);
  }

  const extra = [...adapterPaths, 'LICENSE'];
  for (const rel of extra) {
    if (!isSafeRelativePath(rel)) {
      problem('adapter-path-unsafe', `unsafe adapter path: ${JSON.stringify(rel)}`);
      continue;
    }
    const placed = classifyPath(rel);
    if (placed === null || 'excluded' in placed) continue;
    addEntry(rel, placed, undefined);
  }

  const addedExtras = [];
  for (const extra of extras) {
    if (seenPaths.has(extra.path)) {
      problem('extra-duplicate', `${extra.path} is already in the profile, so it cannot be added as an extra`, extra.path);
      continue;
    }
    const placed = classifyPath(extra.path);
    if (placed === null || 'excluded' in placed) {
      problem('extra-unplaceable', `${extra.path}: this build cannot place that path`, extra.path);
      continue;
    }
    addEntry(extra.path, placed, undefined);
    if (seenPaths.has(extra.path)) addedExtras.push(extra);
  }

  entries.sort(byCategoryThenPath);
  excluded.sort((a, b) => compareStrings(a.path, b.path));

  return {
    profile: {
      schema: PROFILE_SCHEMA,
      id: PROFILE_ID,
      description: PROFILE_DESCRIPTION,
      source: { repo: ECC_REPO_URL, version: ECC_VERSION, tag: ECC_TAG, commit: ECC_COMMIT },
      derivedFrom: {
        harness: 'kimi',
        installSchema: kimiState.schemaVersion ?? null,
        repoVersion: kimiState.source?.repoVersion ?? null,
        modules: Array.isArray(kimiState.resolution?.selectedModules) ? [...kimiState.resolution.selectedModules] : [],
      },
      ...(addedExtras.length > 0 ? { extras: addedExtras.map(({ path, reason }) => ({ path, reason })).sort((a, b) => compareStrings(a.path, b.path)) } : {}),
      counts: countEntries(entries),
      excluded,
      entries,
    },
    problems,
  };
}

/** Stable text form: header fields on one line each, one entry per line. */
export function formatProfile(profile) {
  const field = (key) => `  ${JSON.stringify(key)}: ${formatFlow(profile[key])}`;
  const list = (key) => {
    const items = profile[key];
    if (items.length === 0) return `  ${JSON.stringify(key)}: []`;
    return `  ${JSON.stringify(key)}: [\n${items.map((item) => `    ${formatFlow(item)}`).join(',\n')}\n  ]`;
  };
  const parts = [
    field('schema'),
    field('id'),
    field('description'),
    field('source'),
    field('derivedFrom'),
    ...(profile.extras === undefined ? [] : [list('extras')]),
    field('counts'),
    list('excluded'),
    list('entries'),
  ];
  return `{\n${parts.join(',\n')}\n}\n`;
}

/**
 * Check a loaded profile. Entries become file paths and destination names later,
 * so every one of them is checked here before anything uses it.
 * @returns {{ code: string, message: string, path?: string }[]}
 */
export function validateProfile(profile) {
  const problems = [];
  const problem = (code, message, path) => problems.push({ code, message, ...(path ? { path } : {}) });

  if (!isObject(profile)) return [{ code: 'profile-shape', message: 'the profile is not a JSON object' }];
  if (profile.schema !== PROFILE_SCHEMA) problem('profile-schema', `expected schema ${PROFILE_SCHEMA}, found ${JSON.stringify(profile.schema ?? null)}`);
  if (profile.id !== PROFILE_ID) problem('profile-id', `this build only knows the "${PROFILE_ID}" profile, found ${JSON.stringify(profile.id ?? null)}`);

  const source = profile.source;
  if (!isObject(source) || source.repo !== ECC_REPO_URL || source.version !== ECC_VERSION || source.tag !== ECC_TAG || source.commit !== ECC_COMMIT) {
    problem('profile-source', `the profile is not pinned to ECC ${ECC_TAG} (${ECC_COMMIT}), which is the only release this build installs`);
  }
  if (!Array.isArray(profile.entries)) {
    problem('profile-entries', 'the profile has no entries list');
    return problems;
  }

  const seenPaths = new Set();
  const seenKeys = new Set();
  let previous = null;
  let reportedOrder = false;

  for (const [index, entry] of profile.entries.entries()) {
    const where = `entry ${index}`;
    if (!isObject(entry)) {
      problem('entry-shape', `${where} is not an object`);
      continue;
    }
    if (!CATEGORIES.includes(entry.category)) {
      problem('entry-category', `${where}: unknown category ${JSON.stringify(entry.category ?? null)}`);
      continue;
    }
    const label = typeof entry.path === 'string' ? entry.path : where;
    if (!isSafeRelativePath(entry.path)) {
      problem('entry-path-unsafe', `${where}: unsafe path ${JSON.stringify(entry.path ?? null)}`);
      continue;
    }
    if (typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) {
      problem('entry-sha256', `${label}: sha256 must be 64 lowercase hex characters`, entry.path);
    }

    const allowed = new Set(['category', 'path', 'sha256', ...FIELDS[entry.category]]);
    const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
    if (unknown.length > 0) problem('entry-unknown-field', `${label}: unexpected field(s) ${unknown.join(', ')}`, entry.path);

    let fieldsOk = true;
    for (const name of FIELDS[entry.category]) {
      if (typeof entry[name] !== 'string' || !FIELD_CHECKS[name](entry[name])) {
        problem('entry-field', `${label}: invalid "${name}" ${JSON.stringify(entry[name] ?? null)}`, entry.path);
        fieldsOk = false;
      }
    }

    if (fieldsOk) {
      const placed = classifyPath(entry.path);
      const expected = placed && !('excluded' in placed) ? placed : null;
      const matches =
        expected !== null &&
        expected.category === entry.category &&
        FIELDS[entry.category].every((name) => expected.fields[name] === entry[name]);
      if (!matches) {
        problem('entry-inconsistent', `${label}: the path does not match its category and fields`, entry.path);
      }
      const key = `${entry.category}\0${FIELDS[entry.category].map((name) => entry[name]).join('\0')}`;
      if (seenPaths.has(entry.path) || seenKeys.has(key)) {
        problem('entry-duplicate', `${label}: duplicate entry`, entry.path);
      }
      seenPaths.add(entry.path);
      seenKeys.add(key);
    }

    if (previous !== null && !reportedOrder && byCategoryThenPath(previous, entry) >= 0) {
      problem('profile-unsorted', `${label}: entries must be sorted by category, then path`, entry.path);
      reportedOrder = true;
    }
    previous = entry;
  }

  if (problems.length === 0) {
    const expected = countEntries(profile.entries);
    const actual = isObject(profile.counts) ? profile.counts : {};
    const same =
      Object.keys(actual).length === Object.keys(expected).length &&
      Object.keys(expected).every((key) => actual[key] === expected[key]);
    if (!same) problem('profile-counts', 'the recorded counts do not match the entries');
  }

  if (profile.extras !== undefined) {
    const inEntries = new Set(profile.entries.map((entry) => entry?.path));
    if (!Array.isArray(profile.extras)) {
      problem('profile-extras', '"extras" must be a list');
    } else {
      for (const item of profile.extras) {
        const ok = isObject(item) && typeof item.path === 'string' && typeof item.reason === 'string' && item.reason.trim() !== '' && Object.keys(item).every((key) => EXTRA_KEYS.includes(key));
        if (!ok) problem('profile-extras', `invalid extras item ${JSON.stringify(item)}`);
        else if (!inEntries.has(item.path)) problem('profile-extras', `${item.path} is listed as an extra but is not an entry`, item.path);
      }
    }
  }

  if (!Array.isArray(profile.excluded)) {
    problem('profile-excluded', 'the profile has no excluded list');
  } else {
    for (const item of profile.excluded) {
      if (!isObject(item) || !isSafeRelativePath(item.path) || typeof item.reason !== 'string') {
        problem('excluded-shape', `invalid excluded item ${JSON.stringify(item)}`);
      }
    }
  }
  return problems;
}
