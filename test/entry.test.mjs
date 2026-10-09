// The real entry point, run as a process: that update and uninstall are wired in, what they print and what
// they exit with. Nothing here needs the ECC source: the install state is written by hand.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';

import { STATE_RELATIVE_PATH } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import { emptyState, formatState } from '../skills/ecc-kiro-setup/scripts/lib/state.mjs';
import { makeTempDir, writeTree } from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(HERE, '..', 'skills', 'ecc-kiro-setup', 'scripts', 'ecc-kiro.mjs');
const NOW = new Date('2026-10-07T10:00:00.000Z');

describe('ecc-kiro.mjs as a process', () => {
  let tmp;
  let root;
  let counter = 0;

  before(async () => {
    tmp = await makeTempDir();
  });
  after(() => tmp.cleanup());
  beforeEach(async () => {
    counter += 1;
    root = path.join(tmp.dir, `project-${counter}`);
    await nodeFs.mkdir(root, { recursive: true });
  });

  const run = (...args) =>
    new Promise((resolve) => {
      execFile(process.execPath, [ENTRY, ...args], { env: { ...process.env, KIRO_HOME: path.join(tmp.dir, 'kiro-home') } }, (error, stdout, stderr) => {
        resolve({ code: error ? error.code : 0, stdout, stderr });
      });
    });

  /** A project with one file the installer owns, one the user edited, the block in .kiroignore and a record that says so. */
  async function installedProject() {
    const block = ['# >>> ecc-kiro-setup (managed block, do not edit) >>>', '.claude/', '# <<< ecc-kiro-setup <<<'].join('\n');
    await writeTree(root, {
      '.kiro/steering/ecc-a.md': 'owned',
      '.kiro/steering/ecc-b.md': 'owned, then edited by the user',
      '.kiroignore': `node_modules/\n\n${block}\n`,
      '.claude/settings.json': '{}',
    });
    const state = emptyState({ now: NOW });
    state.dirs = ['.kiro/ecc', '.kiro/steering'];
    state.files = [
      { path: '.kiro/steering/ecc-a.md', category: 'steering', source: null, sha256: sha256Hex('owned') },
      { path: '.kiro/steering/ecc-b.md', category: 'steering', source: null, sha256: sha256Hex('owned') },
      { path: '.kiroignore', category: 'kiroignore', source: null, sha256: sha256Hex(block) },
    ];
    await writeTree(root, { [STATE_RELATIVE_PATH]: formatState(state) });
  }

  it('lists update and uninstall as commands that work', async () => {
    const { code, stdout } = await run('--help');
    assert.equal(code, 0);
    assert.match(stdout, /\n {2}update {4}/);
    assert.match(stdout, /\n {2}uninstall {2}/);
    assert.doesNotMatch(stdout, /not available/);
  });

  it('refuses update and uninstall without --yes or --dry-run, with exit 2', async () => {
    for (const name of ['update', 'uninstall']) {
      const { code, stderr } = await run(name, '--root', root);
      assert.equal(code, 2, name);
      assert.match(stderr, new RegExp(`^ecc-kiro: ${name} (writes and removes|removes) files\\. Preview with "plan --action ${name}" \\(or --dry-run\\), then run again with --yes`), name);
    }
  });

  it('says there is nothing to remove, with exit 0, when no install was recorded', async () => {
    const { code, stdout } = await run('uninstall', '--dry-run', '--root', root);
    assert.equal(code, 0);
    assert.match(stdout, /Nothing to remove\.\n$/);
    const json = JSON.parse((await run('uninstall', '--yes', '--json', '--root', root)).stdout);
    assert.deepEqual([json.ok, json.mode, json.changes, json.source], [true, 'uninstall', 0, null]);
    assert.deepEqual(await nodeFs.readdir(root), []);
  });

  it('stops update with exit 1 and a fix when no install was recorded', async () => {
    const { code, stderr } = await run('update', '--dry-run', '--root', root);
    assert.equal(code, 1);
    assert.match(stderr, /ecc-kiro: nothing to update: \.kiro\/ecc\/install-state\.json does not exist/);
    assert.match(stderr, /\n {2}fix: Run "install" first/);
  });

  it('previews an uninstall without changing anything, then removes what the record lists and nothing else', async () => {
    await installedProject();
    await nodeFs.writeFile(path.join(root, '.kiro/steering/ecc-b.md'), 'owned, then edited by the user');
    const before = await nodeFs.readFile(path.join(root, STATE_RELATIVE_PATH), 'utf8');

    const preview = await run('uninstall', '--dry-run', '--root', root);
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /remove 2 {3}kept \(edited\) 1 {3}already gone 0/);
    assert.match(preview.stdout, /Nothing was removed\. To apply: node \S+ecc-kiro\.mjs uninstall --root \S+ --yes\n$/);
    assert.equal(await nodeFs.readFile(path.join(root, STATE_RELATIVE_PATH), 'utf8'), before);

    const done = await run('uninstall', '--yes', '--root', root);
    assert.equal(done.code, 0, done.stderr);
    assert.match(done.stdout, /Removed 2 files\. The install record \.kiro\/ecc\/install-state\.json was removed too\.\n$/);
    assert.equal(await nodeFs.readFile(path.join(root, '.kiroignore'), 'utf8'), 'node_modules/\n');
    assert.equal(await nodeFs.readFile(path.join(root, '.kiro/steering/ecc-b.md'), 'utf8'), 'owned, then edited by the user');
    await assert.rejects(nodeFs.stat(path.join(root, '.kiro/steering/ecc-a.md')), /ENOENT/);
    await assert.rejects(nodeFs.stat(path.join(root, '.kiro/ecc')), /ENOENT/);
    assert.equal((await run('uninstall', '--yes', '--root', root)).code, 0, 'and a second run finds nothing to do');
  });

  it('exits 1 with the problems when an uninstall cannot go ahead', async () => {
    await installedProject();
    const state = JSON.parse(await nodeFs.readFile(path.join(root, STATE_RELATIVE_PATH), 'utf8'));
    state.files.push({ path: '.kiro/skills/ecc-kiro-setup/SKILL.md', category: 'skill', source: null, sha256: sha256Hex('x') });
    await nodeFs.writeFile(path.join(root, STATE_RELATIVE_PATH), JSON.stringify(state));
    const { code, stderr } = await run('uninstall', '--yes', '--root', root);
    assert.equal(code, 1);
    assert.match(stderr, /ecc-kiro-setup skill itself/);
    assert.equal(await nodeFs.readFile(path.join(root, '.kiro/steering/ecc-a.md'), 'utf8'), 'owned');
  });
});
