// Tests of the parts that touch the disk: inspecting a project and applying decisions.
// They use real temporary directories, and a wrapper around fs where a failure must be injected.

import assert from 'node:assert/strict';
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { STATE_RELATIVE_PATH } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { CodedError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import { formatState, parseState, reconcile } from '../skills/ecc-kiro-setup/scripts/lib/state.mjs';
import {
  applyDecisions,
  assertSafeDestination,
  findUnsafeDestinations,
  inspectDestinations,
  pruneEmptyDirs,
} from '../skills/ecc-kiro-setup/scripts/io/apply.mjs';
import { makeTempDir, writeTree } from './fixtures.mjs';

const NOW = new Date('2026-10-07T10:00:00.000Z');
const LATER = new Date('2026-10-09T08:00:00.000Z');
const sha = (text) => sha256Hex(text);
const scope = new Set(['agent']);

const plannedFile = (name, text, part = 'agents') => ({
  dest: `.kiro/agents/${name}.md`,
  content: text,
  sha256: sha(text),
  source: `agents/${name}.md`,
  category: 'agent',
  part,
});

async function readIfPresent(file) {
  try {
    return await nodeFs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Decide and apply in one go, like the install command does. */
async function run(root, planned, { mode = 'install', previous = null, fs = nodeFs, now = NOW, parts = ['agents'] } = {}) {
  const dests = [...planned.map((file) => file.dest), ...(previous?.files ?? []).map((entry) => entry.path)];
  const disk = await inspectDestinations({ root, dests, fs });
  const decisions = reconcile({ mode, planned, state: previous, disk, scope });
  const result = await applyDecisions({ root, decisions, previous, parts, mode, now, fs });
  return { decisions, result };
}

async function stateOf(root) {
  const text = await readIfPresent(path.join(root, STATE_RELATIVE_PATH));
  return text === null ? null : parseState(text);
}

describe('io/apply', () => {
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

  describe('inspectDestinations', () => {
    it('tells apart a missing path, a file (with its hash) and other things', async () => {
      await writeTree(root, { '.kiro/agents/a.md': 'A', 'notdir': 'x' });
      await nodeFs.mkdir(path.join(root, '.kiro/agents/folder'));
      await nodeFs.symlink('a.md', path.join(root, '.kiro/agents/link.md'));
      const found = await inspectDestinations({
        root,
        dests: ['.kiro/agents/a.md', '.kiro/agents/none.md', '.kiro/agents/folder', '.kiro/agents/link.md', 'notdir/below.md', '.kiro/nothing/at/all.md'],
      });
      assert.deepEqual(found.get('.kiro/agents/a.md'), { kind: 'file', sha256: sha('A') });
      assert.deepEqual(found.get('.kiro/agents/none.md'), { kind: 'missing' });
      assert.deepEqual(found.get('.kiro/nothing/at/all.md'), { kind: 'missing' });
      assert.equal(found.get('.kiro/agents/folder').kind, 'other');
      assert.match(found.get('.kiro/agents/link.md').detail, /symbolic link/);
      assert.match(found.get('notdir/below.md').detail, /parent/);
    });

    it('refuses a path that is not relative and inside the project', async () => {
      await assert.rejects(inspectDestinations({ root, dests: ['../outside'] }), /unsafe path/);
    });
  });

  describe('assertSafeDestination', () => {
    const codeOf = async (dest) => {
      try {
        await assertSafeDestination({ root, dest });
      } catch (error) {
        assert.ok(error instanceof CodedError);
        return `${error.code}: ${error.message}`;
      }
      return null;
    };

    it('accepts ordinary destinations, including ones whose folders do not exist yet', async () => {
      assert.equal(await codeOf('.kiro/agents/a.md'), null);
      assert.equal(await codeOf('.kiroignore'), null);
      await writeTree(root, { '.kiro/agents/x.md': 'x' });
      assert.equal(await codeOf('.kiro/agents/a.md'), null);
    });

    it('refuses paths the installer must never manage', async () => {
      assert.match(await codeOf('.kiro/settings/mcp.json'), /unsafe-path.*settings/);
      assert.match(await codeOf('../escape.md'), /unsafe-path.*safe relative path/);
      assert.match(await codeOf('/etc/passwd'), /unsafe-path/);
      assert.match(await codeOf('src/app.js'), /unsafe-path.*outside \.kiro/);
      assert.match(await codeOf(STATE_RELATIVE_PATH), /unsafe-path.*state file/);
    });

    it('refuses a folder that is really a link to somewhere outside the project', async () => {
      const outside = path.join(tmp.dir, `outside-${counter}`);
      await nodeFs.mkdir(outside);
      await nodeFs.mkdir(path.join(root, '.kiro'));
      await nodeFs.symlink(outside, path.join(root, '.kiro/agents'));
      assert.match(await codeOf('.kiro/agents/a.md'), /unsafe-path.*\.kiro\/agents is a symbolic link that leaves the project/);
      assert.deepEqual(await nodeFs.readdir(outside), []);
    });

    it('refuses a link that points nowhere, and a folder that is a file', async () => {
      await nodeFs.mkdir(path.join(root, '.kiro'));
      await nodeFs.symlink(path.join(tmp.dir, 'does-not-exist'), path.join(root, '.kiro/agents'));
      assert.match(await codeOf('.kiro/agents/a.md'), /points nowhere/);
      await writeTree(root, { '.kiro/steering': 'a file where a folder should be' });
      assert.match(await codeOf('.kiro/steering/a.md'), /\.kiro\/steering is not a directory/);
    });

    it('accepts a link to a folder that stays inside the project', async () => {
      await nodeFs.mkdir(path.join(root, 'shared/agents'), { recursive: true });
      await nodeFs.mkdir(path.join(root, '.kiro'));
      await nodeFs.symlink(path.join(root, 'shared/agents'), path.join(root, '.kiro/agents'));
      assert.equal(await codeOf('.kiro/agents/a.md'), null);
    });

    it('collects failures instead of throwing', async () => {
      const problems = await findUnsafeDestinations({ root, dests: ['.kiro/agents/a.md', '.kiro/settings/x.json', '../y'] });
      assert.deepEqual(problems.map((item) => item.path), ['.kiro/settings/x.json', '../y']);
      assert.ok(problems.every((item) => item.code === 'unsafe-path'));
    });
  });

  describe('applyDecisions: a fresh install', () => {
    it('writes every file, creates the folders it needs and records them', async () => {
      const { decisions, result } = await run(root, [plannedFile('a', 'A'), plannedFile('b', 'B')]);
      assert.equal(result.failure, null);
      assert.equal(result.written, 2);
      assert.equal(result.removed, 0);
      assert.equal(result.stateWritten, true);
      assert.deepEqual(decisions.map((item) => item.action), ['create', 'create']);
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/a.md')), 'A');
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/b.md')), 'B');

      const state = await stateOf(root);
      assert.equal(state.status, 'complete');
      assert.equal(state.installedAt, NOW.toISOString());
      assert.deepEqual(state.dirs, ['.kiro', '.kiro/agents', '.kiro/ecc']);
      assert.deepEqual(state.files.map((entry) => [entry.path, entry.sha256]), [
        ['.kiro/agents/a.md', sha('A')],
        ['.kiro/agents/b.md', sha('B')],
      ]);
    });

    it('does not record folders that already existed', async () => {
      await nodeFs.mkdir(path.join(root, '.kiro/agents'), { recursive: true });
      await run(root, [plannedFile('a', 'A')]);
      assert.deepEqual((await stateOf(root)).dirs, ['.kiro/ecc']);
    });

    it('leaves no temporary files behind', async () => {
      await run(root, [plannedFile('a', 'A')]);
      const names = [...(await nodeFs.readdir(path.join(root, '.kiro/agents'))), ...(await nodeFs.readdir(path.join(root, '.kiro/ecc')))];
      assert.deepEqual(names.sort(), ['a.md', 'install-state.json']);
    });

    it('writes binary content as given', async () => {
      const bytes = Buffer.from([0, 255, 10, 13, 200]);
      await run(root, [{ ...plannedFile('bin', ''), content: bytes, sha256: sha256Hex(bytes) }]);
      assert.deepEqual(await nodeFs.readFile(path.join(root, '.kiro/agents/bin.md')), bytes);
    });

    it('creates no state file when nothing was installed', async () => {
      await writeTree(root, { '.kiro/agents/a.md': 'mine' });
      const { decisions, result } = await run(root, [plannedFile('a', 'A')]);
      assert.deepEqual(decisions.map((item) => item.action), ['skip-conflict']);
      assert.equal(result.written, 0);
      assert.equal(await readIfPresent(path.join(root, STATE_RELATIVE_PATH)), null);
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/a.md')), 'mine');
    });
  });

  describe('applyDecisions: running again', () => {
    it('changes nothing, not even the state file', async () => {
      const planned = [plannedFile('a', 'A'), plannedFile('b', 'B')];
      await run(root, planned);
      const before = await nodeFs.readFile(path.join(root, STATE_RELATIVE_PATH), 'utf8');
      const statBefore = await nodeFs.stat(path.join(root, STATE_RELATIVE_PATH));

      const again = await run(root, planned, { previous: await stateOf(root), now: LATER });
      assert.deepEqual(again.decisions.map((item) => item.action), ['unchanged', 'unchanged']);
      assert.equal(again.result.written, 0);
      assert.equal(again.result.stateWritten, false);
      assert.equal(await nodeFs.readFile(path.join(root, STATE_RELATIVE_PATH), 'utf8'), before);
      assert.equal((await nodeFs.stat(path.join(root, STATE_RELATIVE_PATH))).mtimeMs, statBefore.mtimeMs);
    });

    it('updates files the user has not edited, keeps ones they have, and says so in the state', async () => {
      await run(root, [plannedFile('a', 'A'), plannedFile('b', 'B'), plannedFile('c', 'C')]);
      await nodeFs.writeFile(path.join(root, '.kiro/agents/b.md'), 'B edited by me');

      const next = [plannedFile('a', 'A v2'), plannedFile('b', 'B v2'), plannedFile('c', 'C')];
      const { decisions, result } = await run(root, next, { previous: await stateOf(root), now: LATER });
      assert.deepEqual(decisions.map((item) => item.action), ['update', 'keep-modified', 'unchanged']);
      assert.equal(result.written, 1);
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/a.md')), 'A v2');
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/b.md')), 'B edited by me');

      const state = await stateOf(root);
      assert.equal(state.updatedAt, LATER.toISOString());
      assert.equal(state.installedAt, NOW.toISOString());
      const recorded = Object.fromEntries(state.files.map((entry) => [entry.path, entry.sha256]));
      assert.equal(recorded['.kiro/agents/a.md'], sha('A v2'));
      assert.equal(recorded['.kiro/agents/b.md'], sha('B'), 'still the installed version, so the edit is still noticed');
    });

    it('never overwrites a file it does not own, and installs the rest', async () => {
      await writeTree(root, { '.kiro/agents/b.md': 'the user\'s own agent' });
      const { decisions, result } = await run(root, [plannedFile('a', 'A'), plannedFile('b', 'B')]);
      assert.deepEqual(decisions.map((item) => item.action), ['create', 'skip-conflict']);
      assert.equal(result.written, 1);
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/b.md')), 'the user\'s own agent');
      assert.deepEqual((await stateOf(root)).files.map((entry) => entry.path), ['.kiro/agents/a.md']);
    });

    it('does not write through a link that replaced an owned file', async () => {
      await run(root, [plannedFile('a', 'A')]);
      const target = path.join(tmp.dir, `secret-${counter}.txt`);
      await nodeFs.writeFile(target, 'precious');
      await nodeFs.rm(path.join(root, '.kiro/agents/a.md'));
      await nodeFs.symlink(target, path.join(root, '.kiro/agents/a.md'));

      const { decisions } = await run(root, [plannedFile('a', 'A v2')], { previous: await stateOf(root) });
      assert.equal(decisions[0].action, 'skip-conflict');
      assert.equal(await nodeFs.readFile(target, 'utf8'), 'precious');
    });
  });

  describe('applyDecisions: removing', () => {
    it('update deletes untouched files that are no longer planned, keeps edited ones, and drops folders it created', async () => {
      await run(root, [plannedFile('a', 'A'), plannedFile('b', 'B')]);
      await nodeFs.writeFile(path.join(root, '.kiro/agents/b.md'), 'B edited');

      const { decisions, result } = await run(root, [], { mode: 'update', previous: await stateOf(root), now: LATER });
      assert.deepEqual(decisions.map((item) => item.action), ['remove', 'keep-modified']);
      assert.equal(result.removed, 1);
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/a.md')), null);
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/b.md')), 'B edited');

      const state = await stateOf(root);
      assert.deepEqual(state.files, [], 'the edited file is the user\'s now');
      assert.ok(state.dirs.includes('.kiro/agents'), 'the folder still holds the user\'s file, so it stays');
    });

    it('removes a folder it created once it is empty', async () => {
      await run(root, [plannedFile('a', 'A')]);
      const { result } = await run(root, [], { mode: 'update', previous: await stateOf(root), now: LATER });
      assert.equal(result.removed, 1);
      await assert.rejects(nodeFs.stat(path.join(root, '.kiro/agents')), /ENOENT/);
      assert.deepEqual((await stateOf(root)).dirs, ['.kiro', '.kiro/ecc'], 'the state file still lives in .kiro/ecc');
    });

    it('install only reports stale files and leaves them in place', async () => {
      await run(root, [plannedFile('a', 'A'), plannedFile('b', 'B')]);
      const { decisions, result } = await run(root, [plannedFile('a', 'A')], { previous: await stateOf(root), now: LATER });
      assert.deepEqual(decisions.map((item) => item.action), ['unchanged', 'stale']);
      assert.equal(result.removed, 0);
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/b.md')), 'B');
      assert.equal((await stateOf(root)).files.length, 2);
    });

    it('forgets a file the user deleted', async () => {
      await run(root, [plannedFile('a', 'A'), plannedFile('b', 'B')]);
      await nodeFs.rm(path.join(root, '.kiro/agents/b.md'));
      const { decisions } = await run(root, [plannedFile('a', 'A')], { mode: 'update', previous: await stateOf(root), now: LATER });
      assert.deepEqual(decisions.map((item) => item.action), ['unchanged', 'forget']);
      assert.deepEqual((await stateOf(root)).files.map((entry) => entry.path), ['.kiro/agents/a.md']);
    });

    it('pruneEmptyDirs keeps folders with content, and ignores ones that are already gone', async () => {
      await writeTree(root, { 'x/keep/file.txt': 'x' });
      await nodeFs.mkdir(path.join(root, 'x/empty/deeper'), { recursive: true });
      const remaining = await pruneEmptyDirs({ root, dirs: new Set(['x', 'x/keep', 'x/empty', 'x/empty/deeper', 'x/gone']) });
      assert.deepEqual([...remaining].sort(), ['x', 'x/keep']);
      await assert.rejects(nodeFs.stat(path.join(root, 'x/empty')), /ENOENT/);
    });
  });

  describe('applyDecisions: when something goes wrong', () => {
    /** An fs whose rename fails on the n-th call. */
    const failingRename = (failOn) => {
      let calls = 0;
      return {
        ...Object.fromEntries(Object.keys(nodeFs).map((key) => [key, nodeFs[key]])),
        async rename(from, to) {
          calls += 1;
          if (calls === failOn) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          return nodeFs.rename(from, to);
        },
      };
    };

    it('stops at the failure, saves the state of what was done, and a second run finishes the job', async () => {
      const planned = ['a', 'b', 'c', 'd'].map((name) => plannedFile(name, name.toUpperCase()));
      const first = await run(root, planned, { fs: failingRename(3) });

      assert.equal(first.result.failure.code, 'ENOSPC');
      assert.equal(first.result.failure.dest, '.kiro/agents/c.md');
      assert.match(first.result.failure.message, /disk full/);
      assert.equal(first.result.written, 2);
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/c.md')), null);
      assert.equal(await readIfPresent(path.join(root, '.kiro/agents/d.md')), null, 'nothing runs after the failure');
      assert.deepEqual((await nodeFs.readdir(path.join(root, '.kiro/agents'))).sort(), ['a.md', 'b.md'], 'no temp file is left behind');

      const partial = await stateOf(root);
      assert.equal(partial.status, 'partial');
      assert.deepEqual(partial.files.map((entry) => entry.path), ['.kiro/agents/a.md', '.kiro/agents/b.md']);

      const second = await run(root, planned, { previous: partial, now: LATER });
      assert.equal(second.result.failure, null);
      assert.deepEqual(second.decisions.map((item) => item.action), ['unchanged', 'unchanged', 'create', 'create']);
      const done = await stateOf(root);
      assert.equal(done.status, 'complete');
      assert.equal(done.files.length, 4);
      assert.equal(done.installedAt, NOW.toISOString());
    });

    it('reports an unsafe destination and writes nothing', async () => {
      const bad = { ...plannedFile('x', 'X'), dest: '.kiro/settings/mcp.json' };
      const disk = new Map();
      const decisions = reconcile({ mode: 'install', planned: [bad], state: null, disk, scope });
      const result = await applyDecisions({ root, decisions, previous: null, parts: ['agents'], mode: 'install', now: NOW });
      assert.equal(result.failure.code, 'unsafe-path');
      assert.equal(result.failure.dest, '.kiro/settings/mcp.json');
      assert.equal(result.written, 0);
      assert.deepEqual(await nodeFs.readdir(root), []);
    });

    it('does not follow a folder link out of the project', async () => {
      const outside = path.join(tmp.dir, `outside-apply-${counter}`);
      await nodeFs.mkdir(outside);
      await nodeFs.mkdir(path.join(root, '.kiro'));
      await nodeFs.symlink(outside, path.join(root, '.kiro/agents'));
      const { result } = await run(root, [plannedFile('a', 'A')]);
      assert.equal(result.failure.code, 'unsafe-path');
      assert.deepEqual(await nodeFs.readdir(outside), []);
    });

    it('does not write the state file through a link either', async () => {
      const outside = path.join(tmp.dir, `outside-state-${counter}`);
      await nodeFs.mkdir(outside);
      await nodeFs.mkdir(path.join(root, '.kiro'));
      await nodeFs.symlink(outside, path.join(root, '.kiro/ecc'));
      const { result } = await run(root, [plannedFile('a', 'A')]);
      assert.notEqual(result.failure, null);
      assert.match(result.failure.message, /symbolic link that leaves the project/);
      assert.deepEqual(await nodeFs.readdir(outside), []);
    });

    it('refuses decisions for a part it was not asked to run', async () => {
      const decisions = reconcile({ mode: 'install', planned: [plannedFile('a', 'A', 'skills')], state: null, disk: new Map(), scope });
      await assert.rejects(applyDecisions({ root, decisions, previous: null, parts: ['agents'], mode: 'install', now: NOW }), /not being applied/);
    });

    it('runs parts in the order given and saves the state after each part that changed something', async () => {
      const seen = [];
      const spy = {
        ...Object.fromEntries(Object.keys(nodeFs).map((key) => [key, nodeFs[key]])),
        async rename(from, to) {
          seen.push(path.relative(root, to));
          return nodeFs.rename(from, to);
        },
      };
      const planned = [plannedFile('a', 'A', 'agents'), { ...plannedFile('z', 'Z', 'skills'), dest: '.kiro/agents/z.md' }];
      const disk = await inspectDestinations({ root, dests: planned.map((file) => file.dest) });
      const decisions = reconcile({ mode: 'install', planned, state: null, disk, scope });
      await applyDecisions({ root, decisions, previous: null, parts: ['skills', 'agents'], mode: 'install', now: NOW, fs: spy });
      // skills part, state saved; agents part, state saved; final state with status "complete"
      assert.deepEqual(seen, ['.kiro/agents/z.md', STATE_RELATIVE_PATH, '.kiro/agents/a.md', STATE_RELATIVE_PATH, STATE_RELATIVE_PATH]);
      assert.equal((await stateOf(root)).status, 'complete');
    });
  });

  it('writes a state file that formats and parses to the same text', async () => {
    await run(root, [plannedFile('a', 'A')]);
    const text = await nodeFs.readFile(path.join(root, STATE_RELATIVE_PATH), 'utf8');
    assert.equal(formatState(parseState(text)), text);
  });
});
