// A thin git runner. Everything else talks to git through `git.run(args, options)`,
// so tests can replace it with a fake that never touches the network.

import { runCommand } from './probes.mjs';

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ run(args: string[], options?: { cwd?: string, input?: string, timeout?: number }): Promise<{ ok: boolean, notFound: boolean, stdout: string, stderr: string }> }}
 */
export function createGit({ env = process.env } = {}) {
  // Never block on a credentials prompt, and never download Git LFS content.
  const gitEnv = { ...env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' };
  return {
    run(args, options = {}) {
      return runCommand('git', args, { env: gitEnv, ...options });
    },
  };
}
