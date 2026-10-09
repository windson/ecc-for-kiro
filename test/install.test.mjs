// End-to-end tests of `plan` and `install` through runCli: a fake ECC checkout, a profile built from
// it, and real temporary project folders. No network, no git.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { STATE_RELATIVE_PATH } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { EXIT, runCli, usage } from '../skills/ecc-kiro-setup/scripts/lib/cli.mjs';
import { formatPlanReport } from '../skills/ecc-kiro-setup/scripts/lib/commands/plan.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import { validateHookFile } from '../skills/ecc-kiro-setup/scripts/lib/hook-schema.mjs';
import { buildProfile, formatProfile, validateProfile } from '../skills/ecc-kiro-setup/scripts/lib/profile.mjs';
import { parseState } from '../skills/ecc-kiro-setup/scripts/lib/state.mjs';
import { validateWorkflowRecipe } from '../skills/ecc-kiro-setup/scripts/lib/workflow-schema.mjs';
import { captureStreams, memoryProbes } from './helpers.mjs';
import { minimalCommandAssets, writeCommandAssets } from './command-assets.mjs';
import { fail, fakeGit, makeTempDir, sampleEcc, writeTree } from './fixtures.mjs';
import { legacyHookPath, legacyHookText, shippedHookAssets, writeHookAssets } from './hook-assets.mjs';

const SKILL_DIR = '/work/project/.kiro/skills/ecc-kiro-setup';
const NOW = new Date('2026-10-07T10:00:00.000Z');
const LATER = new Date('2026-10-20T09:30:00.000Z');

const agentText = (name, description, tools, extra = '') => `---\nname: ${name}\ndescription: ${description}\ntools: ${tools}\nmodel: sonnet\n${extra}---\n\n## Prompt Defense Baseline\n\nBe careful, ${name}.\n`;

const AGENTS_MD = [
  '# Sample — Agent Instructions',
  '',
  '## Core Principles',
  '',
  '1. **Agent-First** — Delegate',
  '',
  '## Available Agents',
  '',
  '| Agent | Purpose | When to Use |',
  '|-------|---------|-------------|',
  '| planner | Planning | Complex features |',
  '| code-reviewer | Review | After writing code |',
  '| docs-lookup | Docs | API questions |',
  '',
  '## Agent Orchestration',
  '',
  'Use agents proactively:',
  '- Complex feature requests → **ecc:planner**',
  '',
].join('\n');

/** Steering sources: the adapter's files (three inclusion modes) and one language rule pack. */
const STEERING_SOURCES = {
  'AGENTS.md': AGENTS_MD,
  '.kiro/steering/coding-style.md': '---\ninclusion: auto\nname: coding-style\ndescription: Core style rules.\n---\n\n# Coding Style\n\nKeep files small.\n',
  '.kiro/steering/python-patterns.md': '---\ninclusion: fileMatch\nfileMatchPattern: "*.py"\ndescription: Python patterns\n---\n\n# Python\n',
  '.kiro/steering/dev-mode.md': '---\ninclusion: manual\ndescription: Dev mode\n---\n\n# Dev\n\nUse `#dev-mode` to start.\n',
  'rules/perl/coding-style.md': '---\npaths:\n  - "**/*.pl"\n---\n# Perl Coding Style\n\n> Extends [common/coding-style.md](../common/coding-style.md).\n',
  'rules/perl/testing.md': '---\npaths:\n  - "**/*.t"\n---\n# Perl Testing\n',
};
/** Command sources: plan (class A), quality-gate (built by the engine), a class C command, and one that a skill of the same name covers. */
const COMMAND_SOURCES = {
  'commands/quality-gate.md': '---\ndescription: Formatter gate.\n---\nRun node scripts/hooks/quality-gate.js.\n',
  'commands/orch-add-feature.md': '---\ndescription: Add a feature.\n---\nInvoke the `orch-add-feature` skill with $ARGUMENTS.\n',
  'commands/api-design.md': '---\ndescription: API design.\n---\nThin wrapper.\n',
  '.kiro/scripts/format.sh': '#!/bin/bash\necho format\n',
};
const FIXTURE_CLASSES = {
  plan: { class: 'A' },
  'quality-gate': { class: 'B', builtin: 'quality-gate', design: 'B10' },
  'orch-add-feature': { class: 'C', reason: 'invokes skills that are not in the profile', missing: 'C2: six skills', design: 'C2' },
  'api-design': { class: 'A', skill: 'api-design' },
};
const COMMAND_FILES = ['.kiro/ecc/scripts/format.sh', '.kiro/ecc/scripts/quality-gate.sh', '.kiro/steering/ecc-plan.md', '.kiro/steering/ecc-quality-gate.md'];
/** Hook sources: a file hook (it replaces the stub of sampleEcc), the git push hook, and one that is started by hand and so is not converted. */
const HOOK_SOURCES = {
  [legacyHookPath('tdd-reminder')]: legacyHookText({
    name: 'tdd-reminder',
    description: 'Reminds the agent about tests.',
    when: { type: 'fileCreated', patterns: ['*.ts', '*.tsx'] },
    then: { type: 'askAgent', prompt: 'A new TypeScript file was just created. Consider tests.' },
  }),
  [legacyHookPath('git-push-review')]: legacyHookText({
    name: 'git-push-review',
    description: 'Reviews shell commands.',
    when: { type: 'preToolUse', toolTypes: ['shell'] },
    then: { type: 'askAgent', prompt: 'A shell command is about to be executed.' },
  }),
  [legacyHookPath('quality-gate')]: legacyHookText({
    name: 'quality-gate',
    description: 'Run the quality gate.',
    when: { type: 'userTriggered' },
    then: { type: 'runCommand', command: 'bash .kiro/scripts/quality-gate.sh' },
  }),
};
const HOOK_FILES = ['.kiro/ecc/scripts/git-push-guard.mjs', '.kiro/hooks/ecc-git-push-review.json', '.kiro/hooks/ecc-tdd-reminder.json'];
/** MCP sources: two servers in the catalog (with the fields Kiro does not use) and one in the example of the Kiro adapter, and a license. */
const MCP_SOURCES = {
  'mcp-configs/mcp-servers.json': `${JSON.stringify(
    {
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@example/github'], env: { GITHUB_TOKEN: 'YOUR_GITHUB_PAT_HERE' }, description: 'GitHub operations' },
        hosted: { type: 'http', url: 'https://mcp.example.com/mcp', description: 'A hosted server' },
      },
      _comments: { usage: 'Copy the servers you need to your ~/.claude.json mcpServers section' },
    },
    null,
    2,
  )}\n`,
  '.kiro/settings/mcp.json.example': `${JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['-y', 'docs-mcp'], disabled: false, autoApprove: ['search'] } } }, null, 2)}\n`,
  LICENSE: 'MIT License\n\nCopyright (c) 2026 Test Holder\n',
};
/** The files of the mcp and license parts. The isolation part writes nothing here: the project has no folder of another harness. */
const SUPPORT_FILES = ['.kiro/ecc/LICENSE', '.kiro/ecc/THIRD_PARTY_NOTICES.md', '.kiro/ecc/mcp-servers.md', '.kiro/ecc/mcp.json.example'];
/** The files of the owned part: three scripts, two hook files, three panel agents and the orch-review recipe. */
const OWNED_FILES = [
  '.kiro/agents/ecc-panel-backend.md',
  '.kiro/agents/ecc-panel-frontend.md',
  '.kiro/agents/ecc-panel-reviewer.md',
  '.kiro/ecc/scripts/feature-check.mjs',
  '.kiro/ecc/scripts/hookify-guard.mjs',
  '.kiro/ecc/scripts/usage-report.mjs',
  '.kiro/hooks/ecc-hookify.json',
  '.kiro/hooks/ecc-instinct-observe.json',
  '.kiro/workflows/ecc-orch-review.workflow.json',
];
const STEERING_FILES = ['.kiro/steering/ecc-agents.md', '.kiro/steering/ecc-coding-style.md', '.kiro/steering/ecc-dev-mode.md', '.kiro/steering/ecc-kiro-harness.md', '.kiro/steering/ecc-perl-rules.md', '.kiro/steering/ecc-python-patterns.md'];

/** sampleEcc() plus a few more agents and the steering sources, with the Kimi state and hashes to match. */
function sampleWithAgents() {
  const sample = sampleEcc();
  const extra = {
    'agents/code-reviewer.md': agentText('code-reviewer', 'Reviews code.', 'Read, Grep, Glob, Bash'),
    'agents/docs-lookup.md': agentText('docs-lookup', 'Looks up docs.', 'Read, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs'),
    'agents/e2e-runner.md': agentText('e2e-runner', 'Runs E2E tests.', 'Read, Write, Edit, Bash, Grep, Glob', 'color: green\n'),
  };
  const files = { ...sample.files, ...extra, ...STEERING_SOURCES, ...COMMAND_SOURCES, ...HOOK_SOURCES, ...MCP_SOURCES };
  const added = (rel) => !(rel in sample.files) && !rel.startsWith('.kiro/');
  const operations = [
    // AGENTS.md has new text, so its recorded hash changes.
    ...sample.kimiState.operations.map((op) => (op.kind === 'copy-file' && files[op.sourceRelativePath] !== sample.files[op.sourceRelativePath] ? { ...op, contentSha256: sha256Hex(files[op.sourceRelativePath]) } : op)),
    ...Object.keys({ ...extra, ...STEERING_SOURCES, ...COMMAND_SOURCES }).filter(added).map((rel) => ({ kind: 'copy-file', sourceRelativePath: rel, contentSha256: sha256Hex(files[rel]) })),
  ];
  const kimiState = { ...sample.kimiState, operations };
  const hashes = new Map(Object.entries(files).map(([rel, text]) => [rel, sha256Hex(text)]));
  const adapterPaths = [...sample.adapterPaths, '.kiro/steering/python-patterns.md', '.kiro/steering/dev-mode.md', '.kiro/scripts/format.sh', legacyHookPath('git-push-review'), legacyHookPath('quality-gate')];
  return { files, kimiState, adapterPaths, hashes };
}

const AGENTS = ['code-reviewer', 'docs-lookup', 'e2e-runner', 'planner'];

describe('plan and install', () => {
  let tmp;
  let counter = 0;
  let sample;
  let source;
  let profileFile;
  let home;
  let root;
  let skillRoot;

  before(async () => {
    tmp = await makeTempDir();
    skillRoot = path.join(tmp.dir, 'skill');
    await writeCommandAssets(skillRoot, minimalCommandAssets({ classes: FIXTURE_CLASSES }));
    await writeHookAssets(skillRoot, shippedHookAssets());
  });
  after(() => tmp.cleanup());

  beforeEach(async () => {
    counter += 1;
    const base = path.join(tmp.dir, `case-${counter}`);
    source = path.join(base, 'ecc');
    profileFile = path.join(base, 'profile.json');
    home = path.join(base, 'home');
    root = path.join(base, 'project');
    sample = sampleWithAgents();
    const { profile } = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes: sample.hashes });
    assert.deepEqual(validateProfile(profile), []);
    await writeTree(source, sample.files);
    await nodeFs.mkdir(root, { recursive: true });
    await nodeFs.mkdir(path.join(home, '.kiro'), { recursive: true });
    await nodeFs.writeFile(profileFile, formatProfile(profile));
  });

  async function invoke(argv, { fs = nodeFs, now = NOW, homedir = home, cwd = root, skillDir = skillRoot, models } = {}) {
    const streams = captureStreams();
    const code = await runCli(argv, {
      stdout: streams.stdout,
      stderr: streams.stderr,
      // `models` is what `kiro-cli chat --list-models -f json` prints (or null when it fails); without it the probe is absent.
      probes: models === undefined ? memoryProbes({ cwd, homedir }) : { ...memoryProbes({ cwd, homedir }), listModels: async () => models },
      skillDir,
      services: { git: fakeGit(() => fail('git not expected')), fs, now: () => now },
    });
    return { code, out: streams.out, err: streams.err };
  }
  const json = (result) => JSON.parse(result.out);
  // `base` runs every part the build has; `common` is limited to the agents part, which most tests below are about.
  const base = (...rest) => [...rest, '--source', source, '--profile', profileFile, '--root', root];
  const common = (...rest) => [...base(...rest), '--only', 'agents'];
  const read = (rel) => nodeFs.readFile(path.join(root, rel), 'utf8');
  const stateOnDisk = async () => parseState(await read(STATE_RELATIVE_PATH));
  const listRoot = () => nodeFs.readdir(root);
  const exists = (rel) => nodeFs.stat(path.join(root, rel)).then(() => true, () => false);
  const GUARD_PATH = '.kiro/ecc/scripts/git-push-guard.mjs';
  /** The block the isolation part writes to .kiroignore, and the folder patterns in it. */
  const BLOCK_RE = /^# >>> ecc-kiro-setup \(managed block, do not edit\) >>>\n# [^\n]+\n((?:\.[a-z-]+\/\n)+)# <<< ecc-kiro-setup <<<\n$/m;
  const BLOCK_FOLDERS = (text) => BLOCK_RE.exec(text)[1].trim().split('\n');
  /** The project as a map from path to the hash of its content ("dir" for a folder). */
  const snapshot = async (dir = root, prefix = '', into = {}) => {
    for (const entry of (await nodeFs.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) {
        into[`${rel}/`] = 'dir';
        await snapshot(path.join(dir, entry.name), `${rel}/`, into);
      } else {
        into[rel] = sha256Hex(await nodeFs.readFile(path.join(dir, entry.name)));
      }
    }
    return into;
  };

  describe('plan', () => {
    it('previews an install without touching the project', async () => {
      const result = await invoke(common('plan', '--json'));
      assert.equal(result.code, EXIT.OK, result.err);
      const report = json(result);
      assert.equal(report.schema, 'ecc-kiro.plan.v1');
      assert.equal(report.ok, true);
      assert.equal(report.dryRun, true);
      assert.equal(report.mode, 'install');
      assert.deepEqual(report.parts, ['agents']);
      assert.deepEqual(report.counts, { create: 4, update: 0, unchanged: 0, keepModified: 0, conflict: 0, remove: 0, stale: 0, forget: 0 });
      assert.equal(report.changes, 4);
      assert.deepEqual(report.protected, [{ path: '.kiro/agents', kind: 'directory', files: 4 }]);
      assert.deepEqual(report.files.map((item) => item.path), AGENTS.map((name) => `.kiro/agents/${name}.md`));
      assert.ok(report.files.every((item) => item.action === 'create' && item.category === 'agent'));
      assert.equal(report.source.origin, 'local');
      assert.equal(report.root, root);
      assert.ok(report.notes.some((note) => note.code === 'agent-model-dropped' && /4 agents name a Claude model and 1 a color/.test(note.message)));
      assert.deepEqual(await listRoot(), [], 'the project is untouched');
    });

    it('prints a readable preview that names the protected folder and how to apply it', async () => {
      const result = await invoke(common('plan'));
      assert.equal(result.code, EXIT.OK);
      assert.match(result.out, /install preview/);
      assert.match(result.out, /create 4 {3}update 0 {3}unchanged 0/);
      assert.match(result.out, /Kiro always asks before the agent writes to these paths/);
      assert.match(result.out, /\.kiro\/agents\/ {2}\(4 files\)/);
      const script = `${skillRoot}/scripts/ecc-kiro.mjs`;
      assert.ok(
        result.out.includes(`Nothing was written. To apply: node ${script} install --root ${root} --only agents --source ${source} --profile ${profileFile} --yes\n`),
        result.out,
      );
      assert.deepEqual(await listRoot(), []);
    });

    it('limits the preview with --only, and rejects unknown parts', async () => {
      const one = await invoke(base('plan', '--json', '--only', 'agents'));
      assert.equal(json(one).counts.create, 4);
      const twice = await invoke(base('plan', '--json', '--only', 'agents,agents'));
      assert.deepEqual(json(twice).parts, ['agents']);

      const bad = await invoke(base('plan', '--json', '--only', 'bogus'));
      assert.equal(bad.code, EXIT.USAGE);
      assert.match(json(bad).error.message, /unknown part "bogus".*available in this build: agents, skills, steering, commands, hooks, owned, mcp, license, isolation/);
      const empty = await invoke(base('plan', '--json', '--only', 'agents,'));
      assert.equal(empty.code, EXIT.USAGE);
      const inherited = await invoke(base('plan', '--json', '--only', 'constructor'));
      assert.equal(inherited.code, EXIT.USAGE);
    });

    it('accepts --action install, update and uninstall, and rejects any other', async () => {
      assert.equal((await invoke(common('plan', '--action', 'install'))).code, EXIT.OK);
      await invoke(common('install', '--yes'));
      const update = await invoke(common('plan', '--json', '--action', 'update'), { now: LATER });
      assert.equal(update.code, EXIT.OK);
      assert.equal(json(update).mode, 'update');
      assert.equal(json(update).dryRun, true);
      // An uninstall reads no ECC source, so it takes none of the options about it.
      const uninstall = await invoke(['plan', '--json', '--action', 'uninstall', '--root', root, '--only', 'agents'], { now: LATER });
      assert.equal(uninstall.code, EXIT.OK);
      assert.equal(json(uninstall).mode, 'uninstall');
      assert.equal(json(uninstall).source, null);
      const withSource = await invoke(common('plan', '--json', '--action', 'uninstall'));
      assert.equal(withSource.code, EXIT.USAGE);
      assert.match(json(withSource).error.message, /uninstall does not read the ECC source, so --source and --profile do not apply/);

      const unknown = await invoke(common('plan', '--json', '--action', 'nuke'));
      assert.equal(unknown.code, EXIT.USAGE);
      assert.match(json(unknown).error.message, /unknown action "nuke" \(expected install, update, uninstall\)/);
    });

    it('rejects options it does not take', async () => {
      assert.equal((await invoke(common('plan', '--yes'))).code, EXIT.USAGE);
      assert.equal((await invoke(common('plan', '--dry-run'))).code, EXIT.USAGE);
    });
  });

  describe('install', () => {
    it('refuses to write unless it is told to', async () => {
      const bare = await invoke(common('install', '--json'));
      assert.equal(bare.code, EXIT.USAGE);
      assert.match(json(bare).error.message, /install writes files\. Preview with "plan"/);
      const both = await invoke(common('install', '--yes', '--dry-run', '--json'));
      assert.equal(both.code, EXIT.USAGE);
      assert.match(json(both).error.message, /either --yes or --dry-run/);
      assert.deepEqual(await listRoot(), []);
    });

    it('previews with --dry-run and writes nothing', async () => {
      const result = await invoke(common('install', '--dry-run', '--json'));
      assert.equal(result.code, EXIT.OK);
      assert.equal(json(result).schema, 'ecc-kiro.plan.v1');
      assert.equal(json(result).dryRun, true);
      assert.deepEqual(await listRoot(), []);
    });

    it('installs the agents, converted, and records what it owns', async () => {
      const result = await invoke(common('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.OK, result.err);
      const report = json(result);
      assert.equal(report.schema, 'ecc-kiro.apply.v1');
      assert.equal(report.ok, true);
      assert.equal(report.dryRun, false);
      assert.deepEqual(report.applied, { written: 4, removed: 0 });
      assert.deepEqual(report.state, { path: STATE_RELATIVE_PATH, status: 'complete', files: 4, written: true, removed: false });
      assert.equal(report.failure, null);

      const planner = parseFrontmatter(await read('.kiro/agents/planner.md'));
      assert.deepEqual(planner.data, { name: 'planner', description: 'Plans.', tools: ['read'] });
      assert.equal(planner.body, 'Plan things.\n');

      const docs = parseFrontmatter(await read('.kiro/agents/docs-lookup.md')).data;
      assert.deepEqual(docs.tools, ['read', '@context7/resolve-library-id', '@context7/query-docs']);
      assert.equal('permissions' in docs, false);

      const reviewer = parseFrontmatter(await read('.kiro/agents/code-reviewer.md')).data;
      assert.deepEqual(reviewer.tools, ['read', 'shell']);
      assert.equal(reviewer.permissions.rules[0].capability, 'shell');
      assert.deepEqual(reviewer.permissions.rules[0].match, ['git diff*', 'git log*', 'git status*', 'git show*']);

      const e2e = parseFrontmatter(await read('.kiro/agents/e2e-runner.md')).data;
      assert.deepEqual(e2e.tools, ['read', 'write', 'shell']);
      assert.equal('color' in e2e, false);
      assert.equal('model' in e2e, false);

      const state = await stateOnDisk();
      assert.deepEqual(state.files.map((entry) => entry.path), AGENTS.map((name) => `.kiro/agents/${name}.md`));
      for (const entry of state.files) {
        assert.equal(entry.sha256, sha256Hex(await read(entry.path)), entry.path);
        assert.equal(entry.category, 'agent');
        assert.equal(entry.source, `agents/${entry.path.split('/').pop()}`);
      }
      assert.deepEqual(state.dirs, ['.kiro', '.kiro/agents', '.kiro/ecc']);
      assert.equal(state.installedAt, NOW.toISOString());
      assert.equal(state.source.commit, 'c05b2d6614f62f6db0047669aa4eefb223d478f9');
    });

    it('prints a short summary of what it wrote', async () => {
      const result = await invoke(common('install', '--yes'));
      assert.equal(result.code, EXIT.OK);
      assert.match(result.out, /install \(ECC v2\.2\.3, profile kimi-parity\)/);
      assert.match(result.out, /Wrote 4 files, removed 0\. Install state: \.kiro\/ecc\/install-state\.json \(4 files tracked\)\./);
      assert.doesNotMatch(result.out, /Kiro always asks/);
    });

    it('reports no changes the second time, and leaves even the state file alone', async () => {
      await invoke(common('install', '--yes'));
      const stateBefore = await read(STATE_RELATIVE_PATH);
      const agentsBefore = await Promise.all(AGENTS.map((name) => read(`.kiro/agents/${name}.md`)));

      const again = await invoke(common('install', '--yes', '--json'), { now: LATER });
      assert.equal(again.code, EXIT.OK);
      const report = json(again);
      assert.deepEqual(report.counts, { create: 0, update: 0, unchanged: 4, keepModified: 0, conflict: 0, remove: 0, stale: 0, forget: 0 });
      assert.deepEqual(report.applied, { written: 0, removed: 0 });
      assert.equal(report.state.written, false);
      assert.deepEqual(report.protected, [], 'nothing is touched, so nothing is protected');
      assert.equal(await read(STATE_RELATIVE_PATH), stateBefore);
      assert.deepEqual(await Promise.all(AGENTS.map((name) => read(`.kiro/agents/${name}.md`))), agentsBefore);

      const text = await invoke(common('install', '--yes'), { now: LATER });
      assert.match(text.out, /Nothing to change: everything is already up to date\./);
    });

    it('plans an edited agent as kept, and leaves the edit in place on install', async () => {
      await invoke(common('install', '--yes'));
      const edited = `${await read('.kiro/agents/planner.md')}\nMy own rule: always say hello.\n`;
      await nodeFs.writeFile(path.join(root, '.kiro/agents/planner.md'), edited);

      const plan = json(await invoke(common('plan', '--json'), { now: LATER }));
      assert.equal(plan.counts.keepModified, 1);
      assert.equal(plan.counts.unchanged, 3);
      assert.equal(plan.changes, 0);
      assert.deepEqual(plan.files.find((item) => item.path === '.kiro/agents/planner.md'), {
        path: '.kiro/agents/planner.md',
        category: 'agent',
        action: 'keep-modified',
        reason: 'edited after the install; your version was kept',
      });

      const text = await invoke(common('plan'), { now: LATER });
      assert.match(text.out, /Kept: you edited these after the install/);
      assert.match(text.out, /\.kiro\/agents\/planner\.md: edited after the install/);

      const result = await invoke(common('install', '--yes', '--json'), { now: LATER });
      assert.equal(result.code, EXIT.OK);
      assert.equal(json(result).applied.written, 0);
      assert.equal(await read('.kiro/agents/planner.md'), edited);
    });

    it('restores an agent that was deleted', async () => {
      await invoke(common('install', '--yes'));
      await nodeFs.rm(path.join(root, '.kiro/agents/planner.md'));
      const report = json(await invoke(common('install', '--yes', '--json'), { now: LATER }));
      assert.equal(report.counts.create, 1);
      assert.match(report.files.find((item) => item.action === 'create').reason, /restored/);
      assert.match(await read('.kiro/agents/planner.md'), /name: "planner"/);
    });

    it('skips an agent the user already has, and installs the others', async () => {
      await writeTree(root, { '.kiro/agents/planner.md': 'my own planner' });
      const result = await invoke(common('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.OK);
      const report = json(result);
      assert.equal(report.counts.conflict, 1);
      assert.equal(report.counts.create, 3);
      assert.equal(await read('.kiro/agents/planner.md'), 'my own planner');
      const state = await stateOnDisk();
      assert.ok(!state.files.some((entry) => entry.path.endsWith('planner.md')));

      const text = await invoke(common('plan'), { now: LATER });
      assert.match(text.out, /Skipped: these paths already exist and were not installed by ECC/);
      assert.match(text.out, /\.kiro\/agents\/planner\.md: already exists and was not installed by ECC; left alone/);
    });

    it('skips an agent whose name is already taken by a .json agent', async () => {
      await writeTree(root, { '.kiro/agents/docs-lookup.json': '{"name": "docs-lookup"}' });
      const report = json(await invoke(common('install', '--yes', '--json')));
      assert.equal(report.counts.conflict, 1);
      const item = report.files.find((entry) => entry.path === '.kiro/agents/docs-lookup.md');
      assert.equal(item.action, 'skip-conflict');
      assert.match(item.reason, /\.kiro\/agents\/docs-lookup\.json/);
      await assert.rejects(read('.kiro/agents/docs-lookup.md'), /ENOENT/);
    });

    it('installs nothing when the ECC source does not match the profile', async () => {
      await nodeFs.writeFile(path.join(source, 'agents/planner.md'), 'tampered');
      const result = await invoke(common('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      const report = json(result);
      assert.equal(report.ok, false);
      assert.equal(report.schema, 'ecc-kiro.plan.v1', 'nothing was applied');
      assert.deepEqual(report.problems.map((item) => `${item.code} ${item.path}`), ['hash-mismatch agents/planner.md']);
      assert.deepEqual(await listRoot(), []);

      const text = await invoke(common('plan'));
      assert.equal(text.code, EXIT.FAILED);
      assert.match(text.out, /Problems\n {2}hash-mismatch: agents\/planner\.md does not match/);
      assert.match(text.out, /Nothing was written: fix the problems above first\./);
    });

    it('explains how to fetch when source files are missing', async () => {
      await nodeFs.rm(path.join(source, 'agents/docs-lookup.md'));
      const result = await invoke(common('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      const [problem] = json(result).problems;
      assert.equal(problem.code, 'source-incomplete');
      assert.match(problem.message, /1 ECC file is missing.*agents\/docs-lookup\.md.*--fetch/);
      assert.deepEqual(await listRoot(), []);
    });

    it('stops on an agent it cannot convert, naming the file, and installs nothing', async () => {
      const broken = agentText('planner', 'Plans.', 'Read, TeleportTool');
      await nodeFs.writeFile(path.join(source, 'agents/planner.md'), broken);
      const files = { ...sample.files, 'agents/planner.md': broken };
      const operations = sample.kimiState.operations.map((op) => (op.sourceRelativePath === 'agents/planner.md' ? { ...op, contentSha256: sha256Hex(broken) } : op));
      const hashes = new Map(Object.entries(files).map(([rel, text]) => [rel, sha256Hex(text)]));
      const { profile } = buildProfile({ kimiState: { ...sample.kimiState, operations }, adapterPaths: sample.adapterPaths, hashes });
      await nodeFs.writeFile(profileFile, formatProfile(profile));

      const result = await invoke(common('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      const [problem] = json(result).problems;
      assert.equal(problem.code, 'agent-tool-unknown');
      assert.equal(problem.path, 'agents/planner.md');
      assert.deepEqual(await listRoot(), []);
    });

    it('warns when an agent name is also one of the user\'s global agents', async () => {
      await writeTree(home, { '.kiro/agents/planner.json': '{}', '.kiro/agents/mine.md': '# mine', '.kiro/agents/notes.txt': 'x' });
      const report = json(await invoke(common('plan', '--json')));
      const warning = report.notes.find((note) => note.code === 'agent-shadows-global');
      assert.equal(warning.level, 'warn');
      assert.match(warning.message, /1 agent name also exists in your global agents folder \(planner\)/);
      assert.equal(report.ok, true);
    });

    it('does not look at the global folder when there is none', async () => {
      await nodeFs.rm(path.join(home, '.kiro'), { recursive: true });
      const report = json(await invoke(common('plan', '--json')));
      assert.equal(report.notes.some((note) => note.code === 'agent-shadows-global'), false);
    });

    it('reports an agents folder that is a link out of the project, and writes nothing', async () => {
      const outside = path.join(tmp.dir, `outside-${counter}`);
      await nodeFs.mkdir(outside);
      await nodeFs.mkdir(path.join(root, '.kiro'));
      await nodeFs.symlink(outside, path.join(root, '.kiro/agents'));
      const result = await invoke(common('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      const problems = json(result).problems;
      assert.equal(problems.length, 4);
      assert.ok(problems.every((item) => item.code === 'unsafe-path' && /leaves the project/.test(item.message)));
      assert.deepEqual(await nodeFs.readdir(outside), []);
    });

    it('refuses to run on the folder that holds the global Kiro settings', async () => {
      const result = await invoke(common('plan', '--json').map((arg) => (arg === root ? home : arg)));
      assert.equal(result.code, EXIT.FAILED);
      assert.equal(json(result).error.code, 'root-is-kiro-home');
      assert.match(json(result).error.fix, /inside a project folder/);
      assert.deepEqual(await nodeFs.readdir(path.join(home, '.kiro')), []);
    });

    it('refuses a project folder that does not exist or is a file', async () => {
      const missing = await invoke(['plan', '--json', '--source', source, '--profile', profileFile, '--root', path.join(root, 'nope')]);
      assert.equal(json(missing).error.code, 'root-missing');
      await nodeFs.writeFile(path.join(root, 'file.txt'), 'x');
      const file = await invoke(['plan', '--json', '--source', source, '--profile', profileFile, '--root', path.join(root, 'file.txt')]);
      assert.equal(json(file).error.code, 'root-not-directory');
    });

    it('uses the working directory when --root is not given', async () => {
      const result = await invoke(['plan', '--json', '--source', source, '--profile', profileFile], { cwd: root });
      assert.equal(json(result).root, root);
    });

    it('stops with a fix when the state file is unreadable, and changes nothing', async () => {
      await writeTree(root, { [STATE_RELATIVE_PATH]: '{ not json' });
      const result = await invoke(common('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      assert.equal(json(result).error.code, 'state-invalid');
      assert.match(json(result).error.fix, /Fix or delete/);
      assert.equal(await read(STATE_RELATIVE_PATH), '{ not json');
      await assert.rejects(read('.kiro/agents/planner.md'), /ENOENT/);
    });

    it('stops on a state file that claims a file it must not own', async () => {
      const good = (await invoke(common('install', '--yes', '--json'))).code;
      assert.equal(good, EXIT.OK);
      const state = JSON.parse(await read(STATE_RELATIVE_PATH));
      state.files.push({ path: '.kiro/settings/mcp.json', category: 'agent', source: null, sha256: 'a'.repeat(64) });
      await nodeFs.writeFile(path.join(root, STATE_RELATIVE_PATH), JSON.stringify(state));
      const result = await invoke(common('plan', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      assert.equal(json(result).error.code, 'state-invalid');
    });

    it('stops with a fix when the profile is invalid', async () => {
      const profile = JSON.parse(await nodeFs.readFile(profileFile, 'utf8'));
      profile.entries[0].path = '../escape';
      await nodeFs.writeFile(profileFile, JSON.stringify(profile));
      const result = await invoke(common('plan', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      assert.equal(json(result).error.code, 'profile-invalid');
      assert.match(json(result).error.fix, /verify/);
    });

    it('reports a failure in the middle, keeps the state of what was done, and finishes on the next run', async () => {
      let renames = 0;
      const flaky = {
        ...Object.fromEntries(Object.keys(nodeFs).map((key) => [key, nodeFs[key]])),
        async rename(from, to) {
          renames += 1;
          if (renames === 3) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          return nodeFs.rename(from, to);
        },
      };
      const failed = await invoke(common('install', '--yes', '--json'), { fs: flaky });
      assert.equal(failed.code, EXIT.FAILED);
      const report = json(failed);
      assert.equal(report.ok, false);
      assert.equal(report.failure.code, 'ENOSPC');
      assert.equal(report.failure.dest, '.kiro/agents/e2e-runner.md');
      assert.deepEqual(report.applied, { written: 2, removed: 0 });
      assert.equal((await stateOnDisk()).status, 'partial');

      const text = await invoke(common('install', '--yes'), { fs: flaky, now: LATER });
      assert.equal(text.code, EXIT.OK, text.out);
      assert.equal((await stateOnDisk()).status, 'complete');
      assert.equal((await stateOnDisk()).files.length, 4);
      assert.equal((await stateOnDisk()).installedAt, NOW.toISOString());
    });

    it('prints the failure in plain words', async () => {
      let renames = 0;
      const flaky = {
        ...Object.fromEntries(Object.keys(nodeFs).map((key) => [key, nodeFs[key]])),
        async rename(from, to) {
          renames += 1;
          if (renames === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          return nodeFs.rename(from, to);
        },
      };
      const failed = await invoke(common('install', '--yes'), { fs: flaky });
      assert.equal(failed.code, EXIT.FAILED);
      assert.match(failed.out, /Stopped at \.kiro\/agents\/[a-z0-9-]+\.md: disk full/);
      assert.match(failed.out, /Written before the stop: 1 file\. Run the command again to continue/);
    });
  });

  describe('skills, and all parts together', () => {
    const SKILL_FILES = ['.kiro/skills/api-design/SKILL.md', '.kiro/skills/tdd-workflow/SKILL.md', '.kiro/skills/tdd-workflow/references/notes.md'];
    const isExecutable = async (rel) => ((await nodeFs.stat(path.join(root, rel))).mode & 0o111) !== 0;

    it('previews skills with a summary, and names no protected folder for them', async () => {
      const report = json(await invoke(base('plan', '--json', '--only', 'skills')));
      assert.equal(report.ok, true);
      assert.deepEqual(report.parts, ['skills']);
      assert.equal(report.counts.create, 3);
      assert.deepEqual(report.files.map((item) => item.path), SKILL_FILES);
      assert.deepEqual(report.protected, []);
      assert.equal(report.details.skills.total, 2);
      assert.equal(report.details.skills.valid, 2);
      assert.equal(report.details.skills.files, 3);
      const text = await invoke(base('plan', '--only', 'skills'));
      assert.match(text.out, /Skills: 2 skills, 3 files; all valid/);
    });

    it('runs every part when --only is not given', async () => {
      const report = json(await invoke(base('plan', '--json')));
      assert.deepEqual(report.parts, ['agents', 'skills', 'steering', 'commands', 'hooks', 'owned', 'mcp', 'license', 'isolation']);
      assert.equal(report.counts.create, 4 + 3 + STEERING_FILES.length + COMMAND_FILES.length + HOOK_FILES.length + SUPPORT_FILES.length + OWNED_FILES.length);
      assert.deepEqual(
        report.protected,
        [
          { path: '.kiro/agents', kind: 'directory', files: 4 + 3 },
          { path: '.kiro/hooks', kind: 'directory', files: 2 + 2 },
          { path: '.kiro/workflows', kind: 'directory', files: 1 },
        ],
        'steering is not a folder Kiro asks about; the hook files, the agents and the workflow recipe are',
      );
    });

    it('installs skills byte for byte, with their folders, and records them', async () => {
      const result = await invoke(base('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.OK, result.err);
      assert.deepEqual(json(result).applied, { written: 4 + 3 + STEERING_FILES.length + COMMAND_FILES.length + HOOK_FILES.length + SUPPORT_FILES.length + OWNED_FILES.length, removed: 0 });
      for (const [dest, src] of [
        ['.kiro/skills/tdd-workflow/SKILL.md', 'skills/tdd-workflow/SKILL.md'],
        ['.kiro/skills/tdd-workflow/references/notes.md', 'skills/tdd-workflow/references/notes.md'],
        ['.kiro/skills/api-design/SKILL.md', '.agents/skills/api-design/SKILL.md'],
      ]) {
        assert.ok((await nodeFs.readFile(path.join(root, dest))).equals(await nodeFs.readFile(path.join(source, src))), dest);
      }
      await assert.rejects(nodeFs.stat(path.join(root, '.kiro/skills/api-design/agents')), /ENOENT/, 'Codex metadata is not installed');

      const state = await stateOnDisk();
      assert.equal(state.files.filter((entry) => entry.category === 'skill').length, 3);
      assert.equal(state.files.filter((entry) => entry.category === 'agent').length, 4);
      assert.equal(state.files.filter((entry) => entry.category === 'steering').length, STEERING_FILES.length);
      assert.equal(state.files.filter((entry) => entry.category === 'command').length, 2);
      assert.equal(state.files.filter((entry) => entry.category === 'command-script').length, 2);
      assert.equal(state.files.filter((entry) => entry.category === 'hook').length, 2);
      assert.equal(state.files.filter((entry) => entry.category === 'hook-script').length, 1);
      assert.deepEqual(
        Object.fromEntries(['owned-script', 'owned-hook', 'owned-agent', 'owned-workflow'].map((category) => [category, state.files.filter((entry) => entry.category === category).length])),
        { 'owned-script': 3, 'owned-hook': 2, 'owned-agent': 3, 'owned-workflow': 1 },
      );
      assert.equal(state.files.filter((entry) => entry.category === 'mcp').length, 2);
      assert.equal(state.files.filter((entry) => entry.category === 'license').length, 2);
      assert.equal(state.files.filter((entry) => entry.category === 'kiroignore').length, 0, 'no folder of another harness, so no block');
      assert.deepEqual(state.dirs, [
        '.kiro', '.kiro/agents', '.kiro/ecc', '.kiro/ecc/scripts', '.kiro/hooks', '.kiro/skills', '.kiro/skills/api-design', '.kiro/skills/tdd-workflow', '.kiro/skills/tdd-workflow/references', '.kiro/steering', '.kiro/workflows',
      ]);
    });

    it('reports no changes when run again', async () => {
      await invoke(base('install', '--yes'));
      const before = await read(STATE_RELATIVE_PATH);
      const again = json(await invoke(base('install', '--yes', '--json'), { now: LATER }));
      assert.deepEqual(again.counts, { create: 0, update: 0, unchanged: 7 + STEERING_FILES.length + COMMAND_FILES.length + HOOK_FILES.length + SUPPORT_FILES.length + OWNED_FILES.length, keepModified: 0, conflict: 0, remove: 0, stale: 0, forget: 0 });
      assert.deepEqual(again.applied, { written: 0, removed: 0 });
      assert.equal(await read(STATE_RELATIVE_PATH), before);
    });

    it('leaves the other part alone when only one is named', async () => {
      await invoke(base('install', '--yes'));
      await nodeFs.writeFile(path.join(root, '.kiro/agents/planner.md'), 'agent edited');
      await nodeFs.writeFile(path.join(root, '.kiro/skills/tdd-workflow/SKILL.md'), 'skill edited');

      const skillsOnly = json(await invoke(base('plan', '--json', '--only', 'skills'), { now: LATER }));
      assert.deepEqual(skillsOnly.files.map((item) => item.path), SKILL_FILES);
      assert.equal(skillsOnly.counts.keepModified, 1);
      assert.equal(skillsOnly.counts.unchanged, 2);

      const agentsOnly = json(await invoke(base('plan', '--json', '--only', 'agents'), { now: LATER }));
      assert.equal(agentsOnly.files.length, 4);
      assert.equal(agentsOnly.counts.keepModified, 1);
      assert.ok(agentsOnly.files.every((item) => item.category === 'agent'));

      const result = await invoke(base('install', '--yes', '--json', '--only', 'skills'), { now: LATER });
      assert.equal(result.code, EXIT.OK);
      assert.equal((await stateOnDisk()).files.filter((entry) => entry.category === 'agent').length, 4, 'agents are still tracked');
      assert.equal(await read('.kiro/agents/planner.md'), 'agent edited');
      assert.equal(await read('.kiro/skills/tdd-workflow/SKILL.md'), 'skill edited');
    });

    it('gives installed scripts the execute bit they have in the source', async () => {
      await nodeFs.chmod(path.join(source, 'skills/tdd-workflow/references/notes.md'), 0o755);
      await invoke(base('install', '--yes'));
      assert.equal(await isExecutable('.kiro/skills/tdd-workflow/references/notes.md'), true);
      assert.equal(await isExecutable('.kiro/skills/tdd-workflow/SKILL.md'), false);
      assert.equal(await isExecutable('.kiro/agents/planner.md'), false);
      const report = json(await invoke(base('plan', '--json', '--only', 'skills'), { now: LATER }));
      assert.equal(report.details.skills.executable, 1);
    });

    it('adds nothing to a skill folder that already holds someone else\'s skill', async () => {
      await writeTree(root, { '.kiro/skills/tdd-workflow/SKILL.md': 'my own skill\n' });
      const report = json(await invoke(base('install', '--yes', '--json', '--only', 'skills')));
      assert.equal(report.ok, true);
      assert.equal(report.counts.conflict, 2);
      assert.equal(report.counts.create, 1);
      assert.equal(await read('.kiro/skills/tdd-workflow/SKILL.md'), 'my own skill\n');
      await assert.rejects(read('.kiro/skills/tdd-workflow/references/notes.md'), /ENOENT/);
      assert.equal((await read('.kiro/skills/api-design/SKILL.md')).includes('api-design'), true);
      assert.deepEqual((await stateOnDisk()).files.map((entry) => entry.path), ['.kiro/skills/api-design/SKILL.md']);
    });

    it('keeps a skill file the user edited', async () => {
      await invoke(base('install', '--yes'));
      await nodeFs.appendFile(path.join(root, '.kiro/skills/tdd-workflow/references/notes.md'), 'my note\n');
      const report = json(await invoke(base('plan', '--json', '--only', 'skills'), { now: LATER }));
      assert.equal(report.counts.keepModified, 1);
      assert.equal(report.files.find((item) => item.action === 'keep-modified').path, '.kiro/skills/tdd-workflow/references/notes.md');
    });

    it('reports a skill that was dropped from the profile as stale, and does not remove it', async () => {
      await invoke(base('install', '--yes'));
      const smaller = buildProfile({
        kimiState: { ...sample.kimiState, operations: sample.kimiState.operations.filter((op) => !op.sourceRelativePath.includes('api-design')) },
        adapterPaths: sample.adapterPaths,
        hashes: sample.hashes,
      }).profile;
      await nodeFs.writeFile(profileFile, formatProfile(smaller));

      const report = json(await invoke(base('install', '--yes', '--json', '--only', 'skills'), { now: LATER }));
      assert.equal(report.counts.stale, 1);
      assert.equal(report.counts.remove, 0);
      assert.equal(report.files.find((item) => item.action === 'stale').path, '.kiro/skills/api-design/SKILL.md');
      assert.match(await read('.kiro/skills/api-design/SKILL.md'), /api-design/);
      assert.equal((await stateOnDisk()).files.length, 7 + STEERING_FILES.length + COMMAND_FILES.length + HOOK_FILES.length + SUPPORT_FILES.length + OWNED_FILES.length, 'still tracked');
    });

    it('warns about skills that share a name with a global skill', async () => {
      // Global skills are often links to folders elsewhere; a loose file with a skill's name is not a skill.
      await writeTree(home, { '.kiro/skills/real-dir/SKILL.md': 'global', '.kiro/skills/api-design': 'a plain file, not a skill' });
      await nodeFs.symlink(path.join(home, '.kiro/skills/real-dir'), path.join(home, '.kiro/skills/tdd-workflow'));
      const report = json(await invoke(base('plan', '--json', '--only', 'skills')));
      const note = report.notes.find((item) => item.code === 'skill-shadows-global');
      assert.match(note.message, /1 skill also exists in your global skills folder \(tdd-workflow\)/);
      assert.deepEqual(report.details.skills.overlapsGlobal, ['tdd-workflow']);
    });

    it('stops before writing anything when a skill is broken', async () => {
      const broken = '---\nname: wrong-name\ndescription: x\n---\n';
      await nodeFs.writeFile(path.join(source, 'skills/tdd-workflow/SKILL.md'), broken);
      const files = { ...sample.files, 'skills/tdd-workflow/SKILL.md': broken };
      const operations = sample.kimiState.operations.map((op) => (op.sourceRelativePath === 'skills/tdd-workflow/SKILL.md' ? { ...op, contentSha256: sha256Hex(broken) } : op));
      const hashes = new Map(Object.entries(files).map(([rel, text]) => [rel, sha256Hex(text)]));
      await nodeFs.writeFile(profileFile, formatProfile(buildProfile({ kimiState: { ...sample.kimiState, operations }, adapterPaths: sample.adapterPaths, hashes }).profile));

      const result = await invoke(base('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      const [problem] = json(result).problems;
      assert.equal(problem.code, 'skill-invalid');
      assert.match(problem.message, /name-dir-mismatch/);
      assert.deepEqual(await listRoot(), [], 'not even the agents are installed');
    });
  });

  describe('steering', () => {
    const steer = (...rest) => [...base(...rest), '--only', 'steering'];
    const GLOBS_SCHEMA = 'ecc-kiro.language-globs.v1';

    /** Change one source file and rebuild the profile so its hash matches. */
    async function changeSource(rel, text) {
      await nodeFs.writeFile(path.join(source, rel), text);
      const files = { ...sample.files, [rel]: text };
      const operations = sample.kimiState.operations.map((op) => (op.sourceRelativePath === rel ? { ...op, contentSha256: sha256Hex(text) } : op));
      const hashes = new Map(Object.entries(files).map(([name, body]) => [name, sha256Hex(body)]));
      const { profile } = buildProfile({ kimiState: { ...sample.kimiState, operations }, adapterPaths: sample.adapterPaths, hashes });
      await nodeFs.writeFile(profileFile, formatProfile(profile));
    }

    /** A skill folder with an assets/language-globs.json, for the override file. */
    async function skillWithGlobs(contents) {
      const dir = path.join(tmp.dir, `skill-${counter}`);
      await writeTree(dir, contents === undefined ? {} : { 'assets/language-globs.json': typeof contents === 'string' ? contents : JSON.stringify(contents) });
      return dir;
    }

    it('previews the files with a summary, and names no protected folder for them', async () => {
      const result = await invoke(steer('plan', '--json'));
      assert.equal(result.code, EXIT.OK, result.err);
      const report = json(result);
      assert.deepEqual(report.parts, ['steering']);
      assert.equal(report.counts.create, STEERING_FILES.length);
      assert.deepEqual(report.files.map((item) => item.path), STEERING_FILES);
      assert.ok(report.files.every((item) => item.category === 'steering' && item.action === 'create'));
      assert.deepEqual(report.protected, []);
      const { steering } = report.details;
      assert.deepEqual([steering.files, steering.adapter.files, steering.packs.files, steering.baseline.files], [6, 3, 1, 2]);
      assert.deepEqual([steering.adapter.always, steering.adapter.fileMatch, steering.adapter.manual], [1, 1, 1]);
      assert.equal(steering.alwaysOn.files, 3);
      assert.equal(steering.alwaysOn.limit, 25000);
      assert.deepEqual(await listRoot(), [], 'the project is untouched');

      const text = (await invoke(steer('plan'))).out;
      assert.match(text, /Steering: 6 files \(3 from the ECC adapter, 1 language rule pack, 2 baseline\); always on: 3 files, [\d,]+ of 25,000 bytes/);
    });

    it('installs each file in the mode it needs, and records them', async () => {
      const result = await invoke(steer('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.OK, result.err);
      assert.deepEqual(json(result).applied, { written: STEERING_FILES.length, removed: 0 });

      for (const dest of STEERING_FILES) assert.ok((await read(dest)).startsWith('---\n'), `${dest} starts with its frontmatter`);
      const data = async (dest) => parseFrontmatter(await read(dest)).data;
      assert.deepEqual(await data('.kiro/steering/ecc-coding-style.md'), { inclusion: 'always', name: 'ecc-coding-style', description: 'Core style rules.' });
      assert.deepEqual(await data('.kiro/steering/ecc-python-patterns.md'), { inclusion: 'fileMatch', fileMatchPattern: ['**/*.py'], description: 'Python patterns' });
      assert.deepEqual(await data('.kiro/steering/ecc-dev-mode.md'), { inclusion: 'manual', description: 'Dev mode' });
      assert.deepEqual((await data('.kiro/steering/ecc-perl-rules.md')).fileMatchPattern, ['**/*.pl', '**/*.t']);
      assert.equal((await data('.kiro/steering/ecc-agents.md')).inclusion, 'always');
      assert.equal((await data('.kiro/steering/ecc-kiro-harness.md')).inclusion, 'always');

      assert.match(await read('.kiro/steering/ecc-dev-mode.md'), /Use `#ecc-dev-mode` to start\./);
      assert.match(await read('.kiro/steering/ecc-perl-rules.md'), /Extends \[ecc-coding-style\]\(ecc-coding-style\.md\)\./);
      const agents = await read('.kiro/steering/ecc-agents.md');
      assert.match(agents, /gives this project 4 custom agents and 2 skills\./);
      assert.match(agents, /- Complex feature requests → \*\*planner\*\*/);
      assert.match(agents, /\| e2e-runner \| Runs E2E tests \| See the agent description \|\n$/, 'an agent AGENTS.md does not list gets a row from its description');

      const state = await stateOnDisk();
      assert.deepEqual(state.files.map((entry) => entry.path), STEERING_FILES);
      assert.ok(state.files.every((entry) => entry.category === 'steering'));
      for (const entry of state.files) assert.equal(entry.sha256, sha256Hex(await read(entry.path)), entry.path);
      const sources = Object.fromEntries(state.files.map((entry) => [entry.path.split('/').pop(), entry.source]));
      assert.equal(sources['ecc-coding-style.md'], '.kiro/steering/coding-style.md');
      assert.equal(sources['ecc-agents.md'], 'AGENTS.md');
      assert.deepEqual(sources['ecc-perl-rules.md'], ['rules/perl/coding-style.md', 'rules/perl/testing.md']);
      assert.equal(sources['ecc-kiro-harness.md'], null);
      assert.deepEqual(state.dirs, ['.kiro', '.kiro/ecc', '.kiro/steering']);
    });

    it('reports no changes the second time', async () => {
      await invoke(steer('install', '--yes'));
      const before = await read(STATE_RELATIVE_PATH);
      const again = json(await invoke(steer('install', '--yes', '--json'), { now: LATER }));
      assert.deepEqual(again.counts, { create: 0, update: 0, unchanged: STEERING_FILES.length, keepModified: 0, conflict: 0, remove: 0, stale: 0, forget: 0 });
      assert.deepEqual(again.applied, { written: 0, removed: 0 });
      assert.equal(await read(STATE_RELATIVE_PATH), before);
    });

    it('keeps a steering file the user edited, and leaves one the user already has alone', async () => {
      await writeTree(root, { '.kiro/steering/ecc-dev-mode.md': 'mine\n' });
      const first = json(await invoke(steer('install', '--yes', '--json')));
      assert.equal(first.counts.conflict, 1);
      assert.equal(first.counts.create, STEERING_FILES.length - 1);
      assert.equal(await read('.kiro/steering/ecc-dev-mode.md'), 'mine\n');

      const edited = `${await read('.kiro/steering/ecc-coding-style.md')}\nMy team rule.\n`;
      await nodeFs.writeFile(path.join(root, '.kiro/steering/ecc-coding-style.md'), edited);
      const plan = json(await invoke(steer('plan', '--json'), { now: LATER }));
      assert.equal(plan.counts.keepModified, 1);
      assert.equal(plan.counts.conflict, 1);
      assert.equal(plan.changes, 0);
      const result = await invoke(steer('install', '--yes', '--json'), { now: LATER });
      assert.equal(result.code, EXIT.OK);
      assert.equal(await read('.kiro/steering/ecc-coding-style.md'), edited);
    });

    it('does not touch steering when only the other parts are named', async () => {
      await invoke(base('install', '--yes'));
      await nodeFs.writeFile(path.join(root, '.kiro/steering/ecc-agents.md'), 'edited');
      const report = json(await invoke(base('plan', '--json', '--only', 'agents,skills'), { now: LATER }));
      assert.ok(report.files.every((item) => item.category !== 'steering'));
      assert.equal(report.counts.keepModified, 0);
      const result = await invoke(base('install', '--yes', '--json', '--only', 'skills'), { now: LATER });
      assert.equal(result.code, EXIT.OK);
      assert.equal((await stateOnDisk()).files.filter((entry) => entry.category === 'steering').length, STEERING_FILES.length, 'still tracked');
      assert.equal(await read('.kiro/steering/ecc-agents.md'), 'edited');
    });

    it('refuses always-on steering over 25,000 bytes, and writes nothing', async () => {
      await changeSource('AGENTS.md', AGENTS_MD.replace('| planner | Planning |', `| planner | ${'x'.repeat(30000)} |`));
      const result = await invoke(base('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      const report = json(result);
      assert.deepEqual(report.problems.map((item) => item.code), ['always-on-too-large']);
      assert.match(report.problems[0].message, /over the limit of 25000.*largest: ecc-agents\.md 3\d{4}/);
      assert.equal(report.schema, 'ecc-kiro.plan.v1', 'nothing was applied');
      assert.deepEqual(await listRoot(), [], 'not even the agents and skills are installed');
      assert.match((await invoke(steer('plan'))).out, /Problems\n {2}always-on-too-large: /);
    });

    it('stops when ECC\'s AGENTS.md no longer has the sections it reads', async () => {
      await changeSource('AGENTS.md', '# Agents\n');
      const result = await invoke(steer('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      assert.deepEqual(json(result).problems.map((item) => `${item.code} ${item.path}`), ['agents-md-section AGENTS.md']);
      assert.deepEqual(await listRoot(), []);
    });

    it('uses the file patterns from assets/language-globs.json in the skill folder', async () => {
      const skillDir = await skillWithGlobs({ schema: GLOBS_SCHEMA, packs: { perl: ['**/*.perl', 'lib/**/*.pm'] } });
      const report = json(await invoke(steer('install', '--yes', '--json'), { skillDir }));
      assert.equal(report.ok, true);
      assert.deepEqual(report.details.steering.packs.overridden, ['perl']);
      assert.ok(report.notes.some((note) => note.code === 'steering-globs-overridden'));
      assert.deepEqual(parseFrontmatter(await read('.kiro/steering/ecc-perl-rules.md')).data.fileMatchPattern, ['**/*.perl', 'lib/**/*.pm']);
    });

    it('uses the patterns of the rules themselves when the file has no entry for a pack, or does not exist', async () => {
      const empty = await skillWithGlobs({ schema: GLOBS_SCHEMA, packs: {} });
      const first = json(await invoke(steer('plan', '--json'), { skillDir: empty }));
      assert.deepEqual(first.details.steering.packs.overridden, []);
      const missing = await skillWithGlobs(undefined);
      const second = json(await invoke(steer('plan', '--json'), { skillDir: missing }));
      assert.deepEqual(second.details.steering.packs.overridden, []);
    });

    it('stops with a fix when assets/language-globs.json is unusable, and writes nothing', async () => {
      for (const contents of ['{ not json', { schema: 'other', packs: {} }, { schema: GLOBS_SCHEMA, packs: { python: ['**/*.py'] } }, { schema: GLOBS_SCHEMA, packs: { perl: [] } }]) {
        const skillDir = await skillWithGlobs(contents);
        const result = await invoke(steer('install', '--yes', '--json'), { skillDir });
        assert.equal(result.code, EXIT.FAILED, JSON.stringify(contents));
        const { error } = json(result);
        assert.equal(error.code, 'language-globs-invalid');
        assert.ok(error.message.includes(path.join(skillDir, 'assets', 'language-globs.json')));
        assert.match(error.fix, /Fix or delete the file/);
        assert.deepEqual(await listRoot(), []);
      }
    });

    it('does not read assets/language-globs.json when steering is not part of the run', async () => {
      const skillDir = await skillWithGlobs('{ not json');
      const result = await invoke(base('plan', '--json', '--only', 'agents,skills'), { skillDir });
      assert.equal(result.code, EXIT.OK, result.out);
    });

    it('refuses a steering folder that is a link out of the project', async () => {
      const outside = path.join(tmp.dir, `outside-steering-${counter}`);
      await nodeFs.mkdir(outside);
      await nodeFs.mkdir(path.join(root, '.kiro'));
      await nodeFs.symlink(outside, path.join(root, '.kiro/steering'));
      const result = await invoke(steer('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      assert.ok(json(result).problems.every((item) => item.code === 'unsafe-path' && /leaves the project/.test(item.message)));
      assert.deepEqual(await nodeFs.readdir(outside), []);
    });
  });

  describe('commands', () => {
    const cmd = (...rest) => [...base(...rest), '--only', 'commands'];
    const isExecutable = async (rel) => ((await nodeFs.stat(path.join(root, rel))).mode & 0o111) !== 0;

    /** A skill folder with the command data of the fixtures, changed by `edit`. */
    async function skillWith(edit) {
      const dir = path.join(tmp.dir, `commands-skill-${counter}`);
      const assets = minimalCommandAssets({ classes: FIXTURE_CLASSES });
      edit?.(assets);
      await writeCommandAssets(dir, assets);
      return dir;
    }

    /** Change one source file and rebuild the profile so its hash matches. */
    async function changeSource(rel, text) {
      await nodeFs.writeFile(path.join(source, rel), text);
      const files = { ...sample.files, [rel]: text };
      const operations = sample.kimiState.operations.map((op) => (op.sourceRelativePath === rel ? { ...op, contentSha256: sha256Hex(text) } : op));
      const hashes = new Map(Object.entries(files).map(([name, body]) => [name, sha256Hex(body)]));
      const { profile } = buildProfile({ kimiState: { ...sample.kimiState, operations }, adapterPaths: sample.adapterPaths, hashes });
      await nodeFs.writeFile(profileFile, formatProfile(profile));
    }

    it('previews the commands with a summary and the lint result, and writes nothing', async () => {
      const result = await invoke(cmd('plan', '--json'));
      assert.equal(result.code, EXIT.OK, result.err);
      const report = json(result);
      assert.deepEqual(report.parts, ['commands']);
      assert.equal(report.counts.create, COMMAND_FILES.length);
      assert.deepEqual(report.files.map((item) => item.path), COMMAND_FILES);
      assert.deepEqual(report.protected, []);
      const { commands } = report.details;
      assert.deepEqual([commands.total, commands.registered, commands.pending.map((item) => item.name), commands.skipped], [4, 2, ['orch-add-feature'], [{ name: 'api-design', skill: 'api-design' }]]);
      assert.deepEqual(await listRoot(), []);

      const text = (await invoke(cmd('plan'))).out;
      assert.match(text, /Commands: 2 of 4 registered as \/ecc-<name>; 1 pending \(class B and C, not installed\); 1 left to a skill of the same name; 2 scripts/);
      assert.match(text, /Lint, which stops the plan for a command it would install: 3 clean\n/);
    });

    it('installs the steering and the two scripts, with their execute bits, and records them', async () => {
      await nodeFs.chmod(path.join(source, '.kiro/scripts/quality-gate.sh'), 0o755);
      const result = await invoke(cmd('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.OK, result.err);
      assert.deepEqual(json(result).applied, { written: COMMAND_FILES.length, removed: 0 });

      const plan = await read('.kiro/steering/ecc-plan.md');
      assert.deepEqual(parseFrontmatter(plan).data, { inclusion: 'manual', description: 'Plan a change.' });
      assert.match(plan, /\nInvoked as `\/ecc-plan`\. ARGS is the text after/);
      assert.match(await read('.kiro/steering/ecc-quality-gate.md'), /bash \.kiro\/ecc\/scripts\/quality-gate\.sh/);
      assert.equal(await read('.kiro/ecc/scripts/format.sh'), sample.files['.kiro/scripts/format.sh']);
      assert.equal(await isExecutable('.kiro/ecc/scripts/quality-gate.sh'), true);
      assert.equal(await isExecutable('.kiro/ecc/scripts/format.sh'), false);
      await assert.rejects(read('.kiro/steering/ecc-orch-add-feature.md'), /ENOENT/, 'a pending command is not installed');
      await assert.rejects(read('.kiro/steering/ecc-api-design.md'), /ENOENT/, 'a command that a skill covers is not installed');

      const state = await stateOnDisk();
      assert.deepEqual(state.files.map((entry) => [entry.path, entry.category]), [
        ['.kiro/ecc/scripts/format.sh', 'command-script'],
        ['.kiro/ecc/scripts/quality-gate.sh', 'command-script'],
        ['.kiro/steering/ecc-plan.md', 'command'],
        ['.kiro/steering/ecc-quality-gate.md', 'command'],
      ]);
      assert.deepEqual(state.dirs, ['.kiro', '.kiro/ecc', '.kiro/ecc/scripts', '.kiro/steering']);
      for (const entry of state.files) assert.equal(entry.sha256, sha256Hex(await read(entry.path)), entry.path);
    });

    it('reports no changes the second time, and keeps what the user edited', async () => {
      await invoke(cmd('install', '--yes'));
      const before = await read(STATE_RELATIVE_PATH);
      const again = json(await invoke(cmd('install', '--yes', '--json'), { now: LATER }));
      assert.deepEqual(again.counts, { create: 0, update: 0, unchanged: COMMAND_FILES.length, keepModified: 0, conflict: 0, remove: 0, stale: 0, forget: 0 });
      assert.equal(await read(STATE_RELATIVE_PATH), before);

      const edited = `${await read('.kiro/steering/ecc-plan.md')}\nMy team rule.\n`;
      await nodeFs.writeFile(path.join(root, '.kiro/steering/ecc-plan.md'), edited);
      const plan = json(await invoke(cmd('plan', '--json'), { now: LATER }));
      assert.equal(plan.counts.keepModified, 1);
      assert.equal(plan.files.find((item) => item.action === 'keep-modified').path, '.kiro/steering/ecc-plan.md');
      await invoke(cmd('install', '--yes'), { now: LATER });
      assert.equal(await read('.kiro/steering/ecc-plan.md'), edited);
    });

    it('leaves a steering file of the same name that the user already has alone', async () => {
      await writeTree(root, { '.kiro/steering/ecc-plan.md': 'mine\n' });
      const report = json(await invoke(cmd('install', '--yes', '--json')));
      assert.equal(report.counts.conflict, 1);
      assert.equal(report.counts.create, COMMAND_FILES.length - 1);
      assert.equal(await read('.kiro/steering/ecc-plan.md'), 'mine\n');
    });

    it('leaves the other parts alone when only they are named', async () => {
      await invoke(base('install', '--yes'));
      await nodeFs.writeFile(path.join(root, '.kiro/steering/ecc-plan.md'), 'edited');
      const others = json(await invoke(base('plan', '--json', '--only', 'agents,skills,steering'), { now: LATER }));
      assert.ok(others.files.every((item) => item.category !== 'command' && item.category !== 'command-script'));
      assert.equal(others.counts.keepModified, 0);
      const result = await invoke(base('install', '--yes', '--json', '--only', 'skills'), { now: LATER });
      assert.equal(result.code, EXIT.OK);
      assert.equal((await stateOnDisk()).files.filter((entry) => entry.category === 'command').length, 2, 'still tracked');
      assert.equal(await read('.kiro/steering/ecc-plan.md'), 'edited');
    });

    it('stops with the names of the files when the skill folder has no command data, and writes nothing', async () => {
      const empty = path.join(tmp.dir, `no-assets-${counter}`);
      await nodeFs.mkdir(empty);
      const result = await invoke(base('install', '--yes', '--json'), { skillDir: empty });
      assert.equal(result.code, EXIT.FAILED);
      const report = json(result);
      assert.deepEqual(report.problems.map((item) => item.path), [
        'assets/commands/classes.json',
        'assets/commands/rewrite-rules.json',
        'assets/commands/snippets.json',
        'assets/commands/lint-patterns.json',
        'scripts/runtime/git-push-guard.mjs',
        'scripts/runtime/hookify-guard.mjs',
        'scripts/runtime/usage-report.mjs',
        'scripts/runtime/feature-check.mjs',
      ]);
      assert.equal(report.schema, 'ecc-kiro.plan.v1', 'nothing was applied');
      assert.deepEqual(await listRoot(), [], 'not even the agents are installed');
    });

    it('stops with a fix when a data file is not JSON, or does not hold what it should', async () => {
      const broken = await skillWith(() => {});
      await nodeFs.writeFile(path.join(broken, 'assets/commands/classes.json'), '{ not json');
      const result = await invoke(cmd('install', '--yes', '--json'), { skillDir: broken });
      assert.equal(result.code, EXIT.FAILED);
      const { error } = json(result);
      assert.equal(error.code, 'command-assets-invalid');
      assert.ok(error.message.includes(path.join(broken, 'assets/commands/classes.json')));
      assert.match(error.fix, /Fix the file/);

      const wrong = await skillWith((assets) => { assets.classes.commands.plan.class = 'Z'; });
      const second = await invoke(cmd('plan', '--json'), { skillDir: wrong });
      assert.equal(second.code, EXIT.FAILED);
      assert.match(json(second).problems[0].message, /^assets\/commands\/classes\.json: "plan": "class" must be A, B or C/);
      assert.deepEqual(await listRoot(), []);
    });

    it('does not read the command data when the commands part is not run', async () => {
      const broken = await skillWith(() => {});
      await nodeFs.writeFile(path.join(broken, 'assets/commands/classes.json'), '{ not json');
      const result = await invoke(base('plan', '--json', '--only', 'agents,skills,steering'), { skillDir: broken });
      assert.equal(result.code, EXIT.OK, result.out);
    });

    it('stops before writing anything when a command to install would still have Claude Code wording', async () => {
      await changeSource('commands/plan.md', '---\ndescription: Plan a change.\n---\nSave in ~/.claude/plans/x.\n');
      const result = await invoke(base('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      const report = json(result);
      assert.deepEqual(report.problems.map((item) => item.code), ['command-lint']);
      assert.match(report.problems[0].message, /plan is not installed: the text still has Claude Code wording \(claude-home\)/);
      assert.deepEqual(await listRoot(), [], 'not even the agents are installed');
      assert.match((await invoke(cmd('plan'))).out, /Problems\n {2}command-lint: plan is not installed/);
    });

    it('installs a pending command from a current overlay in the skill folder, and reports a stale one', async () => {
      const sha = sha256Hex(COMMAND_SOURCES['commands/orch-add-feature.md']);
      const overlay = (hash) => `---\nsource: "commands/orch-add-feature.md"\nsha256: "${hash}"\ncredit: ["Adapted from ECC, MIT License."]\n---\nDo the work in Kiro.\n`;
      const current = await skillWith((assets) => assets.overlays.set('orch-add-feature', overlay(sha)));
      const installed = json(await invoke(cmd('install', '--yes', '--json'), { skillDir: current }));
      assert.equal(installed.ok, true, JSON.stringify(installed.problems ?? installed));
      assert.equal(installed.details.commands.withOverlay, 1);
      assert.deepEqual(installed.details.commands.pending, []);
      const file = await read('.kiro/steering/ecc-orch-add-feature.md');
      assert.match(file, /> Credit: Adapted from ECC, MIT License\.\n\nDo the work in Kiro\.\n$/);

      const stale = await skillWith((assets) => assets.overlays.set('orch-add-feature', overlay('0'.repeat(64))));
      const report = json(await invoke(cmd('plan', '--json'), { skillDir: stale, now: LATER }));
      assert.equal(report.details.commands.pending[0].overlay, 'stale');
      assert.ok(report.notes.some((note) => note.code === 'command-overlay-stale' && note.level === 'warn'));
    });
  });

  describe('hooks', () => {
    const hk = (...rest) => [...base(...rest), '--only', 'hooks'];
    const GUARD = '.kiro/ecc/scripts/git-push-guard.mjs';

    /** Change one source file and rebuild the profile so its hash matches. */
    async function changeSource(rel, text) {
      await nodeFs.writeFile(path.join(source, rel), text);
      const files = { ...sample.files, [rel]: text };
      const hashes = new Map(Object.entries(files).map(([name, body]) => [name, sha256Hex(body)]));
      const { profile } = buildProfile({ kimiState: sample.kimiState, adapterPaths: sample.adapterPaths, hashes });
      await nodeFs.writeFile(profileFile, formatProfile(profile));
    }

    /** A skill folder with the command data but without the guard, or with the text given. */
    async function skillWithGuard(guard) {
      const dir = path.join(tmp.dir, `hooks-skill-${counter}`);
      await writeCommandAssets(dir, minimalCommandAssets({ classes: FIXTURE_CLASSES }));
      await writeHookAssets(dir, guard === undefined ? {} : { guard });
      return dir;
    }

    /** Run the installed guard the way the hook command does: from the project, with the event on stdin. */
    const runGuard = (input) =>
      new Promise((resolve) => {
        const child = execFile(process.execPath, [GUARD], { cwd: root }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
        child.stdin.end(input);
      });

    it('previews the hook files with a summary, names the folder Kiro asks about, and writes nothing', async () => {
      const result = await invoke(hk('plan', '--json'));
      assert.equal(result.code, EXIT.OK, result.err);
      const report = json(result);
      assert.deepEqual(report.parts, ['hooks']);
      assert.equal(report.counts.create, HOOK_FILES.length);
      assert.deepEqual(report.files.map((item) => item.path), HOOK_FILES);
      assert.deepEqual(report.files.map((item) => item.category), ['hook-script', 'hook', 'hook']);
      assert.deepEqual(report.protected, [{ path: '.kiro/hooks', kind: 'directory', files: 2 }]);
      const { hooks } = report.details;
      assert.deepEqual([hooks.total, hooks.converted, hooks.disabled, hooks.agentActions, hooks.commandActions], [3, 2, 2, 1, 1]);
      assert.deepEqual(hooks.byTrigger, { PostFileCreate: 1, PreToolUse: 1 });
      assert.deepEqual(hooks.adapted.map((item) => item.name), ['git-push-review']);
      assert.deepEqual(hooks.skipped.map((item) => item.name), ['quality-gate']);
      assert.deepEqual(hooks.scripts, [GUARD]);
      assert.deepEqual(report.notes.map((note) => note.code), ['hooks-disabled', 'hooks-adapted', 'hooks-skipped']);
      assert.deepEqual(await listRoot(), []);

      const text = (await invoke(hk('plan'))).out;
      assert.match(text, /Hooks: 2 hooks in \.kiro\/hooks, all switched off; actions: 1 agent prompt \(credits when on\), 1 script; not converted: quality-gate; 1 script file installed\n/);
      assert.match(text, /\.kiro\/hooks\/ {2}\(2 files\)/);
      assert.match(text, /info: 2 hooks are installed switched off\. Turn one on in the Agent Hooks panel of the IDE, or set "enabled" to true in its file in \.kiro\/hooks\. 1 runs an agent prompt, which uses credits each time the hook fires; 1 runs a script and uses none/);
    });

    it('installs every hook file switched off, with the guard next to the other scripts, and records them', async () => {
      const result = await invoke(hk('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.OK, result.err);
      assert.deepEqual(json(result).applied, { written: HOOK_FILES.length, removed: 0 });

      for (const dest of HOOK_FILES.filter((item) => item.endsWith('.json'))) {
        const parsed = JSON.parse(await read(dest));
        assert.strictEqual(parsed.hooks[0].enabled, false, `${dest} is installed switched off`);
        assert.deepEqual(validateHookFile(parsed, { requireDisabled: true }), [], dest);
      }
      assert.equal(await read(GUARD), shippedHookAssets().guard);

      const tdd = JSON.parse(await read('.kiro/hooks/ecc-tdd-reminder.json')).hooks[0];
      assert.deepEqual([tdd.trigger, tdd.matcher, tdd.action.type], ['PostFileCreate', '\\.(ts|tsx)$', 'agent']);
      const push = JSON.parse(await read('.kiro/hooks/ecc-git-push-review.json')).hooks[0];
      assert.deepEqual([push.trigger, push.matcher, push.action], ['PreToolUse', 'shell', { type: 'command', command: `node ${GUARD}` }]);

      const state = await stateOnDisk();
      assert.deepEqual(state.files.map((entry) => [entry.path, entry.category]), [
        [GUARD, 'hook-script'],
        ['.kiro/hooks/ecc-git-push-review.json', 'hook'],
        ['.kiro/hooks/ecc-tdd-reminder.json', 'hook'],
      ]);
      const sources = Object.fromEntries(state.files.map((entry) => [entry.path, entry.source]));
      assert.equal(sources['.kiro/hooks/ecc-tdd-reminder.json'], '.kiro/hooks/tdd-reminder.kiro.hook');
      assert.equal(sources[GUARD], null);
      assert.deepEqual(state.dirs, ['.kiro', '.kiro/ecc', '.kiro/ecc/scripts', '.kiro/hooks']);
      for (const entry of state.files) assert.equal(entry.sha256, sha256Hex(await read(entry.path)), entry.path);
    });

    it('installs a guard that blocks git push when it is run as the hook runs it, and lets an acknowledged push through', async () => {
      await invoke(hk('install', '--yes'));
      const hook = JSON.parse(await read('.kiro/hooks/ecc-git-push-review.json')).hooks[0];
      assert.equal(hook.action.command, `node ${GUARD}`, 'a command for the project root, where Kiro runs it');

      const blocked = await runGuard(JSON.stringify({ tool_name: 'execute_bash', tool_input: { command: 'git add . && git push' } }));
      assert.equal(blocked.code, 2);
      assert.match(blocked.stderr, /ECC pre-push check: this command runs git push/);
      assert.deepEqual(await runGuard(JSON.stringify({ tool_input: { command: 'ECC_PUSH_REVIEWED=1 git push' } })), { code: 0, stdout: '', stderr: '' });
      assert.deepEqual(await runGuard(JSON.stringify({ tool_input: { command: 'ls' } })), { code: 0, stdout: '', stderr: '' });
    });

    it('reports no changes the second time', async () => {
      await invoke(hk('install', '--yes'));
      const before = await read(STATE_RELATIVE_PATH);
      const again = json(await invoke(hk('install', '--yes', '--json'), { now: LATER }));
      assert.deepEqual(again.counts, { create: 0, update: 0, unchanged: HOOK_FILES.length, keepModified: 0, conflict: 0, remove: 0, stale: 0, forget: 0 });
      assert.deepEqual(again.applied, { written: 0, removed: 0 });
      assert.equal(await read(STATE_RELATIVE_PATH), before);
    });

    it('keeps a hook that the user switched on, and says so', async () => {
      await invoke(hk('install', '--yes'));
      const switchedOn = (await read('.kiro/hooks/ecc-tdd-reminder.json')).replace('"enabled": false', '"enabled": true');
      assert.notEqual(switchedOn, await read('.kiro/hooks/ecc-tdd-reminder.json'));
      await nodeFs.writeFile(path.join(root, '.kiro/hooks/ecc-tdd-reminder.json'), switchedOn);

      const plan = json(await invoke(hk('plan', '--json'), { now: LATER }));
      assert.equal(plan.counts.keepModified, 1);
      assert.equal(plan.counts.unchanged, HOOK_FILES.length - 1);
      assert.equal(plan.changes, 0);
      assert.equal(plan.files.find((item) => item.action === 'keep-modified').path, '.kiro/hooks/ecc-tdd-reminder.json');
      assert.match((await invoke(hk('plan'), { now: LATER })).out, /Kept: you edited these after the install[^]*ecc-tdd-reminder\.json: edited after the install/);

      const result = await invoke(hk('install', '--yes', '--json'), { now: LATER });
      assert.equal(result.code, EXIT.OK);
      assert.equal(await read('.kiro/hooks/ecc-tdd-reminder.json'), switchedOn);
    });

    it('restores a hook that was deleted', async () => {
      await invoke(hk('install', '--yes'));
      await nodeFs.rm(path.join(root, '.kiro/hooks/ecc-git-push-review.json'));
      const report = json(await invoke(hk('install', '--yes', '--json'), { now: LATER }));
      assert.equal(report.counts.create, 1);
      assert.match(report.files.find((item) => item.action === 'create').reason, /restored/);
      assert.strictEqual(JSON.parse(await read('.kiro/hooks/ecc-git-push-review.json')).hooks[0].enabled, false);
    });

    it('leaves a hook file or a script that the user already has alone, and installs the rest', async () => {
      await writeTree(root, { '.kiro/hooks/ecc-tdd-reminder.json': '{"mine": true}\n', [GUARD]: 'my own guard\n' });
      const report = json(await invoke(hk('install', '--yes', '--json')));
      assert.equal(report.counts.conflict, 2);
      assert.equal(report.counts.create, 1);
      assert.equal(await read('.kiro/hooks/ecc-tdd-reminder.json'), '{"mine": true}\n');
      assert.equal(await read(GUARD), 'my own guard\n');
      assert.deepEqual((await stateOnDisk()).files.map((entry) => entry.path), ['.kiro/hooks/ecc-git-push-review.json']);
    });

    it('leaves the other parts alone when only hooks are named, and the hooks alone when they are not', async () => {
      await invoke(base('install', '--yes'));
      await nodeFs.writeFile(path.join(root, '.kiro/agents/planner.md'), 'agent edited');
      await nodeFs.writeFile(path.join(root, '.kiro/hooks/ecc-tdd-reminder.json'), 'hook edited');

      const hooksOnly = json(await invoke(hk('plan', '--json'), { now: LATER }));
      assert.ok(hooksOnly.files.every((item) => item.category === 'hook' || item.category === 'hook-script'));
      assert.equal(hooksOnly.counts.keepModified, 1);

      const others = json(await invoke(base('plan', '--json', '--only', 'agents,skills,steering,commands'), { now: LATER }));
      assert.ok(others.files.every((item) => item.category !== 'hook' && item.category !== 'hook-script'));
      assert.equal(others.counts.keepModified, 1, 'only the edited agent');

      const result = await invoke(base('install', '--yes', '--json', '--only', 'skills'), { now: LATER });
      assert.equal(result.code, EXIT.OK);
      const state = await stateOnDisk();
      assert.equal(state.files.filter((entry) => entry.category === 'hook').length, 2, 'still tracked');
      assert.equal(await read('.kiro/hooks/ecc-tdd-reminder.json'), 'hook edited');
      assert.equal(await read('.kiro/agents/planner.md'), 'agent edited');
    });

    it('stops, naming the script, when the skill folder does not have it, and writes nothing', async () => {
      const skillDir = await skillWithGuard(undefined);
      const result = await invoke(hk('install', '--yes', '--json'), { skillDir });
      assert.equal(result.code, EXIT.FAILED);
      const report = json(result);
      assert.deepEqual(report.problems.map((item) => [item.code, item.path]), [['hook-assets-missing', 'scripts/runtime/git-push-guard.mjs']]);
      assert.match(report.problems[0].message, /was not found in the skill folder, and the git push hook runs it/);
      assert.equal(report.schema, 'ecc-kiro.plan.v1', 'nothing was applied');
      assert.deepEqual(await listRoot(), []);
      assert.match((await invoke(hk('plan'), { skillDir })).out, /Problems\n {2}hook-assets-missing: /);

      const empty = await invoke(hk('plan', '--json'), { skillDir: await skillWithGuard('') });
      assert.equal(json(empty).problems[0].code, 'hook-assets-missing', 'an empty file counts as missing');
    });

    it('does not read the guard when hooks are not part of the run', async () => {
      const skillDir = await skillWithGuard(undefined);
      const result = await invoke(base('plan', '--json', '--only', 'agents,skills,steering,commands'), { skillDir });
      assert.equal(result.code, EXIT.OK, result.out);
    });

    it('installs no script when no hook runs it', async () => {
      await nodeFs.rm(path.join(source, '.kiro/hooks/git-push-review.kiro.hook'));
      const withoutPush = buildProfile({
        kimiState: sample.kimiState,
        adapterPaths: sample.adapterPaths.filter((item) => !item.includes('git-push-review')),
        hashes: sample.hashes,
      }).profile;
      await nodeFs.writeFile(profileFile, formatProfile(withoutPush));
      const skillDir = await skillWithGuard(undefined);
      const report = json(await invoke(hk('plan', '--json'), { skillDir }));
      assert.equal(report.ok, true, JSON.stringify(report.problems));
      assert.deepEqual(report.files.map((item) => item.path), ['.kiro/hooks/ecc-tdd-reminder.json']);
      assert.deepEqual(report.details.hooks.scripts, []);
    });

    it('stops before writing anything, naming the file, when a hook cannot be converted', async () => {
      await changeSource(
        '.kiro/hooks/tdd-reminder.kiro.hook',
        legacyHookText({ name: 'tdd-reminder', when: { type: 'fileCreated', patterns: ['src/*.ts'] }, then: { type: 'askAgent', prompt: 'x' } }),
      );
      const result = await invoke(base('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      const report = json(result);
      assert.deepEqual(report.problems.map((item) => [item.code, item.path]), [['hook-glob-unsupported', '.kiro/hooks/tdd-reminder.kiro.hook']]);
      assert.match(report.problems[0].message, /the pattern "src\/\*\.ts" is not supported/);
      assert.equal(report.schema, 'ecc-kiro.plan.v1', 'nothing was applied');
      assert.deepEqual(await listRoot(), [], 'not even the agents are installed');
    });

    it('stops on a hook folder that is a link out of the project', async () => {
      const outside = path.join(tmp.dir, `outside-hooks-${counter}`);
      await nodeFs.mkdir(outside);
      await nodeFs.mkdir(path.join(root, '.kiro'));
      await nodeFs.symlink(outside, path.join(root, '.kiro/hooks'));
      const result = await invoke(hk('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      assert.ok(json(result).problems.every((item) => item.code === 'unsafe-path' && /leaves the project/.test(item.message)));
      assert.deepEqual(await nodeFs.readdir(outside), []);
    });
  });

  describe('owned', () => {
    const own = (...rest) => [...base(...rest), '--only', 'owned'];
    const un = (...rest) => ['uninstall', ...rest, '--root', root];
    const LIST = JSON.stringify({
      models: [
        { model_id: 'auto', rate_multiplier: 1 },
        { model_id: 'claude-opus-5', rate_multiplier: 2.2 },
        { model_id: 'gpt-5.6-terra', rate_multiplier: 2.2 },
        { model_id: 'glm-5', rate_multiplier: 0.5 },
      ],
      default_model: 'auto',
    });
    const modelOf = async (name) => /^model: "?([^"\n]*)"?$/m.exec(await read(`.kiro/agents/${name}.md`))?.[1] ?? null;

    it('plans the nine files without the ECC source, and says which paths Kiro asks about', async () => {
      const report = json(await invoke(own('plan', '--json')));
      assert.deepEqual(report.problems, []);
      assert.equal(report.counts.create, OWNED_FILES.length);
      assert.deepEqual(report.files.map((item) => item.path), [...OWNED_FILES].sort());
      assert.deepEqual(report.protected, [
        { path: '.kiro/agents', kind: 'directory', files: 3 },
        { path: '.kiro/hooks', kind: 'directory', files: 2 },
        { path: '.kiro/workflows', kind: 'directory', files: 1 },
      ]);
      assert.deepEqual(report.details.owned.hooks, [
        { file: '.kiro/hooks/ecc-hookify.json', names: ['ecc-hookify-bash', 'ecc-hookify-file', 'ecc-hookify-prompt', 'ecc-hookify-stop'] },
        { file: '.kiro/hooks/ecc-instinct-observe.json', names: ['ecc-instinct-observe-pre', 'ecc-instinct-observe-post'] },
      ]);
      assert.deepEqual(await listRoot(), [], 'plan writes nothing');
    });
    it('writes the scripts as they are in the skill, every hook switched off, and records ownership in four categories', async () => {
      const result = await invoke(own('install', '--yes', '--json'));
      assert.equal(result.code, EXIT.OK, result.err);
      assert.deepEqual(json(result).applied, { written: OWNED_FILES.length, removed: 0 });
      for (const file of ['hookify-guard.mjs', 'usage-report.mjs', 'feature-check.mjs']) {
        assert.equal(await read(`.kiro/ecc/scripts/${file}`), await nodeFs.readFile(path.join(skillRoot, 'scripts', 'runtime', file), 'utf8'), file);
      }
      for (const file of ['.kiro/hooks/ecc-hookify.json', '.kiro/hooks/ecc-instinct-observe.json']) {
        assert.deepEqual(validateHookFile(JSON.parse(await read(file)), { requireDisabled: true }), [], file);
      }
      assert.deepEqual(validateWorkflowRecipe(JSON.parse(await read('.kiro/workflows/ecc-orch-review.workflow.json'))), []);
      const state = await stateOnDisk();
      assert.deepEqual(state.files.map((entry) => entry.category).sort(), [...Array(3).fill('owned-agent'), ...Array(2).fill('owned-hook'), ...Array(3).fill('owned-script'), 'owned-workflow']);
      assert.ok(state.files.every((entry) => entry.source === null));
      assert.deepEqual(state.dirs, ['.kiro', '.kiro/agents', '.kiro/ecc', '.kiro/ecc/scripts', '.kiro/hooks', '.kiro/workflows']);
    });
    it('leaves model: out of the panel agents when the model list is not available, and says so', async () => {
      for (const models of [undefined, null, 'not json']) {
        const result = json(await invoke(own('plan', '--json'), { models }));
        assert.match(result.notes.find((note) => note.code === 'panel-models').message, /the local model list could not be read/, String(models));
        assert.equal(result.details.owned.modelsKnown, false);
      }
      await invoke(own('install', '--yes'), { models: null });
      for (const name of ['ecc-panel-backend', 'ecc-panel-frontend', 'ecc-panel-reviewer']) assert.equal(await modelOf(name), null, name);
    });
    it('sets model: from the list the installer reads, per role, and names the choice in the notes', async () => {
      const report = json(await invoke(own('plan', '--json'), { models: LIST }));
      assert.equal(report.details.owned.modelsKnown, true);
      assert.deepEqual(report.details.owned.agents, [
        { name: 'ecc-panel-backend', model: 'gpt-5.6-terra' },
        { name: 'ecc-panel-frontend', model: 'glm-5' },
        { name: 'ecc-panel-reviewer', model: 'claude-opus-5' },
      ]);
      assert.match(report.notes.find((note) => note.code === 'panel-models').message, /ecc-panel-backend uses gpt-5\.6-terra; ecc-panel-frontend uses glm-5; ecc-panel-reviewer uses claude-opus-5\. Whether a sub-agent applies the model: of its agent file is not proven/);
      await invoke(own('install', '--yes'), { models: LIST });
      assert.deepEqual([await modelOf('ecc-panel-backend'), await modelOf('ecc-panel-frontend'), await modelOf('ecc-panel-reviewer')], ['gpt-5.6-terra', 'glm-5', 'claude-opus-5']);
      assert.match(await read('.kiro/agents/ecc-panel-backend.md'), /^tools: \["read"\]$/m, 'read only');
    });
    it('changes nothing the second time, updates an agent when the model list changed, and keeps a hook the user switched on', async () => {
      await invoke(own('install', '--yes'), { models: LIST });
      const again = json(await invoke(own('install', '--yes', '--json'), { models: LIST, now: LATER }));
      assert.deepEqual(again.applied, { written: 0, removed: 0 });
      const newer = JSON.stringify({ models: [{ model_id: 'gpt-5.7-terra', rate_multiplier: 2.2 }, { model_id: 'glm-5', rate_multiplier: 0.5 }, { model_id: 'claude-opus-5', rate_multiplier: 2.2 }] });
      const plan = json(await invoke(own('plan', '--json'), { models: newer, now: LATER }));
      assert.deepEqual(plan.files.filter((item) => item.action === 'update').map((item) => item.path), ['.kiro/agents/ecc-panel-backend.md']);
      const hookText = (await read('.kiro/hooks/ecc-hookify.json')).replace('"enabled": false', '"enabled": true');
      await nodeFs.writeFile(path.join(root, '.kiro/hooks/ecc-hookify.json'), hookText);
      const after = json(await invoke(own('update', '--yes', '--json'), { models: newer, now: LATER }));
      assert.equal(after.counts.keepModified, 1);
      assert.equal(await modelOf('ecc-panel-backend'), 'gpt-5.7-terra');
      assert.equal(await read('.kiro/hooks/ecc-hookify.json'), hookText, 'the user\'s switch stays');
    });
    it('leaves an agent of the user\'s alone when it has the same name, as a .md or a .json', async () => {
      await writeTree(root, { '.kiro/agents/ecc-panel-reviewer.md': 'mine', '.kiro/agents/ecc-panel-backend.json': '{}' });
      const report = json(await invoke(own('install', '--yes', '--json')));
      assert.deepEqual(report.files.filter((item) => item.action === 'skip-conflict').map((item) => item.path), ['.kiro/agents/ecc-panel-backend.md', '.kiro/agents/ecc-panel-reviewer.md']);
      assert.equal(await read('.kiro/agents/ecc-panel-reviewer.md'), 'mine');
    });
    it('warns that the recipe names agents the install does not have, when the profile has no security-reviewer', async () => {
      const report = json(await invoke(own('plan', '--json')));
      const note = report.notes.find((item) => item.code === 'owned-workflow-agents');
      assert.equal(note.level, 'warn');
      assert.match(note.message, /names an agent that is not in this install \(security-reviewer\); .* so it must exist in \.kiro\/agents/);
      assert.deepEqual(report.details.owned.missingAgents, ['security-reviewer']);
    });
    it('stops with the path in the skill when a script is missing, and writes nothing', async () => {
      const dir = path.join(tmp.dir, `owned-skill-${counter}`);
      await writeCommandAssets(dir, minimalCommandAssets({ classes: FIXTURE_CLASSES }));
      await writeHookAssets(dir, { ...shippedHookAssets(), owned: false });
      await nodeFs.mkdir(path.join(dir, 'scripts', 'runtime'), { recursive: true });
      await nodeFs.writeFile(path.join(dir, 'scripts', 'runtime', 'usage-report.mjs'), 'x');
      const result = await invoke(own('install', '--yes', '--json'), { skillDir: dir });
      assert.equal(result.code, EXIT.FAILED);
      assert.deepEqual(json(result).problems.map((item) => [item.code, item.path]), [['owned-assets-missing', 'scripts/runtime/hookify-guard.mjs'], ['owned-assets-missing', 'scripts/runtime/feature-check.mjs']]);
      assert.deepEqual(await listRoot(), []);
    });
    it('does not read the scripts when the part is not run', async () => {
      const dir = path.join(tmp.dir, `no-owned-skill-${counter}`);
      await writeCommandAssets(dir, minimalCommandAssets({ classes: FIXTURE_CLASSES }));
      await writeHookAssets(dir, { ...shippedHookAssets(), owned: false });
      const result = await invoke(base('plan', '--json', '--only', 'agents,hooks'), { skillDir: dir });
      assert.equal(result.code, EXIT.OK, result.out);
    });
    it('is removed on its own by an uninstall of the part, and the other parts stay', async () => {
      await invoke(base('install', '--yes'));
      const removed = json(await invoke(un('--yes', '--json', '--only', 'owned'), { now: LATER }));
      assert.equal(removed.counts.remove, OWNED_FILES.length);
      assert.equal(removed.state.removed, false);
      for (const file of OWNED_FILES) assert.equal(await exists(file), false, file);
      assert.equal(await exists('.kiro/hooks/ecc-tdd-reminder.json'), true);
      assert.equal(await exists('.kiro/workflows'), false, 'the folder the install made goes with its last file');
    });
  });
  describe('mcp, license and isolation', () => {
    const part = (name, ...rest) => [...base(...rest), '--only', name];

    it('writes the MCP examples under .kiro/ecc, every server off, and nothing under .kiro/settings', async () => {
      const preview = json(await invoke(part('mcp', 'plan', '--json')));
      assert.deepEqual(preview.files.map((item) => item.path), ['.kiro/ecc/mcp-servers.md', '.kiro/ecc/mcp.json.example']);
      assert.deepEqual(preview.details.mcp, { servers: 3, fromCatalog: 2, fromAdapter: 1, local: 2, remote: 1, left: { autoApprove: 1, description: 2, type: 1 }, files: ['.kiro/ecc/mcp.json.example', '.kiro/ecc/mcp-servers.md'] });
      assert.deepEqual(preview.protected, []);
      assert.match((await invoke(part('mcp', 'plan'))).out, /MCP examples: 3 servers \(2 local, 1 remote\) in \.kiro\/ecc\/mcp\.json\.example, every one switched off; 1 of them from the Kiro adapter of ECC\n/);

      assert.equal((await invoke(part('mcp', 'install', '--yes'))).code, EXIT.OK);
      const example = JSON.parse(await read('.kiro/ecc/mcp.json.example'));
      assert.deepEqual(Object.keys(example.mcpServers), ['github', 'hosted', 'docs']);
      assert.ok(Object.values(example.mcpServers).every((server) => server.disabled === true));
      assert.deepEqual(example.mcpServers.hosted, { url: 'https://mcp.example.com/mcp', disabled: true });
      assert.deepEqual(example.mcpServers.github.env, { GITHUB_TOKEN: 'YOUR_GITHUB_PAT_HERE' });
      assert.doesNotMatch(await read('.kiro/ecc/mcp.json.example'), /description|autoApprove|"type"|claude/);
      assert.match(await read('.kiro/ecc/mcp-servers.md'), /\| github \| catalog \| `npx -y @example\/github` \| GITHUB_TOKEN \| GitHub operations \|/);
      assert.equal(await exists('.kiro/settings'), false, 'nothing under .kiro/settings');
    });

    it('stops on a catalog it cannot convert, and writes nothing', async () => {
      const broken = '{"mcpServers": {"a": {"command": "a", "surprise": true}}}\n';
      await nodeFs.writeFile(path.join(source, 'mcp-configs/mcp-servers.json'), broken);
      const files = { ...sample.files, 'mcp-configs/mcp-servers.json': broken };
      const operations = sample.kimiState.operations.map((op) => (op.sourceRelativePath === 'mcp-configs/mcp-servers.json' ? { ...op, contentSha256: sha256Hex(broken) } : op));
      const hashes = new Map(Object.entries(files).map(([rel, text]) => [rel, sha256Hex(text)]));
      await nodeFs.writeFile(profileFile, formatProfile(buildProfile({ kimiState: { ...sample.kimiState, operations }, adapterPaths: sample.adapterPaths, hashes }).profile));
      const result = await invoke(part('mcp', 'install', '--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      assert.deepEqual(json(result).problems.map((item) => item.code), ['mcp-unknown-field']);
      assert.deepEqual(await listRoot(), []);
    });

    it('copies the license byte for byte and writes the notices beside it', async () => {
      assert.equal((await invoke(part('license', 'install', '--yes'))).code, EXIT.OK);
      assert.equal(await read('.kiro/ecc/LICENSE'), MCP_SOURCES.LICENSE);
      const notices = await read('.kiro/ecc/THIRD_PARTY_NOTICES.md');
      assert.ok(notices.includes(`- sha256 of that LICENSE file: ${sha256Hex(MCP_SOURCES.LICENSE)}.`));
      assert.deepEqual((await stateOnDisk()).files.map((entry) => [entry.path, entry.category, entry.source]), [
        ['.kiro/ecc/LICENSE', 'license', 'LICENSE'],
        ['.kiro/ecc/THIRD_PARTY_NOTICES.md', 'license', null],
      ]);
      const again = json(await invoke(part('license', 'install', '--yes', '--json'), { now: LATER }));
      assert.deepEqual(again.applied, { written: 0, removed: 0 });
    });

    it('keeps a license file the user changed', async () => {
      await invoke(part('license', 'install', '--yes'));
      await nodeFs.appendFile(path.join(root, '.kiro/ecc/LICENSE'), 'my note\n');
      const report = json(await invoke(part('license', 'plan', '--json'), { now: LATER }));
      assert.deepEqual(report.files.filter((item) => item.action === 'keep-modified').map((item) => item.path), ['.kiro/ecc/LICENSE']);
    });

    it('leaves .kiroignore alone when no other harness has a folder, and says so', async () => {
      await nodeFs.writeFile(path.join(root, '.codex'), 'a file, not a folder');
      const report = json(await invoke(part('isolation', 'plan', '--json')));
      assert.equal(report.counts.create, 0);
      assert.deepEqual(report.details.isolation, { folders: [], block: false });
      assert.match((await invoke(part('isolation', 'plan'))).out, /Isolation: no folder of another harness found, so \.kiroignore is left alone\n/);
      assert.equal((await invoke(part('isolation', 'install', '--yes'))).code, EXIT.OK);
      assert.equal(await exists('.kiroignore'), false);
    });

    it('hides the folders that exist, in a block, and creates the file when there is none', async () => {
      await nodeFs.mkdir(path.join(root, '.kimi-code'));
      await nodeFs.mkdir(path.join(root, '.claude'));
      const preview = json(await invoke(part('isolation', 'plan', '--json')));
      assert.deepEqual(preview.files.map((item) => [item.path, item.category, item.action]), [['.kiroignore', 'kiroignore', 'create']]);
      assert.deepEqual(preview.protected, [{ path: '.kiroignore', kind: 'file', files: 1 }]);
      assert.deepEqual(preview.details.isolation, { folders: ['.claude', '.kimi-code'], block: true });
      const text = (await invoke(part('isolation', 'plan'))).out;
      assert.match(text, /Isolation: a block in \.kiroignore asks Kiro to ignore 2 folders of other harnesses \(\.claude, \.kimi-code\)\n/);
      assert.match(text, /\.kiroignore {2}\(1 file\)/);
      assert.match(text, /add \.kiroignore there/);

      assert.equal((await invoke(part('isolation', 'install', '--yes'))).code, EXIT.OK);
      const written = await read('.kiroignore');
      assert.match(written, BLOCK_RE);
      assert.deepEqual(BLOCK_FOLDERS(written), ['.claude/', '.kimi-code/']);
      assert.equal(written.startsWith('# >>>'), true, 'a new file holds only the block');
      assert.deepEqual((await stateOnDisk()).files.map((entry) => [entry.path, entry.category, entry.createdFile]), [['.kiroignore', 'kiroignore', true]]);
    });

    it('keeps the lines the user has, adds the block after them, and a second run changes nothing', async () => {
      const mine = '# mine\nnode_modules/\n.env\n';
      await writeTree(root, { '.kiroignore': mine, '.claude/settings.json': '{}' });
      await invoke(part('isolation', 'install', '--yes'));
      assert.equal((await read('.kiroignore')).startsWith(`${mine}\n# >>> ecc-kiro-setup`), true);
      assert.equal('createdFile' in (await stateOnDisk()).files[0], false, 'the file was the user\'s');

      const before = await read('.kiroignore');
      const again = json(await invoke(part('isolation', 'install', '--yes', '--json'), { now: LATER }));
      assert.deepEqual(again.applied, { written: 0, removed: 0 });
      assert.equal(again.counts.unchanged, 1);
      assert.equal(await read('.kiroignore'), before);
    });

    it('rewrites the block when a folder appears, and leaves it alone once the user has edited it', async () => {
      await nodeFs.mkdir(path.join(root, '.claude'));
      await invoke(part('isolation', 'install', '--yes'));
      await nodeFs.mkdir(path.join(root, '.cursor'));
      const update = json(await invoke(part('isolation', 'install', '--yes', '--json'), { now: LATER }));
      assert.deepEqual(update.files.map((item) => item.action), ['update']);
      assert.deepEqual(BLOCK_FOLDERS(await read('.kiroignore')), ['.claude/', '.cursor/']);

      const edited = (await read('.kiroignore')).replace('.cursor/', '.cursor/\nmy-own/');
      await nodeFs.writeFile(path.join(root, '.kiroignore'), edited);
      await nodeFs.mkdir(path.join(root, '.gemini'));
      const kept = json(await invoke(part('isolation', 'install', '--yes', '--json'), { now: LATER }));
      assert.deepEqual(kept.files.map((item) => [item.action, item.updateAvailable]), [['keep-modified', true]]);
      assert.equal(await read('.kiroignore'), edited);
    });

    it('does not claim a block it did not write, and does not write through a link', async () => {
      await nodeFs.mkdir(path.join(root, '.claude'));
      const foreign = '# >>> ecc-kiro-setup (managed block, do not edit) >>>\n.claude/\n# <<< ecc-kiro-setup <<<\n';
      await nodeFs.writeFile(path.join(root, '.kiroignore'), foreign);
      const claimed = json(await invoke(part('isolation', 'install', '--yes', '--json')));
      assert.deepEqual(claimed.files.map((item) => item.action), ['skip-conflict']);
      assert.equal(await read('.kiroignore'), foreign);
      assert.equal(await exists(STATE_RELATIVE_PATH), false);

      await nodeFs.rm(path.join(root, '.kiroignore'));
      const outside = path.join(tmp.dir, `ignore-target-${counter}.txt`);
      await nodeFs.writeFile(outside, 'precious\n');
      await nodeFs.symlink(outside, path.join(root, '.kiroignore'));
      const linked = json(await invoke(part('isolation', 'install', '--yes', '--json')));
      assert.deepEqual(linked.files.map((item) => [item.action, item.reason]), [['skip-conflict', 'is a symbolic link; left alone']]);
      assert.equal(await nodeFs.readFile(outside, 'utf8'), 'precious\n');
    });

    it('stops on damaged markers and says how to fix them', async () => {
      await nodeFs.mkdir(path.join(root, '.claude'));
      const damaged = '.env\n# <<< ecc-kiro-setup <<<\n';
      await nodeFs.writeFile(path.join(root, '.kiroignore'), damaged);
      const report = json(await invoke(part('isolation', 'install', '--yes', '--json')));
      assert.equal(report.ok, true, 'the file is skipped, not a failure');
      assert.match(report.files[0].reason, /^the ECC marker lines are damaged/);
      assert.equal(await read('.kiroignore'), damaged);
    });
  });

  describe('update', () => {
    const every = base;
    const ALL = 4 + 3 + STEERING_FILES.length + COMMAND_FILES.length + HOOK_FILES.length + SUPPORT_FILES.length + OWNED_FILES.length;
    /** The profile of this fixture without the hooks of the Kiro adapter (or without the ones named). */
    const writeProfileWithout = async (keep) => {
      const adapterPaths = sample.adapterPaths.filter((item) => !item.endsWith('.kiro.hook') || keep.includes(item));
      await nodeFs.writeFile(profileFile, formatProfile(buildProfile({ kimiState: sample.kimiState, adapterPaths, hashes: sample.hashes }).profile));
    };

    it('needs an install to work on: with no record it stops with a fix and writes nothing', async () => {
      for (const flag of ['--yes', '--dry-run']) {
        const result = await invoke(every('update', flag, '--json'));
        assert.equal(result.code, EXIT.FAILED, flag);
        assert.equal(json(result).error.code, 'not-installed');
        assert.match(json(result).error.message, /nothing to update: \.kiro\/ecc\/install-state\.json does not exist/);
        assert.match(json(result).error.fix, /Run "install" first/);
      }
      assert.deepEqual(await listRoot(), []);
      const plan = await invoke(every('plan', '--action', 'update', '--json'));
      assert.equal(json(plan).error.code, 'not-installed');
    });

    it('does nothing right after an install, not even to the state file', async () => {
      await invoke(every('install', '--yes'));
      const before = await read(STATE_RELATIVE_PATH);
      const dry = json(await invoke(every('update', '--dry-run', '--json'), { now: LATER }));
      assert.equal(dry.mode, 'update');
      assert.deepEqual(dry.counts, { create: 0, update: 0, unchanged: ALL, keepModified: 0, conflict: 0, remove: 0, stale: 0, forget: 0 });
      assert.equal(dry.changes, 0);
      const result = await invoke(every('update', '--yes'), { now: LATER });
      assert.equal(result.code, EXIT.OK);
      assert.match(result.out, /^ecc-kiro-setup update \(ECC v2\.2\.3/);
      assert.match(result.out, /Nothing to change: everything is already up to date\.\n$/);
      assert.equal(await read(STATE_RELATIVE_PATH), before);
    });

    it('removes what the install no longer includes, where install only reports it as stale', async () => {
      await invoke(every('install', '--yes'));
      await writeProfileWithout([legacyHookPath('tdd-reminder')]); // the git push hook is gone from the profile, and so is its guard script

      const stale = json(await invoke(every('install', '--yes', '--json'), { now: LATER }));
      assert.equal(stale.counts.stale, 2);
      assert.equal(stale.counts.remove, 0);
      assert.equal(await exists('.kiro/hooks/ecc-git-push-review.json'), true);

      const preview = json(await invoke(every('update', '--dry-run', '--json'), { now: LATER }));
      assert.equal(preview.counts.remove, 2);
      assert.deepEqual(preview.files.filter((item) => item.action === 'remove').map((item) => item.path), [GUARD_PATH, '.kiro/hooks/ecc-git-push-review.json']);
      assert.deepEqual(preview.protected, [{ path: '.kiro/hooks', kind: 'directory', files: 1 }]);
      assert.equal(await exists(GUARD_PATH), true, 'a preview removes nothing');

      const text = await invoke(every('update', '--yes'), { now: LATER });
      assert.equal(text.code, EXIT.OK, text.err);
      assert.match(text.out, /Wrote 0 files, removed 2\. Install state: \.kiro\/ecc\/install-state\.json \(\d+ files tracked\)\./);
      assert.equal(await exists(GUARD_PATH), false);
      assert.equal(await exists('.kiro/hooks/ecc-git-push-review.json'), false);
      assert.equal(await exists('.kiro/hooks/ecc-tdd-reminder.json'), true, 'the other hook stays');
      const state = await stateOnDisk();
      assert.equal(state.files.length, ALL - 2);
      assert.ok(!state.files.some((entry) => entry.path === GUARD_PATH));
    });

    it('keeps a file the user edited when it leaves the install, stops tracking it, and keeps its folder', async () => {
      await invoke(every('install', '--yes'));
      await nodeFs.writeFile(path.join(root, '.kiro/hooks/ecc-tdd-reminder.json'), '{"version": "v1", "mine": true}\n');
      await writeProfileWithout([]); // every hook is gone from the profile

      const report = json(await invoke(every('update', '--yes', '--json'), { now: LATER }));
      assert.equal(report.ok, true);
      assert.deepEqual(report.files.filter((item) => item.action === 'remove').map((item) => item.path), [GUARD_PATH, '.kiro/hooks/ecc-git-push-review.json']);
      const kept = report.files.find((item) => item.action === 'keep-modified');
      assert.deepEqual([kept.path, kept.reason], ['.kiro/hooks/ecc-tdd-reminder.json', 'edited after the install; kept and no longer tracked']);
      assert.equal(await read('.kiro/hooks/ecc-tdd-reminder.json'), '{"version": "v1", "mine": true}\n');
      assert.ok(!(await stateOnDisk()).files.some((entry) => entry.path.includes('tdd-reminder')));
      const text = (await invoke(every('update', '--yes'), { now: LATER })).out;
      assert.match(text, /Nothing to change/, 'the second update has nothing left to do');
    });

    it('removes a folder the install created once its last file goes', async () => {
      // The owned part also puts files in .kiro/hooks, so this runs without it.
      const noOwned = ['--only', 'agents,skills,steering,commands,hooks,mcp,license,isolation'];
      await invoke([...every('install', '--yes'), ...noOwned]);
      assert.ok((await stateOnDisk()).dirs.includes('.kiro/hooks'));
      await nodeFs.rm(path.join(root, '.kiro/hooks/ecc-tdd-reminder.json'));
      await writeProfileWithout([]);
      await invoke([...every('update', '--yes'), ...noOwned], { now: LATER });
      assert.equal(await exists('.kiro/hooks'), false, 'the folder was the installer\'s and is empty now');
      assert.equal(await exists('.kiro/agents'), true);
      assert.ok(!(await stateOnDisk()).dirs.includes('.kiro/hooks'));
    });

    it('follows the harness folders: lists a new one in the block, and takes the block out when none is left', async () => {
      const mine = 'node_modules/\n';
      await writeTree(root, { '.kiroignore': mine, '.claude/settings.json': '{}' });
      await invoke(every('install', '--yes'));

      await nodeFs.mkdir(path.join(root, '.kimi-code'));
      const grown = json(await invoke(every('update', '--yes', '--json'), { now: LATER }));
      assert.deepEqual(grown.files.filter((item) => item.path === '.kiroignore').map((item) => item.action), ['update']);
      assert.deepEqual(BLOCK_FOLDERS(await read('.kiroignore')), ['.claude/', '.kimi-code/']);

      await nodeFs.rm(path.join(root, '.claude'), { recursive: true });
      await nodeFs.rm(path.join(root, '.kimi-code'), { recursive: true });
      const gone = json(await invoke(every('update', '--yes', '--json'), { now: LATER }));
      assert.deepEqual(gone.files.filter((item) => item.path === '.kiroignore').map((item) => item.action), ['remove']);
      assert.equal(await read('.kiroignore'), mine, 'the user\'s lines are back exactly');
      assert.ok(!(await stateOnDisk()).files.some((entry) => entry.path === '.kiroignore'));
    });

    it('takes the block out of a file the installer made, and deletes the file with it', async () => {
      await nodeFs.mkdir(path.join(root, '.claude'));
      await invoke(every('install', '--yes'));
      await nodeFs.rm(path.join(root, '.claude'), { recursive: true });
      await invoke(every('update', '--yes'), { now: LATER });
      assert.equal(await exists('.kiroignore'), false);
    });

    it('limits an update to the parts it is asked about', async () => {
      await invoke(every('install', '--yes'));
      await writeProfileWithout([]);
      const agentsOnly = json(await invoke(every('update', '--dry-run', '--json', '--only', 'agents,skills'), { now: LATER }));
      assert.equal(agentsOnly.counts.remove, 0, 'the hooks are out of scope');
      assert.deepEqual(agentsOnly.parts, ['agents', 'skills']);
      const hooksOnly = json(await invoke(every('update', '--dry-run', '--json', '--only', 'hooks'), { now: LATER }));
      assert.equal(hooksOnly.counts.remove, 3);
    });

    it('stops without changing anything when the ECC source no longer matches the profile', async () => {
      await invoke(every('install', '--yes'));
      const before = await read(STATE_RELATIVE_PATH);
      await nodeFs.writeFile(path.join(source, 'agents/planner.md'), 'tampered');
      const result = await invoke(every('update', '--yes', '--json'), { now: LATER });
      assert.equal(result.code, EXIT.FAILED);
      assert.deepEqual(json(result).problems.map((item) => item.code), ['hash-mismatch']);
      assert.equal(await read(STATE_RELATIVE_PATH), before);
    });
  });

  describe('uninstall', () => {
    const everything = 4 + 3 + STEERING_FILES.length + COMMAND_FILES.length + HOOK_FILES.length + SUPPORT_FILES.length + OWNED_FILES.length;
    const un = (...rest) => ['uninstall', ...rest, '--root', root];

    it('asks for --yes, and previews with --dry-run or plan without changing anything', async () => {
      await writeTree(root, { '.claude/settings.json': '{}' });
      await invoke(base('install', '--yes'));
      const before = await snapshot();

      const bare = await invoke(un());
      assert.equal(bare.code, EXIT.USAGE);
      assert.match(bare.err, /uninstall removes files\. Preview with "plan --action uninstall" \(or --dry-run\), then run again with --yes/);

      const dry = await invoke(un('--dry-run', '--json'), { now: LATER });
      assert.equal(dry.code, EXIT.OK, dry.err);
      const report = json(dry);
      assert.equal(report.schema, 'ecc-kiro.plan.v1');
      assert.deepEqual([report.mode, report.dryRun, report.source, report.ok], ['uninstall', true, null, true]);
      assert.deepEqual(report.profile, { id: 'kimi-parity', file: null });
      assert.deepEqual(report.parts, ['agents', 'skills', 'steering', 'commands', 'hooks', 'owned', 'mcp', 'license', 'isolation']);
      assert.deepEqual(report.counts, { create: 0, update: 0, unchanged: 0, keepModified: 0, conflict: 0, remove: everything + 1, stale: 0, forget: 0 });
      assert.deepEqual(report.stateFile, { path: STATE_RELATIVE_PATH, remove: true });
      assert.equal(report.changes, everything + 2, 'the files, the block and the install record');
      assert.deepEqual(report.protected, [
        { path: '.kiro/agents', kind: 'directory', files: 4 + 3 },
        { path: '.kiro/hooks', kind: 'directory', files: 2 + 2 },
        { path: '.kiro/workflows', kind: 'directory', files: 1 },
        { path: '.kiroignore', kind: 'file', files: 1 },
      ]);
      assert.ok(report.files.every((item) => item.action === 'remove'));

      const viaPlan = json(await invoke(['plan', '--action', 'uninstall', '--json', '--root', root], { now: LATER }));
      assert.deepEqual(viaPlan, report);

      const text = (await invoke(un('--dry-run'), { now: LATER })).out;
      assert.match(text, /^ecc-kiro-setup uninstall preview \(ECC v2\.2\.3, profile kimi-parity\)\n/);
      assert.doesNotMatch(text, /Source /);
      assert.match(text, new RegExp(`remove ${everything + 1} {3}kept \\(edited\\) 0 {3}already gone 0`));
      assert.match(text, /The install record \.kiro\/ecc\/install-state\.json goes last, then the folders the install created, if they are empty\. The ecc-kiro-setup skill is not touched\./);
      assert.match(text, /Kiro always asks before the agent changes these paths, so the installer removes what it put there itself once you confirm:/);
      assert.match(text, /\.kiroignore {2}\(1 file\)/);
      assert.ok(text.includes(`Nothing was removed. To apply: node ${skillRoot}/scripts/ecc-kiro.mjs uninstall --root ${root} --yes\n`), text);

      assert.deepEqual(await snapshot(), before, 'none of the previews touched the project');
    });

    it('gives an empty project back empty, and one with a .kiroignore of its own back exactly as it was', async () => {
      await writeTree(root, { '.claude/settings.json': '{}' });
      const original = await snapshot();
      await invoke(base('install', '--yes'));
      assert.notDeepEqual(await snapshot(), original);
      assert.equal(await exists('.kiroignore'), true);

      const result = await invoke(un('--yes'), { now: LATER });
      assert.equal(result.code, EXIT.OK, result.err);
      assert.match(result.out, new RegExp(`Removed ${everything + 1} files\\. The install record \\.kiro/ecc/install-state\\.json was removed too\\.\\n$`));
      assert.deepEqual(await snapshot(), original);

      // The same with lines of the user's own, in a file with Windows line breaks and no final newline.
      const mine = '# mine\r\nnode_modules/\r\n.env';
      await nodeFs.writeFile(path.join(root, '.kiroignore'), mine);
      const withIgnore = await snapshot();
      await invoke(base('install', '--yes'), { now: LATER });
      assert.match(await read('.kiroignore'), /^# mine\r\nnode_modules\/\r\n\.env\r\n\r\n# >>> ecc-kiro-setup/);
      await invoke(un('--yes'), { now: LATER });
      assert.equal(await read('.kiroignore'), '# mine\r\nnode_modules/\r\n.env\r\n', 'only the missing final line break is different');
      assert.deepEqual({ ...(await snapshot()), '.kiroignore': undefined }, { ...withIgnore, '.kiroignore': undefined });
    });

    it('leaves what was in the project before: the user\'s files in the same folders, and the folders themselves', async () => {
      await writeTree(root, {
        '.kiro/steering/mine.md': 'my steering',
        '.kiro/skills/mine/SKILL.md': 'my skill',
        '.kiro/agents/planner.md': 'my own planner',
        'src/app.ts': 'code',
        '.kimi-code/AGENTS.md': 'kimi',
      });
      const original = await snapshot();
      const installed = json(await invoke(base('install', '--yes', '--json')));
      assert.equal(installed.counts.conflict, 1, 'the planner agent is the user\'s and was skipped');

      const result = await invoke(un('--yes', '--json'), { now: LATER });
      assert.equal(result.code, EXIT.OK, result.err);
      assert.equal(json(result).counts.remove, everything + 1 - 1);
      assert.deepEqual(await snapshot(), original);
    });

    it('keeps a file the user edited, in its folder, and a block the user edited, and stops tracking them', async () => {
      await writeTree(root, { '.claude/settings.json': '{}' });
      await invoke(base('install', '--yes'));
      await nodeFs.appendFile(path.join(root, '.kiro/agents/planner.md'), '\nMy own rule.\n');
      const hook = JSON.parse(await read('.kiro/hooks/ecc-tdd-reminder.json'));
      hook.hooks[0].enabled = true;
      await nodeFs.writeFile(path.join(root, '.kiro/hooks/ecc-tdd-reminder.json'), `${JSON.stringify(hook, null, 2)}\n`);
      const editedIgnore = (await read('.kiroignore')).replace('.claude/', '.claude/\nmy-own/');
      await nodeFs.writeFile(path.join(root, '.kiroignore'), editedIgnore);

      const preview = json(await invoke(un('--dry-run', '--json'), { now: LATER }));
      assert.deepEqual(preview.files.filter((item) => item.action === 'keep-modified').map((item) => item.path), ['.kiro/agents/planner.md', '.kiro/hooks/ecc-tdd-reminder.json', '.kiroignore']);
      assert.equal(preview.counts.keepModified, 3);
      const text = (await invoke(un('--dry-run'), { now: LATER })).out;
      assert.match(text, /Kept: you edited these after the install, so they were not changed\.\n {2}\.kiro\/agents\/planner\.md: edited after the install; kept and no longer tracked/);

      const result = await invoke(un('--yes', '--json'), { now: LATER });
      assert.equal(result.code, EXIT.OK, result.err);
      assert.equal(json(result).state.removed, true, 'what the user edited is theirs now, so nothing is tracked');
      assert.deepEqual(Object.keys(await snapshot()).filter((item) => !item.startsWith('.claude')), ['.kiro/', '.kiro/agents/', '.kiro/agents/planner.md', '.kiro/hooks/', '.kiro/hooks/ecc-tdd-reminder.json', '.kiroignore']);
      assert.equal(await read('.kiroignore'), editedIgnore);
      assert.match(await read('.kiro/agents/planner.md'), /My own rule\./);
    });

    it('never removes the ecc-kiro-setup skill, or anything in its folder', async () => {
      const skill = { '.kiro/skills/ecc-kiro-setup/SKILL.md': 'the skill', '.kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs': 'code', '.kiro/skills/ecc-kiro-setup/assets/x.json': '{}' };
      await writeTree(root, skill);
      const original = await snapshot();
      await invoke(base('install', '--yes'));
      assert.equal((await invoke(un('--yes'), { now: LATER })).code, EXIT.OK);
      assert.deepEqual(await snapshot(), original);

      // A state file that names the skill is refused outright, and nothing is removed.
      await invoke(base('install', '--yes'), { now: LATER });
      const state = JSON.parse(await read(STATE_RELATIVE_PATH));
      state.files.push({ path: '.kiro/skills/ecc-kiro-setup/SKILL.md', category: 'skill', source: null, sha256: sha256Hex('the skill') });
      await nodeFs.writeFile(path.join(root, STATE_RELATIVE_PATH), JSON.stringify(state));
      const installedTree = await snapshot();
      for (const flag of ['--dry-run', '--yes']) {
        const refused = await invoke(un(flag, '--json'), { now: LATER });
        assert.equal(refused.code, EXIT.FAILED, flag);
        assert.equal(json(refused).error.code, 'state-invalid');
        assert.match(json(refused).error.message, /ecc-kiro-setup skill itself/);
      }
      assert.deepEqual(await snapshot(), installedTree);
    });

    it('removes everything the record lists on a full uninstall, even a category this build has no part for, and only those parts with --only', async () => {
      await invoke(base('install', '--yes', '--only', 'agents'));
      await writeTree(root, { '.kiro/steering/from-another-version.md': 'old' });
      const state = JSON.parse(await read(STATE_RELATIVE_PATH));
      state.files.push({ path: '.kiro/steering/from-another-version.md', category: 'steering-legacy', source: null, sha256: sha256Hex('old') });
      await nodeFs.writeFile(path.join(root, STATE_RELATIVE_PATH), JSON.stringify(state));

      const limited = json(await invoke(un('--dry-run', '--json', '--only', 'steering'), { now: LATER }));
      assert.equal(limited.counts.remove, 0, 'no part of this build owns that category');
      const full = json(await invoke(un('--yes', '--json'), { now: LATER }));
      assert.equal(full.counts.remove, 5);
      // The file is gone. Its folder was made by this test, not by the installer, so the folder stays.
      assert.deepEqual(await snapshot(), { '.kiro/': 'dir', '.kiro/steering/': 'dir' });
    });

    it('needs no ECC source, no profile and no git: the install state is enough', async () => {
      await invoke(base('install', '--yes'));
      await nodeFs.rm(source, { recursive: true });
      await nodeFs.rm(profileFile);
      const result = await invoke(un('--yes', '--json'), { now: LATER });
      assert.equal(result.code, EXIT.OK, result.err);
      assert.equal(json(result).state.removed, true);
      assert.deepEqual(await listRoot(), []);
    });

    it('says there is nothing to remove, and succeeds, when no install was recorded', async () => {
      await writeTree(root, { 'src/a.ts': 'x', '.kiro/steering/mine.md': 'mine' });
      const before = await snapshot();
      for (const flag of ['--dry-run', '--yes']) {
        const result = await invoke(un(flag, '--json'));
        assert.equal(result.code, EXIT.OK, flag);
        const report = json(result);
        assert.deepEqual([report.ok, report.changes, report.counts.remove], [true, 0, 0], flag);
        assert.deepEqual(report.notes.map((note) => note.code), ['not-installed']);
      }
      assert.match((await invoke(un('--dry-run'))).out, /Nothing to remove\.\n$/);
      assert.match((await invoke(un('--yes'))).out, /Nothing to remove\.\n$/);
      assert.deepEqual(await snapshot(), before);

      await invoke(base('install', '--yes'));
      await invoke(un('--yes'), { now: LATER });
      assert.match((await invoke(un('--yes'), { now: LATER })).out, /Nothing to remove\./, 'a second uninstall finds nothing');
    });

    it('with --only removes those parts, keeps the install record for the others, and a full uninstall finishes the job', async () => {
      await nodeFs.mkdir(path.join(root, '.claude'));
      await invoke(base('install', '--yes'));
      const preview = json(await invoke(un('--dry-run', '--json', '--only', 'hooks,owned,isolation'), { now: LATER }));
      assert.deepEqual(preview.parts, ['hooks', 'owned', 'isolation']);
      assert.equal(preview.counts.remove, HOOK_FILES.length + OWNED_FILES.length + 1);
      assert.deepEqual(preview.stateFile, { path: STATE_RELATIVE_PATH, remove: false });
      assert.equal(preview.changes, HOOK_FILES.length + OWNED_FILES.length + 1);
      assert.doesNotMatch((await invoke(un('--dry-run', '--only', 'hooks,owned,isolation'), { now: LATER })).out, /install record .* goes last/);

      const part = json(await invoke(un('--yes', '--json', '--only', 'hooks,owned,isolation'), { now: LATER }));
      assert.equal(part.state.removed, false);
      assert.equal(part.state.files, everything - HOOK_FILES.length - OWNED_FILES.length);
      assert.equal(await exists('.kiro/hooks'), false);
      assert.equal(await exists('.kiroignore'), false);
      assert.equal(await exists('.kiro/agents/planner.md'), true);
      assert.match((await invoke(un('--yes', '--only', 'hooks,owned,isolation'), { now: LATER })).out, /Nothing to remove\./, 'asking again finds nothing of those parts');
      assert.match((await invoke(un('--dry-run', '--only', 'hooks,owned,isolation'), { now: LATER })).out, /Nothing to remove\./);

      const rest = json(await invoke(un('--yes', '--json'), { now: LATER }));
      assert.equal(rest.state.removed, true);
      assert.deepEqual(await nodeFs.readdir(root), ['.claude']);

      const bad = await invoke(un('--dry-run', '--json', '--only', 'bogus'));
      assert.equal(bad.code, EXIT.USAGE);
    });

    it('stops at a failure, keeps a record of what is left, and a second run finishes', async () => {
      await invoke(base('install', '--yes'));
      let removals = 0;
      const flaky = {
        ...Object.fromEntries(Object.keys(nodeFs).map((key) => [key, nodeFs[key]])),
        async rm(file, options) {
          if (String(file).endsWith('.md')) {
            removals += 1;
            if (removals === 5) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          }
          return nodeFs.rm(file, options);
        },
      };
      const failed = await invoke(un('--yes', '--json'), { fs: flaky, now: LATER });
      assert.equal(failed.code, EXIT.FAILED);
      const report = json(failed);
      assert.equal(report.ok, false);
      assert.equal(report.failure.code, 'EACCES');
      assert.equal(report.failure.dest, '.kiro/agents/ecc-panel-frontend.md');
      assert.equal(report.state.removed, false);
      assert.ok(report.applied.removed >= 4, 'the four agents come before it');
      const partial = await stateOnDisk();
      assert.equal(partial.status, 'partial');
      assert.equal(partial.files.length, everything - report.applied.removed, 'the record lists what is left');

      const second = await invoke(un('--yes', '--json'), { now: LATER });
      assert.equal(second.code, EXIT.OK, second.err);
      assert.equal(json(second).state.removed, true);
      assert.deepEqual(await listRoot(), []);
    });

    it('refuses to remove through a folder that is a link out of the project, and removes nothing', async () => {
      await invoke(base('install', '--yes'));
      const outside = path.join(tmp.dir, `outside-agents-${counter}`);
      await nodeFs.mkdir(outside);
      await nodeFs.writeFile(path.join(outside, 'planner.md'), 'outside');
      await nodeFs.rename(path.join(root, '.kiro/agents'), path.join(tmp.dir, `moved-agents-${counter}`));
      await nodeFs.symlink(outside, path.join(root, '.kiro/agents'));
      const result = await invoke(un('--yes', '--json'), { now: LATER });
      assert.equal(result.code, EXIT.FAILED);
      assert.ok(json(result).problems.length > 0 && json(result).problems.every((item) => item.code === 'unsafe-path'));
      assert.equal(await nodeFs.readFile(path.join(outside, 'planner.md'), 'utf8'), 'outside');
      assert.equal(await exists(STATE_RELATIVE_PATH), true);
    });

    it('stops with a fix when the install state cannot be read', async () => {
      await writeTree(root, { [STATE_RELATIVE_PATH]: '{ not json' });
      const result = await invoke(un('--yes', '--json'));
      assert.equal(result.code, EXIT.FAILED);
      assert.equal(json(result).error.code, 'state-invalid');
      assert.equal(await read(STATE_RELATIVE_PATH), '{ not json');
    });

    it('refuses to run on the folder that holds the global Kiro settings', async () => {
      const result = await invoke(['uninstall', '--dry-run', '--json', '--root', home]);
      assert.equal(result.code, EXIT.FAILED);
      assert.equal(json(result).error.code, 'root-is-kiro-home');
    });
  });

  describe('install, update and uninstall again and again', () => {
    it('settle on the same files every time, and an install after an uninstall gives the same bytes as the first', async () => {
      await writeTree(root, { '.claude/settings.json': '{}', '.kimi-code/AGENTS.md': 'x', '.kiroignore': 'dist/\n' });
      const original = await snapshot();
      /** The project without the install state, whose timestamps differ from run to run. */
      const withoutState = async () => {
        const found = await snapshot();
        delete found[STATE_RELATIVE_PATH];
        return found;
      };
      await invoke(base('install', '--yes'));
      const installed = await withoutState();
      assert.notDeepEqual(installed, original);

      for (const [name, argv] of [['install', base('install', '--yes')], ['update', base('update', '--yes')], ['install', base('install', '--yes')], ['update', base('update', '--yes')]]) {
        const result = await invoke(argv, { now: LATER });
        assert.equal(result.code, EXIT.OK, name);
        assert.match(result.out, /Nothing to change: everything is already up to date\./, name);
        assert.deepEqual(await withoutState(), installed, name);
      }

      await invoke(['uninstall', '--yes', '--root', root], { now: LATER });
      assert.deepEqual(await snapshot(), original);
      await invoke(base('install', '--yes'), { now: LATER });
      assert.deepEqual(await withoutState(), installed);
    });
  });

  describe('formatPlanReport', () => {
    const report = (files, counts = {}) => ({
      schema: 'ecc-kiro.plan.v1',
      ok: true,
      mode: 'install',
      root: '/p',
      profile: { id: 'kimi-parity' },
      source: { dir: '/s', origin: 'cache', commit: 'c05b2d6614f62f6db0047669aa4eefb223d478f9', commitVerified: true },
      parts: ['agents'],
      counts: { create: 0, update: 0, unchanged: 0, keepModified: 0, conflict: 0, remove: 0, stale: 0, forget: 0, ...counts },
      changes: 0,
      protected: [],
      files,
      notes: [],
      problems: [],
    });

    it('says when an edited file has a newer version that was not applied', () => {
      const text = formatPlanReport(
        report(
          [
            { path: '.kiro/agents/a.md', category: 'agent', action: 'keep-modified', reason: 'edited', updateAvailable: true },
            { path: '.kiro/agents/b.md', category: 'agent', action: 'keep-modified', reason: 'edited' },
          ],
          { keepModified: 2 },
        ),
      );
      assert.match(text, /\.kiro\/agents\/a\.md: edited \(a newer version was not applied\)/);
      assert.match(text, /\.kiro\/agents\/b\.md: edited\n/);
    });

    it('shows only the first twenty entries of a long list', () => {
      const files = Array.from({ length: 23 }, (_, i) => ({ path: `.kiro/agents/f${String(i).padStart(2, '0')}.md`, category: 'agent', action: 'skip-conflict', reason: 'exists' }));
      const text = formatPlanReport(report(files, { conflict: 23 }));
      assert.match(text, /f19\.md: exists/);
      assert.doesNotMatch(text, /f20\.md/);
      assert.match(text, /\.\.\.and 3 more/);
    });

    it('lists stale files and tells the user how to remove them', () => {
      const text = formatPlanReport(report([{ path: '.kiro/agents/old.md', category: 'agent', action: 'stale', reason: 'no longer part of the install' }], { stale: 1 }));
      assert.match(text, /stale 1/);
      assert.match(text, /Stale: no longer part of the install \(run "update" to remove them\)\./);
    });
  });

  describe('usage', () => {
    it('lists the new options and commands', () => {
      const text = usage();
      assert.match(text, /--only <value>/);
      assert.match(text, /--yes/);
      assert.match(text, /--dry-run/);
      assert.match(text, /--action <value>/);
      const lineFor = (name) => text.split('\n').find((line) => line.trimStart().startsWith(`${name} `));
      for (const name of ['plan', 'install', 'update', 'uninstall']) assert.doesNotMatch(lineFor(name), /not available/, name);
      assert.match(text, /--action <value>\s+what "plan" previews: install \(default\), update or uninstall/);
    });
  });
});
