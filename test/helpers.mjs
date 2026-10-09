// Shared test helpers: an in-memory probes object and capture streams.

import path from 'node:path';

/**
 * In-memory stand-in for the real probes. Directories are implied by file paths.
 * @param {object} [options]
 * @param {Record<string, string>} [options.files] absolute path -> contents
 * @param {string[]} [options.dirs] extra (possibly empty) directories
 */
export function memoryProbes({
  files = {},
  dirs = [],
  env = {},
  homedir = '/home/tester',
  cwd = '/work/project',
  node = '22.22.0',
  git = 'git version 2.42.0',
  kiro = { found: true, version: '2.28.0', v3Flag: true },
} = {}) {
  const fileMap = new Map(Object.entries(files).map(([p, text]) => [path.normalize(p), text]));
  const dirSet = new Set();
  const addDir = (p) => {
    let current = path.normalize(p);
    for (;;) {
      dirSet.add(current);
      const parent = path.dirname(current);
      if (parent === current) return;
      current = parent;
    }
  };
  for (const dir of dirs) addDir(dir);
  for (const file of fileMap.keys()) addDir(path.dirname(file));

  return {
    env,
    homedir,
    cwd,
    platform: 'linux',
    async nodeVersion() {
      return node;
    },
    async gitVersion() {
      return git;
    },
    async kiroCli() {
      return kiro;
    },
    async stat(p) {
      const key = path.normalize(p);
      if (fileMap.has(key)) return { type: 'file', size: fileMap.get(key).length };
      if (dirSet.has(key)) return { type: 'dir', size: 0 };
      return null;
    },
    async readText(p) {
      const key = path.normalize(p);
      return fileMap.has(key) ? fileMap.get(key) : null;
    },
    async readdir(p) {
      const key = path.normalize(p);
      if (!dirSet.has(key)) return null;
      const names = new Set();
      for (const entry of [...fileMap.keys(), ...dirSet]) {
        if (entry !== key && path.dirname(entry) === key) names.add(path.basename(entry));
      }
      return [...names].sort();
    },
  };
}

/** Capture writes to stdout/stderr. */
export function captureStreams() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (chunk) => out.push(String(chunk)) },
    stderr: { write: (chunk) => err.push(String(chunk)) },
    get out() {
      return out.join('');
    },
    get err() {
      return err.join('');
    },
  };
}

export const VALID_SKILL_MD = [
  '---',
  'name: ecc-kiro-setup',
  'description: Sets up ECC for Kiro. Use when installing ECC.',
  '---',
  '',
  '# Body',
  '',
].join('\n');
