// Finding the wizard's own script. The precedence is fixed: the project copy first, then the
// global skill under $KIRO_HOME (or ~/.kiro) skills, then the installed Power. $KIRO_HOME wins
// over the home default for both the global and the power paths.

import { existsSync } from 'node:fs';
import path from 'node:path';

import { SKILL_NAME } from './constants.mjs';
import { resolveKiroHome } from './paths.mjs';

const SCRIPT_RELATIVE = path.join('scripts', 'ecc-kiro.mjs');

/**
 * The places the script may live, in the order they are tried.
 * @param {{ root: string, homedir: string, env?: Record<string, string | undefined> }} input
 * @returns {{ origin: 'project' | 'global' | 'power', path: string }[]}
 */
export function scriptSearchPaths({ root, homedir, env = {} }) {
  const kiroHome = resolveKiroHome(env, homedir);
  return [
    { origin: 'project', path: path.join(path.resolve(root), '.kiro', 'skills', SKILL_NAME, SCRIPT_RELATIVE) },
    { origin: 'global', path: path.join(kiroHome, 'skills', SKILL_NAME, SCRIPT_RELATIVE) },
    { origin: 'power', path: path.join(kiroHome, 'powers', 'installed', SKILL_NAME, 'skills', SKILL_NAME, SCRIPT_RELATIVE) },
  ];
}

/**
 * Locate the script by trying each place in order.
 * @param {{ root: string, homedir: string, env?: Record<string, string | undefined>, exists?: (path: string) => boolean }} input
 *   `exists` defaults to a real filesystem check; tests pass their own.
 * @returns {{ found: boolean, origin: string | null, path: string | null, searched: { origin: string, path: string }[] }}
 */
export function locateScript({ root, homedir, env = {}, exists = existsSync }) {
  const searched = scriptSearchPaths({ root, homedir, env });
  for (const entry of searched) {
    if (exists(entry.path)) {
      return { found: true, origin: entry.origin, path: entry.path, searched };
    }
  }
  return { found: false, origin: null, path: null, searched };
}
