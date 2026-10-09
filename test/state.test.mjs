import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ECC_COMMIT, STATE_SCHEMA } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { CodedError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import {
  buildState,
  changesDisk,
  countActions,
  emptyState,
  formatState,
  managedPathProblem,
  parseState,
  protectedPaths,
  reconcile,
} from '../skills/ecc-kiro-setup/scripts/lib/state.mjs';

const NOW = new Date('2026-10-07T10:00:00.000Z');
const LATER = new Date('2026-10-08T11:30:00.000Z');

const sha = (text) => sha256Hex(text);
const planned = (name, text, extra = {}) => ({ dest: `.kiro/agents/${name}.md`, content: text, sha256: sha(text), source: `agents/${name}.md`, category: 'agent', part: 'agents', ...extra });
const owned = (name, text, extra = {}) => ({ path: `.kiro/agents/${name}.md`, category: 'agent', source: `agents/${name}.md`, sha256: sha(text), ...extra });
const stateWith = (...files) => ({ ...emptyState({ now: NOW }), files });
const file = (text) => ({ kind: 'file', sha256: sha(text) });
const missing = { kind: 'missing' };
const diskOf = (entries) => new Map(Object.entries(entries).map(([name, value]) => [`.kiro/agents/${name}.md`, value]));
const scope = new Set(['agent']);

const only = (decisions) => {
  assert.equal(decisions.length, 1, JSON.stringify(decisions));
  return decisions[0];
};

describe('managedPathProblem', () => {
  it('allows files inside .kiro and the .kiroignore file', () => {
    for (const dest of ['.kiro/agents/planner.md', '.kiro/steering/ecc-python.md', '.kiro/skills/tdd/SKILL.md', '.kiro/hooks/ecc-x.json', '.kiro/ecc/LICENSE', '.kiroignore']) {
      assert.equal(managedPathProblem(dest), null, dest);
    }
  });

  it('refuses .kiro/settings, the state file itself, and anything outside .kiro', () => {
    assert.match(managedPathProblem('.kiro/settings/mcp.json'), /settings/);
    assert.match(managedPathProblem('.kiro/settings'), /settings/);
    assert.match(managedPathProblem('.kiro/ecc/install-state.json'), /state file/);
    for (const dest of ['AGENTS.md', '.github/workflows/ci.yml', '.kiro', '.kiroignore/x', '.kirox/a', 'src/.kiro/a.md', '.claude/agents/a.md']) {
      assert.match(managedPathProblem(dest), /outside \.kiro/, dest);
    }
  });

  it('refuses the folder of this skill and everything in it, but not folders with a similar name', () => {
    for (const dest of ['.kiro/skills/ecc-kiro-setup', '.kiro/skills/ecc-kiro-setup/SKILL.md', '.kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs', '.kiro/skills/ecc-kiro-setup/scripts/lib/state.mjs']) {
      assert.match(managedPathProblem(dest), /is in the ecc-kiro-setup skill itself, which no install, update or uninstall touches/, dest);
    }
    for (const dest of ['.kiro/skills/ecc-kiro-setup2/SKILL.md', '.kiro/skills/ecc-kiro-setup-extra/SKILL.md', '.kiro/skills/my-ecc-kiro-setup/SKILL.md', '.kiro/steering/ecc-kiro-setup.md']) {
      assert.equal(managedPathProblem(dest), null, dest);
    }
  });

  it('refuses unsafe paths of every kind', () => {
    for (const dest of ['/etc/passwd', '../x', '.kiro/../x', '.kiro//a', '.kiro/./a', 'C:\\x', '.kiro\\a', '', null, 3]) {
      assert.match(managedPathProblem(dest), /not a safe relative path/, String(dest));
    }
  });
});

describe('protectedPaths', () => {
  it('counts files in the folders Kiro always asks about', () => {
    const found = protectedPaths(['.kiro/agents/a.md', '.kiro/agents/b.md', '.kiro/hooks/h.json', '.kiro/steering/s.md', '.kiroignore', '.kiro/skills/x/SKILL.md']);
    assert.deepEqual(found, [
      { path: '.kiro/agents', kind: 'directory', files: 2 },
      { path: '.kiro/hooks', kind: 'directory', files: 1 },
      { path: '.kiroignore', kind: 'file', files: 1 },
    ]);
  });

  it('is empty when nothing is protected, and does not match look-alike folders', () => {
    assert.deepEqual(protectedPaths([]), []);
    assert.deepEqual(protectedPaths(['.kiro/agents-extra/a.md', '.kiro/steering/a.md']), []);
  });
});

describe('the state file', () => {
  const sample = () => {
    const state = emptyState({ now: NOW });
    state.dirs = ['.kiro/agents', '.kiro/ecc'];
    state.files = [owned('a', 'A'), owned('b', 'B', { source: ['agents/b.md', 'rules/x.md'] }), owned('c', 'C', { source: null })];
    return state;
  };

  it('starts out pinned to this release and this tool', () => {
    const state = emptyState({ now: NOW });
    assert.equal(state.schema, STATE_SCHEMA);
    assert.equal(state.source.commit, ECC_COMMIT);
    assert.equal(state.profile.id, 'kimi-parity');
    assert.equal(state.installedAt, '2026-10-07T10:00:00.000Z');
    assert.equal(state.status, 'complete');
  });

  it('formats one file per line and reads back what it wrote', () => {
    const state = sample();
    const text = formatState(state);
    assert.ok(text.endsWith('}\n'));
    assert.equal(text.split('\n').filter((line) => line.includes('"sha256"')).length, 3);
    assert.deepEqual(parseState(text), state);
    assert.equal(formatState(parseState(text)), text);
    assert.deepEqual(JSON.parse(text), state);
  });

  it('formats an empty install', () => {
    const text = formatState(emptyState({ now: NOW }));
    assert.match(text, /"dirs": \[\],\n {2}"files": \[\]\n\}/);
    assert.equal(parseState(text).files.length, 0);
  });

  describe('rejects a file that is wrong or hostile', () => {
    const stateError = (mutate) => {
      const state = JSON.parse(JSON.stringify(sample()));
      const text = mutate(state) ?? JSON.stringify(state);
      try {
        parseState(text);
      } catch (error) {
        assert.ok(error instanceof CodedError);
        assert.equal(error.code, 'state-invalid');
        assert.match(error.fix, /Fix or delete/);
        return error.message;
      }
      return assert.fail('expected the state to be rejected');
    };

    it('that is not JSON, not an object, or has another schema', () => {
      assert.match(stateError(() => '{ nope'), /not valid JSON/);
      assert.match(stateError(() => '[]'), /must be a JSON object/);
      assert.match(stateError(() => 'null'), /must be a JSON object/);
      assert.match(stateError((s) => { s.schema = 'ecc-kiro.install.v0'; }), /unsupported schema/);
    });

    it('with bad metadata', () => {
      assert.match(stateError((s) => { s.installedAt = 'yesterday'; }), /installedAt/);
      assert.match(stateError((s) => { s.updatedAt = 5; }), /updatedAt/);
      assert.match(stateError((s) => { s.status = 'done'; }), /status/);
      assert.match(stateError((s) => { s.tool = []; }), /objects/);
      assert.match(stateError((s) => { s.source = { version: '2.2.3' }; }), /version and a commit/);
      assert.match(stateError((s) => { s.profile = {}; }), /profile needs an id/);
    });

    it('with directories outside .kiro', () => {
      assert.match(stateError((s) => { s.dirs = ['src']; }), /unsafe path/);
      assert.match(stateError((s) => { s.dirs = ['.kiro/../x']; }), /unsafe path/);
      assert.match(stateError((s) => { s.dirs = '.kiro'; }), /dirs must be a list/);
    });

    it('that claims a file of this skill, so an uninstall could never delete it', () => {
      assert.match(stateError((s) => { s.files[0].path = '.kiro/skills/ecc-kiro-setup/SKILL.md'; }), /ecc-kiro-setup skill itself/);
      assert.match(stateError((s) => { s.files[0].path = '.kiro/skills/ecc-kiro-setup/scripts/ecc-kiro.mjs'; }), /ecc-kiro-setup skill itself/);
    });

    it('that says the installer created a file it did not, or something other than the .kiroignore block', () => {
      assert.match(stateError((s) => { s.files[0].createdFile = true; }), /"createdFile" is only valid as true on the \.kiroignore block/);
      assert.match(stateError((s) => { s.files[0].createdFile = false; }), /"createdFile" is only valid as true/);
      const ignore = (mutate) => stateError((s) => {
        s.files[0] = { path: '.kiroignore', category: 'kiroignore', source: null, sha256: 'a'.repeat(64) };
        mutate(s.files[0]);
      });
      assert.match(ignore((entry) => { entry.createdFile = 'yes'; }), /"createdFile" is only valid as true/);
      assert.match(ignore((entry) => { entry.createdFile = false; }), /"createdFile" is only valid as true/);
    });

    it('that tracks .kiroignore as a plain file, which would have an uninstall delete the whole file, or another path as its block', () => {
      const entryError = (entry) => stateError((s) => { s.files[0] = { source: null, sha256: 'a'.repeat(64), ...entry }; });
      assert.match(entryError({ path: '.kiroignore', category: 'agent' }), /\.kiroignore: the category "kiroignore" belongs to \.kiroignore and to nothing else/);
      assert.match(entryError({ path: '.kiro/steering/x.md', category: 'kiroignore' }), /the category "kiroignore" belongs to \.kiroignore and to nothing else/);
      assert.match(entryError({ path: '.kiroignore', category: 'steering' }), /nothing else/);
    });

    it('that lists a folder of this skill as one the install created, so an uninstall could never remove one', () => {
      for (const dir of ['.kiro/skills/ecc-kiro-setup', '.kiro/skills/ecc-kiro-setup/scripts', '.kiro/skills/ecc-kiro-setup/scripts/lib']) {
        assert.match(stateError((s) => { s.dirs = [dir]; }), /ecc-kiro-setup skill itself/, dir);
      }
      const ok = JSON.parse(JSON.stringify(sample()));
      ok.dirs = ['.kiro', '.kiro/skills', '.kiro/skills/ecc-kiro-setup2', '.kiro/skills/tdd-workflow'];
      assert.deepEqual(parseState(JSON.stringify(ok)).dirs, ok.dirs, 'its parent and look-alikes are fine');
    });

    it('that claims files it must never manage', () => {
      assert.match(stateError((s) => { s.files[0].path = '.kiro/settings/mcp.json'; }), /settings/);
      assert.match(stateError((s) => { s.files[0].path = '../outside.md'; }), /safe relative path/);
      assert.match(stateError((s) => { s.files[0].path = '/etc/passwd'; }), /safe relative path/);
      assert.match(stateError((s) => { s.files[0].path = 'AGENTS.md'; }), /outside \.kiro/);
      assert.match(stateError((s) => { s.files[0].path = '.kiro/ecc/install-state.json'; }), /state file/);
    });

    it('with bad file entries', () => {
      assert.match(stateError((s) => { s.files[1].path = s.files[0].path; }), /twice/);
      assert.match(stateError((s) => { s.files[0].sha256 = 'ABC'; }), /sha256/);
      assert.match(stateError((s) => { s.files[0].category = 'Agent!'; }), /category/);
      assert.match(stateError((s) => { s.files[0].source = 7; }), /invalid source/);
      assert.match(stateError((s) => { s.files[0].source = ['ok', 3]; }), /invalid source/);
      assert.match(stateError((s) => { s.files[0] = 'planner'; }), /must be an object/);
      assert.match(stateError((s) => { s.files = {}; }), /files must be a list/);
    });
  });

  describe('buildState', () => {
    const files = new Map([[owned('a', 'A').path, owned('a', 'A')]]);

    it('creates a sorted state for a first install', () => {
      const unsorted = new Map([[owned('b', 'B').path, owned('b', 'B')], [owned('a', 'A').path, owned('a', 'A')]]);
      const state = buildState({ previous: null, files: unsorted, dirs: new Set(['.kiro/ecc', '.kiro/agents']), status: 'complete', now: NOW, changed: true });
      assert.deepEqual(state.files.map((f) => f.path), ['.kiro/agents/a.md', '.kiro/agents/b.md']);
      assert.deepEqual(state.dirs, ['.kiro/agents', '.kiro/ecc']);
      assert.equal(state.installedAt, state.updatedAt);
    });

    it('keeps the install time, and keeps the update time when nothing changed', () => {
      const previous = buildState({ previous: null, files, dirs: new Set(), status: 'complete', now: NOW, changed: true });
      const same = buildState({ previous, files, dirs: new Set(), status: 'complete', now: LATER, changed: false });
      assert.equal(same.installedAt, previous.installedAt);
      assert.equal(same.updatedAt, previous.updatedAt);
      assert.equal(formatState(same), formatState(previous));
      const changed = buildState({ previous, files, dirs: new Set(), status: 'complete', now: LATER, changed: true });
      assert.equal(changed.updatedAt, LATER.toISOString());
      assert.equal(changed.installedAt, NOW.toISOString());
    });

    it('moves the update time when only the status changes', () => {
      const previous = buildState({ previous: null, files, dirs: new Set(), status: 'partial', now: NOW, changed: true });
      const done = buildState({ previous, files, dirs: new Set(), status: 'complete', now: LATER, changed: false });
      assert.equal(done.status, 'complete');
      assert.equal(done.updatedAt, LATER.toISOString());
    });
  });
});

describe('reconcile: files the installer wants to write', () => {
  const run = (overrides) => reconcile({ mode: 'install', planned: [], state: null, disk: new Map(), scope, ...overrides });

  it('creates a file when nothing is there', () => {
    const d = only(run({ planned: [planned('a', 'A')], disk: diskOf({ a: missing }) }));
    assert.equal(d.action, 'create');
    assert.equal(d.write.sha256, sha('A'));
    assert.deepEqual(d.record, { path: '.kiro/agents/a.md', category: 'agent', source: 'agents/a.md', sha256: sha('A') });
    assert.equal(d.remove, false);
  });

  it('treats a path that was never inspected as empty', () => {
    assert.equal(only(run({ planned: [planned('a', 'A')] })).action, 'create');
  });

  it('skips a file that is not ECC\'s and reports a conflict, without claiming it', () => {
    const d = only(run({ planned: [planned('a', 'A')], disk: diskOf({ a: file('mine') }) }));
    assert.equal(d.action, 'skip-conflict');
    assert.equal(d.write, null);
    assert.equal(d.record, null);
    assert.match(d.reason, /not installed by ECC/);
  });

  it('treats a user file as a conflict even when its content equals the new version', () => {
    assert.equal(only(run({ planned: [planned('a', 'A')], disk: diskOf({ a: file('A') }) })).action, 'skip-conflict');
  });

  it('skips anything that is not a regular file, whether or not ECC owned the path', () => {
    for (const state of [null, stateWith(owned('a', 'A'))]) {
      const d = only(run({ planned: [planned('a', 'A')], state, disk: diskOf({ a: { kind: 'other', detail: 'is a symbolic link' } }) }));
      assert.equal(d.action, 'skip-conflict');
      assert.match(d.reason, /symbolic link/);
      assert.deepEqual(d.record, state ? owned('a', 'A') : null);
    }
  });

  it('leaves an unchanged owned file alone and refreshes its record', () => {
    const d = only(run({ planned: [planned('a', 'A')], state: stateWith(owned('a', 'A')), disk: diskOf({ a: file('A') }) }));
    assert.equal(d.action, 'unchanged');
    assert.equal(d.write, null);
    assert.equal(d.record.sha256, sha('A'));
  });

  it('updates an owned file that the user has not touched', () => {
    const d = only(run({ planned: [planned('a', 'A2')], state: stateWith(owned('a', 'A')), disk: diskOf({ a: file('A') }) }));
    assert.equal(d.action, 'update');
    assert.equal(d.write.sha256, sha('A2'));
    assert.equal(d.record.sha256, sha('A2'));
  });

  it('keeps an owned file the user edited, and remembers what was installed', () => {
    const d = only(run({ planned: [planned('a', 'A2')], state: stateWith(owned('a', 'A')), disk: diskOf({ a: file('A mine') }) }));
    assert.equal(d.action, 'keep-modified');
    assert.equal(d.write, null);
    assert.equal(d.updateAvailable, true);
    assert.equal(d.record.sha256, sha('A'), 'still the hash that was installed, so the edit keeps being detected');
  });

  it('says when an edited file has no newer version waiting', () => {
    const d = only(run({ planned: [planned('a', 'A')], state: stateWith(owned('a', 'A')), disk: diskOf({ a: file('A mine') }) }));
    assert.equal(d.action, 'keep-modified');
    assert.equal(d.updateAvailable, false);
  });

  it('accepts a user edit that happens to equal the new version', () => {
    const d = only(run({ planned: [planned('a', 'A2')], state: stateWith(owned('a', 'A')), disk: diskOf({ a: file('A2') }) }));
    assert.equal(d.action, 'unchanged');
    assert.equal(d.write, null);
    assert.equal(d.record.sha256, sha('A2'));
  });

  it('restores an owned file that was deleted', () => {
    const d = only(run({ planned: [planned('a', 'A')], state: stateWith(owned('a', 'A')), disk: diskOf({ a: missing }) }));
    assert.equal(d.action, 'create');
    assert.match(d.reason, /restored/);
  });

  describe('with a sibling that would clash', () => {
    const withSibling = (sibling) => planned('a', 'A', { blockedBy: ['.kiro/agents/a.json'] });
    const disk = (siblingEntry) => new Map([['.kiro/agents/a.md', missing], ['.kiro/agents/a.json', siblingEntry]]);

    it('skips the file and names the sibling', () => {
      const d = only(run({ planned: [withSibling()], disk: disk(file('{}')) }));
      assert.equal(d.action, 'skip-conflict');
      assert.match(d.reason, /\.kiro\/agents\/a\.json/);
    });

    it('does not mind when the sibling is absent', () => {
      assert.equal(only(run({ planned: [withSibling()], disk: disk(missing) })).action, 'create');
    });

    it('also blocks restoring a deleted owned file', () => {
      const d = only(run({ planned: [withSibling()], state: stateWith(owned('a', 'A')), disk: disk(file('{}')) }));
      assert.equal(d.action, 'skip-conflict');
      assert.deepEqual(d.record, owned('a', 'A'));
    });

    it('does not block an owned file that is already in place', () => {
      const d = only(run({
        planned: [withSibling()],
        state: stateWith(owned('a', 'A')),
        disk: new Map([['.kiro/agents/a.md', file('A')], ['.kiro/agents/a.json', file('{}')]]),
      }));
      assert.equal(d.action, 'unchanged');
    });
  });

  describe('inside a folder with a main file (an anchor)', () => {
    const MAIN = '.kiro/agents/main.md';
    const inFolder = (name, text) => planned(name, text, { anchor: MAIN });
    const withMain = (mainEntry, others = {}) => new Map([[MAIN, mainEntry], ...Object.entries(others).map(([name, entry]) => [`.kiro/agents/${name}.md`, entry])]);
    const actions = (decisions) => Object.fromEntries(decisions.map((item) => [item.dest.split('/').pop(), item.action]));

    it('adds nothing to a folder whose main file belongs to someone else', () => {
      const decisions = run({ planned: [inFolder('main', 'M'), inFolder('extra', 'E')], disk: withMain(file('mine'), { extra: missing }) });
      assert.deepEqual(actions(decisions), { 'extra.md': 'skip-conflict', 'main.md': 'skip-conflict' });
      assert.match(decisions[0].reason, /\.kiro\/agents\/main\.md is not an ECC file, so this folder belongs to something else/);
      assert.ok(decisions.every((item) => item.write === null && item.record === null));
    });

    it('installs into a folder with no main file yet, and into one whose main file is ECC\'s', () => {
      const fresh = run({ planned: [inFolder('main', 'M'), inFolder('extra', 'E')], disk: withMain(missing, { extra: missing }) });
      assert.deepEqual(actions(fresh), { 'extra.md': 'create', 'main.md': 'create' });

      const ours = run({
        planned: [inFolder('main', 'M'), inFolder('extra', 'E')],
        state: stateWith(owned('main', 'M')),
        disk: withMain(file('M'), { extra: missing }),
      });
      assert.deepEqual(actions(ours), { 'extra.md': 'create', 'main.md': 'unchanged' });
    });

    it('still treats an edited main file as ECC\'s own, and keeps updating the other files', () => {
      const decisions = run({
        planned: [inFolder('main', 'M2'), inFolder('extra', 'E2')],
        state: stateWith(owned('main', 'M'), owned('extra', 'E')),
        disk: withMain(file('M edited'), { extra: file('E') }),
      });
      assert.deepEqual(actions(decisions), { 'extra.md': 'update', 'main.md': 'keep-modified' });
    });

    it('does not apply to the main file itself', () => {
      const decisions = run({ planned: [inFolder('main', 'M')], disk: withMain(missing) });
      assert.deepEqual(actions(decisions), { 'main.md': 'create' });
    });

    it('keeps the record of a file ECC already owns when the main file turns out to be foreign', () => {
      const decisions = run({
        planned: [inFolder('extra', 'E2')],
        state: stateWith(owned('extra', 'E')),
        disk: withMain(file('mine'), { extra: file('E') }),
      });
      assert.equal(decisions[0].action, 'skip-conflict');
      assert.deepEqual(decisions[0].record, owned('extra', 'E'));
    });
  });

  it('rejects two planned files for one destination', () => {
    assert.throws(() => run({ planned: [planned('a', 'A'), planned('a', 'B')] }), /share the destination/);
  });

  it('returns decisions sorted by path', () => {
    const d = run({ planned: [planned('c', 'C'), planned('a', 'A'), planned('b', 'B')] });
    assert.deepEqual(d.map((item) => item.dest), ['.kiro/agents/a.md', '.kiro/agents/b.md', '.kiro/agents/c.md']);
  });

  it('rejects an unknown mode', () => {
    assert.throws(() => run({ mode: 'reinstall' }), /unknown mode/);
  });
});

describe('reconcile: files ECC owns that are no longer planned', () => {
  const state = () => stateWith(owned('a', 'A'), owned('b', 'B'), owned('c', 'C'));
  const disk = () => diskOf({ a: file('A'), b: file('B edited'), c: missing });
  const run = (mode) => reconcile({ mode, planned: [], state: state(), disk: disk(), scope });
  const byName = (decisions) => Object.fromEntries(decisions.map((item) => [item.dest.split('/').pop(), item]));

  it('update removes untouched files, keeps edited ones and stops tracking them, and forgets deleted ones', () => {
    const d = byName(run('update'));
    assert.equal(d['a.md'].action, 'remove');
    assert.equal(d['a.md'].remove, true);
    assert.equal(d['a.md'].record, null);
    assert.equal(d['b.md'].action, 'keep-modified');
    assert.equal(d['b.md'].remove, false);
    assert.equal(d['b.md'].record, null, 'released: it is the user\'s file now');
    assert.equal(d['c.md'].action, 'forget');
    assert.equal(d['c.md'].record, null);
  });

  it('install only reports them, and keeps tracking them', () => {
    const d = byName(run('install'));
    assert.equal(d['a.md'].action, 'stale');
    assert.equal(d['a.md'].remove, false);
    assert.deepEqual(d['a.md'].record, owned('a', 'A'));
    assert.equal(d['b.md'].action, 'keep-modified');
    assert.deepEqual(d['b.md'].record, owned('b', 'B'));
    assert.equal(d['c.md'].action, 'forget');
  });

  it('uninstall behaves like update: ECC\'s own files go, the user\'s stay', () => {
    const d = byName(run('uninstall'));
    assert.equal(d['a.md'].action, 'remove');
    assert.equal(d['a.md'].reason, 'installed by ECC');
    assert.equal(d['b.md'].action, 'keep-modified');
    assert.equal(d['c.md'].action, 'forget');
    assert.ok(Object.values(d).every((item) => item.write === null));
  });

  it('never touches a path ECC does not own, however it looks', () => {
    const decisions = reconcile({
      mode: 'uninstall',
      planned: [],
      state: stateWith(owned('a', 'A')),
      disk: diskOf({ a: file('A'), mine: file('mine') }),
      scope,
    });
    assert.deepEqual(decisions.map((item) => item.dest), ['.kiro/agents/a.md']);
  });

  it('leaves owned files of other categories alone', () => {
    const skill = { path: '.kiro/skills/tdd/SKILL.md', category: 'skill', source: 'skills/tdd/SKILL.md', sha256: sha('S') };
    const decisions = reconcile({
      mode: 'update',
      planned: [],
      state: stateWith(owned('a', 'A'), skill),
      disk: new Map([['.kiro/agents/a.md', file('A')], [skill.path, file('S')]]),
      scope,
    });
    assert.deepEqual(decisions.map((item) => item.dest), ['.kiro/agents/a.md']);
  });

  it('treats something that replaced a file as an edit', () => {
    const d = only(reconcile({
      mode: 'uninstall',
      planned: [],
      state: stateWith(owned('a', 'A')),
      disk: diskOf({ a: { kind: 'other', detail: 'is not a regular file' } }),
      scope,
    }));
    assert.equal(d.action, 'keep-modified');
    assert.equal(d.remove, false);
  });

  it('does not remove a file the plan still wants', () => {
    const decisions = reconcile({ mode: 'update', planned: [planned('a', 'A')], state: stateWith(owned('a', 'A')), disk: diskOf({ a: file('A') }), scope });
    assert.deepEqual(decisions.map((item) => item.action), ['unchanged']);
  });
});

describe('counting decisions', () => {
  const decisions = reconcile({
    mode: 'update',
    planned: [planned('new', 'N'), planned('same', 'S'), planned('mine', 'M'), planned('old', 'O2')],
    state: stateWith(owned('same', 'S'), owned('old', 'O'), owned('gone', 'G'), owned('edit', 'E')),
    disk: diskOf({ new: missing, same: file('S'), mine: file('M'), old: file('O'), gone: file('G'), edit: file('E!') }),
    scope,
  });

  it('counts each action under a readable key', () => {
    assert.deepEqual(countActions(decisions), { create: 1, update: 1, unchanged: 1, keepModified: 1, conflict: 1, remove: 1, stale: 0, forget: 0 });
  });

  it('knows whether anything would change on disk', () => {
    assert.equal(changesDisk(decisions), true);
    assert.equal(changesDisk(decisions.filter((item) => ['unchanged', 'keep-modified', 'skip-conflict'].includes(item.action))), false);
    assert.equal(changesDisk([]), false);
  });
});

describe('reconcile: the managed block of .kiroignore', () => {
  const BLOCK = 'a managed block';
  const block = (text = BLOCK, part = 'isolation') => ({ dest: '.kiroignore', content: text, sha256: sha(text), source: null, category: 'kiroignore', part });
  const entry = (text = BLOCK, extra = {}) => ({ path: '.kiroignore', category: 'kiroignore', source: null, sha256: sha(text), ...extra });
  const here = (value) => new Map([['.kiroignore', value]]);
  const blockScope = new Set(['kiroignore']);
  const run = (overrides) => only(reconcile({ mode: 'install', planned: [], state: null, disk: new Map(), scope: blockScope, ...overrides }));

  it('creates the block when the file or the block is not there, and says it is a block', () => {
    const d = run({ planned: [block()], disk: here(missing) });
    assert.equal(d.action, 'create');
    assert.equal(d.reason, 'new block');
    assert.equal(d.write.content, BLOCK);
    assert.deepEqual(d.record, entry());
  });

  it('restores a block that was deleted, and says so', () => {
    const d = run({ planned: [block()], state: stateWith(entry()), disk: here(missing) });
    assert.equal(d.action, 'create');
    assert.equal(d.reason, 'restored: the block was deleted after the install');
  });

  it('does not claim a block that is there without a record', () => {
    const d = run({ planned: [block()], disk: here(file(BLOCK)) });
    assert.equal(d.action, 'skip-conflict');
    assert.equal(d.write, null);
    assert.equal(d.record, null);
  });

  it('leaves .kiroignore alone when it is a link or its markers are damaged', () => {
    for (const detail of ['is a symbolic link', 'the ECC marker lines are damaged (expected one begin line followed by one end line)']) {
      const d = run({ planned: [block()], state: stateWith(entry()), disk: here({ kind: 'other', detail }) });
      assert.equal(d.action, 'skip-conflict', detail);
      assert.equal(d.reason, `${detail}; left alone`);
      assert.deepEqual(d.record, entry());
    }
  });

  it('updates a block the user did not touch, and keeps one the user edited', () => {
    const updated = run({ planned: [block('v2')], state: stateWith(entry('v1')), disk: here(file('v1')) });
    assert.equal(updated.action, 'update');
    assert.equal(updated.write.content, 'v2');
    const kept = run({ planned: [block('v2')], state: stateWith(entry('v1')), disk: here(file('v1 edited')) });
    assert.equal(kept.action, 'keep-modified');
    assert.equal(kept.write, null);
    assert.equal(kept.updateAvailable, true);
  });

  it('remembers that the installer created the file, through every run that keeps the block', () => {
    const owner = stateWith(entry('v1', { createdFile: true }));
    assert.equal(run({ planned: [block('v1')], state: owner, disk: here(file('v1')) }).record.createdFile, true);
    assert.equal(run({ planned: [block('v2')], state: owner, disk: here(file('v1')) }).record.createdFile, true);
    assert.equal(run({ planned: [block('v2')], state: owner, disk: here(file('v1 edited')) }).record.createdFile, true);
    assert.equal(run({ planned: [block('v1')], state: owner, disk: here(file('v1 mine')) }).record.createdFile, true);
    assert.equal('createdFile' in run({ planned: [block('v1')], state: stateWith(entry('v1')), disk: here(file('v1')) }).record, false);
  });

  it('decides again whether the file is the installer\'s when it has to write the block anew', () => {
    const owner = stateWith(entry('v1', { createdFile: true }));
    const d = run({ planned: [block('v1')], state: owner, disk: here(missing) });
    assert.equal(d.action, 'create');
    assert.equal('createdFile' in d.record, false, 'the apply step decides that, from whether the file exists');
  });

  it('removes the block on update and uninstall when nothing wants it and the user did not touch it', () => {
    for (const mode of ['update', 'uninstall']) {
      const d = run({ mode, state: stateWith(entry()), disk: here(file(BLOCK)) });
      assert.equal(d.action, 'remove', mode);
      assert.equal(d.remove, true);
      assert.equal(d.category, 'kiroignore');
      assert.equal(d.record, null);
    }
    assert.equal(run({ mode: 'install', state: stateWith(entry()), disk: here(file(BLOCK)) }).action, 'stale');
  });

  it('keeps a block the user edited when it goes, and stops tracking it', () => {
    const d = run({ mode: 'uninstall', state: stateWith(entry()), disk: here(file('my own lines in the block')) });
    assert.equal(d.action, 'keep-modified');
    assert.equal(d.remove, false);
    assert.equal(d.record, null);
  });

  it('forgets a block that is gone, and a file that is not there', () => {
    assert.equal(run({ mode: 'uninstall', state: stateWith(entry()), disk: here(missing) }).action, 'forget');
  });

  it('does not touch a block of another run when the isolation part is out of scope', () => {
    const decisions = reconcile({ mode: 'uninstall', planned: [], state: stateWith(entry()), disk: here(file(BLOCK)), scope: new Set(['agent']) });
    assert.deepEqual(decisions, []);
  });
});

describe('the state file and the .kiroignore block', () => {
  it('writes and reads back "createdFile" on the block, and nothing else carries it', () => {
    const state = emptyState({ now: NOW });
    state.files = [
      { path: '.kiro/agents/a.md', category: 'agent', source: 'agents/a.md', sha256: sha('A') },
      { path: '.kiroignore', category: 'kiroignore', source: null, sha256: sha('block'), createdFile: true },
    ];
    const text = formatState(state);
    assert.match(text, /\{"path": "\.kiroignore", "category": "kiroignore", "source": null, "sha256": "[0-9a-f]{64}", "createdFile": true\}/);
    assert.deepEqual(parseState(text), state);
    assert.equal(formatState(parseState(text)), text);
  });
});
