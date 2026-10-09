import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DOCTOR_SCHEMA, ECC_COMMIT, KIROIGNORE_BLOCK_BEGIN, KIROIGNORE_BLOCK_END, STATE_SCHEMA, cacheCheckoutName } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { collectDoctor, formatDoctor } from '../skills/ecc-kiro-setup/scripts/lib/doctor.mjs';
import { VALID_SKILL_MD, memoryProbes } from './helpers.mjs';

const ROOT = '/work/project';
const SKILL_DIR = `${ROOT}/.kiro/skills/ecc-kiro-setup`;

function run({ files = {}, root = ROOT, skillDir = SKILL_DIR, withSkill = true, ...probeOptions } = {}) {
  const allFiles = withSkill ? { [`${skillDir}/SKILL.md`]: VALID_SKILL_MD, ...files } : files;
  return collectDoctor({ root, skillDir, probes: memoryProbes({ ...probeOptions, files: allFiles }) });
}
const findings = (report) => report.problems.map((item) => `${item.severity}:${item.code}`);

describe('collectDoctor: tools', () => {
  it('reports a healthy environment', async () => {
    const report = await run();
    assert.equal(report.schema, DOCTOR_SCHEMA);
    assert.equal(report.ok, true);
    assert.deepEqual(report.tools.node, { version: '22.22.0', required: '>=18.0.0', ok: true });
    assert.deepEqual(report.tools.git, { found: true, version: '2.42.0', partialClone: true });
    assert.deepEqual(report.tools.kiroCli, { found: true, version: '2.28.0', v3Flag: true, nativeV3: false });
    assert.equal(report.eccTarget.commit, ECC_COMMIT);
    assert.deepEqual(findings(report), ['info:kiro-cli-v3-opt-in']);
    assert.equal(report.selfCheck.valid, true);
  });

  it('fails when Node is older than 18', async () => {
    const report = await run({ node: '16.20.2' });
    assert.equal(report.ok, false);
    assert.equal(report.tools.node.ok, false);
    assert.ok(findings(report).includes('error:node-too-old'));
  });

  it('warns when git is missing or too old for a partial clone', async () => {
    const missing = await run({ git: null });
    assert.deepEqual(missing.tools.git, { found: false, version: null, partialClone: false });
    assert.ok(findings(missing).includes('warn:git-missing'));
    assert.equal(missing.ok, true);

    const old = await run({ git: 'git version 2.20.1' });
    assert.equal(old.tools.git.partialClone, false);
    assert.ok(findings(old).includes('warn:git-old'));

    const edge = await run({ git: 'git version 2.24.9' });
    assert.ok(findings(edge).includes('warn:git-old'));
    const boundary = await run({ git: 'git version 2.25.0' });
    assert.equal(boundary.tools.git.partialClone, true);
    assert.ok(!findings(boundary).includes('warn:git-old'));
  });

  it('describes kiro-cli states', async () => {
    const absent = await run({ kiro: { found: false, version: null, v3Flag: null } });
    assert.deepEqual(findings(absent), ['info:kiro-cli-not-found']);

    const noV3 = await run({ kiro: { found: true, version: '2.10.0', v3Flag: false } });
    assert.deepEqual(findings(noV3), ['warn:kiro-cli-no-v3']);

    const native = await run({ kiro: { found: true, version: '3.1.0', v3Flag: true } });
    assert.equal(native.tools.kiroCli.nativeV3, true);
    assert.deepEqual(findings(native), []);

    const unknownFlag = await run({ kiro: { found: true, version: '2.28.0', v3Flag: null } });
    assert.deepEqual(findings(unknownFlag), []);
  });
});

describe('collectDoctor: target project', () => {
  it('lists only known subfolders of .kiro, in a stable order', async () => {
    const report = await run({
      files: { [`${ROOT}/.kiro/steering/a.md`]: 'x', [`${ROOT}/.kiro/agents/b.md`]: 'x', [`${ROOT}/.kiro/custom/c.txt`]: 'x' },
    });
    assert.equal(report.target.kiroDir.exists, true);
    assert.deepEqual(report.target.kiroDir.subdirs, ['agents', 'skills', 'steering']);
  });

  it('reports a missing .kiro folder', async () => {
    const report = await run({ withSkill: false, skillDir: '/elsewhere/ecc-kiro-setup', files: { '/elsewhere/ecc-kiro-setup/SKILL.md': VALID_SKILL_MD } });
    assert.equal(report.target.kiroDir.exists, false);
    assert.deepEqual(report.target.kiroDir.subdirs, []);
  });

  it('detects a git repository', async () => {
    assert.equal((await run()).target.isGitRepo, false);
    assert.equal((await run({ files: { [`${ROOT}/.git/HEAD`]: 'ref' } })).target.isGitRepo, true);
  });

  it('detects .kiroignore and the managed block', async () => {
    assert.deepEqual((await run()).target.kiroignore, { exists: false, managedBlock: false });
    assert.deepEqual((await run({ files: { [`${ROOT}/.kiroignore`]: '.env\n' } })).target.kiroignore, { exists: true, managedBlock: false });
    const block = `.env\n${KIROIGNORE_BLOCK_BEGIN}\n.claude/\n${KIROIGNORE_BLOCK_END}\n`;
    assert.deepEqual((await run({ files: { [`${ROOT}/.kiroignore`]: block } })).target.kiroignore, { exists: true, managedBlock: true });
    const half = `${KIROIGNORE_BLOCK_BEGIN}\n.claude/\n`;
    assert.equal((await run({ files: { [`${ROOT}/.kiroignore`]: half } })).target.kiroignore.managedBlock, false);
  });

  it('lists harness folders that exist as directories', async () => {
    const report = await run({
      files: {
        [`${ROOT}/.kimi-code/README.md`]: 'x',
        [`${ROOT}/.claude/settings.json`]: '{}',
        [`${ROOT}/.cursor`]: 'a file, not a folder',
        [`${ROOT}/.gitignore`]: 'x',
      },
    });
    assert.deepEqual(report.target.harnessDirs, ['.claude', '.kimi-code']);
  });
});

describe('collectDoctor: install state', () => {
  const stateAt = (text) => run({ files: { [`${ROOT}/.kiro/ecc/install-state.json`]: text } });

  it('reports no install when there is no state file', async () => {
    assert.deepEqual((await run()).target.installState, { exists: false, path: '.kiro/ecc/install-state.json' });
  });

  it('summarizes a valid state file', async () => {
    const report = await stateAt(
      JSON.stringify({
        schema: STATE_SCHEMA,
        installedAt: '2026-10-07T00:00:00.000Z',
        profile: { id: 'kimi-parity' },
        source: { version: '2.2.3', commit: ECC_COMMIT },
        files: [{}, {}, {}],
      }),
    );
    assert.deepEqual(report.target.installState, {
      exists: true,
      path: '.kiro/ecc/install-state.json',
      valid: true,
      schema: STATE_SCHEMA,
      profile: 'kimi-parity',
      eccVersion: '2.2.3',
      eccCommit: ECC_COMMIT,
      installedAt: '2026-10-07T00:00:00.000Z',
      files: 3,
    });
    assert.equal(report.ok, true);
  });

  it('fails on a state file that is not JSON or not an object', async () => {
    for (const text of ['{not json', '[]', 'null', '"text"']) {
      const report = await stateAt(text);
      assert.equal(report.ok, false, text);
      assert.ok(findings(report).includes('error:state-corrupt'), text);
      assert.equal(report.target.installState.valid, false);
    }
  });

  it('warns about an unknown schema but keeps going', async () => {
    const report = await stateAt(JSON.stringify({ schema: 'something.else', files: [] }));
    assert.equal(report.ok, true);
    assert.ok(findings(report).includes('warn:state-schema-unknown'));
    assert.equal(report.target.installState.files, 0);
  });
});

describe('collectDoctor: locations and cache', () => {
  it('warns when the skill is installed in more than one place', async () => {
    assert.ok(!findings(await run()).includes('warn:skill-duplicate'));
    const both = await run({ files: { '/home/tester/.kiro/skills/ecc-kiro-setup/SKILL.md': VALID_SKILL_MD } });
    assert.ok(findings(both).includes('warn:skill-duplicate'));
    assert.deepEqual(both.locations.present, { project: true, global: true, power: false });
    const withPower = await run({ files: { '/home/tester/.kiro/powers/installed/ecc-kiro-setup/plugin.json': '{}' } });
    assert.deepEqual(withPower.locations.present, { project: true, global: false, power: true });
    assert.ok(findings(withPower).includes('warn:skill-duplicate'));
  });

  it('honors KIRO_HOME', async () => {
    const report = await run({ env: { KIRO_HOME: '/custom/kiro' } });
    assert.equal(report.locations.kiroHome, '/custom/kiro');
    assert.equal(report.locations.global, '/custom/kiro/skills/ecc-kiro-setup');
    assert.equal((await run()).locations.kiroHome, '/home/tester/.kiro');
  });

  it('resolves the cache location in order: ECC_KIRO_CACHE, XDG_CACHE_HOME, home', async () => {
    assert.equal((await run()).cache.root, '/home/tester/.cache/ecc-kiro');
    assert.equal((await run({ env: { XDG_CACHE_HOME: '/xdg' } })).cache.root, '/xdg/ecc-kiro');
    assert.equal((await run({ env: { XDG_CACHE_HOME: '/xdg', ECC_KIRO_CACHE: '/custom/cache' } })).cache.root, '/custom/cache');
  });

  it('detects the pinned checkout in the cache', async () => {
    const env = { ECC_KIRO_CACHE: '/custom/cache' };
    assert.deepEqual((await run({ env })).cache, {
      root: '/custom/cache',
      exists: false,
      checkout: `/custom/cache/${cacheCheckoutName()}`,
      checkoutExists: false,
    });
    const partial = await run({ env, dirs: ['/custom/cache'] });
    assert.equal(partial.cache.exists, true);
    assert.equal(partial.cache.checkoutExists, false);
    const full = await run({ env, dirs: [`/custom/cache/${cacheCheckoutName()}`] });
    assert.equal(full.cache.checkoutExists, true);
  });
});

describe('collectDoctor: self-check', () => {
  it('fails when SKILL.md is missing', async () => {
    const report = await run({ withSkill: false });
    assert.equal(report.ok, false);
    assert.equal(report.selfCheck.found, false);
    assert.ok(findings(report).includes('error:skill-md-missing'));
  });

  it('fails when SKILL.md is invalid', async () => {
    const report = await run({ files: { [`${SKILL_DIR}/SKILL.md`]: '# no frontmatter\n' } });
    assert.equal(report.ok, false);
    assert.equal(report.selfCheck.valid, false);
    assert.ok(findings(report).includes('error:skill-invalid'));
  });

  it('fails when the folder name does not match the skill name', async () => {
    const report = await run({ skillDir: '/x/wrong-name', files: { '/x/wrong-name/SKILL.md': VALID_SKILL_MD }, withSkill: false });
    assert.equal(report.ok, false);
    assert.deepEqual(report.selfCheck.errors.map((e) => e.code), ['name-dir-mismatch']);
  });
});

describe('doctor output', () => {
  it('produces a report that survives a JSON round trip unchanged', async () => {
    const report = await run({ files: { [`${ROOT}/.kiroignore`]: 'x', [`${ROOT}/.claude/a`]: 'x' } });
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  });

  it('renders a readable summary', async () => {
    const text = formatDoctor(await run());
    assert.match(text, /ecc-kiro-setup 0\.1\.0 doctor \(ECC v2\.2\.3 @ c05b2d6\)/);
    assert.match(text, /node\s+22\.22\.0\s+ok/);
    assert.match(text, /kiro-cli\s+2\.28\.0\s+V3 via --v3/);
    assert.match(text, /ECC install\s+none/);
    assert.match(text, /SKILL\.md valid/);
    assert.match(text, /Result: ok\n$/);
  });

  it('renders findings with their fixes when something is wrong', async () => {
    const text = formatDoctor(await run({ node: '16.0.0' }));
    assert.match(text, /\[error\] node-too-old:/);
    assert.match(text, /fix: Install Node 18\.0\.0 or newer\./);
    assert.match(text, /Result: problems need attention\n$/);
  });
});
