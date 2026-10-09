// Real environment probes. Logic that needs the machine goes through this object
// so it can be replaced by an in-memory fake in tests.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';

import { parseVersion } from '../lib/version.mjs';

const MISSING = new Set(['ENOENT', 'ENOTDIR']);

/**
 * Run a program without a shell. Arguments are passed as an array.
 * @returns {Promise<{ ok: boolean, notFound: boolean, stdout: string, stderr: string }>}
 */
export function runCommand(command, args, { timeout = 15000, env = process.env, cwd, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      { timeout, env, cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: error === null,
          notFound: error?.code === 'ENOENT',
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        });
      },
    );
    if (input !== undefined && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, homedir?: string }} [options]
 */
export function createProbes({ env = process.env, cwd = process.cwd(), homedir = os.homedir() } = {}) {
  return {
    env,
    cwd,
    homedir,
    platform: process.platform,

    async nodeVersion() {
      return process.versions.node;
    },

    async gitVersion() {
      const result = await runCommand('git', ['--version'], { env });
      return result.ok ? result.stdout.trim() : null;
    },

    async kiroCli() {
      const version = await runCommand('kiro-cli', ['--version'], { env });
      if (version.notFound) return { found: false, version: null, v3Flag: null };
      const help = await runCommand('kiro-cli', ['chat', '--help'], { env });
      return {
        found: true,
        version: parseVersion(version.stdout || version.stderr),
        v3Flag: help.ok ? /--v3\b/.test(help.stdout) : null,
      };
    },

    /** The raw output of `kiro-cli chat --list-models -f json`, or null when the CLI is missing or fails. */
    async listModels() {
      const result = await runCommand('kiro-cli', ['chat', '--list-models', '-f', 'json'], { env, timeout: 30000 });
      return result.ok ? result.stdout : null;
    },
    async stat(path) {
      try {
        const info = await fs.stat(path);
        return { type: info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other', size: info.size };
      } catch (error) {
        if (MISSING.has(error.code)) return null;
        throw error;
      }
    },

    async readText(path) {
      try {
        return await fs.readFile(path, 'utf8');
      } catch (error) {
        if (MISSING.has(error.code)) return null;
        throw error;
      }
    },

    async readdir(path) {
      try {
        return (await fs.readdir(path)).sort();
      } catch (error) {
        if (MISSING.has(error.code)) return null;
        throw error;
      }
    },
  };
}
