import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ECC_COMMIT, PROFILE_SCHEMA } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import { CATEGORIES, EXTRAS_SCHEMA, buildProfile, classifyPath, countEntries, formatProfile, validateExtras, validateProfile } from '../skills/ecc-kiro-setup/scripts/lib/profile.mjs';
import { sampleEcc } from './fixtures.mjs';

const place = (category, fields = {}) => ({ category, fields });

describe('classifyPath', () => {
  const cases = [
    ['agents/planner.md', place('agent', { name: 'planner' })],
    ['commands/plan.md', place('command', { name: 'plan' })],
    ['rules/README.md', place('rule', { pack: '', file: 'README.md' })],
    ['rules/common/coding-style.md', place('rule', { pack: 'common', file: 'coding-style.md' })],
    ['scripts/harness-audit.js', place('script', { name: 'harness-audit.js' })],
    ['skills/tdd-workflow/SKILL.md', place('skill', { skill: 'tdd-workflow', rel: 'SKILL.md' })],
    ['skills/ck/commands/save.mjs', place('skill', { skill: 'ck', rel: 'commands/save.mjs' })],
    ['skills/continuous-learning-v2/agents/observer.md', place('skill', { skill: 'continuous-learning-v2', rel: 'agents/observer.md' })],
    ['.agents/skills/api-design/SKILL.md', place('skill', { skill: 'api-design', rel: 'SKILL.md' })],
    ['.agents/skills/brand-discovery/references/90_SYNTHESIS.md', place('skill', { skill: 'brand-discovery', rel: 'references/90_SYNTHESIS.md' })],
    ['AGENTS.md', place('agents-md')],
    ['mcp-configs/mcp-servers.json', place('mcp-catalog')],
    ['LICENSE', place('license')],
    ['.kiro/steering/coding-style.md', place('adapter-steering', { name: 'coding-style' })],
    ['.kiro/hooks/tdd-reminder.kiro.hook', place('adapter-hook', { name: 'tdd-reminder' })],
    ['.kiro/scripts/quality-gate.sh', place('adapter-script', { name: 'quality-gate' })],
    ['.kiro/settings/mcp.json.example', place('adapter-mcp-example')],
  ];
  for (const [rel, expected] of cases) {
    it(`places ${rel}`, () => assert.deepEqual(classifyPath(rel), expected));
  }

  it('marks Codex, Pi and Kimi-only files as excluded', () => {
    assert.deepEqual(classifyPath('.agents/skills/api-design/agents/openai.yaml'), { excluded: 'codex-metadata' });
    assert.deepEqual(classifyPath('skills/x/agents/openai.yaml'), { excluded: 'codex-metadata' });
    assert.deepEqual(classifyPath('.pi/extensions/index.ts'), { excluded: 'pi-adapter' });
    assert.deepEqual(classifyPath('.kimi/README.md'), { excluded: 'kimi-adapter' });
    assert.deepEqual(classifyPath('.mcp.json'), { excluded: 'kimi-mcp-config' });
  });

  it('returns null for paths it cannot place', () => {
    for (const rel of [
      'agents/readme.txt',
      'agents/sub/x.md',
      'commands/x.txt',
      'rules/a/b/c.md',
      'skills/only-a-folder',
      'skills/x',
      '.agents/skills/x',
      '.agents/other/x/y',
      '.kiro/install.sh',
      '.kiro/hooks/README.md',
      '.kiro/steering/sub/x.md',
      '.kiro/agents/planner.md',
      'docs/guide.md',
    ]) {
      assert.equal(classifyPath(rel), null, rel);
    }
  });
});

describe('buildProfile', () => {
  const build = (mutate) => {
    const sample = sampleEcc();
    mutate?.(sample);
    return buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes: sample.hashes });
  };

  it('builds a valid, sorted profile from a Kimi install and the adapter files', () => {
    const { profile, problems } = build();
    assert.deepEqual(problems, []);
    assert.equal(profile.schema, PROFILE_SCHEMA);
    assert.equal(profile.source.commit, ECC_COMMIT);
    assert.deepEqual(validateProfile(profile), []);
    assert.deepEqual(
      profile.entries.map(({ category, path }) => `${category} ${path}`),
      [
        'agent agents/planner.md',
        'skill .agents/skills/api-design/SKILL.md',
        'skill skills/tdd-workflow/SKILL.md',
        'skill skills/tdd-workflow/references/notes.md',
        'command commands/plan.md',
        'rule rules/README.md',
        'rule rules/common/coding-style.md',
        'agents-md AGENTS.md',
        'mcp-catalog mcp-configs/mcp-servers.json',
        'script scripts/harness-audit.js',
        'adapter-steering .kiro/steering/coding-style.md',
        'adapter-hook .kiro/hooks/tdd-reminder.kiro.hook',
        'adapter-script .kiro/scripts/quality-gate.sh',
        'adapter-mcp-example .kiro/settings/mcp.json.example',
        'license LICENSE',
      ],
    );
  });

  it('records the metadata each category needs, with the hash last', () => {
    const { profile } = build();
    const skill = profile.entries.find((entry) => entry.path === '.agents/skills/api-design/SKILL.md');
    assert.deepEqual(Object.keys(skill), ['category', 'path', 'skill', 'rel', 'sha256']);
    assert.equal(skill.sha256, sha256Hex(sampleEcc().files['.agents/skills/api-design/SKILL.md']));
    const rule = profile.entries.find((entry) => entry.path === 'rules/README.md');
    assert.deepEqual({ pack: rule.pack, file: rule.file }, { pack: '', file: 'README.md' });
  });

  it('counts entries per category and distinct skill folders', () => {
    const { profile } = build();
    assert.equal(profile.counts.agent, 1);
    assert.equal(profile.counts.skill, 3);
    assert.equal(profile.counts.skillDirs, 2);
    assert.equal(profile.counts.license, 1);
    assert.deepEqual(profile.counts, countEntries(profile.entries));
  });

  it('lists what it left out, sorted, and keeps the Kimi module list', () => {
    const { profile } = build();
    assert.deepEqual(profile.excluded, [
      { path: '.agents/skills/api-design/agents/openai.yaml', reason: 'codex-metadata' },
      { path: '.kimi/README.md', reason: 'kimi-adapter' },
      { path: '.mcp.json', reason: 'kimi-mcp-config' },
      { path: '.pi/README.md', reason: 'pi-adapter' },
    ]);
    assert.deepEqual(profile.derivedFrom, { harness: 'kimi', installSchema: 'ecc.install.v1', repoVersion: '2.2.3', modules: ['rules-core', 'agents-core'] });
  });

  it('does not need excluded files to exist in the checkout', () => {
    const { problems } = build(({ hashes }) => {
      hashes.delete('.pi/README.md');
      hashes.delete('.kimi/README.md');
      hashes.delete('.agents/skills/api-design/agents/openai.yaml');
    });
    assert.deepEqual(problems, []);
  });

  it('ignores adapter files it does not use', () => {
    const { profile } = build();
    assert.ok(!profile.entries.some((entry) => entry.path.endsWith('install.sh') || entry.path.endsWith('hooks/README.md')));
  });

  it('stops on a hash that differs from the Kimi record', () => {
    const { problems } = build(({ hashes }) => hashes.set('agents/planner.md', 'f'.repeat(64)));
    assert.deepEqual(problems.map((item) => `${item.code} ${item.path}`), ['hash-mismatch agents/planner.md']);
  });

  it('reports files missing from the checkout, including the license', () => {
    const { problems } = build(({ hashes }) => {
      hashes.delete('commands/plan.md');
      hashes.delete('LICENSE');
    });
    assert.deepEqual(problems.map((item) => `${item.code} ${item.path}`), ['source-missing commands/plan.md', 'source-missing LICENSE']);
  });

  it('reports paths it cannot place or that are unsafe', () => {
    const { problems } = build(({ kimiState }) => {
      kimiState.operations.push({ kind: 'copy-file', sourceRelativePath: 'docs/other.md', contentSha256: 'a'.repeat(64) });
      kimiState.operations.push({ kind: 'copy-file', sourceRelativePath: '../escape.md', contentSha256: 'a'.repeat(64) });
    });
    assert.deepEqual(problems.map((item) => item.code), ['unclassified-path', 'kimi-path-unsafe']);
  });

  it('reports invalid hashes and unexpected operation kinds on placeable files', () => {
    const { problems } = build(({ kimiState }) => {
      kimiState.operations[0].contentSha256 = 'not-a-hash';
      kimiState.operations[1].kind = 'symlink';
    });
    assert.deepEqual(problems.map((item) => item.code), ['kimi-hash-invalid', 'kimi-operation-kind']);
  });

  it('reports two files that would land on the same destination', () => {
    const { problems } = build(({ kimiState, hashes, files }) => {
      files['.agents/skills/tdd-workflow/SKILL.md'] = 'other';
      hashes.set('.agents/skills/tdd-workflow/SKILL.md', sha256Hex('other'));
      kimiState.operations.push({ kind: 'copy-file', sourceRelativePath: '.agents/skills/tdd-workflow/SKILL.md', contentSha256: sha256Hex('other') });
    });
    assert.deepEqual(problems.map((item) => item.code), ['duplicate-entry']);
  });

  it('rejects a Kimi install of another ECC version or schema', () => {
    const { problems } = build(({ kimiState }) => {
      kimiState.source.repoVersion = '2.1.0';
      kimiState.schemaVersion = 'ecc.install.v9';
    });
    assert.deepEqual(problems.map((item) => item.code), ['kimi-schema', 'kimi-version']);
  });

  it('returns no profile when the state is unusable', () => {
    assert.equal(buildProfile({ kimiState: null, hashes: new Map() }).profile, null);
    assert.equal(buildProfile({ kimiState: [], hashes: new Map() }).profile, null);
    const noOps = buildProfile({ kimiState: { schemaVersion: 'ecc.install.v1', source: { repoVersion: '2.2.3' } }, hashes: new Map() });
    assert.equal(noOps.profile, null);
    assert.deepEqual(noOps.problems.map((item) => item.code), ['kimi-operations']);
  });
});

describe('formatProfile', () => {
  const { profile } = buildProfile({ ...pick(sampleEcc()) });

  function pick({ kimiState, adapterPaths, hashes }) {
    return { kimiState, adapterPaths, hashes };
  }

  it('writes JSON that reads back to the same profile', () => {
    assert.deepEqual(JSON.parse(formatProfile(profile)), profile);
  });

  it('puts one entry per line and ends with a newline', () => {
    const text = formatProfile(profile);
    assert.ok(text.endsWith('}\n'));
    const entryLines = text.split('\n').filter((line) => line.startsWith('    {"category"'));
    assert.equal(entryLines.length, profile.entries.length);
  });

  it('is stable: formatting the parsed text gives the same text', () => {
    const text = formatProfile(profile);
    assert.equal(formatProfile(JSON.parse(text)), text);
  });

  it('writes empty lists compactly', () => {
    const empty = { ...profile, excluded: [], entries: [] };
    assert.match(formatProfile(empty), /"excluded": \[\],\n {2}"entries": \[\]\n\}\n$/);
  });
});

describe('validateProfile', () => {
  const fresh = () => structuredClone(buildProfile(pickSample()).profile);
  function pickSample() {
    const { kimiState, adapterPaths, hashes } = sampleEcc();
    return { kimiState, adapterPaths, hashes };
  }
  const codes = (profile) => validateProfile(profile).map((item) => item.code);

  it('accepts a freshly built profile', () => {
    assert.deepEqual(validateProfile(fresh()), []);
  });

  it('rejects things that are not profiles', () => {
    for (const bad of [null, [], 'text', 3]) assert.deepEqual(codes(bad), ['profile-shape']);
    assert.ok(codes({}).includes('profile-schema'));
  });

  it('rejects another schema, id or ECC release', () => {
    const schema = fresh();
    schema.schema = 'x';
    assert.ok(codes(schema).includes('profile-schema'));
    const id = fresh();
    id.id = 'minimal';
    assert.ok(codes(id).includes('profile-id'));
    const source = fresh();
    source.source.commit = 'b'.repeat(40);
    assert.ok(codes(source).includes('profile-source'));
  });

  it('rejects entries that are not an array', () => {
    const profile = fresh();
    profile.entries = {};
    assert.deepEqual(codes(profile).slice(-1), ['profile-entries']);
  });

  it('rejects unknown categories, unsafe paths and bad hashes', () => {
    const category = fresh();
    category.entries[0].category = 'mystery';
    assert.ok(codes(category).includes('entry-category'));
    const unsafe = fresh();
    unsafe.entries[0].path = '../outside';
    assert.ok(codes(unsafe).includes('entry-path-unsafe'));
    const hash = fresh();
    hash.entries[0].sha256 = 'ABC';
    assert.ok(codes(hash).includes('entry-sha256'));
    const shape = fresh();
    shape.entries[0] = 'text';
    assert.ok(codes(shape).includes('entry-shape'));
  });

  it('rejects extra or malformed per-category fields', () => {
    const extra = fresh();
    extra.entries[0].surprise = 1;
    assert.ok(codes(extra).includes('entry-unknown-field'));
    const name = fresh();
    name.entries[0].name = '../x';
    assert.ok(codes(name).includes('entry-field'));
    const rel = fresh();
    const skill = rel.entries.find((entry) => entry.category === 'skill');
    skill.rel = '../x';
    assert.ok(codes(rel).includes('entry-field'));
  });

  it('rejects a path that does not match its category and fields', () => {
    const profile = fresh();
    profile.entries[0].name = 'someone-else';
    assert.ok(codes(profile).includes('entry-inconsistent'));
    const moved = fresh();
    moved.entries[0].path = 'commands/planner.md';
    assert.ok(codes(moved).includes('entry-inconsistent'));
  });

  it('rejects duplicates and unsorted entries', () => {
    const dup = fresh();
    dup.entries.push({ ...dup.entries[0] });
    assert.ok(codes(dup).includes('entry-duplicate'));
    const unsorted = fresh();
    [unsorted.entries[0], unsorted.entries[1]] = [unsorted.entries[1], unsorted.entries[0]];
    assert.ok(codes(unsorted).includes('profile-unsorted'));
  });

  it('rejects counts that disagree with the entries, whatever their key order', () => {
    const wrong = fresh();
    wrong.counts.agent = 99;
    assert.deepEqual(codes(wrong), ['profile-counts']);
    const reordered = fresh();
    reordered.counts = Object.fromEntries(Object.entries(reordered.counts).reverse());
    assert.deepEqual(codes(reordered), []);
  });

  it('checks the excluded list', () => {
    const profile = fresh();
    profile.excluded.push({ path: '../x', reason: 'r' });
    assert.ok(codes(profile).includes('excluded-shape'));
    const missing = fresh();
    delete missing.excluded;
    assert.ok(codes(missing).includes('profile-excluded'));
  });

  it('covers every category in the sort order', () => {
    assert.equal(new Set(CATEGORIES).size, CATEGORIES.length);
  });
});

describe('extras', () => {
  const extraPath = 'skills/orch-pipeline/SKILL.md';
  const extras = [{ path: extraPath, reason: 'The orch commands share this skill.' }];
  const withExtra = () => {
    const sample = sampleEcc();
    const hashes = new Map(sample.hashes);
    hashes.set(extraPath, sha256Hex('orch pipeline'));
    return { sample, hashes };
  };

  it('adds the files on top of the Kimi set, with the hash of the pinned checkout, and records the reason', () => {
    const { sample, hashes } = withExtra();
    const plain = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes }).profile;
    const { profile, problems } = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes, extras });
    assert.deepEqual(problems, []);
    assert.equal(profile.entries.length, plain.entries.length + 1);
    assert.deepEqual(profile.entries.find((entry) => entry.path === extraPath), { category: 'skill', path: extraPath, skill: 'orch-pipeline', rel: 'SKILL.md', sha256: sha256Hex('orch pipeline') });
    assert.deepEqual(profile.extras, extras);
    assert.equal(profile.counts.skill, plain.counts.skill + 1);
    assert.equal(profile.counts.skillDirs, plain.counts.skillDirs + 1);
    assert.deepEqual(validateProfile(profile), []);
    assert.equal(plain.extras, undefined, 'a profile without extras has no extras key');
  });

  it('keeps the entries sorted, and writes the extras one per line before the counts', () => {
    const { sample, hashes } = withExtra();
    const { profile } = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes, extras });
    const text = formatProfile(profile);
    assert.match(text, /"description"[^\n]*\n {2}"source"[^\n]*\n {2}"derivedFrom"[^\n]*\n {2}"extras": \[\n {4}\{"path": "skills\/orch-pipeline\/SKILL\.md", "reason": "The orch commands share this skill\."\}\n {2}\],\n {2}"counts"/);
    assert.deepEqual(JSON.parse(text), profile);
    assert.deepEqual(validateProfile(JSON.parse(text)), []);
  });

  it('refuses an extra that is already in the profile, one with no hash in the checkout, and one it cannot place', () => {
    const { sample, hashes } = withExtra();
    const taken = sample.kimiState.operations.find((op) => op.sourceRelativePath.startsWith('skills/'))?.sourceRelativePath;
    const duplicate = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes, extras: [{ path: taken, reason: 'twice' }] });
    assert.deepEqual(duplicate.problems.map((item) => item.code), ['extra-duplicate']);
    const missing = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes: sample.hashes, extras });
    assert.deepEqual(missing.problems.map((item) => item.code), ['source-missing']);
    const odd = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes, extras: [{ path: 'docs/readme.md', reason: 'no' }] });
    assert.deepEqual(odd.problems.map((item) => item.code), ['extra-unplaceable']);
  });

  it('is checked on load: an extra must be an entry, with a reason', () => {
    const { sample, hashes } = withExtra();
    const { profile } = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes, extras });
    const codes = (value) => validateProfile(value).map((item) => item.code);
    assert.deepEqual(codes({ ...profile, extras: [{ path: 'skills/other/SKILL.md', reason: 'x' }] }), ['profile-extras']);
    assert.deepEqual(codes({ ...profile, extras: [{ path: extraPath, reason: '  ' }] }), ['profile-extras']);
    assert.deepEqual(codes({ ...profile, extras: [{ path: extraPath, reason: 'x', more: 1 }] }), ['profile-extras']);
    assert.deepEqual(codes({ ...profile, extras: 'orch' }), ['profile-extras']);
  });

  describe('validateExtras', () => {
    const good = { schema: EXTRAS_SCHEMA, description: 'd', entries: [{ path: extraPath, reason: 'why' }] };
    it('accepts a file with entries that can be placed', () => assert.deepEqual(validateExtras(good), []));
    it('rejects the wrong schema, unknown keys, a missing reason, unsafe or unplaceable or repeated paths', () => {
      const messages = (value) => validateExtras(value).map((item) => item.message);
      assert.match(messages({ ...good, schema: 'x' })[0], /expected schema ecc-kiro\.profile-extras\.v1/);
      assert.match(messages({ ...good, more: 1 })[0], /unexpected key\(s\): more/);
      assert.match(messages({ ...good, entries: [{ path: extraPath }] })[0], /"reason" must say why/);
      assert.match(messages({ ...good, entries: [{ path: '../x/SKILL.md', reason: 'r' }] })[0], /unsafe path/);
      assert.match(messages({ ...good, entries: [{ path: 'docs/a.md', reason: 'r' }] })[0], /cannot place/);
      assert.match(messages({ ...good, entries: [good.entries[0], good.entries[0]] })[0], /listed twice/);
      assert.match(messages({ ...good, entries: 'x' })[0], /must be a list/);
      assert.match(messages(null)[0], /JSON object/);
    });
  });
});
