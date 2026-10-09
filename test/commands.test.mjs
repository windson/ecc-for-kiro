// End-to-end tests of `verify` and `profile` through runCli, with temp directories and a fake git.

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { ECC_COMMIT, cacheCheckoutName } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { EXIT, runCli } from '../skills/ecc-kiro-setup/scripts/lib/cli.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import { buildProfile, formatProfile, validateProfile } from '../skills/ecc-kiro-setup/scripts/lib/profile.mjs';
import { captureStreams, memoryProbes } from './helpers.mjs';
import { fail, fakeGit, fakeOid, makeTempDir, ok, pinnedGit, sampleEcc, writeTree } from './fixtures.mjs';

const SKILL_DIR = '/work/project/.kiro/skills/ecc-kiro-setup';

async function invoke(argv, { git = fakeGit(() => fail('git not expected')), probes = memoryProbes() } = {}) {
  const streams = captureStreams();
  const code = await runCli(argv, {
    stdout: streams.stdout,
    stderr: streams.stderr,
    probes,
    skillDir: SKILL_DIR,
    services: { git, fs: nodeFs },
  });
  return { code, out: streams.out, err: streams.err, git };
}
const json = (result) => JSON.parse(result.out);

describe('verify', () => {
  let tmp;
  let sample;
  let profileFile;
  let source;

  before(async () => {
    tmp = await makeTempDir();
  });
  after(() => tmp.cleanup());

  beforeEach(async () => {
    sample = sampleEcc();
    const { profile } = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes: sample.hashes });
    assert.deepEqual(validateProfile(profile), []);
    const base = await import('node:fs/promises').then((fs) => fs.mkdtemp(path.join(tmp.dir, 'case-')));
    source = path.join(base, 'ecc');
    profileFile = path.join(base, 'profile.json');
    await writeTree(source, sample.files);
    await writeFile(profileFile, formatProfile(profile));
  });

  it('passes when every file matches, and reports counts', async () => {
    const result = await invoke(['verify', '--json', '--source', source, '--profile', profileFile]);
    assert.equal(result.code, EXIT.OK);
    const report = json(result);
    assert.equal(report.ok, true);
    assert.equal(report.checked, 15);
    assert.equal(report.source.origin, 'local');
    assert.equal(report.source.commitVerified, false);
    assert.equal(report.counts.skillDirs, 2);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.mismatched, []);
  });

  it('prints a readable summary by default', async () => {
    const result = await invoke(['verify', '--source', source, '--profile', profileFile]);
    assert.equal(result.code, EXIT.OK);
    assert.match(result.out, /Result: all 15 files match their recorded hashes/);
    assert.match(result.out, /no \.git directory, so only file hashes are checked/);
  });

  it('fails and names a file whose content changed', async () => {
    await writeFile(path.join(source, 'agents', 'planner.md'), 'tampered');
    const result = await invoke(['verify', '--json', '--source', source, '--profile', profileFile]);
    assert.equal(result.code, EXIT.FAILED);
    const report = json(result);
    assert.equal(report.ok, false);
    assert.deepEqual(report.mismatched, [{ path: 'agents/planner.md', expected: sha256Hex(sample.files['agents/planner.md']), actual: sha256Hex('tampered') }]);
  });

  it('fails and names a file that is missing, suggesting --fetch', async () => {
    await nodeFs.rm(path.join(source, 'LICENSE'));
    const result = await invoke(['verify', '--source', source, '--profile', profileFile]);
    assert.equal(result.code, EXIT.FAILED);
    assert.match(result.out, /missing {3}LICENSE/);
    assert.match(result.out, /Run again with --fetch/);
    assert.match(result.out, /Result: verification failed/);
  });

  it('checks the commit of a git checkout', async () => {
    await mkdir(path.join(source, '.git'));
    const good = await invoke(['verify', '--json', '--source', source, '--profile', profileFile], { git: pinnedGit() });
    assert.equal(good.code, EXIT.OK);
    assert.equal(json(good).source.commitVerified, true);

    const bad = await invoke(['verify', '--json', '--source', source, '--profile', profileFile], { git: fakeGit(() => ok(`${'e'.repeat(40)}\n`)) });
    assert.equal(bad.code, EXIT.FAILED);
    assert.equal(json(bad).error.code, 'commit-mismatch');
  });

  it('refuses an invalid profile before touching the source', async () => {
    const profile = JSON.parse(await readFile(profileFile, 'utf8'));
    profile.entries[0].path = '../escape';
    await writeFile(profileFile, JSON.stringify(profile));
    const result = await invoke(['verify', '--json', '--source', source, '--profile', profileFile]);
    assert.equal(result.code, EXIT.FAILED);
    const report = json(result);
    assert.equal(report.ok, false);
    assert.equal(report.source, null);
    assert.ok(report.problems.some((item) => item.code === 'entry-path-unsafe'));
    assert.equal(result.git.calls.length, 0);
  });

  it('reports a missing or unreadable profile file', async () => {
    const missing = await invoke(['verify', '--json', '--source', source, '--profile', path.join(source, 'nope.json')]);
    assert.equal(missing.code, EXIT.FAILED);
    assert.equal(json(missing).error.code, 'profile-missing');
    await writeFile(profileFile, '{ not json');
    const broken = await invoke(['verify', '--json', '--source', source, '--profile', profileFile]);
    assert.equal(json(broken).error.code, 'profile-unreadable');
  });

  it('downloads missing files into the cache only when --fetch is given', async () => {
    const cacheRoot = path.join(path.dirname(source), 'cache');
    const checkout = path.join(cacheRoot, cacheCheckoutName());
    await mkdir(path.join(checkout, '.git'), { recursive: true });
    const probes = memoryProbes({ env: { ECC_KIRO_CACHE: cacheRoot } });
    const git = pinnedGit({
      tree: Object.keys(sample.files),
      onCheckoutIndex: async () => {
        await writeTree(checkout, sample.files);
        return ok();
      },
    });

    const offline = await invoke(['verify', '--json', '--profile', profileFile], { git, probes });
    assert.equal(offline.code, EXIT.FAILED);
    assert.equal(json(offline).missing.length, 15);
    assert.ok(!git.calls.some((call) => call.args.includes('checkout-index')));

    const online = await invoke(['verify', '--json', '--fetch', '--profile', profileFile], { git, probes });
    assert.equal(online.code, EXIT.OK);
    const report = json(online);
    assert.equal(report.fetched, 15);
    assert.equal(report.source.origin, 'cache');
    assert.ok(git.calls.some((call) => call.args.includes('checkout-index')));
  });

  it('asks for --fetch when there is no source at all', async () => {
    const probes = memoryProbes({ env: { ECC_KIRO_CACHE: path.join(path.dirname(source), 'nothing') } });
    const result = await invoke(['verify', '--json', '--profile', profileFile], { probes });
    assert.equal(result.code, EXIT.FAILED);
    const error = json(result).error;
    assert.equal(error.code, 'source-missing');
    assert.match(error.fix, /--fetch/);
  });
});

describe('profile', () => {
  let tmp;
  let sample;
  let root;
  let source;
  let kimiFile;
  let outFile;

  before(async () => {
    tmp = await makeTempDir();
  });
  after(() => tmp.cleanup());

  beforeEach(async () => {
    sample = sampleEcc();
    root = await nodeFs.mkdtemp(path.join(tmp.dir, 'case-'));
    source = path.join(root, 'ecc');
    kimiFile = path.join(root, 'kimi-state.json');
    outFile = path.join(root, 'out', 'profile.json');
    await writeTree(source, sample.files);
    await mkdir(path.join(source, '.git'));
    await writeFile(kimiFile, JSON.stringify(sample.kimiState));
  });

  const gitFor = () => pinnedGit({ tree: Object.keys(sample.files) });
  const run = (extra = []) => invoke(['profile', '--json', '--root', root, '--kimi', kimiFile, '--source', source, '--out', outFile, ...extra], { git: gitFor() });

  it('reports a missing profile file and does not write unless asked', async () => {
    const result = await run();
    assert.equal(result.code, EXIT.FAILED);
    assert.equal(json(result).status, 'missing');
    await assert.rejects(readFile(outFile), /ENOENT/);
  });

  it('writes the profile with --write, then reports it unchanged', async () => {
    const written = await run(['--write']);
    assert.equal(written.code, EXIT.OK);
    const report = json(written);
    assert.equal(report.status, 'written');
    assert.equal(report.counts.agent, 1);
    assert.equal(report.excluded, 4);

    const text = await readFile(outFile, 'utf8');
    const profile = JSON.parse(text);
    assert.deepEqual(validateProfile(profile), []);
    assert.equal(profile.source.commit, ECC_COMMIT);
    const expected = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes: sample.hashes }).profile;
    assert.equal(text, formatProfile(expected));

    const again = await run();
    assert.equal(again.code, EXIT.OK);
    assert.equal(json(again).status, 'unchanged');
  });

  it('notices when the file on disk differs, and fixes it with --write', async () => {
    await run(['--write']);
    await writeFile(outFile, '{}\n');
    const differs = await run();
    assert.equal(differs.code, EXIT.FAILED);
    assert.equal(json(differs).status, 'differs');
    const fixed = await run(['--write']);
    assert.equal(fixed.code, EXIT.OK);
    assert.equal(json(fixed).status, 'written');
  });

  it('stops without writing when the ECC checkout disagrees with the Kimi hashes', async () => {
    await writeFile(path.join(source, 'agents', 'planner.md'), 'changed after Kimi installed it');
    const result = await run(['--write']);
    assert.equal(result.code, EXIT.FAILED);
    const report = json(result);
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.problems.map((item) => `${item.code} ${item.path}`), ['hash-mismatch agents/planner.md']);
    await assert.rejects(readFile(outFile), /ENOENT/);
  });

  it('does not need Pi, Kimi or Codex-only files to exist', async () => {
    await nodeFs.rm(path.join(source, '.pi'), { recursive: true });
    await nodeFs.rm(path.join(source, '.agents', 'skills', 'api-design', 'agents'), { recursive: true });
    const result = await run(['--write']);
    assert.equal(result.code, EXIT.OK);
  });

  describe('with extra entries', () => {
    const extraPath = 'skills/orch-pipeline/SKILL.md';
    const extrasFile = () => path.join(root, 'extras.json');
    const writeExtras = (value) => writeFile(extrasFile(), typeof value === 'string' ? value : JSON.stringify(value));
    const good = { schema: 'ecc-kiro.profile-extras.v1', description: 'd', entries: [{ path: extraPath, reason: 'The orch commands share this skill.' }] };
    beforeEach(async () => {
      sample.files[extraPath] = 'orch pipeline skill';
      await writeTree(source, { [extraPath]: sample.files[extraPath] });
    });
    const gitWithExtra = () => pinnedGit({ tree: Object.keys(sample.files) });
    const runExtras = (extra) => invoke(['profile', '--json', '--root', root, '--kimi', kimiFile, '--source', source, '--out', outFile, '--extras', extrasFile(), ...extra], { git: gitWithExtra() });

    it('adds them to the profile, hashed from the checkout, and says how many', async () => {
      await writeExtras(good);
      const result = await runExtras(['--write']);
      assert.equal(result.code, EXIT.OK, result.err + result.out);
      const report = json(result);
      assert.equal(report.extras, 1);
      assert.equal(report.counts.skill, json(await run()).counts.skill + 1);
      const profile = JSON.parse(await readFile(outFile, 'utf8'));
      assert.deepEqual(validateProfile(profile), []);
      assert.deepEqual(profile.extras, good.entries);
      assert.equal(profile.entries.find((entry) => entry.path === extraPath).sha256, sha256Hex('orch pipeline skill'));
      assert.equal(json(await runExtras([])).status, 'unchanged');
      assert.match((await runExtras(['--json'])).out, /"extras": 1/);
    });
    it('reads the file of the skill by default, and works without one', async () => {
      const skillDir = path.join(root, 'skill');
      await mkdir(path.join(skillDir, 'assets', 'profiles'), { recursive: true });
      await writeFile(path.join(skillDir, 'assets', 'profiles', 'extras-v2.2.3.json'), JSON.stringify(good));
      const streams = captureStreams();
      const code = await runCli(['profile', '--json', '--root', root, '--kimi', kimiFile, '--source', source, '--out', outFile], { stdout: streams.stdout, stderr: streams.stderr, probes: memoryProbes(), skillDir, services: { git: gitWithExtra(), fs: nodeFs } });
      assert.equal(code, EXIT.FAILED, 'the profile is not written yet, so it is missing');
      assert.equal(JSON.parse(streams.out).extras, 1);
      const without = await run();
      assert.equal(json(without).extras, 0);
    });
    it('stops with a code when the file is missing, is not JSON, or is not what it should be', async () => {
      const code = async (value) => {
        if (value !== undefined) await writeExtras(value);
        return json(await runExtras([])).error.code;
      };
      assert.equal(await code(undefined), 'extras-missing');
      assert.equal(await code('{ nope'), 'extras-invalid');
      assert.equal(await code({ ...good, entries: [{ path: extraPath }] }), 'extras-invalid');
    });
    it('stops without writing when an extra is not in the checkout', async () => {
      await writeExtras({ ...good, entries: [{ path: 'skills/not-there/SKILL.md', reason: 'r' }] });
      const result = await runExtras(['--write']);
      assert.equal(result.code, EXIT.FAILED);
      assert.deepEqual(json(result).problems.map((item) => item.code), ['source-missing']);
      await assert.rejects(readFile(outFile), /ENOENT/);
    });
  });
  it('reports a missing or unreadable Kimi state', async () => {
    const missing = await invoke(['profile', '--json', '--root', root, '--kimi', path.join(root, 'nope.json'), '--source', source], { git: gitFor() });
    assert.equal(json(missing).error.code, 'kimi-missing');
    await writeFile(kimiFile, 'not json');
    const broken = await invoke(['profile', '--json', '--root', root, '--kimi', kimiFile, '--source', source], { git: gitFor() });
    assert.equal(json(broken).error.code, 'kimi-unreadable');
  });

  it('downloads only the files the profile needs when asked to fetch', async () => {
    const cacheRoot = path.join(root, 'cache');
    const checkout = path.join(cacheRoot, cacheCheckoutName());
    await mkdir(path.join(checkout, '.git'), { recursive: true });
    const probes = memoryProbes({ env: { ECC_KIRO_CACHE: cacheRoot } });
    const git = pinnedGit({
      tree: Object.keys(sample.files),
      onCheckoutIndex: async () => {
        await writeTree(checkout, sample.files);
        return ok();
      },
    });
    const result = await invoke(['profile', '--json', '--root', root, '--kimi', kimiFile, '--fetch', '--out', outFile, '--write'], { git, probes });
    assert.equal(result.code, EXIT.OK);
    assert.equal(json(result).source.origin, 'cache');

    const requested = git.calls.find((call) => call.args.includes('fetch')).options.input.split('\n');
    assert.ok(requested.includes(fakeOid('agents/planner.md')));
    assert.ok(requested.includes(fakeOid('LICENSE')));
    assert.ok(requested.includes(fakeOid('.kiro/steering/coding-style.md')));
    assert.ok(!requested.includes(fakeOid('.pi/README.md')));
    assert.ok(!requested.includes(fakeOid('.kiro/install.sh')));
    assert.deepEqual(validateProfile(JSON.parse(await readFile(outFile, 'utf8'))), []);
  });

  it('reads the Kimi state from .kimi-code by default', async () => {
    await mkdir(path.join(root, '.kimi-code'));
    await writeFile(path.join(root, '.kimi-code', 'ecc-install-state.json'), JSON.stringify(sample.kimiState));
    const result = await invoke(['profile', '--json', '--root', root, '--source', source, '--out', outFile, '--write'], { git: gitFor() });
    assert.equal(result.code, EXIT.OK);
    assert.equal(json(result).kimi, path.join(root, '.kimi-code', 'ecc-install-state.json'));
  });
});
