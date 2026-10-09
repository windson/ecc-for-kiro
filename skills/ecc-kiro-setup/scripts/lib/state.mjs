// The install state (which files ECC owns in a project) and the ownership rules.
//
// Everything here is pure. The file system is reached through io/apply.mjs, which hands this
// module what it found on disk.
//
// Ownership, for every file the installer might touch:
//
//   at the destination                     install / update                  uninstall
//   nothing                                create                            n/a
//   ECC-owned, unchanged since install     update if the content changed     remove
//   ECC-owned, edited since install        keep and report                   keep and report
//   not ECC-owned (the user's)             skip and report a conflict        leave alone

import {
  ECC_COMMIT,
  ECC_REPO_URL,
  ECC_TAG,
  ECC_VERSION,
  KIROIGNORE_CATEGORY,
  KIROIGNORE_FILE,
  PROFILE_ID,
  SKILL_NAME,
  SKILL_VERSION,
  STATE_RELATIVE_PATH,
  STATE_SCHEMA,
} from './constants.mjs';
import { CodedError } from './exit.mjs';
import { formatFlow } from './frontmatter.mjs';
import { SHA256_PATTERN } from './hash.mjs';
import { compareStrings, isSafeRelativePath } from './paths.mjs';

export const MODES = Object.freeze(['install', 'update', 'uninstall']);

/** Everything that can happen to one file. */
export const ACTIONS = Object.freeze(['create', 'update', 'unchanged', 'keep-modified', 'skip-conflict', 'remove', 'stale', 'forget']);

const CATEGORY = /^[a-z][a-z0-9-]*$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// ---- which paths the installer may ever write or delete ----------------------

/** Kiro refuses agent writes here outright, and so does this tool. */
const DENIED = ['.kiro/settings'];

/** This skill's own folder. It is not ECC's, so no run ever writes or deletes anything in it. */
const SKILL_FOLDER = `.kiro/skills/${SKILL_NAME}`;

/** Kiro always asks before the agent writes to these, so the installer writes them itself after one confirmation. */
export const KIRO_ASK_PATHS = Object.freeze([
  { path: '.kiro/agents', kind: 'directory' },
  { path: '.kiro/hooks', kind: 'directory' },
  { path: '.kiro/workflows', kind: 'directory' },
  { path: '.kiro/powers', kind: 'directory' },
  { path: KIROIGNORE_FILE, kind: 'file' },
]);

const under = (dest, prefix) => dest === prefix || dest.startsWith(`${prefix}/`);

/**
 * Why the installer must not write or delete this path, or null when it may.
 * Paths from a profile or a state file are data, so this runs on every one of them.
 */
export function managedPathProblem(dest) {
  if (!isSafeRelativePath(dest)) return 'is not a safe relative path';
  if (DENIED.some((prefix) => under(dest, prefix))) return 'is under .kiro/settings, which Kiro never lets the agent change';
  if (under(dest, SKILL_FOLDER)) return `is in the ${SKILL_NAME} skill itself, which no install, update or uninstall touches`;
  if (dest === STATE_RELATIVE_PATH) return 'is the install state file, which the installer manages itself';
  if (dest === KIROIGNORE_FILE || dest.startsWith('.kiro/')) return null;
  return 'is outside .kiro (only files inside .kiro/ and .kiroignore may be managed)';
}

/** The always-ask paths this set of changes will touch, with the number of files in each. */
export function protectedPaths(dests) {
  const found = [];
  for (const { path: prefix, kind } of KIRO_ASK_PATHS) {
    const files = dests.filter((dest) => under(dest, prefix)).length;
    if (files > 0) found.push({ path: prefix, kind, files });
  }
  return found;
}

// ---- the state file -----------------------------------------------------------

/** @typedef {{ path: string, category: string, source: string | string[] | null, sha256: string }} OwnedFile */

/**
 * A fresh state object.
 * @param {{ now: Date }} input
 */
export function emptyState({ now }) {
  const stamp = now.toISOString();
  return {
    schema: STATE_SCHEMA,
    tool: { name: SKILL_NAME, version: SKILL_VERSION },
    source: { repo: ECC_REPO_URL, version: ECC_VERSION, tag: ECC_TAG, commit: ECC_COMMIT },
    profile: { id: PROFILE_ID },
    status: 'complete',
    installedAt: stamp,
    updatedAt: stamp,
    dirs: [],
    files: [],
  };
}

/**
 * Read and check a state file. A state file lives in the project, so anything it says is treated as hostile.
 * @param {string} text
 */
export function parseState(text, where = STATE_RELATIVE_PATH) {
  const fail = (message) => {
    throw new CodedError('state-invalid', `${where}: ${message}`, {
      fix: `Fix or delete ${where}. Deleting it makes every ECC file look like your own, so later runs report conflicts.`,
    });
  };
  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    return fail(`not valid JSON (${error.message})`);
  }
  if (!isObject(state)) return fail('must be a JSON object');
  if (state.schema !== STATE_SCHEMA) return fail(`unsupported schema ${JSON.stringify(state.schema ?? null)}; expected ${STATE_SCHEMA}`);
  for (const key of ['installedAt', 'updatedAt']) {
    if (typeof state[key] !== 'string' || !ISO_TIME.test(state[key])) fail(`${key} must be an ISO timestamp`);
  }
  if (state.status !== 'complete' && state.status !== 'partial') fail('status must be "complete" or "partial"');
  if (!isObject(state.tool) || !isObject(state.source) || !isObject(state.profile)) fail('tool, source and profile must be objects');
  if (typeof state.source.commit !== 'string' || typeof state.source.version !== 'string') fail('source needs a version and a commit');
  if (typeof state.profile.id !== 'string') fail('profile needs an id');

  if (!Array.isArray(state.dirs)) fail('dirs must be a list');
  for (const dir of state.dirs) {
    if (!isSafeRelativePath(dir) || !(dir === '.kiro' || dir.startsWith('.kiro/'))) fail(`dirs contains an unsafe path ${JSON.stringify(dir)}`);
    if (under(dir, SKILL_FOLDER)) fail(`dirs contains ${JSON.stringify(dir)}, which is in the ${SKILL_NAME} skill itself`);
  }
  if (!Array.isArray(state.files)) fail('files must be a list');
  const seen = new Set();
  for (const [index, entry] of state.files.entries()) {
    if (!isObject(entry)) fail(`files[${index}] must be an object`);
    const problem = managedPathProblem(entry.path);
    if (problem) fail(`files[${index}] ${JSON.stringify(entry.path)} ${problem}`);
    if (seen.has(entry.path)) fail(`files lists ${entry.path} twice`);
    seen.add(entry.path);
    if (typeof entry.category !== 'string' || !CATEGORY.test(entry.category)) fail(`${entry.path}: invalid category`);
    if (typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) fail(`${entry.path}: sha256 must be 64 lowercase hex characters`);
    const src = entry.source;
    const sourceOk = src === null || typeof src === 'string' || (Array.isArray(src) && src.every((item) => typeof item === 'string'));
    if (!sourceOk) fail(`${entry.path}: invalid source`);
    // .kiroignore is shared with the user, so it is tracked as its managed block and as nothing else: an entry that
    // called it a plain file would have an uninstall delete the whole file.
    if ((entry.path === KIROIGNORE_FILE) !== (entry.category === KIROIGNORE_CATEGORY)) {
      fail(`${entry.path}: the category "${KIROIGNORE_CATEGORY}" belongs to ${KIROIGNORE_FILE} and to nothing else`);
    }
    // Only the .kiroignore block can say that the installer created the whole file.
    if (Object.hasOwn(entry, 'createdFile') && (entry.createdFile !== true || entry.category !== KIROIGNORE_CATEGORY)) {
      fail(`${entry.path}: "createdFile" is only valid as true on the ${KIROIGNORE_FILE} block`);
    }
  }
  return state;
}

/** Stable text form: one line per header field, one line per file. */
export function formatState(state) {
  const field = (key) => `  ${JSON.stringify(key)}: ${formatFlow(state[key])}`;
  const list = (key) => {
    const items = state[key];
    if (items.length === 0) return `  ${JSON.stringify(key)}: []`;
    return `  ${JSON.stringify(key)}: [\n${items.map((item) => `    ${formatFlow(item)}`).join(',\n')}\n  ]`;
  };
  const parts = ['schema', 'tool', 'source', 'profile', 'status', 'installedAt', 'updatedAt'].map(field);
  parts.push(list('dirs'), list('files'));
  return `{\n${parts.join(',\n')}\n}\n`;
}

/**
 * The state after a run.
 * @param {object} input
 * @param {any | null} input.previous state before the run, if any
 * @param {Map<string, OwnedFile>} input.files owned files after the run
 * @param {Set<string>} input.dirs directories the installer created
 * @param {'complete' | 'partial'} input.status
 * @param {Date} input.now
 * @param {boolean} input.changed whether this run changed anything on disk
 */
export function buildState({ previous, files, dirs, status, now, changed }) {
  const base = previous ?? emptyState({ now });
  return {
    ...base,
    tool: { name: SKILL_NAME, version: SKILL_VERSION },
    source: { repo: ECC_REPO_URL, version: ECC_VERSION, tag: ECC_TAG, commit: ECC_COMMIT },
    profile: { id: PROFILE_ID },
    status,
    updatedAt: changed || previous === null || previous.status !== status ? now.toISOString() : previous.updatedAt,
    dirs: [...dirs].sort(compareStrings),
    files: [...files.values()].sort((a, b) => compareStrings(a.path, b.path)),
  };
}

// ---- deciding what to do with each file --------------------------------------

/** @typedef {{ kind: 'missing' } | { kind: 'file', sha256: string } | { kind: 'other', detail: string }} DiskEntry */

/**
 * @typedef {object} Decision
 * @property {string} dest
 * @property {string} category
 * @property {string} part
 * @property {string} action one of ACTIONS
 * @property {string} reason
 * @property {object | null} write the planned file to write, or null
 * @property {boolean} remove whether to delete the file
 * @property {OwnedFile | null} record the state entry for this path after the run; null means "not owned"
 * @property {boolean} [updateAvailable] for keep-modified: the installer has a newer version it did not apply
 */

/** The state entry for a planned file. `entry` is the previous one: `createdFile` of the .kiroignore block carries over. */
const recordOf = (file, entry) => ({
  path: file.dest,
  category: file.category,
  source: file.source ?? null,
  sha256: file.sha256,
  ...(entry?.createdFile === true ? { createdFile: true } : {}),
});

/** What a path holds: a file, or the managed block of .kiroignore. */
const nounOf = (item) => (item.category === KIROIGNORE_CATEGORY ? 'block' : 'file');

const decision = (base, action, reason, rest = {}) => ({
  dest: base.dest,
  category: base.category,
  part: base.part,
  action,
  reason,
  write: null,
  remove: false,
  record: null,
  ...rest,
});

function decidePlanned({ file, entry, here, disk, owned }) {
  const base = { dest: file.dest, category: file.category, part: file.part };
  const keep = entry ?? null;
  const noun = nounOf(base);

  if (here.kind === 'other') return decision(base, 'skip-conflict', `${here.detail}; left alone`, { record: keep });

  // A folder that belongs to someone else (its main file is not ours) gets none of our files.
  if (file.anchor && file.anchor !== file.dest && (disk.get(file.anchor)?.kind ?? 'missing') !== 'missing' && !owned.has(file.anchor)) {
    return decision(base, 'skip-conflict', `${file.anchor} is not an ECC file, so this folder belongs to something else; left alone`, { record: keep });
  }

  const blocker = (file.blockedBy ?? []).find((other) => (disk.get(other)?.kind ?? 'missing') !== 'missing');
  if (here.kind === 'missing') {
    if (blocker) return decision(base, 'skip-conflict', `${blocker} already defines the same name, so Kiro would see two; left alone`, { record: keep });
    const reason = entry ? `restored: the ${noun} was deleted after the install` : `new ${noun}`;
    return decision(base, 'create', reason, { write: file, record: recordOf(file) });
  }

  if (!entry) return decision(base, 'skip-conflict', 'already exists and was not installed by ECC; left alone');

  if (here.sha256 === entry.sha256) {
    if (file.sha256 === entry.sha256) return decision(base, 'unchanged', 'up to date', { record: recordOf(file, entry) });
    return decision(base, 'update', 'new version', { write: file, record: recordOf(file, entry) });
  }
  if (here.sha256 === file.sha256) return decision(base, 'unchanged', 'your edit matches the new version', { record: recordOf(file, entry) });
  return decision(base, 'keep-modified', 'edited after the install; your version was kept', {
    record: entry,
    updateAvailable: file.sha256 !== entry.sha256,
  });
}

function decideUnplanned({ mode, entry, here }) {
  const base = { dest: entry.path, category: entry.category, part: null };
  if (here.kind === 'missing') return decision(base, 'forget', 'already deleted');
  const untouched = here.kind === 'file' && here.sha256 === entry.sha256;
  if (mode === 'install') {
    return untouched
      ? decision(base, 'stale', 'no longer part of the install; "update" removes it', { record: entry })
      : decision(base, 'keep-modified', 'no longer part of the install, and edited since; kept', { record: entry });
  }
  if (untouched) return decision(base, 'remove', mode === 'uninstall' ? 'installed by ECC' : 'no longer part of the install', { remove: true });
  return decision(base, 'keep-modified', here.kind === 'file' ? 'edited after the install; kept and no longer tracked' : `${here.detail}; kept and no longer tracked`);
}

/**
 * Decide what happens to every file.
 * @param {object} input
 * @param {'install' | 'update' | 'uninstall'} input.mode
 * @param {{ dest: string, category: string, part: string, source?: any, sha256: string, blockedBy?: string[], anchor?: string }[]} input.planned
 * @param {{ files: OwnedFile[] } | null} input.state the current install state, if any
 * @param {Map<string, DiskEntry>} input.disk what is on disk for every planned and owned path
 * @param {Set<string>} input.scope categories this run is responsible for; owned files of other categories are not touched
 * @returns {Decision[]} sorted by path
 */
export function reconcile({ mode, planned, state, disk, scope }) {
  if (!MODES.includes(mode)) throw new TypeError(`unknown mode ${JSON.stringify(mode)}`);
  const owned = new Map((state?.files ?? []).map((entry) => [entry.path, entry]));
  const look = (dest) => disk.get(dest) ?? { kind: 'missing' };

  const plannedByDest = new Map();
  for (const file of planned) {
    if (plannedByDest.has(file.dest)) throw new Error(`two planned files share the destination ${file.dest}`);
    plannedByDest.set(file.dest, file);
  }

  const decisions = [];
  for (const file of plannedByDest.values()) {
    decisions.push(decidePlanned({ file, entry: owned.get(file.dest), here: look(file.dest), disk, owned }));
  }
  for (const entry of owned.values()) {
    if (plannedByDest.has(entry.path) || !scope.has(entry.category)) continue;
    decisions.push(decideUnplanned({ mode, entry, here: look(entry.path) }));
  }
  return decisions.sort((a, b) => compareStrings(a.dest, b.dest));
}

/** Count decisions by action. Keys use camelCase so they read well in JSON. */
export function countActions(decisions) {
  const counts = { create: 0, update: 0, unchanged: 0, keepModified: 0, conflict: 0, remove: 0, stale: 0, forget: 0 };
  const names = { 'keep-modified': 'keepModified', 'skip-conflict': 'conflict' };
  for (const item of decisions) counts[names[item.action] ?? item.action] += 1;
  return counts;
}

/** Whether applying these decisions changes anything on disk. */
export const changesDisk = (decisions) => decisions.some((item) => item.write !== null || item.remove);
