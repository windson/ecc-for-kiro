// Path helpers. Relative paths from profiles and state files are data, so they are
// checked before they are ever joined to a directory.

import path from 'node:path';

/**
 * A safe relative path uses forward slashes, has no empty, "." or ".." segments,
 * and is neither absolute nor a Windows drive path.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function assertSafeRelativePath(value, label = 'path') {
  if (!isSafeRelativePath(value)) {
    throw new Error(`unsafe ${label}: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Join a safe relative path to a root, and refuse anything that would land outside it.
 * @param {string} root
 * @param {string} relative
 */
export function resolveInside(root, relative) {
  assertSafeRelativePath(relative);
  const base = path.resolve(root);
  const full = path.resolve(base, ...relative.split('/'));
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`path escapes ${base}: ${JSON.stringify(relative)}`);
  }
  return full;
}

/** Byte-order string comparison, so sorted output does not depend on the locale. */
export function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
export function resolveKiroHome(env, homedir) {
  return env.KIRO_HOME ? path.resolve(env.KIRO_HOME) : path.join(homedir, '.kiro');
}

/** Cache for the ECC checkout: ECC_KIRO_CACHE, else $XDG_CACHE_HOME/ecc-kiro, else ~/.cache/ecc-kiro. */
export function resolveCacheRoot(env, homedir) {
  if (env.ECC_KIRO_CACHE) return path.resolve(env.ECC_KIRO_CACHE);
  if (env.XDG_CACHE_HOME) return path.join(path.resolve(env.XDG_CACHE_HOME), 'ecc-kiro');
  return path.join(homedir, '.cache', 'ecc-kiro');
}
