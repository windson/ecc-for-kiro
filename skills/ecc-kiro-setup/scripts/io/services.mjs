// The real services commands use to reach git and the file system.

import nodeFs from 'node:fs/promises';

import { createGit } from './git.mjs';

/** @param {{ env?: NodeJS.ProcessEnv }} [options] */
export function createServices({ env = process.env } = {}) {
  return { git: createGit({ env }), fs: nodeFs };
}
