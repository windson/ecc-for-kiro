import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import {
  assertSafeRelativePath,
  compareStrings,
  isSafeRelativePath,
  resolveCacheRoot,
  resolveInside,
  resolveKiroHome,
} from '../skills/ecc-kiro-setup/scripts/lib/paths.mjs';

describe('isSafeRelativePath', () => {
  it('accepts ordinary relative paths', () => {
    for (const ok of ['a', 'a/b.md', '.agents/skills/x/SKILL.md', 'dir with space/file', 'a..b', '.hidden/file', 'a/b/c/d.txt']) {
      assert.equal(isSafeRelativePath(ok), true, ok);
    }
  });

  it('rejects absolute, drive, dotted, empty-segment, backslash and NUL paths', () => {
    for (const bad of ['', '/abs', 'C:/x', 'C:x', 'a//b', 'a/./b', './a', '../a', 'a/..', 'a/../b', 'a\\b', 'a\0b', 'a/', '/']) {
      assert.equal(isSafeRelativePath(bad), false, JSON.stringify(bad));
    }
  });

  it('rejects values that are not strings', () => {
    for (const bad of [null, undefined, 42, {}, []]) assert.equal(isSafeRelativePath(bad), false);
  });

  it('assertSafeRelativePath names what was wrong', () => {
    assert.equal(assertSafeRelativePath('a/b'), 'a/b');
    assert.throws(() => assertSafeRelativePath('../x', 'profile path'), /unsafe profile path: "\.\.\/x"/);
  });
});

describe('resolveInside', () => {
  it('joins a safe relative path to the root', () => {
    assert.equal(resolveInside('/root', 'a/b.md'), path.join('/root', 'a', 'b.md'));
  });

  it('refuses paths that escape the root', () => {
    assert.throws(() => resolveInside('/root', '../x'), /unsafe/);
    assert.throws(() => resolveInside('/root', '/etc/passwd'), /unsafe/);
    assert.throws(() => resolveInside('/root', 'a/../../x'), /unsafe/);
  });
});

describe('compareStrings', () => {
  it('orders by code unit, not by locale', () => {
    assert.equal(compareStrings('B', 'a'), -1);
    assert.equal(compareStrings('a', 'B'), 1);
    assert.equal(compareStrings('a', 'a'), 0);
    assert.deepEqual(['b', 'A', 'a', 'B'].sort(compareStrings), ['A', 'B', 'a', 'b']);
  });
});

describe('Kiro home and cache locations', () => {
  it('uses KIRO_HOME when set and ~/.kiro otherwise', () => {
    assert.equal(resolveKiroHome({ KIRO_HOME: '/custom' }, '/home/u'), '/custom');
    assert.equal(resolveKiroHome({}, '/home/u'), path.join('/home/u', '.kiro'));
  });

  it('prefers ECC_KIRO_CACHE, then XDG_CACHE_HOME, then ~/.cache', () => {
    assert.equal(resolveCacheRoot({ ECC_KIRO_CACHE: '/c', XDG_CACHE_HOME: '/x' }, '/home/u'), '/c');
    assert.equal(resolveCacheRoot({ XDG_CACHE_HOME: '/x' }, '/home/u'), path.join('/x', 'ecc-kiro'));
    assert.equal(resolveCacheRoot({}, '/home/u'), path.join('/home/u', '.cache', 'ecc-kiro'));
  });
});

describe('sha256Hex', () => {
  it('hashes strings as UTF-8 and bytes identically', () => {
    assert.equal(sha256Hex('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    assert.equal(sha256Hex(Buffer.from('hello')), sha256Hex('hello'));
    assert.equal(sha256Hex('é'), sha256Hex(Buffer.from('é', 'utf8')));
  });
});
