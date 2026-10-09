// A temp-directory integration run of the real ecc-kiro.mjs process against fixture ECC sources:
// doctor, install, a second install that changes nothing, update, then uninstall that puts the
// project back. Scratch directories live under /tmp/ecc-scratch/<name> and are removed when done.
// Node 18+ built-ins only; no network and no git, because --source points at a local fixture tree.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { STATE_RELATIVE_PATH } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { buildProfile, formatProfile, validateProfile } from '../skills/ecc-kiro-setup/scripts/lib/profile.mjs';
import { sampleEcc, writeTree } from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(HERE, '..', 'skills', 'ecc-kiro-setup', 'scripts', 'ecc-kiro.mjs');
const SCRATCH_BASE = '/tmp/ecc-scratch';

/** Run the real entry point as a process and capture its output and exit code. */
function run(args, { home }) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [ENTRY, ...args],
      { env: { ...process.env, KIRO_HOME: path.join(home, '.kiro') } },
      (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, stdout, stderr }),
    );
  });
}

describe('integration: the real process against a fixture source under /tmp/ecc-scratch', () => {
  let scratch;
  let source;
  let profileFile;
  let home;
  let root;

  before(async () => {
    scratch = path.join(SCRATCH_BASE, `d1-${process.pid}`);
    await nodeFs.mkdir(scratch, { recursive: true });
    source = path.join(scratch, 'ecc');
    profileFile = path.join(scratch, 'profile.json');
    home = path.join(scratch, 'home');
    root = path.join(scratch, 'project');

    const sample = sampleEcc();
    const { profile } = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes: sample.hashes });
    assert.deepEqual(validateProfile(profile), []);
    await writeTree(source, sample.files);
    await nodeFs.mkdir(path.join(home, '.kiro'), { recursive: true });
    await nodeFs.mkdir(root, { recursive: true });
    await nodeFs.writeFile(profileFile, formatProfile(profile));
  });

  after(async () => {
    await nodeFs.rm(scratch, { recursive: true, force: true });
  });

  // Agents and skills are the parts the sample fixture carries whole, so the run uses them. These are
  // functions, not constants, because the paths are set in before() after the describe body runs.
  const only = () => ['--only', 'agents,skills'];
  const srcArgs = () => ['--source', source, '--profile', profileFile, '--root', root];

  it('runs doctor read-only and reports a valid SKILL.md self-check', async () => {
    const before = await nodeFs.readdir(root);
    const result = await run(['doctor', '--json', '--root', root], { home });
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schema, 'ecc-kiro.doctor.v1');
    assert.equal(report.selfCheck.valid, true);
    assert.deepEqual(await nodeFs.readdir(root), before, 'doctor writes nothing');
  });

  it('installs, is idempotent, updates and then uninstalls back to the original project', async () => {
    // Preview writes nothing.
    const preview = await run(['plan', '--json', ...only(), ...srcArgs()], { home });
    assert.equal(preview.code, 0, preview.stderr);
    const plan = JSON.parse(preview.stdout);
    assert.ok(plan.counts.create > 0);
    await assert.rejects(nodeFs.stat(path.join(root, '.kiro', 'agents')), /ENOENT/, 'plan creates nothing');

    // Install.
    const installed = await run(['install', '--yes', '--json', ...only(), ...srcArgs()], { home });
    assert.equal(installed.code, 0, installed.stderr);
    const applied = JSON.parse(installed.stdout);
    assert.equal(applied.applied.written, plan.counts.create);
    const state = JSON.parse(await nodeFs.readFile(path.join(root, STATE_RELATIVE_PATH), 'utf8'));
    assert.equal(state.files.length, plan.counts.create);
    await nodeFs.stat(path.join(root, '.kiro', 'agents', 'planner.md'));

    // A second install changes nothing.
    const again = await run(['install', '--yes', '--json', ...only(), ...srcArgs()], { home });
    assert.equal(again.code, 0, again.stderr);
    assert.deepEqual(JSON.parse(again.stdout).applied, { written: 0, removed: 0 });

    // Update does the same and reports no changes on an up-to-date install.
    const updated = await run(['update', '--yes', '--json', ...only(), ...srcArgs()], { home });
    assert.equal(updated.code, 0, updated.stderr);
    assert.deepEqual(JSON.parse(updated.stdout).applied, { written: 0, removed: 0 });

    // Uninstall needs no source, and puts the project back.
    const uninstalled = await run(['uninstall', '--yes', '--json', '--root', root], { home });
    assert.equal(uninstalled.code, 0, uninstalled.stderr);
    assert.equal(JSON.parse(uninstalled.stdout).applied.removed, plan.counts.create);
    assert.deepEqual(await nodeFs.readdir(root), [], 'the project is empty again');
  });
});
