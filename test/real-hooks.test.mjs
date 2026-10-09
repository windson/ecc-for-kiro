// The real ECC v2.2.3 hooks: the 13 .kiro.hook files of the Kiro adapter, converted to 12 v1 hook files, and
// the git push guard that ships in the skill. These tests read the pinned checkout in the source cache and
// are skipped when it is not there (fetch it with: ecc-kiro.mjs verify --fetch).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import nodeFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

import { EXIT, runCli } from '../skills/ecc-kiro-setup/scripts/lib/cli.mjs';
import { defaultProfilePath } from '../skills/ecc-kiro-setup/scripts/lib/commands/verify.mjs';
import { HOOK_TRIGGERS, validateHookFile } from '../skills/ecc-kiro-setup/scripts/lib/hook-schema.mjs';
import { DOC_MATCHER, GUARD_COMMAND, GUARD_DEST } from '../skills/ecc-kiro-setup/scripts/lib/hooks.mjs';
import { resolveCacheRoot } from '../skills/ecc-kiro-setup/scripts/lib/paths.mjs';
import { buildPlanned, entriesFor } from '../skills/ecc-kiro-setup/scripts/lib/plan.mjs';
import { steeringDest } from '../skills/ecc-kiro-setup/scripts/lib/steering.mjs';
import { CHECKLIST } from '../skills/ecc-kiro-setup/scripts/runtime/git-push-guard.mjs';
import { cacheCheckoutPath, readVerifiedFiles } from '../skills/ecc-kiro-setup/scripts/io/source.mjs';
import { shippedCommandAssets } from './command-assets.mjs';
import { makeTempDir, pinnedGit } from './fixtures.mjs';
import { captureStreams, memoryProbes } from './helpers.mjs';
import { shippedHookAssets } from './hook-assets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..', 'skills', 'ecc-kiro-setup');
const checkout = cacheCheckoutPath(resolveCacheRoot(process.env, os.homedir()));
const haveCheckout = existsSync(path.join(checkout, 'AGENTS.md')) && existsSync(path.join(checkout, '.kiro', 'hooks', 'auto-format.kiro.hook'));
const SNAPSHOT = JSON.parse(readFileSync(path.join(HERE, 'snapshots', 'hooks-v2.2.3.json'), 'utf8'));
const decoder = new TextDecoder('utf-8', { fatal: true });

// The glob semantics of the source files, written out apart from the translator, so that a change to
// lib/hooks.mjs is held against what the patterns meant: *.ext is a file name ending, **/dir/** a folder
// named dir somewhere above the file.
function globMatches(glob, filePath) {
  if (glob.startsWith('*.')) return filePath.endsWith(glob.slice(1));
  const folder = /^\*\*\/([^/]+)\/\*\*$/.exec(glob)[1];
  return filePath.split('/').slice(0, -1).includes(folder);
}

const SAMPLE_PATHS = [
  'a.ts', 'src/app.ts', 'src/App.tsx', 'src/util.js', 'src/index.jsx', 'src/x.tsx.bak', 'x.d.ts', 'tools/run.py', 'run.pyc', 'src/lib.rs', 'src/librs',
  'src/auth/login.ts', 'auth/x', 'api/handler.py', 'src/middleware/cors.js', 'src/authors/list.ts', 'src/oauth/a.ts', 'src/api', 'rapid/x.js',
  '/abs/project/src/api/v1/users.ts', '/abs/auth.ts', 'README.md', 'docs/guide.md', 'package.json', 'lib/main.go', 'a/b/c/d/e.rs', '.ts', 'ts',
];

describe('the real ECC hooks', { skip: haveCheckout ? false : 'ECC v2.2.3 is not in the source cache' }, () => {
  let profile;
  let read;
  let built;
  let legacy;
  let hookFiles;

  const source = (rel) => decoder.decode(read.files.get(rel));
  const stemOf = (dest) => dest.split('/').pop().replace(/\.json$/, '');

  before(async () => {
    profile = JSON.parse(readFileSync(defaultProfilePath(SKILL_DIR), 'utf8'));
    read = await readVerifiedFiles({ dir: checkout, entries: entriesFor(['hooks'], profile) });
    assert.deepEqual(read.missing, []);
    assert.deepEqual(read.mismatched, []);
    built = buildPlanned({ parts: ['hooks'], profile, sourceFiles: read.files, hookAssets: shippedHookAssets() });
    legacy = new Map(profile.entries.filter((e) => e.category === 'adapter-hook').map((e) => [e.name, JSON.parse(source(e.path))]));
    hookFiles = built.planned.filter((file) => file.category === 'hook').map((file) => ({ file, parsed: JSON.parse(String(file.content)) }));
  });

  it('reads the 13 hooks of the Kiro adapter, all matching the profile', () => {
    assert.equal(entriesFor(['hooks'], profile).length, 13);
    assert.equal(read.files.size, 13);
    assert.equal(legacy.size, 13);
    assert.deepEqual([...legacy.values()].filter((hook) => hook.enabled !== true), [], 'in ECC they all ship switched on, which is why the install switches them off');
  });

  it('plans without a problem: 12 hook files and the guard script', () => {
    assert.deepEqual(built.problems, []);
    assert.equal(hookFiles.length, 12);
    assert.equal(built.planned.length, 13);
    assert.ok(hookFiles.every(({ file }) => file.part === 'hooks' && file.category === 'hook' && /^\.kiro\/hooks\/ecc-[a-z0-9-]+\.json$/.test(file.dest)));
    assert.deepEqual(built.planned.filter((file) => file.category === 'hook-script').map((file) => file.dest), [GUARD_DEST]);
  });

  it('ships every one of the twelve hooks switched off, with "enabled": false in the file', () => {
    assert.equal(hookFiles.length, 12);
    for (const { file, parsed } of hookFiles) {
      assert.equal(parsed.hooks.length, 1, file.dest);
      assert.strictEqual(parsed.hooks[0].enabled, false, `${file.dest} must be switched off`);
      assert.match(String(file.content), /"enabled": false\n/, `${file.dest} says so in words`);
      assert.doesNotMatch(String(file.content), /"enabled": true/, file.dest);
    }
    assert.equal(built.details.hooks.disabled, 12);
  });

  it('writes files the v1 validator accepts, with every hook required to be off', () => {
    for (const { file, parsed } of hookFiles) assert.deepEqual(validateHookFile(parsed, { requireDisabled: true }), [], file.dest);
  });

  it('uses only version v1 and the portable triggers, and no key beyond name, description, trigger, matcher, action and enabled', () => {
    for (const { file, parsed } of hookFiles) {
      assert.equal(parsed.version, 'v1', file.dest);
      assert.deepEqual(Object.keys(parsed), ['version', 'hooks'], file.dest);
      const hook = parsed.hooks[0];
      assert.ok(Object.hasOwn(HOOK_TRIGGERS, hook.trigger), `${file.dest}: ${hook.trigger}`);
      assert.ok(Object.keys(hook).every((key) => ['name', 'description', 'trigger', 'matcher', 'action', 'enabled'].includes(key)), file.dest);
      assert.ok(String(file.content).endsWith('}\n'), `${file.dest} ends with a newline`);
    }
  });

  it('names each hook ecc-<name>, as its file and its source are called', () => {
    const names = hookFiles.map(({ parsed }) => parsed.hooks[0].name);
    assert.equal(new Set(names).size, 12);
    for (const { file, parsed } of hookFiles) {
      assert.equal(parsed.hooks[0].name, stemOf(file.dest), file.dest);
      assert.equal(file.source, `.kiro/hooks/${parsed.hooks[0].name.slice(4)}.kiro.hook`, file.dest);
      assert.ok(legacy.has(parsed.hooks[0].name.slice(4)));
    }
  });

  it('matches the snapshot: trigger, matcher and action type of each hook, what was adapted, what was left out', () => {
    const actual = Object.fromEntries(hookFiles.map(({ parsed }) => [parsed.hooks[0].name, { trigger: parsed.hooks[0].trigger, matcher: parsed.hooks[0].matcher ?? null, action: parsed.hooks[0].action.type }]));
    assert.deepEqual(actual, SNAPSHOT.hooks);
    assert.deepEqual(built.details.hooks.adapted.map((item) => item.name), SNAPSHOT.adapted);
    assert.deepEqual(built.details.hooks.skipped.map((item) => item.name), SNAPSHOT.skipped);
    assert.deepEqual(built.details.hooks.scripts, SNAPSHOT.scripts);
    assert.deepEqual(built.details.hooks.byTrigger, SNAPSHOT.byTrigger);
    assert.deepEqual([built.details.hooks.total, built.details.hooks.converted, built.details.hooks.agentActions, built.details.hooks.commandActions], [13, 12, 11, 1]);
  });

  it('matches the snapshot: which hooks fire for which paths, and for which tool names', () => {
    const compiled = hookFiles.map(({ parsed }) => parsed.hooks[0]);
    const fires = {};
    for (const filePath of Object.keys(SNAPSHOT.fires)) {
      fires[filePath] = {};
      for (const trigger of ['PostFileSave', 'PostFileCreate']) {
        const names = compiled.filter((hook) => hook.trigger === trigger && new RegExp(hook.matcher).test(filePath)).map((hook) => hook.name);
        if (names.length > 0) fires[filePath][trigger] = names;
      }
    }
    assert.deepEqual(fires, SNAPSHOT.fires);
    const tools = {};
    for (const tool of Object.keys(SNAPSHOT.tools)) {
      tools[tool] = {};
      for (const trigger of ['PreToolUse', 'PostToolUse']) {
        const names = compiled.filter((hook) => hook.trigger === trigger && new RegExp(hook.matcher).test(tool)).map((hook) => hook.name);
        if (names.length > 0) tools[tool][trigger] = names;
      }
    }
    assert.deepEqual(tools, SNAPSHOT.tools);
  });

  it('keeps the file hooks on the files the patterns of the source named, for a wide range of paths', () => {
    let fired = 0;
    let quiet = 0;
    for (const { parsed } of hookFiles) {
      const hook = parsed.hooks[0];
      const old = legacy.get(hook.name.slice(4));
      if (old.when.patterns === undefined) continue;
      for (const filePath of SAMPLE_PATHS) {
        const expected = old.when.patterns.some((glob) => globMatches(glob, filePath));
        assert.equal(new RegExp(hook.matcher).test(filePath), expected, `${hook.name} on ${filePath}`);
        if (expected) fired += 1;
        else quiet += 1;
      }
    }
    assert.ok(fired > 20 && quiet > 100, `${fired} paths fired and ${quiet} did not; the sample has to tell the two apart`);
  });

  it('maps the trigger of every source hook as the plan says', () => {
    const expected = { fileEdited: 'PostFileSave', fileCreated: 'PostFileCreate', agentStop: 'Stop', postToolUse: 'PostToolUse', preToolUse: 'PreToolUse' };
    for (const { parsed } of hookFiles) {
      const hook = parsed.hooks[0];
      const old = legacy.get(hook.name.slice(4));
      const want = hook.name === 'ecc-doc-file-warning' ? 'PostFileCreate' : expected[old.when.type];
      assert.equal(hook.trigger, want, hook.name);
    }
    assert.deepEqual([...legacy.values()].map((hook) => hook.when.type).filter((type) => !Object.hasOwn(expected, type)), ['userTriggered']);
  });

  it('keeps the description and the prompt of the nine agent hooks that are not adapted, word for word', () => {
    const adapted = new Set(SNAPSHOT.adapted);
    let checked = 0;
    for (const { parsed } of hookFiles) {
      const hook = parsed.hooks[0];
      const name = hook.name.slice(4);
      if (adapted.has(name)) continue;
      const old = legacy.get(name);
      assert.equal(old.then.type, 'askAgent', name);
      assert.equal(hook.description, old.description, name);
      assert.deepEqual(hook.action, { type: 'agent', prompt: old.then.prompt }, name);
      checked += 1;
    }
    assert.equal(checked, 9);
  });

  it('differs from the source in exactly the ways of the three adaptations', () => {
    const byName = new Map(hookFiles.map(({ parsed }) => [parsed.hooks[0].name, parsed.hooks[0]]));

    const extract = byName.get('ecc-extract-patterns');
    const old = legacy.get('extract-patterns');
    assert.equal(extract.action.prompt, old.then.prompt.replace('.kiro/steering/lessons-learned.md', '.kiro/steering/ecc-lessons-learned.md'));
    assert.equal(extract.description, old.description.replace('lessons-learned.md', 'ecc-lessons-learned.md'));
    assert.notEqual(extract.action.prompt, old.then.prompt);
    assert.ok(profile.entries.some((entry) => entry.category === 'adapter-steering' && entry.name === 'lessons-learned'), 'the steering part installs the file the hook names');
    assert.ok(extract.action.prompt.includes(steeringDest('lessons-learned')), 'and the path is the one it installs');

    const doc = byName.get('ecc-doc-file-warning');
    const oldDoc = legacy.get('doc-file-warning').then.prompt;
    assert.equal(
      doc.action.prompt,
      oldDoc
        .replace('You are about to create or modify a file.', 'A file was just created.')
        .replace("If you're creating documentation", 'If you created documentation')
        .replace('or skip it.', 'or remove it.')
        .replace(' Proceed with the write operation if appropriate.', ' Otherwise carry on.'),
    );
    assert.notEqual(doc.action.prompt, oldDoc);
    assert.equal(doc.action.prompt.split('\n').length, oldDoc.split('\n').length, 'the lines of the prompt are the same');
    assert.equal(doc.matcher, DOC_MATCHER);

    const push = byName.get('ecc-git-push-review');
    assert.deepEqual(push.action, { type: 'command', command: GUARD_COMMAND });
    assert.equal(legacy.get('git-push-review').then.type, 'askAgent');
    assert.deepEqual(legacy.get('git-push-review').when.toolTypes, ['shell']);
  });

  it('gives the git push hook the shell tool, a command, and a script that is the one in the skill', () => {
    const push = hookFiles.map(({ parsed }) => parsed.hooks[0]).find((hook) => hook.name === 'ecc-git-push-review');
    assert.deepEqual([push.trigger, push.matcher, push.action.type, push.enabled], ['PreToolUse', 'shell', 'command', false]);
    const script = built.planned.find((file) => file.dest === GUARD_DEST);
    assert.equal(script.content, readFileSync(path.join(SKILL_DIR, 'scripts', 'runtime', 'git-push-guard.mjs'), 'utf8'));
    assert.equal(script.source, null);
    assert.equal(script.mode, undefined, 'the hook runs it with node, so it needs no execute bit');
    assert.ok(push.action.command.endsWith(GUARD_DEST));
  });

  it('has a guard whose checklist is the four points of the prompt it replaces', () => {
    const prompt = legacy.get('git-push-review').then.prompt.toLowerCase();
    assert.equal(CHECKLIST.length, 4);
    for (const item of CHECKLIST) assert.ok(prompt.includes(item.toLowerCase().replace(/^the /, '').replace(/\.$/, '')), item);
  });

  it('leaves out the one hook that is started by hand, which the commands part gives as /ecc-quality-gate', () => {
    assert.equal(legacy.get('quality-gate').when.type, 'userTriggered');
    assert.deepEqual(built.planned.filter((file) => file.dest.includes('quality-gate')), []);
    const gate = shippedCommandAssets().classes.commands['quality-gate'];
    assert.equal(gate.builtin, 'quality-gate', 'the engine builds /ecc-quality-gate');
    assert.match(built.notes.find((note) => note.code === 'hooks-skipped').message, /quality-gate.*\/ecc-quality-gate/);
  });

  it('counts 11 agent hooks, which cost credits when on, and 1 command hook, which does not', () => {
    const kinds = hookFiles.map(({ parsed }) => parsed.hooks[0].action.type);
    assert.deepEqual([kinds.filter((kind) => kind === 'agent').length, kinds.filter((kind) => kind === 'command').length], [11, 1]);
    assert.match(built.notes.find((note) => note.code === 'hooks-disabled').message, /^12 hooks are installed switched off\..*11 run an agent prompt, which uses credits.*1 runs a script and uses none$/);
  });

  describe('plan and install on the real skill folder and the real cache', () => {
    const invoke = async (argv, root, home) => {
      const streams = captureStreams();
      const code = await runCli(argv, {
        stdout: streams.stdout,
        stderr: streams.stderr,
        probes: memoryProbes({ cwd: root, homedir: home }),
        skillDir: SKILL_DIR,
        services: { git: pinnedGit(), fs: nodeFs, now: () => new Date('2026-10-07T10:00:00.000Z') },
      });
      return { code, out: streams.out, err: streams.err };
    };

    it('plans 13 files, writes nothing, installs them with every hook off, and a second run changes nothing', async () => {
      const project = await makeTempDir();
      try {
        const home = path.join(project.dir, 'home');
        const root = path.join(project.dir, 'project');
        await nodeFs.mkdir(path.join(home, '.kiro'), { recursive: true });
        await nodeFs.mkdir(root, { recursive: true });
        const args = ['--only', 'hooks', '--source', checkout, '--root', root];

        const preview = await invoke(['plan', '--json', ...args], root, home);
        assert.equal(preview.code, EXIT.OK, preview.err);
        const report = JSON.parse(preview.out);
        assert.deepEqual(report.problems, []);
        assert.equal(report.counts.create, 13);
        assert.deepEqual(report.protected, [{ path: '.kiro/hooks', kind: 'directory', files: 12 }]);
        assert.deepEqual(await nodeFs.readdir(root), [], 'plan writes nothing');

        const text = (await invoke(['plan', ...args], root, home)).out;
        assert.match(text, /Hooks: 12 hooks in \.kiro\/hooks, all switched off; actions: 11 agent prompts \(credits when on\), 1 script; not converted: quality-gate; 1 script file installed\n/);
        assert.match(text, /\.kiro\/hooks\/ {2}\(12 files\)/);

        const installed = await invoke(['install', '--yes', '--json', ...args], root, home);
        assert.equal(installed.code, EXIT.OK, installed.err);
        assert.deepEqual(JSON.parse(installed.out).applied, { written: 13, removed: 0 });

        const names = (await nodeFs.readdir(path.join(root, '.kiro', 'hooks'))).sort();
        assert.equal(names.length, 12);
        for (const name of names) {
          const parsed = JSON.parse(await nodeFs.readFile(path.join(root, '.kiro', 'hooks', name), 'utf8'));
          assert.strictEqual(parsed.hooks[0].enabled, false, `${name} is installed switched off`);
          assert.deepEqual(validateHookFile(parsed, { requireDisabled: true }), [], name);
        }
        assert.equal(await nodeFs.readFile(path.join(root, GUARD_DEST), 'utf8'), shippedHookAssets().guard);
        const state = JSON.parse(await nodeFs.readFile(path.join(root, '.kiro', 'ecc', 'install-state.json'), 'utf8'));
        assert.deepEqual([state.files.filter((f) => f.category === 'hook').length, state.files.filter((f) => f.category === 'hook-script').length], [12, 1]);

        const again = JSON.parse((await invoke(['install', '--yes', '--json', ...args], root, home)).out);
        assert.deepEqual(again.applied, { written: 0, removed: 0 });
        assert.equal(again.counts.unchanged, 13);
      } finally {
        await project.cleanup();
      }
    });
  });
});
