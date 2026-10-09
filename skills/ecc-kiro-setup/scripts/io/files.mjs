// Small file helpers. Every function takes the fs module as its first argument so
// tests can pass a fake, and so nothing here reaches for a global.

import { randomBytes } from 'node:crypto';
import path from 'node:path';

const MISSING = new Set(['ENOENT', 'ENOTDIR']);

/**
 * A sibling temp path for `file`, unique per call regardless of clock resolution.
 * Keeping the temp file in the same directory as the target lets `rename` be atomic
 * (same filesystem). A random suffix avoids a collision when two writes land in the
 * same millisecond, which a timestamp-only name could not.
 * @param {string} file
 * @returns {string}
 */
export function tempName(file) {
  return `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
}

/** @returns {Promise<string | null>} null when the file does not exist */
export async function readTextIfExists(fs, file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (MISSING.has(error.code)) return null;
    throw error;
  }
}

/**
 * Write a file by writing a sibling temp file and renaming it, so readers never see half a file.
 * @param {any} fs
 * @param {string} file
 * @param {string | Uint8Array} data strings are written as UTF-8
 * @param {{ mode?: number }} [options] permission bits for the new file (for example 0o755 for a script)
 */
export async function writeFileAtomic(fs, file, data, { mode } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = tempName(file);
  try {
    await fs.writeFile(temp, data, { flag: 'wx' });
    if (mode !== undefined) await fs.chmod(temp, mode);
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

/** Same as writeFileAtomic, for text. */
export const writeTextAtomic = (fs, file, text) => writeFileAtomic(fs, file, text);
