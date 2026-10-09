// Getting the pinned ECC release onto disk and checking it.
//
// The release is fetched with a partial clone (no file contents) followed by a checkout of
// only the paths a profile lists, so a few hundred files are downloaded instead of the
// whole repository. All git access goes through `git.run`, which tests replace with a fake.

import nodeFs from 'node:fs/promises';
import path from 'node:path';

import { ECC_COMMIT, ECC_REPO_URL, ECC_TAG, cacheCheckoutName } from '../lib/constants.mjs';
import { CodedError } from '../lib/exit.mjs';
import { sha256Hex } from '../lib/hash.mjs';
import { assertSafeRelativePath, resolveInside } from '../lib/paths.mjs';

const NETWORK_TIMEOUT_MS = 10 * 60 * 1000;
const HEAD_PATTERN = /^[0-9a-f]{40}$/;
const PARTIAL_CLONE_UNSUPPORTED = /filter|partial clone|unknown option|unrecognized option|usage:/i;

export const cacheCheckoutPath = (cacheRoot) => path.join(cacheRoot, cacheCheckoutName());

async function exists(fs, target) {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

const firstLine = (text) => text.trim().split('\n')[0] || 'no output';

/** HEAD of a checkout, or null when the directory is not a git checkout. */
async function readHead(fs, git, dir) {
  if (!(await exists(fs, path.join(dir, '.git')))) return null;
  const result = await git.run(['-C', dir, 'rev-parse', 'HEAD']);
  const head = result.stdout.trim();
  if (!result.ok || !HEAD_PATTERN.test(head)) {
    throw new CodedError('git-failed', `could not read HEAD of ${dir}: ${firstLine(result.stderr)}`);
  }
  return head;
}

function assertPinned(commit, where) {
  if (commit !== null && commit !== ECC_COMMIT) {
    throw new CodedError('commit-mismatch', `${where} is at ${commit}, but this build installs ECC ${ECC_TAG} (${ECC_COMMIT})`, {
      fix: 'Use a checkout of the pinned tag, or delete the cached checkout and fetch again.',
    });
  }
}

/**
 * Find or create the ECC checkout to read from.
 * - `sourceDir`: use that directory as given; nothing is downloaded or changed.
 * - otherwise the cached checkout, created with `fetch: true` (a network clone into `cacheRoot`).
 * @returns {Promise<{ dir: string, origin: 'local' | 'cache' | 'cloned', commit: string | null, commitVerified: boolean }>}
 */
export async function openSource({ sourceDir, cacheRoot, fetch = false, git, log = () => {}, fs = nodeFs }) {
  if (sourceDir) {
    const dir = path.resolve(sourceDir);
    if (!(await exists(fs, dir))) throw new CodedError('source-missing', `source directory not found: ${dir}`);
    const commit = await readHead(fs, git, dir);
    assertPinned(commit, `the source checkout ${dir}`);
    return { dir, origin: 'local', commit, commitVerified: commit !== null };
  }

  const dir = cacheCheckoutPath(cacheRoot);
  if (await exists(fs, path.join(dir, '.git'))) {
    const commit = await readHead(fs, git, dir);
    assertPinned(commit, `the cached checkout ${dir}`);
    const sparse = await git.run(['-C', dir, 'config', '--get', 'core.sparseCheckout']);
    if (sparse.ok && sparse.stdout.trim() === 'true') {
      throw new CodedError('cache-incompatible', `the cached checkout ${dir} uses sparse-checkout, which this tool does not manage`, {
        fix: `Delete ${dir} and run again with --fetch.`,
      });
    }
    return { dir, origin: 'cache', commit, commitVerified: true };
  }

  if (!fetch) {
    throw new CodedError('source-missing', `no ECC checkout found at ${dir}`, {
      fix: `Run again with --fetch to download ECC ${ECC_TAG} from github.com into ${cacheRoot}, or pass --source <checkout>.`,
    });
  }

  log(`Downloading ECC ${ECC_TAG} from github.com into ${dir} (partial clone, file contents are fetched later) ...`);
  await fs.mkdir(cacheRoot, { recursive: true });
  const cloneArgs = (extra) => [
    '-c', 'advice.detachedHead=false',
    '-c', 'core.autocrlf=false',
    'clone', '--depth', '1', ...extra,
    '--branch', ECC_TAG, ECC_REPO_URL, dir,
  ];
  let cloned = await git.run(cloneArgs(['--filter=blob:none', '--no-checkout']), { cwd: cacheRoot, timeout: NETWORK_TIMEOUT_MS });
  if (!cloned.ok && PARTIAL_CLONE_UNSUPPORTED.test(cloned.stderr)) {
    // An old git (or a server) without partial clone: take the whole repository at the tag instead.
    log('This git cannot do a partial clone; downloading the full repository at the pinned tag instead ...');
    await fs.rm(dir, { recursive: true, force: true });
    cloned = await git.run(cloneArgs([]), { cwd: cacheRoot, timeout: NETWORK_TIMEOUT_MS });
  }
  if (!cloned.ok) {
    throw new CodedError('clone-failed', `git clone failed: ${firstLine(cloned.stderr)}`, {
      fix: 'Check the network connection, or pass --source <checkout>.',
    });
  }
  const commit = await readHead(fs, git, dir);
  assertPinned(commit, 'the new clone');
  return { dir, origin: 'cloned', commit, commitVerified: true };
}

/**
 * List files in the checkout's tree (works without file contents).
 * @param {string[]} prefixes repo-relative directories
 */
export async function listTree({ source, prefixes, git }) {
  if (source.commit === null) {
    throw new CodedError('git-required', 'listing files needs a git checkout; pass --source <git checkout> or use --fetch');
  }
  for (const prefix of prefixes) assertSafeRelativePath(prefix, 'tree prefix');
  const result = await git.run(['-C', source.dir, 'ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', ...prefixes]);
  if (!result.ok) throw new CodedError('git-failed', `git ls-tree failed: ${firstLine(result.stderr)}`);
  return result.stdout.split('\0').filter(Boolean).sort();
}

const REGULAR_FILE_MODES = new Set(['100644', '100755']);

/**
 * Every regular file in the checkout's HEAD tree, with its git object id.
 * Works without file contents, so it is cheap in a partial clone.
 * @returns {Promise<Map<string, string>>} path -> object id
 */
export async function treeMap({ source, git }) {
  if (source.commit === null) {
    throw new CodedError('git-required', 'this needs a git checkout; pass --source <git checkout> or use --fetch');
  }
  const result = await git.run(['-C', source.dir, 'ls-tree', '-r', '-z', 'HEAD']);
  if (!result.ok) throw new CodedError('git-failed', `git ls-tree failed: ${firstLine(result.stderr)}`);
  const files = new Map();
  for (const record of result.stdout.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    if (type === 'blob' && REGULAR_FILE_MODES.has(mode)) files.set(record.slice(tab + 1), oid);
  }
  return files;
}

/**
 * Make sure the given files are present in a checkout this tool manages.
 * Only cache checkouts are changed; a user-supplied `--source` is never touched.
 *
 * File contents are downloaded in one request and then written from the local object store.
 * (Letting `git checkout` fetch them lazily costs one round trip per file: minutes instead of seconds.)
 * @returns {Promise<{ fetched: number, stillMissing: string[] }>}
 */
export async function ensurePaths({ source, paths, git, log = () => {}, fs = nodeFs }) {
  const missing = [];
  for (const rel of [...new Set(paths)]) {
    if (!(await exists(fs, resolveInside(source.dir, rel)))) missing.push(rel);
  }
  if (missing.length === 0) return { fetched: 0, stillMissing: [] };
  if (source.origin === 'local') return { fetched: 0, stillMissing: missing };

  const tree = await treeMap({ source, git });
  const fetchable = missing.filter((rel) => tree.has(rel));
  if (fetchable.length > 0) {
    log(`Downloading ${fetchable.length} file(s) of ECC ${ECC_TAG} from github.com ...`);
    const ids = [...new Set(fetchable.map((rel) => tree.get(rel)))];
    // "noop" negotiation is what git itself uses for lazy fetches: without it the server
    // may assume the (empty) partial clone already has the blobs and send nothing.
    const download = await git.run(
      [
        '-C', source.dir,
        '-c', 'fetch.negotiationAlgorithm=noop',
        'fetch', 'origin', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', '--filter=blob:none', '--stdin',
      ],
      { input: `${ids.join('\n')}\n`, timeout: NETWORK_TIMEOUT_MS },
    );
    if (!download.ok) {
      log(`Warning: the batch download failed (${firstLine(download.stderr)}); falling back to one request per file, which is slow.`);
    }

    const indexed = await git.run(['-C', source.dir, 'read-tree', 'HEAD']);
    if (!indexed.ok) throw new CodedError('fetch-failed', `git read-tree failed: ${firstLine(indexed.stderr)}`);
    const written = await git.run(['-C', source.dir, '-c', 'core.autocrlf=false', 'checkout-index', '-f', '-z', '--stdin'], {
      input: `${fetchable.join('\0')}\0`,
      timeout: NETWORK_TIMEOUT_MS,
    });
    if (!written.ok) {
      throw new CodedError('fetch-failed', `git checkout-index failed: ${firstLine(written.stderr)}`, {
        fix: 'Check the network connection and run again.',
      });
    }
  }

  const stillMissing = [];
  for (const rel of missing) {
    if (!(await exists(fs, resolveInside(source.dir, rel)))) stillMissing.push(rel);
  }
  return { fetched: missing.length - stillMissing.length, stillMissing };
}

/**
 * Read the files a profile lists and keep only those whose SHA-256 matches the profile.
 * What this returns is safe to convert and install: the bytes are the ones the profile pins.
 * `executable` lists the files that have an execute bit in the checkout (git records it, and the
 * hash does not), so an installed script can be run the same way the original can.
 * @param {{ dir: string, entries: { path: string, sha256: string }[], fs?: any }} input
 * @returns {Promise<{ files: Map<string, Buffer>, executable: Set<string>, missing: string[], mismatched: { path: string, expected: string, actual: string }[] }>}
 */
export async function readVerifiedFiles({ dir, entries, fs = nodeFs }) {
  const files = new Map();
  const executable = new Set();
  const missing = [];
  const mismatched = [];
  for (const entry of entries) {
    const full = resolveInside(dir, entry.path);
    let bytes;
    try {
      bytes = await fs.readFile(full);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR') {
        missing.push(entry.path);
        continue;
      }
      throw error;
    }
    const actual = sha256Hex(bytes);
    if (actual !== entry.sha256) {
      mismatched.push({ path: entry.path, expected: entry.sha256, actual });
      continue;
    }
    files.set(entry.path, bytes);
    if (((await fs.stat(full)).mode & 0o111) !== 0) executable.add(entry.path);
  }
  return { files, executable, missing, mismatched };
}

/**
 * Hash files of a checkout. Paths must be safe relative paths.
 * @returns {Promise<{ hashes: Map<string, string>, missing: string[] }>}
 */
export async function hashPaths({ dir, paths, fs = nodeFs }) {
  const hashes = new Map();
  const missing = [];
  for (const rel of paths) {
    const full = resolveInside(dir, rel);
    let bytes;
    try {
      bytes = await fs.readFile(full);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR') {
        missing.push(rel);
        continue;
      }
      throw error;
    }
    hashes.set(rel, sha256Hex(bytes));
  }
  return { hashes, missing };
}
