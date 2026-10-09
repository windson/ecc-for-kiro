import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createProbes, runCommand } from '../skills/ecc-kiro-setup/scripts/io/probes.mjs';

describe('real probes: filesystem', () => {
  let dir;
  const probes = createProbes({ env: { PATH: '' }, cwd: '/nowhere', homedir: '/home/nobody' });

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ecc-kiro-probes-'));
    await writeFile(path.join(dir, 'b.txt'), 'hello');
    await writeFile(path.join(dir, 'a.txt'), 'x');
    await mkdir(path.join(dir, 'sub'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports files, directories and missing paths', async () => {
    assert.deepEqual(await probes.stat(path.join(dir, 'b.txt')), { type: 'file', size: 5 });
    assert.deepEqual(await probes.stat(path.join(dir, 'sub')), { type: 'dir', size: (await probes.stat(path.join(dir, 'sub'))).size });
    assert.equal((await probes.stat(path.join(dir, 'sub'))).type, 'dir');
    assert.equal(await probes.stat(path.join(dir, 'nope')), null);
    assert.equal(await probes.stat(path.join(dir, 'b.txt', 'child')), null);
  });

  it('reads text and returns null for missing files', async () => {
    assert.equal(await probes.readText(path.join(dir, 'b.txt')), 'hello');
    assert.equal(await probes.readText(path.join(dir, 'nope')), null);
    assert.equal(await probes.readText(path.join(dir, 'b.txt', 'child')), null);
  });

  it('lists directories sorted and returns null when it cannot', async () => {
    assert.deepEqual(await probes.readdir(dir), ['a.txt', 'b.txt', 'sub']);
    assert.equal(await probes.readdir(path.join(dir, 'nope')), null);
    assert.equal(await probes.readdir(path.join(dir, 'b.txt')), null);
  });

  it('does not swallow unexpected errors', async () => {
    await assert.rejects(() => probes.readText(dir), /EISDIR/);
  });

  it('exposes the environment it was created with', () => {
    assert.equal(probes.cwd, '/nowhere');
    assert.equal(probes.homedir, '/home/nobody');
  });
});

describe('real probes: commands', () => {
  it('reports the running Node version', async () => {
    assert.equal(await createProbes().nodeVersion(), process.versions.node);
  });

  it('runs a program and captures output', async () => {
    const result = await runCommand(process.execPath, ['--version']);
    assert.equal(result.ok, true);
    assert.equal(result.notFound, false);
    assert.match(result.stdout, /^v\d+\.\d+\.\d+/);
  });

  it('reports a missing program as notFound', async () => {
    const result = await runCommand('definitely-not-a-real-command-ecc-kiro', []);
    assert.equal(result.ok, false);
    assert.equal(result.notFound, true);
  });

  it('passes arguments without a shell', async () => {
    const tricky = 'a;b $HOME `x` && y';
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', tricky]);
    assert.equal(result.stdout, tricky);
  });

  it('stops a program that exceeds the timeout', async () => {
    const started = Date.now();
    const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeout: 200 });
    assert.equal(result.ok, false);
    assert.ok(Date.now() - started < 5000);
  });

  it('finds tools using the PATH from the environment it was given', async () => {
    const probes = createProbes({ env: { PATH: '' } });
    assert.equal(await probes.gitVersion(), null);
    assert.deepEqual(await probes.kiroCli(), { found: false, version: null, v3Flag: null });
  });
});
