#!/usr/bin/env node
// ecc-kiro: install, update and remove ECC for Kiro. See ../SKILL.md.

import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createProbes } from './io/probes.mjs';
import { createServices } from './io/services.mjs';
import { runCli } from './lib/cli.mjs';

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Run with real streams, probes and services. Returns the exit code. */
export function main(argv = process.argv.slice(2)) {
  const probes = createProbes();
  return runCli(argv, {
    stdout: process.stdout,
    stderr: process.stderr,
    probes,
    services: createServices({ env: probes.env }),
    skillDir,
  });
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  process.exitCode = await main();
}
