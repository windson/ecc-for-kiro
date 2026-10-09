// Fixtures for tests that need an ECC-like source tree on disk and a fake git.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ECC_COMMIT } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';

export async function makeTempDir(prefix = 'ecc-kiro-test-') {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Write `files` (relative path -> text) under `dir`. */
export async function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text);
  }
}

export const ok = (stdout = '') => ({ ok: true, notFound: false, stdout, stderr: '' });
export const fail = (stderr = 'failure') => ({ ok: false, notFound: false, stdout: '', stderr });

/**
 * A fake git. `handler(args, options)` answers each call; every call is recorded.
 * @param {(args: string[], options: any, calls: any[]) => any} handler
 */
export function fakeGit(handler) {
  const calls = [];
  return {
    calls,
    async run(args, options = {}) {
      calls.push({ args, options });
      return handler(args, options, calls);
    },
  };
}

/** A stable fake git object id for a path. */
export const fakeOid = (rel) => sha256Hex(rel).slice(0, 40);

/**
 * A fake git for a checkout at the pinned commit. `tree` lists the files the fake HEAD contains.
 * Answers rev-parse, config, ls-tree (names, or full records) and read-tree; `onFetch` and
 * `onCheckoutIndex` let a test observe the download and create the files git would write.
 */
export function pinnedGit({ tree = [], onFetch, onCheckoutIndex, sparse = false } = {}) {
  return fakeGit(async (args, options) => {
    if (args.includes('rev-parse')) return ok(`${ECC_COMMIT}\n`);
    if (args.includes('config')) return sparse ? ok('true\n') : { ok: false, notFound: false, stdout: '', stderr: '' };
    if (args.includes('ls-tree')) {
      const dashes = args.indexOf('--');
      const prefixes = dashes === -1 ? [] : args.slice(dashes + 1);
      const selected = prefixes.length === 0 ? tree : tree.filter((rel) => prefixes.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`)));
      if (args.includes('--name-only')) return ok(selected.map((rel) => `${rel}\0`).join(''));
      return ok(selected.map((rel) => `100644 blob ${fakeOid(rel)}\t${rel}\0`).join(''));
    }
    if (args.includes('fetch')) return onFetch ? onFetch(args, options) : ok();
    if (args.includes('read-tree')) return ok();
    if (args.includes('checkout-index')) return onCheckoutIndex ? onCheckoutIndex(args, options) : ok();
    return fail(`unexpected git call: ${args.join(' ')}`);
  });
}

/** A small ECC-shaped tree plus a matching Kimi install state (as the parsed JSON object). */
export function sampleEcc() {
  const files = {
    'agents/planner.md': '---\nname: planner\ndescription: Plans.\ntools: Read, Grep\nmodel: opus\n---\nPlan things.\n',
    'commands/plan.md': '---\ndescription: Plan a change.\n---\nPlan.\n',
    'skills/tdd-workflow/SKILL.md': '---\nname: tdd-workflow\ndescription: TDD. Use when writing tests.\n---\n# TDD\n',
    'skills/tdd-workflow/references/notes.md': '# Notes\n',
    '.agents/skills/api-design/SKILL.md': '---\nname: api-design\ndescription: API design. Use for APIs.\n---\n# API\n',
    '.agents/skills/api-design/agents/openai.yaml': 'interface: {}\n',
    'rules/README.md': '# Rules\n',
    'rules/common/coding-style.md': '# Coding style\n',
    'AGENTS.md': '# Agents\n',
    'mcp-configs/mcp-servers.json': '{"mcpServers": {}}\n',
    'scripts/harness-audit.js': '// audit\n',
    '.pi/README.md': '# Pi\n',
    '.kimi/README.md': '# Kimi\n',
    '.kiro/steering/coding-style.md': '---\ninclusion: auto\n---\n# Style\n',
    '.kiro/hooks/tdd-reminder.kiro.hook': '{"name": "tdd-reminder"}\n',
    '.kiro/hooks/README.md': '# Hooks\n',
    '.kiro/scripts/quality-gate.sh': '#!/bin/bash\n',
    '.kiro/settings/mcp.json.example': '{"mcpServers": {}}\n',
    '.kiro/install.sh': '#!/bin/bash\n',
    LICENSE: 'MIT\n',
  };
  const operations = [
    'agents/planner.md',
    'commands/plan.md',
    'skills/tdd-workflow/SKILL.md',
    'skills/tdd-workflow/references/notes.md',
    '.agents/skills/api-design/SKILL.md',
    '.agents/skills/api-design/agents/openai.yaml',
    'rules/README.md',
    'rules/common/coding-style.md',
    'AGENTS.md',
    'mcp-configs/mcp-servers.json',
    'scripts/harness-audit.js',
    '.pi/README.md',
    '.kimi/README.md',
  ].map((sourceRelativePath) => ({ kind: 'copy-file', sourceRelativePath, contentSha256: sha256Hex(files[sourceRelativePath]) }));
  operations.push({ kind: 'merge-json', sourceRelativePath: '.mcp.json', contentSha256: sha256Hex('{}') });

  const kimiState = {
    schemaVersion: 'ecc.install.v1',
    source: { repoVersion: '2.2.3' },
    resolution: { selectedModules: ['rules-core', 'agents-core'] },
    operations,
  };
  const adapterPaths = [
    '.kiro/hooks/README.md',
    '.kiro/hooks/tdd-reminder.kiro.hook',
    '.kiro/install.sh',
    '.kiro/scripts/quality-gate.sh',
    '.kiro/settings/mcp.json.example',
    '.kiro/steering/coding-style.md',
  ];
  const hashes = new Map(Object.entries(files).map(([rel, text]) => [rel, sha256Hex(text)]));
  return { files, kimiState, adapterPaths, hashes };
}
