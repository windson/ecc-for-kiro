// Reading what is on disk, and applying a set of decisions to it.
//
// Rules this file enforces for every path it touches:
//   - it must be a path the installer may manage (lib/state.mjs: managedPathProblem);
//   - no directory on the way may be a symbolic link that leaves the project;
//   - files are replaced atomically (temp file, then rename) and never written through a link;
//   - directories are only removed when the installer created them and they are empty.

import nodeFs from 'node:fs/promises';
import path from 'node:path';

import { KIROIGNORE_FILE, STATE_RELATIVE_PATH } from '../lib/constants.mjs';
import { CodedError } from '../lib/exit.mjs';
import { sha256Hex } from '../lib/hash.mjs';
import { findBlock, withBlock, withoutBlock } from '../lib/kiroignore.mjs';
import { compareStrings, resolveInside } from '../lib/paths.mjs';
import { buildState, formatState, managedPathProblem } from '../lib/state.mjs';
import { writeFileAtomic } from './files.mjs';

const isInside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const utf8 = new TextDecoder('utf-8', { fatal: true });

// ---- reading the project ----------------------------------------------------

/**
 * .kiroignore is shared with the user, so only its managed block is "the file" here: missing when the
 * file or the block is not there, and the hash of the block text when it is.
 */
async function inspectKiroignore(root, fs) {
  const full = resolveInside(root, KIROIGNORE_FILE);
  let stat;
  try {
    stat = await fs.lstat(full);
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'missing' };
    if (error.code === 'ENOTDIR') return { kind: 'other', detail: 'a parent of this path is not a directory' };
    throw error;
  }
  if (stat.isSymbolicLink()) return { kind: 'other', detail: 'is a symbolic link' };
  if (!stat.isFile()) return { kind: 'other', detail: 'is not a regular file' };
  let text;
  try {
    text = utf8.decode(await fs.readFile(full));
  } catch {
    return { kind: 'other', detail: 'is not valid UTF-8 text' };
  }
  const { found, problem } = findBlock(text);
  if (problem !== null) return { kind: 'other', detail: problem };
  return found === null ? { kind: 'missing' } : { kind: 'file', sha256: sha256Hex(found.text) };
}

async function inspectOne(root, dest, fs) {
  if (dest === KIROIGNORE_FILE) return inspectKiroignore(root, fs);
  const full = resolveInside(root, dest);
  let stat;
  try {
    stat = await fs.lstat(full);
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'missing' };
    if (error.code === 'ENOTDIR') return { kind: 'other', detail: 'a parent of this path is not a directory' };
    throw error;
  }
  if (stat.isSymbolicLink()) return { kind: 'other', detail: 'is a symbolic link' };
  if (!stat.isFile()) return { kind: 'other', detail: 'is not a regular file' };
  return { kind: 'file', sha256: sha256Hex(await fs.readFile(full)) };
}

/**
 * What is at each path: nothing, a regular file (with its hash), or something else.
 * For .kiroignore that is its managed block (see inspectKiroignore).
 * @returns {Promise<Map<string, import('../lib/state.mjs').DiskEntry>>}
 */
export async function inspectDestinations({ root, dests, fs = nodeFs }) {
  const found = new Map();
  for (const dest of new Set(dests)) found.set(dest, await inspectOne(root, dest, fs));
  return found;
}

// ---- path safety ---------------------------------------------------------------

const unsafe = (dest, why) => new CodedError('unsafe-path', `refusing to touch ${dest}: ${why}`);

/**
 * Throw if a directory on the way to `dest` is not a plain directory inside the project.
 * Directories that do not exist yet are fine: they are created under a parent that was checked.
 */
async function assertInsideProject({ root, dest, fs }) {
  const base = path.resolve(root);
  const realRoot = await fs.realpath(base);
  let current = base;
  for (const segment of dest.split('/').slice(0, -1)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const shown = path.relative(base, current);
    if (stat.isSymbolicLink()) {
      let real;
      try {
        real = await fs.realpath(current);
      } catch {
        throw unsafe(dest, `${shown} is a symbolic link that points nowhere`);
      }
      if (!isInside(realRoot, real)) throw unsafe(dest, `${shown} is a symbolic link that leaves the project`);
    } else if (!stat.isDirectory()) {
      throw unsafe(dest, `${shown} is not a directory`);
    }
  }
}

/** Throw unless the installer may manage `dest` and nothing on its way leaves the project. */
export async function assertSafeDestination({ root, dest, fs = nodeFs }) {
  const problem = managedPathProblem(dest);
  if (problem) throw unsafe(dest, problem);
  await assertInsideProject({ root, dest, fs });
}

/** Run the safety check on every destination and collect the failures instead of throwing. */
export async function findUnsafeDestinations({ root, dests, fs = nodeFs }) {
  const problems = [];
  for (const dest of new Set(dests)) {
    try {
      await assertSafeDestination({ root, dest, fs });
    } catch (error) {
      if (!(error instanceof CodedError)) throw error;
      problems.push({ code: error.code, message: error.message, path: dest });
    }
  }
  return problems;
}

/** Directories (relative to the root, outermost first) that do not exist yet on the way to `dest`. */
async function missingAncestors(root, dest, fs) {
  const missing = [];
  let current = path.resolve(root);
  const parts = dest.split('/').slice(0, -1);
  for (const [index, segment] of parts.entries()) {
    current = path.join(current, segment);
    try {
      await fs.lstat(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(parts.slice(0, index + 1).join('/'));
    }
  }
  return missing;
}

/**
 * Remove the directories the installer created, deepest first, when they are empty.
 * @returns {Promise<Set<string>>} the directories that are still there
 */
export async function pruneEmptyDirs({ root, dirs, fs = nodeFs }) {
  const remaining = new Set(dirs);
  const ordered = [...dirs].sort((a, b) => b.split('/').length - a.split('/').length || compareStrings(a, b));
  for (const dir of ordered) {
    try {
      await fs.rmdir(resolveInside(root, dir));
      remaining.delete(dir);
    } catch (error) {
      if (error.code === 'ENOENT') remaining.delete(dir);
      else if (!['ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  return remaining;
}

// ---- the managed block of .kiroignore ----------------------------------------

/** The text and permission bits of .kiroignore, or null when there is no such file. */
async function readKiroignore(root, fs) {
  const full = resolveInside(root, KIROIGNORE_FILE);
  let stat;
  try {
    stat = await fs.lstat(full);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile()) throw unsafe(KIROIGNORE_FILE, 'is not a regular file');
  try {
    return { text: utf8.decode(await fs.readFile(full)), mode: stat.mode & 0o777 };
  } catch {
    throw unsafe(KIROIGNORE_FILE, 'is not valid UTF-8 text');
  }
}

/** Put the block into .kiroignore, next to whatever the user has there. Returns whether the file is new. */
async function writeKiroignoreBlock({ root, block, fs }) {
  const current = await readKiroignore(root, fs);
  const text = withBlock(current?.text ?? '', block);
  await writeFileAtomic(fs, resolveInside(root, KIROIGNORE_FILE), text, current === null ? {} : { mode: current.mode });
  return current === null;
}

/** Take the block out of .kiroignore. A file the installer created is deleted when nothing else is left in it. */
async function removeKiroignoreBlock({ root, createdFile, fs }) {
  const current = await readKiroignore(root, fs);
  if (current === null) return;
  const text = withoutBlock(current.text);
  if (createdFile && text.trim() === '') await fs.rm(resolveInside(root, KIROIGNORE_FILE), { force: true });
  else if (text !== current.text) await writeFileAtomic(fs, resolveInside(root, KIROIGNORE_FILE), text, { mode: current.mode });
}

// ---- applying decisions -----------------------------------------------------

/** The block goes last in its group, so a run that stops early has not touched .kiroignore yet. */
const blockLast = (a, b) => Number(a.dest === KIROIGNORE_FILE) - Number(b.dest === KIROIGNORE_FILE);

/**
 * Apply decisions to the project and keep the install state in step.
 *
 * Decisions run part by part. After a part that changed files, and again at the end, the state
 * file is written, so a failure leaves a state that lists exactly the files that were written.
 * Nothing is retried, and nothing is rolled back.
 *
 * An uninstall that leaves no file tracked ends by deleting the state file, then the folders the
 * installer created, if they are empty. An uninstall of some parts keeps the state of the others.
 *
 * @param {object} input
 * @param {string} input.root
 * @param {import('../lib/state.mjs').Decision[]} input.decisions
 * @param {any | null} input.previous the state read before the run, or null
 * @param {string[]} input.parts part names in the order they run; decisions without a part run last
 * @param {'install' | 'update' | 'uninstall'} input.mode
 * @param {Date} input.now
 * @param {any} [input.fs]
 * @returns {Promise<{ state: any, written: number, removed: number, stateWritten: boolean, stateRemoved: boolean, failure: null | { dest: string | null, code: string, message: string } }>}
 */
export async function applyDecisions({ root, decisions, previous, parts, mode, now, fs = nodeFs }) {
  const known = new Set([...parts, null]);
  const stray = decisions.find((item) => !known.has(item.part));
  if (stray) throw new TypeError(`decision for ${stray.dest} belongs to part ${JSON.stringify(stray.part)}, which is not being applied`);

  const files = new Map((previous?.files ?? []).map((entry) => [entry.path, entry]));
  const dirs = new Set(previous?.dirs ?? []);
  const result = { state: previous, written: 0, removed: 0, stateWritten: false, stateRemoved: false, failure: null };
  let onDisk = previous ? formatState(previous) : null;

  const persist = async (status) => {
    if (files.size === 0 && previous === null) return;
    for (const dir of await missingAncestors(root, STATE_RELATIVE_PATH, fs)) dirs.add(dir);
    const next = buildState({ previous, files, dirs, status, now, changed: result.written + result.removed > 0 });
    const text = formatState(next);
    result.state = next;
    if (text === onDisk) return;
    await assertInsideProject({ root, dest: STATE_RELATIVE_PATH, fs });
    await writeFileAtomic(fs, resolveInside(root, STATE_RELATIVE_PATH), text);
    onDisk = text;
    result.stateWritten = true;
  };

  const prune = async () => {
    const kept = await pruneEmptyDirs({ root, dirs, fs });
    dirs.clear();
    for (const dir of kept) dirs.add(dir);
  };

  let current = null;
  try {
    for (const part of [...parts, null]) {
      const before = result.written + result.removed;
      for (const item of decisions.filter((candidate) => candidate.part === part).sort(blockLast)) {
        current = item.dest;
        let record = item.record;
        if (item.write !== null) {
          await assertSafeDestination({ root, dest: item.dest, fs });
          for (const dir of await missingAncestors(root, item.dest, fs)) dirs.add(dir);
          if (item.dest === KIROIGNORE_FILE) {
            // The whole file is the installer's only when it did not exist before the block went in.
            if (await writeKiroignoreBlock({ root, block: item.write.content, fs })) record = { ...record, createdFile: true };
          } else {
            await writeFileAtomic(fs, resolveInside(root, item.dest), item.write.content, { mode: item.write.mode });
          }
          result.written += 1;
        } else if (item.remove) {
          await assertSafeDestination({ root, dest: item.dest, fs });
          if (item.dest === KIROIGNORE_FILE) await removeKiroignoreBlock({ root, createdFile: files.get(item.dest)?.createdFile === true, fs });
          else await fs.rm(resolveInside(root, item.dest), { force: true });
          result.removed += 1;
        }
        if (record) files.set(item.dest, record);
        else files.delete(item.dest);
      }
      current = null;
      if (result.written + result.removed > before) await persist('partial');
    }
    if (mode !== 'install' && result.removed > 0) await prune();
    if (mode === 'uninstall' && previous !== null && files.size === 0) {
      // Nothing is tracked any more: the record goes last, and then the folders it was the last file of.
      await assertInsideProject({ root, dest: STATE_RELATIVE_PATH, fs });
      current = STATE_RELATIVE_PATH;
      await fs.rm(resolveInside(root, STATE_RELATIVE_PATH), { force: true });
      current = null;
      result.state = null;
      result.stateRemoved = true;
      await prune();
    } else {
      await persist('complete');
    }
  } catch (error) {
    result.failure = {
      dest: current,
      code: error.code ?? 'apply-failed',
      message: error instanceof Error ? error.message : String(error),
    };
    // An uninstall that already deleted the record must not write a new one.
    if (!result.stateRemoved) {
      try {
        await persist('partial');
      } catch (stateError) {
        result.failure.message += ` (the install state could not be saved either: ${stateError.message})`;
      }
    }
  }
  return result;
}
