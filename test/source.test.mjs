import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ECC_COMMIT, ECC_REPO_URL, ECC_TAG, cacheCheckoutName } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { CodedError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import { ensurePaths, hashPaths, listTree, openSource, treeMap } from '../skills/ecc-kiro-setup/scripts/io/source.mjs';
import { fail, fakeGit, fakeOid, makeTempDir, ok, pinnedGit, writeTree } from './fixtures.mjs';

const rejectsWith = (promise, code, pattern) =>
  assert.rejects(promise, (error) => {
    assert.ok(error instanceof CodedError, `expected CodedError, got ${error}`);
    assert.equal(error.code, code);
    if (pattern) assert.match(`${error.message} ${error.fix ?? ''}`, pattern);
    return true;
  });

describe('openSource with --source', () => {
  let tmp;
  before(async () => {
    tmp = await makeTempDir();
  });
  after(() => tmp.cleanup());

  it('rejects a directory that does not exist', async () => {
    await rejectsWith(openSource({ sourceDir: path.join(tmp.dir, 'nope'), cacheRoot: tmp.dir, git: fakeGit(() => ok()) }), 'source-missing');
  });

  it('accepts a plain directory and reports that the commit could not be checked', async () => {
    const dir = path.join(tmp.dir, 'plain');
    await mkdir(dir);
    const git = fakeGit(() => fail('must not be called'));
    const source = await openSource({ sourceDir: dir, cacheRoot: tmp.dir, git });
    assert.deepEqual(source, { dir, origin: 'local', commit: null, commitVerified: false });
    assert.equal(git.calls.length, 0);
  });

  it('verifies the commit of a git checkout', async () => {
    const dir = path.join(tmp.dir, 'checkout');
    await mkdir(path.join(dir, '.git'), { recursive: true });
    const git = pinnedGit();
    const source = await openSource({ sourceDir: dir, cacheRoot: tmp.dir, git });
    assert.deepEqual(source, { dir, origin: 'local', commit: ECC_COMMIT, commitVerified: true });
    assert.deepEqual(git.calls[0].args, ['-C', dir, 'rev-parse', 'HEAD']);
  });

  it('refuses a checkout at another commit', async () => {
    const dir = path.join(tmp.dir, 'other');
    await mkdir(path.join(dir, '.git'), { recursive: true });
    const git = fakeGit(() => ok(`${'a'.repeat(40)}\n`));
    await rejectsWith(openSource({ sourceDir: dir, cacheRoot: tmp.dir, git }), 'commit-mismatch', new RegExp(ECC_COMMIT));
  });

  it('reports git failures and unreadable HEAD output', async () => {
    const dir = path.join(tmp.dir, 'broken');
    await mkdir(path.join(dir, '.git'), { recursive: true });
    await rejectsWith(openSource({ sourceDir: dir, cacheRoot: tmp.dir, git: fakeGit(() => fail('fatal: bad object')) }), 'git-failed', /bad object/);
    await rejectsWith(openSource({ sourceDir: dir, cacheRoot: tmp.dir, git: fakeGit(() => ok('not a sha\n')) }), 'git-failed');
  });
});

describe('openSource with the cache', () => {
  let tmp;
  before(async () => {
    tmp = await makeTempDir();
  });
  after(() => tmp.cleanup());

  const checkout = (cacheRoot) => path.join(cacheRoot, cacheCheckoutName());

  it('asks for --fetch when nothing is cached, without touching git', async () => {
    const git = fakeGit(() => fail('must not be called'));
    await rejectsWith(openSource({ cacheRoot: path.join(tmp.dir, 'empty'), git }), 'source-missing', /--fetch/);
    assert.equal(git.calls.length, 0);
  });

  it('clones a partial, checkout-less copy of the pinned tag when asked to fetch', async () => {
    const cacheRoot = path.join(tmp.dir, 'fresh');
    const dir = checkout(cacheRoot);
    const messages = [];
    const git = fakeGit(async (args) => {
      if (args.includes('clone')) {
        await mkdir(path.join(dir, '.git'), { recursive: true });
        return ok();
      }
      if (args.includes('rev-parse')) return ok(`${ECC_COMMIT}\n`);
      return fail('unexpected');
    });
    const source = await openSource({ cacheRoot, fetch: true, git, log: (m) => messages.push(m) });
    assert.deepEqual(source, { dir, origin: 'cloned', commit: ECC_COMMIT, commitVerified: true });
    assert.deepEqual(git.calls[0].args, [
      '-c', 'advice.detachedHead=false',
      '-c', 'core.autocrlf=false',
      'clone', '--depth', '1', '--filter=blob:none', '--no-checkout',
      '--branch', ECC_TAG, ECC_REPO_URL, dir,
    ]);
    assert.equal(git.calls[0].options.cwd, cacheRoot);
    assert.ok(git.calls[0].options.timeout >= 60_000);
    assert.match(messages.join('\n'), /github\.com/);
  });

  it('reports a failed clone with the first line of git output, without retrying', async () => {
    const git = fakeGit(() => fail('fatal: unable to access\nmore detail'));
    await rejectsWith(openSource({ cacheRoot: path.join(tmp.dir, 'offline'), fetch: true, git }), 'clone-failed', /unable to access/);
    assert.equal(git.calls.length, 1);
  });

  it('falls back to a full shallow clone when the git in use cannot do a partial clone', async () => {
    const cacheRoot = path.join(tmp.dir, 'old-git');
    const dir = checkout(cacheRoot);
    const messages = [];
    const git = fakeGit(async (args) => {
      if (args.includes('clone') && args.includes('--filter=blob:none')) return fail("error: unknown option `filter'");
      if (args.includes('clone')) {
        await mkdir(path.join(dir, '.git'), { recursive: true });
        return ok();
      }
      return ok(`${ECC_COMMIT}\n`);
    });
    const source = await openSource({ cacheRoot, fetch: true, git, log: (m) => messages.push(m) });
    assert.equal(source.origin, 'cloned');
    const clones = git.calls.filter((call) => call.args.includes('clone'));
    assert.equal(clones.length, 2);
    assert.deepEqual(clones[1].args, [
      '-c', 'advice.detachedHead=false',
      '-c', 'core.autocrlf=false',
      'clone', '--depth', '1', '--branch', ECC_TAG, ECC_REPO_URL, dir,
    ]);
    assert.match(messages.join('\n'), /full repository/);
  });

  it('reports the failure when the full-clone fallback fails too', async () => {
    const git = fakeGit(async (args) => (args.includes('--filter=blob:none') ? fail('error: unknown option `filter') : fail('fatal: repository not found')));
    await rejectsWith(openSource({ cacheRoot: path.join(tmp.dir, 'old-git-2'), fetch: true, git }), 'clone-failed', /repository not found/);
  });

  it('refuses a fresh clone that is not at the pinned commit', async () => {
    const cacheRoot = path.join(tmp.dir, 'moved');
    const dir = checkout(cacheRoot);
    const git = fakeGit(async (args) => {
      if (args.includes('clone')) {
        await mkdir(path.join(dir, '.git'), { recursive: true });
        return ok();
      }
      return ok(`${'c'.repeat(40)}\n`);
    });
    await rejectsWith(openSource({ cacheRoot, fetch: true, git }), 'commit-mismatch');
  });

  it('reuses a cached checkout at the pinned commit', async () => {
    const cacheRoot = path.join(tmp.dir, 'warm');
    await mkdir(path.join(checkout(cacheRoot), '.git'), { recursive: true });
    const git = pinnedGit();
    const source = await openSource({ cacheRoot, git });
    assert.deepEqual(source, { dir: checkout(cacheRoot), origin: 'cache', commit: ECC_COMMIT, commitVerified: true });
  });

  it('refuses a cached checkout that uses sparse-checkout', async () => {
    const cacheRoot = path.join(tmp.dir, 'sparse');
    await mkdir(path.join(checkout(cacheRoot), '.git'), { recursive: true });
    await rejectsWith(openSource({ cacheRoot, git: pinnedGit({ sparse: true }) }), 'cache-incompatible', /Delete/);
  });

  it('refuses a cached checkout at another commit', async () => {
    const cacheRoot = path.join(tmp.dir, 'stale');
    await mkdir(path.join(checkout(cacheRoot), '.git'), { recursive: true });
    await rejectsWith(openSource({ cacheRoot, git: fakeGit(() => ok(`${'d'.repeat(40)}\n`)) }), 'commit-mismatch');
  });
});

describe('treeMap', () => {
  const source = { dir: '/checkout', origin: 'cache', commit: ECC_COMMIT };

  it('maps regular files to their object ids and skips links, submodules and directories', async () => {
    const records = [
      '100644 blob aaaa\tdocs/a.md\0',
      '100755 blob bbbb\tscripts/run.sh\0',
      '120000 blob cccc\tlink\0',
      '160000 commit dddd\tvendor/sub\0',
      '100644 blob eeee\tname with space.md\0',
      'garbage without a tab\0',
    ].join('');
    const git = fakeGit(() => ok(records));
    const files = await treeMap({ source, git });
    assert.deepEqual([...files], [['docs/a.md', 'aaaa'], ['scripts/run.sh', 'bbbb'], ['name with space.md', 'eeee']]);
    assert.deepEqual(git.calls[0].args, ['-C', '/checkout', 'ls-tree', '-r', '-z', 'HEAD']);
  });

  it('needs a git checkout and reports git failures', async () => {
    await rejectsWith(treeMap({ source: { ...source, commit: null }, git: fakeGit(() => ok()) }), 'git-required');
    await rejectsWith(treeMap({ source, git: fakeGit(() => fail('fatal: not a tree')) }), 'git-failed', /not a tree/);
  });
});

describe('ensurePaths', () => {
  let tmp;
  before(async () => {
    tmp = await makeTempDir();
  });
  after(() => tmp.cleanup());

  const cached = (dir, commit = ECC_COMMIT) => ({ dir, origin: 'cache', commit });

  it('does nothing when every file is already there', async () => {
    const dir = path.join(tmp.dir, 'complete');
    await writeTree(dir, { 'a.md': 'a', 'b/c.md': 'c' });
    const git = fakeGit(() => fail('must not be called'));
    const result = await ensurePaths({ source: cached(dir), paths: ['a.md', 'b/c.md', 'a.md'], git });
    assert.deepEqual(result, { fetched: 0, stillMissing: [] });
    assert.equal(git.calls.length, 0);
  });

  it('downloads the missing files in one request, then writes them from the local object store', async () => {
    const dir = path.join(tmp.dir, 'partial');
    await writeTree(dir, { 'have.md': 'x' });
    const names = ['have.md', 'need/one.md', 'need/two file.md', 'other.md'];
    const git = pinnedGit({
      tree: names,
      onCheckoutIndex: async () => {
        await writeTree(dir, { 'need/one.md': '1', 'need/two file.md': '2' });
        return ok();
      },
    });
    const result = await ensurePaths({ source: cached(dir), paths: ['have.md', 'need/one.md', 'need/two file.md'], git, log: () => {} });
    assert.deepEqual(result, { fetched: 2, stillMissing: [] });

    const verbs = git.calls.map((call) => call.args.find((arg) => ['ls-tree', 'fetch', 'read-tree', 'checkout-index'].includes(arg)));
    assert.deepEqual(verbs, ['ls-tree', 'fetch', 'read-tree', 'checkout-index']);

    const fetch = git.calls[1];
    assert.deepEqual(fetch.args, [
      '-C', dir, '-c', 'fetch.negotiationAlgorithm=noop',
      'fetch', 'origin', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', '--filter=blob:none', '--stdin',
    ]);
    assert.equal(fetch.options.input, `${fakeOid('need/one.md')}\n${fakeOid('need/two file.md')}\n`);
    assert.ok(fetch.options.timeout >= 60_000);

    assert.deepEqual(git.calls[2].args, ['-C', dir, 'read-tree', 'HEAD']);
    assert.deepEqual(git.calls[3].args, ['-C', dir, '-c', 'core.autocrlf=false', 'checkout-index', '-f', '-z', '--stdin']);
    assert.equal(git.calls[3].options.input, 'need/one.md\0need/two file.md\0');
  });

  it('does not ask for the same object twice', async () => {
    const dir = path.join(tmp.dir, 'same-oid');
    await mkdir(dir, { recursive: true });
    const git = fakeGit(async (args) => {
      if (args.includes('ls-tree')) return ok(['100644 blob 1111\ta.md\0', '100644 blob 1111\tb.md\0'].join(''));
      return ok();
    });
    await ensurePaths({ source: cached(dir), paths: ['a.md', 'b.md'], git });
    assert.equal(git.calls.find((call) => call.args.includes('fetch')).options.input, '1111\n');
  });

  it('reports files that are not in the release or not written', async () => {
    const dir = path.join(tmp.dir, 'absent');
    await mkdir(dir, { recursive: true });
    const git = pinnedGit({
      tree: ['there.md', 'unwritten.md'],
      onCheckoutIndex: async () => {
        await writeTree(dir, { 'there.md': 'x' });
        return ok();
      },
    });
    const result = await ensurePaths({ source: cached(dir), paths: ['there.md', 'unwritten.md', 'not-in-release.md'], git });
    assert.deepEqual(result, { fetched: 1, stillMissing: ['unwritten.md', 'not-in-release.md'] });
  });

  it('skips the download when nothing it needs is in the release', async () => {
    const dir = path.join(tmp.dir, 'nothing');
    await mkdir(dir, { recursive: true });
    const git = pinnedGit({ tree: ['other.md'] });
    const result = await ensurePaths({ source: cached(dir), paths: ['gone.md'], git });
    assert.deepEqual(result, { fetched: 0, stillMissing: ['gone.md'] });
    assert.ok(!git.calls.some((call) => call.args.includes('fetch') || call.args.includes('checkout-index')));
  });

  it('warns and carries on when the batch download fails', async () => {
    const dir = path.join(tmp.dir, 'slow-path');
    await mkdir(dir, { recursive: true });
    const messages = [];
    const git = pinnedGit({
      tree: ['a.md'],
      onFetch: () => fail('fatal: unsupported option'),
      onCheckoutIndex: async () => {
        await writeTree(dir, { 'a.md': 'x' });
        return ok();
      },
    });
    const result = await ensurePaths({ source: cached(dir), paths: ['a.md'], git, log: (m) => messages.push(m) });
    assert.deepEqual(result, { fetched: 1, stillMissing: [] });
    assert.match(messages.join('\n'), /batch download failed.*unsupported option/);
  });

  it('never changes a user-supplied source', async () => {
    const dir = path.join(tmp.dir, 'local');
    await mkdir(dir, { recursive: true });
    const git = fakeGit(() => fail('must not be called'));
    const result = await ensurePaths({ source: { dir, origin: 'local', commit: null }, paths: ['missing.md'], git });
    assert.deepEqual(result, { fetched: 0, stillMissing: ['missing.md'] });
    assert.equal(git.calls.length, 0);
  });

  it('reports failures to read the tree or to write files, and rejects unsafe paths', async () => {
    const dir = path.join(tmp.dir, 'failing');
    await mkdir(dir, { recursive: true });
    await rejectsWith(ensurePaths({ source: cached(dir), paths: ['x.md'], git: fakeGit(() => fail('fatal: no tree')) }), 'git-failed', /no tree/);
    const readTreeFails = fakeGit(async (args) => (args.includes('ls-tree') ? ok('100644 blob 1111\tx.md\0') : args.includes('read-tree') ? fail('fatal: index') : ok()));
    await rejectsWith(ensurePaths({ source: cached(dir), paths: ['x.md'], git: readTreeFails }), 'fetch-failed', /index/);
    const writeFails = fakeGit(async (args) => (args.includes('ls-tree') ? ok('100644 blob 1111\tx.md\0') : args.includes('checkout-index') ? fail('fatal: disk full') : ok()));
    await rejectsWith(ensurePaths({ source: cached(dir), paths: ['x.md'], git: writeFails }), 'fetch-failed', /disk full/);
    await assert.rejects(ensurePaths({ source: cached(dir), paths: ['../x.md'], git: fakeGit(() => ok()) }), /unsafe/);
  });
});

describe('listTree', () => {
  const source = { dir: '/checkout', origin: 'cache', commit: ECC_COMMIT };

  it('returns the sorted file names from NUL-separated git output', async () => {
    const git = fakeGit(() => ok('.kiro/steering/b.md\0.kiro/steering/a.md\0'));
    assert.deepEqual(await listTree({ source, prefixes: ['.kiro/steering'], git }), ['.kiro/steering/a.md', '.kiro/steering/b.md']);
    assert.deepEqual(git.calls[0].args, ['-C', '/checkout', 'ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', '.kiro/steering']);
  });

  it('needs a git checkout', async () => {
    await rejectsWith(listTree({ source: { dir: '/x', origin: 'local', commit: null }, prefixes: ['a'], git: fakeGit(() => ok()) }), 'git-required');
  });

  it('reports git failures and rejects unsafe prefixes', async () => {
    await rejectsWith(listTree({ source, prefixes: ['a'], git: fakeGit(() => fail('fatal: bad tree')) }), 'git-failed', /bad tree/);
    await assert.rejects(listTree({ source, prefixes: ['../a'], git: fakeGit(() => ok()) }), /unsafe/);
  });
});

describe('hashPaths', () => {
  let tmp;
  before(async () => {
    tmp = await makeTempDir();
    await writeTree(tmp.dir, { 'a.md': 'hello', 'dir/b.md': 'world' });
  });
  after(() => tmp.cleanup());

  it('hashes file contents and lists missing files', async () => {
    const { hashes, missing } = await hashPaths({ dir: tmp.dir, paths: ['a.md', 'dir/b.md', 'nope.md', 'dir'] });
    assert.equal(hashes.get('a.md'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    assert.equal(hashes.get('dir/b.md'), sha256Hex('world'));
    assert.deepEqual(missing, ['nope.md', 'dir']);
  });

  it('refuses unsafe paths', async () => {
    await assert.rejects(hashPaths({ dir: tmp.dir, paths: ['../etc/passwd'] }), /unsafe/);
  });
});
