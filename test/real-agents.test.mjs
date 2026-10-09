// The 68 real ECC v2.2.3 agents, converted. These tests read the pinned checkout in the source
// cache and are skipped when it is not there (fetch it with: ecc-kiro.mjs verify --fetch).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

import { convertAgent } from '../skills/ecc-kiro-setup/scripts/lib/agents.mjs';
import { defaultProfilePath } from '../skills/ecc-kiro-setup/scripts/lib/commands/verify.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';
import { resolveCacheRoot } from '../skills/ecc-kiro-setup/scripts/lib/paths.mjs';
import { buildPlanned } from '../skills/ecc-kiro-setup/scripts/lib/plan.mjs';
import { cacheCheckoutPath, readVerifiedFiles } from '../skills/ecc-kiro-setup/scripts/io/source.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ecc-kiro-setup');
const checkout = cacheCheckoutPath(resolveCacheRoot(process.env, os.homedir()));
const haveCheckout = existsSync(path.join(checkout, 'agents', 'planner.md'));
const SNAPSHOT = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'agent-tools-v2.2.3.json'), 'utf8'));

const KIRO_TAGS = new Set(['read', 'write', 'shell', 'web', 'subagent']);
const MCP_ENTRY = /^@[A-Za-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const decoder = new TextDecoder('utf-8', { fatal: true });

describe('the real ECC agents', { skip: haveCheckout ? false : 'ECC v2.2.3 is not in the source cache' }, () => {
  let profile;
  let entries;
  let sourceFiles;
  let converted;

  before(async () => {
    profile = JSON.parse(readFileSync(defaultProfilePath(SKILL_DIR), 'utf8'));
    entries = profile.entries.filter((entry) => entry.category === 'agent');
    const read = await readVerifiedFiles({ dir: checkout, entries });
    assert.deepEqual(read.missing, []);
    assert.deepEqual(read.mismatched, []);
    sourceFiles = read.files;
    converted = entries.map((entry) => ({ entry, text: decoder.decode(sourceFiles.get(entry.path)), result: convertAgent({ path: entry.path, text: decoder.decode(sourceFiles.get(entry.path)) }) }));
  });

  it('are 68 files whose bytes match the hashes in the profile', () => {
    assert.equal(entries.length, 68);
    assert.equal(sourceFiles.size, 68);
  });

  it('all convert, with unique names that match their files and do not clash with Kiro\'s own agents', () => {
    const names = converted.map(({ result }) => result.name);
    assert.equal(new Set(names).size, 68);
    assert.equal(new Set(converted.map(({ result }) => result.dest)).size, 68);
    for (const { entry, result } of converted) {
      assert.equal(entry.path, `agents/${result.name}.md`);
      assert.equal(result.dest, `.kiro/agents/${result.name}.md`);
      assert.doesNotMatch(result.name, /^kiro[_-]/i);
    }
    for (const builtIn of ['kiro_default', 'kiro_planner', 'kiro_help', 'kiro_guide']) assert.ok(!names.includes(builtIn), builtIn);
  });

  it('come out as valid Kiro agents: only name, description, tools (and permissions for shell), tools are Kiro tags', () => {
    for (const { result } of converted) {
      const { data, hasFrontmatter } = parseFrontmatter(result.content);
      assert.equal(hasFrontmatter, true, result.name);
      assert.deepEqual(Object.keys(data), result.shellRules ? ['name', 'description', 'tools', 'permissions'] : ['name', 'description', 'tools'], result.name);
      assert.equal(data.name, result.name);
      assert.ok(data.description.length > 0 && data.description === data.description.trim(), result.name);
      assert.deepEqual(data.tools, result.tools);
      assert.ok(data.tools.length > 0 && new Set(data.tools).size === data.tools.length, result.name);
      for (const tool of data.tools) assert.ok(KIRO_TAGS.has(tool) || MCP_ENTRY.test(tool), `${result.name}: ${tool}`);
      assert.equal(result.shellRules, data.tools.includes('shell'), result.name);
      assert.ok(result.content.startsWith('---\n'), 'frontmatter is the first thing in the file');
    }
  });

  it('keep the body of every agent byte for byte, and the description word for word', () => {
    for (const { text, result } of converted) {
      const before = parseFrontmatter(text);
      const after = parseFrontmatter(result.content);
      assert.equal(after.body, before.body, result.name);
      assert.equal(after.data.description, before.data.description.trim(), result.name);
    }
  });

  it('map tools exactly as the snapshot says, including docs-lookup and the browser agent', () => {
    const actual = Object.fromEntries(converted.map(({ result }) => [result.name, result.tools]));
    assert.deepEqual(actual, SNAPSHOT);
    assert.deepEqual(SNAPSHOT['docs-lookup'], ['read', '@context7/resolve-library-id', '@context7/query-docs']);
    const browser = Object.entries(SNAPSHOT).filter(([, tools]) => tools.some((tool) => tool.startsWith('@playwright/')));
    assert.equal(browser.length, 1);
    assert.deepEqual(browser[0][1].slice(0, 3), ['read', 'write', 'shell']);
    assert.equal(browser[0][1].length, 3 + 8);
  });

  it('give permission rules to the 53 agents that can run shell commands, and to no others', () => {
    const withShell = converted.filter(({ result }) => result.shellRules);
    assert.equal(withShell.length, 53);
    for (const { result } of converted) {
      const { data } = parseFrontmatter(result.content);
      assert.equal('permissions' in data, result.tools.includes('shell'), result.name);
    }
  });

  it('are planned as 68 files in .kiro/agents through the plan builder, with the notes a user should see', () => {
    const built = buildPlanned({ parts: ['agents'], profile, sourceFiles, existing: { globalAgents: new Set() } });
    assert.deepEqual(built.problems, []);
    assert.equal(built.planned.length, 68);
    assert.ok(built.planned.every((file) => file.dest.startsWith('.kiro/agents/') && file.category === 'agent' && file.part === 'agents'));
    assert.deepEqual(built.notes.map((note) => note.code), ['agent-model-dropped']);
    assert.match(built.notes[0].message, /68 agents name a Claude model and 5 a color/);
  });
});
