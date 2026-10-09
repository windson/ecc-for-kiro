// The disk side of update and uninstall: the managed block of .kiroignore, and the end of an uninstall
// (the state file goes last, then the folders the install created). Real temporary folders, and a
// wrapper around fs where a failure or the order of calls matters.

import assert from 'node:assert/strict';
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { KIROIGNORE_BLOCK_BEGIN, KIROIGNORE_BLOCK_END, STATE_RELATIVE_PATH } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import { buildBlock } from '../skills/ecc-kiro-setup/scripts/lib/kiroignore.mjs';
import { formatState, parseState, reconcile } from '../skills/ecc-kiro-setup/scripts/lib/state.mjs';
import { applyDecisions, inspectDestinations } from '../skills/ecc-kiro-setup/scripts/io/apply.mjs';
import { makeTempDir, writeTree } from './fixtures.mjs';

const NOW = new Date('2026-10-07T10:00:00.000Z');
const LATER = new Date('2026-10-09T08:00:00.000Z');
const sha = (text) => sha256Hex(text);
const scope = new Set(['agent', 'kiroignore']);

const BLOCK = buildBlock(['.claude', '.kimi-code']);
const BLOCK_2 = buildBlock(['.claude', '.codex', '.kimi-code']);

const agent = (name, text) => ({ dest: `.kiro/agents/${name}.md`, content: text, sha256: sha(text), source: `agents/${name}.md`, category: 'agent', part: 'agents' });
const ignoreBlock = (block = BLOCK) => ({ dest: '.kiroignore', content: block, sha256: sha(block), source: null, category: 'kiroignore', part: 'isolation' });

async function readIfPresent(file) {
  try {
    return await nodeFs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

describe('io/apply: update and uninstall', () => {
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

  const read = (rel) => readIfPresent(path.join(root, rel));
  const stateOf = async () => {
    const text = await read(STATE_RELATIVE_PATH);
    return text === null ? null : parseState(text);
  };
  /** Decide and apply in one go, like the commands do. `scopeOf` limits what an update or uninstall may touch. */
  async function run(planned, { mode = 'install', previous = null, fs = nodeFs, now = NOW, parts = ['agents', 'isolation'], scopeOf = scope } = {}) {
    const dests = [...planned.map((file) => file.dest), ...(previous?.files ?? []).map((entry) => entry.path)];
    const disk = await inspectDestinations({ root, dests, fs });
    const decisions = reconcile({ mode, planned, state: previous, disk, scope: scopeOf });
    const result = await applyDecisions({ root, decisions, previous, parts, mode, now, fs });
    return { decisions, result };
  }
  const tree = async (dir = root, prefix = '') => {
    const found = [];
    for (const entry of (await nodeFs.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) found.push(`${rel}/`, ...(await tree(path.join(dir, entry.name), `${rel}/`)));
      else found.push(rel);
    }
    return found;
  };

  describe('inspecting .kiroignore', () => {
    const inspect = async () => (await inspectDestinations({ root, dests: ['.kiroignore'] })).get('.kiroignore');

    it('sees no file, and a file without the block, as the block being missing', async () => {
      assert.deepEqual(await inspect(), { kind: 'missing' });
      await writeTree(root, { '.kiroignore': 'node_modules/\n.env\n' });
      assert.deepEqual(await inspect(), { kind: 'missing' });
    });

    it('takes the hash of the block text, not of the file', async () => {
      await writeTree(root, { '.kiroignore': `.env\n\n${BLOCK}\nlogs/\n` });
      assert.deepEqual(await inspect(), { kind: 'file', sha256: sha(BLOCK) });
      await writeTree(root, { '.kiroignore': `${BLOCK.split('\n').join('\r\n')}\r\n` });
      assert.deepEqual(await inspect(), { kind: 'file', sha256: sha(BLOCK) }, 'the same block with Windows line breaks');
    });

    it('sees an edit inside the block as a different hash', async () => {
      await writeTree(root, { '.kiroignore': `${BLOCK.replace('.claude/', '.claude/\nmine/')}\n` });
      assert.notEqual((await inspect()).sha256, sha(BLOCK));
    });

    it('reports damaged markers, a link, a folder and text that is not UTF-8 as something else', async () => {
      await writeTree(root, { '.kiroignore': `${KIROIGNORE_BLOCK_BEGIN}\n.claude/\n` });
      assert.match((await inspect()).detail, /marker lines are damaged/);
      await nodeFs.rm(path.join(root, '.kiroignore'));
      await nodeFs.symlink('elsewhere', path.join(root, '.kiroignore'));
      assert.deepEqual(await inspect(), { kind: 'other', detail: 'is a symbolic link' });
      await nodeFs.rm(path.join(root, '.kiroignore'));
      await nodeFs.mkdir(path.join(root, '.kiroignore'));
      assert.deepEqual(await inspect(), { kind: 'other', detail: 'is not a regular file' });
      await nodeFs.rmdir(path.join(root, '.kiroignore'));
      await nodeFs.writeFile(path.join(root, '.kiroignore'), Buffer.from([0x23, 0xff, 0xfe, 0x0a]));
      assert.deepEqual(await inspect(), { kind: 'other', detail: 'is not valid UTF-8 text' });
    });
  });

  describe('writing the block', () => {
    it('creates the file when there is none, and remembers that the installer made it', async () => {
      const { result } = await run([ignoreBlock()]);
      assert.equal(result.failure, null);
      assert.equal(result.written, 1);
      assert.equal(await read('.kiroignore'), `${BLOCK}\n`);
      const [entry] = (await stateOf()).files;
      assert.deepEqual(entry, { path: '.kiroignore', category: 'kiroignore', source: null, sha256: sha(BLOCK), createdFile: true });
    });

    it('adds the block to a file the user has, keeps every line of theirs, and does not claim the file', async () => {
      const mine = 'node_modules/\r\n.env\n!.env.example\n';
      await writeTree(root, { '.kiroignore': mine });
      await run([ignoreBlock()]);
      assert.equal(await read('.kiroignore'), `${mine}\r\n${BLOCK.split('\n').join('\r\n')}\r\n`);
      const [entry] = (await stateOf()).files;
      assert.equal('createdFile' in entry, false);
    });

    it('keeps the permission bits of the file it adds to', async () => {
      await writeTree(root, { '.kiroignore': '.env\n' });
      await nodeFs.chmod(path.join(root, '.kiroignore'), 0o600);
      await run([ignoreBlock()]);
      assert.equal((await nodeFs.stat(path.join(root, '.kiroignore'))).mode & 0o777, 0o600);
    });

    it('replaces the block in place when the folders change, and keeps the user\'s lines around it', async () => {
      await writeTree(root, { '.kiroignore': '.env\n' });
      await run([ignoreBlock()]);
      await nodeFs.appendFile(path.join(root, '.kiroignore'), 'added later by the user\n');

      const { decisions } = await run([ignoreBlock(BLOCK_2)], { mode: 'update', previous: await stateOf(), now: LATER });
      assert.deepEqual(decisions.map((item) => item.action), ['update']);
      assert.equal(await read('.kiroignore'), `.env\n\n${BLOCK_2}\nadded later by the user\n`);
      assert.equal((await stateOf()).files[0].sha256, sha(BLOCK_2));
    });

    it('keeps the "created the file" mark through an update', async () => {
      await run([ignoreBlock()]);
      await run([ignoreBlock(BLOCK_2)], { mode: 'update', previous: await stateOf(), now: LATER });
      assert.equal((await stateOf()).files[0].createdFile, true);
      assert.equal(await read('.kiroignore'), `${BLOCK_2}\n`);
    });

    it('leaves a block alone that the user edited, and says a newer version was not applied', async () => {
      await run([ignoreBlock()]);
      const edited = `${BLOCK.replace('.claude/', '.claude/\nmine/')}\n`;
      await nodeFs.writeFile(path.join(root, '.kiroignore'), edited);
      const { decisions, result } = await run([ignoreBlock(BLOCK_2)], { mode: 'update', previous: await stateOf(), now: LATER });
      assert.deepEqual(decisions.map((item) => [item.action, item.updateAvailable]), [['keep-modified', true]]);
      assert.equal(result.written, 0);
      assert.equal(await read('.kiroignore'), edited);
      assert.equal((await stateOf()).files[0].sha256, sha(BLOCK), 'still the installed block, so the edit is still noticed');
    });

    it('writes the block back when the user removed only the block, and the whole file when it was deleted', async () => {
      await writeTree(root, { '.kiroignore': '.env\n' });
      await run([ignoreBlock()]);
      await nodeFs.writeFile(path.join(root, '.kiroignore'), '.env\n');
      const partial = await run([ignoreBlock()], { previous: await stateOf(), now: LATER });
      assert.equal(partial.decisions[0].reason, 'restored: the block was deleted after the install');
      assert.equal(await read('.kiroignore'), `.env\n\n${BLOCK}\n`);
      assert.equal('createdFile' in (await stateOf()).files[0], false, 'the file was the user\'s all along');

      await nodeFs.rm(path.join(root, '.kiroignore'));
      await run([ignoreBlock()], { previous: await stateOf(), now: LATER });
      assert.equal(await read('.kiroignore'), `${BLOCK}\n`);
      assert.equal((await stateOf()).files[0].createdFile, true, 'now the installer made it');
    });

    it('does not write through a link, and does not claim a block it did not write', async () => {
      const target = path.join(tmp.dir, `target-${counter}.txt`);
      await nodeFs.writeFile(target, 'precious\n');
      await nodeFs.symlink(target, path.join(root, '.kiroignore'));
      const { decisions, result } = await run([ignoreBlock()]);
      assert.deepEqual(decisions.map((item) => item.action), ['skip-conflict']);
      assert.equal(result.written, 0);
      assert.equal(await nodeFs.readFile(target, 'utf8'), 'precious\n');

      await nodeFs.rm(path.join(root, '.kiroignore'));
      await writeTree(root, { '.kiroignore': `${BLOCK}\n` });
      const foreign = await run([ignoreBlock()]);
      assert.deepEqual(foreign.decisions.map((item) => item.action), ['skip-conflict'], 'a block with no record is not ours');
      assert.equal(await stateOf(), null);
    });

    it('stops on damaged markers without changing the file', async () => {
      const damaged = `.env\n${KIROIGNORE_BLOCK_END}\n`;
      await writeTree(root, { '.kiroignore': damaged });
      const { decisions } = await run([ignoreBlock()]);
      assert.equal(decisions[0].action, 'skip-conflict');
      assert.match(decisions[0].reason, /marker lines are damaged \(expected one begin line followed by one end line\); left alone$/);
      assert.equal(await read('.kiroignore'), damaged);
    });
  });

  describe('removing the block', () => {
    it('deletes a file the installer made when nothing else is in it', async () => {
      await run([ignoreBlock()]);
      const { decisions, result } = await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER });
      assert.deepEqual(decisions.map((item) => item.action), ['remove']);
      assert.equal(result.removed, 1);
      assert.equal(await read('.kiroignore'), null);
    });

    it('keeps a file the installer made when the user has added lines to it since', async () => {
      await run([ignoreBlock()]);
      await nodeFs.appendFile(path.join(root, '.kiroignore'), 'mine/\n');
      await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER });
      assert.equal(await read('.kiroignore'), 'mine/\n');
    });

    it('gives a file the user had back exactly as it was', async () => {
      const mine = '# my rules\r\nnode_modules/\r\n\r\n.env\r\n';
      await writeTree(root, { '.kiroignore': mine });
      await run([ignoreBlock()]);
      await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER });
      assert.equal(await read('.kiroignore'), mine);
    });

    it('keeps an empty file the user had, since the installer did not make it', async () => {
      await writeTree(root, { '.kiroignore': '' });
      await run([ignoreBlock()]);
      await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER });
      assert.equal(await read('.kiroignore'), '');
    });

    it('update takes the block out when no harness folder is left, and leaves the rest of the install', async () => {
      await run([agent('a', 'A'), ignoreBlock()]);
      const { decisions } = await run([agent('a', 'A')], { mode: 'update', previous: await stateOf(), now: LATER });
      assert.deepEqual(decisions.map((item) => [item.dest, item.action]), [['.kiro/agents/a.md', 'unchanged'], ['.kiroignore', 'remove']]);
      assert.equal(await read('.kiroignore'), null);
      assert.deepEqual((await stateOf()).files.map((entry) => entry.path), ['.kiro/agents/a.md']);
    });

    it('does not remove a block the user edited, and stops tracking it', async () => {
      await run([ignoreBlock()]);
      const edited = `${BLOCK.replace('.claude/', '.claude/\nmine/')}\n`;
      await nodeFs.writeFile(path.join(root, '.kiroignore'), edited);
      const { decisions } = await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER });
      assert.deepEqual(decisions.map((item) => item.action), ['keep-modified']);
      assert.equal(await read('.kiroignore'), edited);
    });

    it('takes the block out last, after the files', async () => {
      await run([agent('a', 'A'), agent('b', 'B'), ignoreBlock()]);
      const calls = [];
      const spy = {
        ...Object.fromEntries(Object.keys(nodeFs).map((key) => [key, nodeFs[key]])),
        async rm(file, options) {
          calls.push(path.relative(root, file));
          return nodeFs.rm(file, options);
        },
        async rename(from, to) {
          calls.push(`write ${path.relative(root, to)}`);
          return nodeFs.rename(from, to);
        },
      };
      await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER, fs: spy });
      const at = (name) => calls.findIndex((call) => call === name);
      assert.ok(at('.kiro/agents/a.md') >= 0 && at('.kiro/agents/b.md') >= 0 && at('.kiroignore') >= 0, calls.join(', '));
      assert.ok(at('.kiroignore') > at('.kiro/agents/b.md'), calls.join(', '));
      assert.ok(at(STATE_RELATIVE_PATH) > at('.kiroignore'), 'and the state file after that');
    });
  });

  describe('the end of an uninstall', () => {
    it('removes the files, then the state file, then the folders it created: an empty project stays empty', async () => {
      await run([agent('a', 'A'), agent('b', 'B'), ignoreBlock()]);
      assert.notDeepEqual(await tree(), []);
      const { result } = await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER });
      assert.equal(result.failure, null);
      assert.equal(result.removed, 3);
      assert.equal(result.stateRemoved, true);
      assert.equal(result.state, null);
      assert.deepEqual(await tree(), []);
    });

    it('removes the state file even when no file is left to remove', async () => {
      await run([agent('a', 'A')]);
      await nodeFs.rm(path.join(root, '.kiro/agents/a.md'));
      const { decisions, result } = await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER });
      assert.deepEqual(decisions.map((item) => item.action), ['forget']);
      assert.equal(result.removed, 0);
      assert.equal(result.stateRemoved, true);
      assert.deepEqual(await tree(), []);
    });

    it('leaves a file the user edited, its folders, and everything that was not ECC\'s', async () => {
      await writeTree(root, { '.kiro/steering/mine.md': 'my steering' });
      await run([agent('a', 'A'), agent('b', 'B')]);
      await nodeFs.writeFile(path.join(root, '.kiro/agents/b.md'), 'B edited');
      const { decisions, result } = await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER });
      assert.deepEqual(decisions.map((item) => item.action), ['remove', 'keep-modified']);
      assert.equal(result.stateRemoved, true, 'the edited file is the user\'s now, so nothing is tracked');
      assert.deepEqual(await tree(), ['.kiro/', '.kiro/agents/', '.kiro/agents/b.md', '.kiro/steering/', '.kiro/steering/mine.md']);
    });

    it('never goes near the folder of this skill, even when it sits in a folder the install created', async () => {
      await run([agent('a', 'A')]);
      const skill = { '.kiro/skills/ecc-kiro-setup/SKILL.md': 'the skill', '.kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs': 'code' };
      await writeTree(root, skill);
      const state = await stateOf();
      state.dirs.push('.kiro/skills'); // a folder the install created, which the skill was copied into afterwards
      await nodeFs.writeFile(path.join(root, STATE_RELATIVE_PATH), formatState(state));

      const { result } = await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER });
      assert.equal(result.failure, null);
      assert.deepEqual(await tree(), ['.kiro/', '.kiro/skills/', '.kiro/skills/ecc-kiro-setup/', '.kiro/skills/ecc-kiro-setup/SKILL.md', '.kiro/skills/ecc-kiro-setup/scripts/', '.kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs']);
      assert.equal(await read('.kiro/skills/ecc-kiro-setup/SKILL.md'), 'the skill');
    });

    it('keeps the state of the parts it was not asked about, and the folders they still need', async () => {
      await run([agent('a', 'A'), ignoreBlock()]);
      const { decisions, result } = await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER, scopeOf: new Set(['kiroignore']) });
      assert.deepEqual(decisions.map((item) => item.action), ['remove']);
      assert.equal(result.stateRemoved, false);
      const state = await stateOf();
      assert.deepEqual(state.files.map((entry) => entry.path), ['.kiro/agents/a.md']);
      assert.equal(state.status, 'complete');
      assert.ok(state.dirs.includes('.kiro/agents') && state.dirs.includes('.kiro/ecc'));
      assert.equal(await read('.kiro/agents/a.md'), 'A');
      assert.equal(await read('.kiroignore'), null);
    });

    it('stops at a failure, keeps a state that lists what is left, and a second run finishes', async () => {
      await run([agent('a', 'A'), agent('b', 'B'), agent('c', 'C')]);
      let removals = 0;
      const flaky = {
        ...Object.fromEntries(Object.keys(nodeFs).map((key) => [key, nodeFs[key]])),
        async rm(file, options) {
          if (String(file).endsWith('.md')) {
            removals += 1;
            if (removals === 2) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          }
          return nodeFs.rm(file, options);
        },
      };
      const first = await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER, fs: flaky });
      assert.equal(first.result.failure.code, 'EACCES');
      assert.equal(first.result.failure.dest, '.kiro/agents/b.md');
      assert.equal(first.result.stateRemoved, false);
      const partial = await stateOf();
      assert.equal(partial.status, 'partial');
      assert.deepEqual(partial.files.map((entry) => entry.path), ['.kiro/agents/b.md', '.kiro/agents/c.md']);

      const second = await run([], { mode: 'uninstall', previous: partial, now: LATER });
      assert.equal(second.result.failure, null);
      assert.equal(second.result.stateRemoved, true);
      assert.deepEqual(await tree(), []);
    });

    it('reports a failure to remove the state file, and leaves a state that a second run can still use', async () => {
      await run([agent('a', 'A')]);
      const flaky = {
        ...Object.fromEntries(Object.keys(nodeFs).map((key) => [key, nodeFs[key]])),
        async rm(file, options) {
          if (String(file).endsWith('install-state.json')) throw Object.assign(new Error('read-only'), { code: 'EROFS' });
          return nodeFs.rm(file, options);
        },
      };
      const first = await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER, fs: flaky });
      assert.equal(first.result.failure.code, 'EROFS');
      assert.equal(first.result.failure.dest, STATE_RELATIVE_PATH);
      const partial = await stateOf();
      assert.deepEqual(partial.files, []);
      assert.equal(partial.status, 'partial');

      const second = await run([], { mode: 'uninstall', previous: partial, now: LATER });
      assert.equal(second.result.stateRemoved, true);
      assert.deepEqual(await tree(), []);
    });

    it('does not write a new record when a folder cannot be removed after the record was deleted', async () => {
      await run([agent('a', 'A')]);
      const stubborn = {
        ...Object.fromEntries(Object.keys(nodeFs).map((key) => [key, nodeFs[key]])),
        // The folder of the record is where the failure comes from, and only once the record is gone.
        async rmdir(dir) {
          if (dir === path.join(root, '.kiro/ecc') && (await read(STATE_RELATIVE_PATH)) === null) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          return nodeFs.rmdir(dir);
        },
      };
      const { result } = await run([], { mode: 'uninstall', previous: await stateOf(), now: LATER, fs: stubborn });
      assert.equal(result.failure.code, 'EACCES');
      assert.equal(result.stateRemoved, true);
      assert.equal(await read(STATE_RELATIVE_PATH), null, 'the record stays deleted');
      assert.equal(await read('.kiro/agents/a.md'), null, 'and the file is gone');
    });

    it('refuses to remove the state file through a link that leaves the project', async () => {
      await run([agent('a', 'A')]);
      const outside = path.join(tmp.dir, `outside-${counter}`);
      await nodeFs.mkdir(outside);
      await nodeFs.writeFile(path.join(outside, 'install-state.json'), 'not ours');
      await nodeFs.rename(path.join(root, '.kiro/ecc'), path.join(tmp.dir, `moved-${counter}`));
      await nodeFs.symlink(outside, path.join(root, '.kiro/ecc'));
      const previous = parseState(await nodeFs.readFile(path.join(tmp.dir, `moved-${counter}`, 'install-state.json'), 'utf8'));
      const { result } = await run([], { mode: 'uninstall', previous, now: LATER });
      assert.notEqual(result.failure, null);
      assert.match(result.failure.message, /symbolic link that leaves the project/);
      assert.equal(await nodeFs.readFile(path.join(outside, 'install-state.json'), 'utf8'), 'not ours');
    });
  });
});
