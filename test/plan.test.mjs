import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DESCRIPTION_MAX } from '../skills/ecc-kiro-setup/scripts/lib/skills.mjs';
import { UsageError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import { PART_ORDER, SKILL_DIR, buildPlanned, entriesFor, resolveParts, scopeFor } from '../skills/ecc-kiro-setup/scripts/lib/plan.mjs';
import { SAMPLE_RULES, minimalCommandAssets } from './command-assets.mjs';
import { legacyHookPath, legacyHookText } from './hook-assets.mjs';

const enc = (text) => Buffer.from(text, 'utf8');
const skillMd = (name, description = 'Does a thing. Use when asked.', extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`;

/** The profile entry for an ECC path, the way profile.mjs would have classified it. */
function entryFor(path, bytes) {
  const parts = path.split('/');
  const base = { path, sha256: sha256Hex(bytes) };
  if (path === 'AGENTS.md') return { category: 'agents-md', ...base };
  if (path.startsWith('.kiro/steering/')) return { category: 'adapter-steering', name: parts[2].replace(/\.md$/, ''), ...base };
  if (parts[0] === 'rules') return { category: 'rule', pack: parts.length === 3 ? parts[1] : '', file: parts[parts.length - 1], ...base };
  if (path.startsWith('agents/')) return { category: 'agent', name: parts[1].replace(/\.md$/, ''), ...base };
  if (path.startsWith('commands/')) return { category: 'command', name: parts[1].replace(/\.md$/, ''), ...base };
  if (path.startsWith('.kiro/scripts/')) return { category: 'adapter-script', name: parts[2].replace(/\.sh$/, ''), ...base };
  if (path.startsWith('.kiro/hooks/') && path.endsWith('.kiro.hook')) return { category: 'adapter-hook', name: parts[2].replace(/\.kiro\.hook$/, ''), ...base };
  const skillPrefix = parts[0] === 'skills' ? 1 : 2;
  return { category: 'skill', skill: parts[skillPrefix], rel: parts.slice(skillPrefix + 1).join('/'), ...base };
}

/** A profile-shaped object and the matching source bytes, from a map of ECC path -> bytes. */
function fixture(files) {
  const entries = Object.entries(files).map(([path, bytes]) => entryFor(path, bytes));
  return { profile: { entries }, sourceFiles: new Map(Object.entries(files)) };
}

describe('parts', () => {
  it('runs agents, skills, steering, commands, hooks, owned, mcp, license, then isolation', () => {
    assert.deepEqual([...PART_ORDER], ['agents', 'skills', 'steering', 'commands', 'hooks', 'owned', 'mcp', 'license', 'isolation']);
  });

  it('defaults to every part and keeps run order whatever order --only lists them in', () => {
    assert.deepEqual(resolveParts(undefined), ['agents', 'skills', 'steering', 'commands', 'hooks', 'owned', 'mcp', 'license', 'isolation']);
    assert.deepEqual(resolveParts('isolation,license,mcp'), ['mcp', 'license', 'isolation']);
    assert.deepEqual(resolveParts('hooks,commands'), ['commands', 'hooks']);
    assert.deepEqual(resolveParts('commands,agents'), ['agents', 'commands']);
    assert.deepEqual(resolveParts('skills,agents'), ['agents', 'skills']);
    assert.deepEqual(resolveParts('steering,agents'), ['agents', 'steering']);
    assert.deepEqual(resolveParts('skills'), ['skills']);
    assert.deepEqual(resolveParts(' agents , agents '), ['agents']);
  });

  it('rejects names it does not know, empty items and names inherited from Object', () => {
    for (const bad of ['bogus', 'agents,,skills', ',', 'constructor', '__proto__', 'toString']) {
      assert.throws(() => resolveParts(bad), UsageError, bad);
    }
  });

  it('knows which profile entries and which installed categories belong to a part', () => {
    const { profile } = fixture({
      'agents/a.md': enc('x'),
      'skills/s/SKILL.md': enc(skillMd('s')),
    });
    assert.deepEqual(entriesFor(['agents'], profile).map((e) => e.path), ['agents/a.md']);
    assert.deepEqual(entriesFor(['skills'], profile).map((e) => e.path), ['skills/s/SKILL.md']);
    assert.equal(entriesFor(['agents', 'skills'], profile).length, 2);
    assert.deepEqual([...scopeFor(['agents'])], ['agent']);
    assert.deepEqual([...scopeFor(['agents', 'skills'])].sort(), ['agent', 'skill']);
    assert.deepEqual([...scopeFor(['steering'])], ['steering']);
    assert.deepEqual([...scopeFor(['commands'])].sort(), ['command', 'command-script']);
    assert.deepEqual([...scopeFor(['hooks'])].sort(), ['hook', 'hook-script']);
    assert.deepEqual([...scopeFor(['mcp'])], ['mcp']);
    assert.deepEqual([...scopeFor(['license'])], ['license']);
    assert.deepEqual([...scopeFor(['isolation'])], ['kiroignore']);
  });

  it('reads the MCP catalog and example for the mcp part, the license for the license part, and no ECC file for the isolation part', () => {
    const { profile } = fixture({
      'agents/a.md': enc('x'),
      'commands/plan.md': enc('---\ndescription: d\n---\nx'),
      'mcp-configs/mcp-servers.json': enc('{"mcpServers": {}}'),
      '.kiro/settings/mcp.json.example': enc('{"mcpServers": {}}'),
      LICENSE: enc('MIT'),
    });
    profile.entries.find((e) => e.path === 'mcp-configs/mcp-servers.json').category = 'mcp-catalog';
    profile.entries.find((e) => e.path === '.kiro/settings/mcp.json.example').category = 'adapter-mcp-example';
    profile.entries.find((e) => e.path === 'LICENSE').category = 'license';
    assert.deepEqual(entriesFor(['mcp'], profile).map((e) => e.path).sort(), ['.kiro/settings/mcp.json.example', 'mcp-configs/mcp-servers.json']);
    assert.deepEqual(entriesFor(['license'], profile).map((e) => e.path), ['LICENSE']);
    assert.deepEqual(entriesFor(['isolation'], profile), []);
  });

  it('reads only the hooks of the Kiro adapter for the hooks part', () => {
    const { profile } = fixture({
      '.kiro/hooks/a.kiro.hook': enc('x'),
      '.kiro/scripts/format.sh': enc('#!/bin/bash'),
      'commands/plan.md': enc('---\ndescription: d\n---\nx'),
      'agents/a.md': enc('x'),
    });
    profile.entries.find((e) => e.path === '.kiro/hooks/a.kiro.hook').category = 'adapter-hook';
    assert.deepEqual(entriesFor(['hooks'], profile).map((e) => e.path), ['.kiro/hooks/a.kiro.hook']);
    assert.equal(entriesFor(['hooks', 'commands'], profile).length, 3, 'the commands part adds its own files');
  });

  it('reads only the commands and the scripts of the Kiro adapter for the commands part', () => {
    const { profile } = fixture({
      'commands/plan.md': enc('---\ndescription: d\n---\nx'),
      '.kiro/scripts/format.sh': enc('#!/bin/bash'),
      '.kiro/steering/coding-style.md': enc('x'),
      'agents/a.md': enc('x'),
      'skills/s/SKILL.md': enc(skillMd('s')),
    });
    assert.deepEqual(entriesFor(['commands'], profile).map((e) => e.path).sort(), ['.kiro/scripts/format.sh', 'commands/plan.md']);
  });

  it('reads only what the steering part uses: the adapter files, the AGENTS.md, the agents and the rules of its packs', () => {
    const { profile } = fixture({
      '.kiro/steering/coding-style.md': enc('x'),
      '.kiro/hooks/a.kiro.hook': enc('x'),
      'AGENTS.md': enc('x'),
      'agents/a.md': enc('x'),
      'skills/s/SKILL.md': enc(skillMd('s')),
      'rules/README.md': enc('x'),
      'rules/common/testing.md': enc('x'),
      'rules/golang/testing.md': enc('x'),
      'rules/perl/testing.md': enc('x'),
      'rules/react-native/testing.md': enc('x'),
    });
    profile.entries.find((e) => e.path === '.kiro/hooks/a.kiro.hook').category = 'adapter-hook';
    assert.deepEqual(entriesFor(['steering'], profile).map((e) => e.path).sort(), [
      '.kiro/steering/coding-style.md',
      'AGENTS.md',
      'agents/a.md',
      'rules/perl/testing.md',
      'rules/react-native/testing.md',
    ]);
    assert.equal(entriesFor(['steering', 'skills'], profile).length, 6, 'the skills part adds its own files');
  });
});

describe('buildPlanned: skills', () => {
  const build = (files, extra = {}) => {
    const { profile, sourceFiles } = fixture(files);
    return buildPlanned({ parts: ['skills'], profile, sourceFiles, ...extra });
  };

  it('puts every file of a skill under .kiro/skills/<name>/ with the same relative path', () => {
    const built = build({
      'skills/tdd-workflow/SKILL.md': enc(skillMd('tdd-workflow')),
      'skills/tdd-workflow/references/notes.md': enc('# Notes\n'),
      'skills/tdd-workflow/scripts/run.sh': enc('#!/bin/sh\n'),
      '.agents/skills/api-design/SKILL.md': enc(skillMd('api-design')),
    });
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.planned.map((f) => f.dest), [
      '.kiro/skills/api-design/SKILL.md',
      '.kiro/skills/tdd-workflow/SKILL.md',
      '.kiro/skills/tdd-workflow/references/notes.md',
      '.kiro/skills/tdd-workflow/scripts/run.sh',
    ]);
    assert.ok(built.planned.every((f) => f.category === 'skill' && f.part === 'skills'));
    assert.deepEqual(built.planned.map((f) => f.source), [
      '.agents/skills/api-design/SKILL.md',
      'skills/tdd-workflow/SKILL.md',
      'skills/tdd-workflow/references/notes.md',
      'skills/tdd-workflow/scripts/run.sh',
    ]);
    assert.ok(built.planned.filter((f) => f.dest.includes('tdd-workflow')).every((f) => f.anchor === '.kiro/skills/tdd-workflow/SKILL.md'));
    assert.equal(SKILL_DIR, '.kiro/skills');
  });

  it('copies every byte unchanged, binary and CRLF files included', () => {
    const binary = Buffer.from([0, 1, 2, 255, 254, 13, 10, 0xc3, 0x28]);
    const crlf = enc('line one\r\nline two\r\n');
    const skill = `\uFEFF---\r\nname: demo\r\ndescription: Does a thing. Use when asked.\r\n---\r\n\r\nBody\r\n`;
    const built = build({
      'skills/demo/SKILL.md': enc(skill),
      'skills/demo/assets/blob.bin': binary,
      'skills/demo/references/crlf.md': crlf,
    });
    assert.deepEqual(built.problems, []);
    const byDest = Object.fromEntries(built.planned.map((f) => [f.dest, f]));
    assert.ok(Buffer.from(byDest['.kiro/skills/demo/assets/blob.bin'].content).equals(binary));
    assert.ok(Buffer.from(byDest['.kiro/skills/demo/references/crlf.md'].content).equals(crlf));
    assert.ok(Buffer.from(byDest['.kiro/skills/demo/SKILL.md'].content).equals(enc(skill)));
    for (const file of built.planned) assert.equal(file.sha256, sha256Hex(file.content));
  });

  it('marks the files that are executable in the source, and only those', () => {
    const built = build(
      { 'skills/s/SKILL.md': enc(skillMd('s')), 'skills/s/scripts/go.sh': enc('#!/bin/sh\n'), 'skills/s/scripts/data.json': enc('{}') },
      { sourceExecutable: new Set(['skills/s/scripts/go.sh']) },
    );
    const modes = Object.fromEntries(built.planned.map((f) => [f.dest.split('/').pop(), f.mode]));
    assert.deepEqual(modes, { 'SKILL.md': undefined, 'go.sh': 0o755, 'data.json': undefined });
    assert.equal(built.details.skills.executable, 1);
  });

  it('reports what it found in a summary and in notes', () => {
    const long = Array.from({ length: 501 }, (_, i) => `line ${i}`).join('\n');
    const built = build({
      'skills/a/SKILL.md': enc(`---\nname: a\ndescription: A. Use for a.\norigin: ECC\nargument-hint: "[x]"\n---\n${long}\n`),
      'skills/b/SKILL.md': enc(skillMd('b', 'B. Use for b.', 'origin: ECC\n')),
      'skills/b/notes.md': enc('n'),
    });
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.details.skills, {
      total: 2,
      valid: 2,
      files: 3,
      executable: 0,
      patched: [],
      longBodies: 1,
      otherWarnings: [],
      extraFields: { 'argument-hint': 1, origin: 2 },
      overlapsGlobal: [],
    });
    assert.deepEqual(built.notes.map((n) => n.code), ['skill-extra-fields']);
    assert.match(built.notes[0].message, /argument-hint x1, origin x2.*copied unchanged/);
  });

  it('warns about skills that share a name with one of the user\'s global skills', () => {
    const built = build(
      { 'skills/a/SKILL.md': enc(skillMd('a')), 'skills/b/SKILL.md': enc(skillMd('b')) },
      { existing: { globalSkills: new Set(['b', 'unrelated']) } },
    );
    const note = built.notes.find((n) => n.code === 'skill-shadows-global');
    assert.equal(note.level, 'warn');
    assert.match(note.message, /1 skill also exists in your global skills folder \(b\); in this project the project copy wins/);
    assert.deepEqual(built.details.skills.overlapsGlobal, ['b']);
  });

  it('repairs an overlong description, says so, and still installs the skill', () => {
    const long = `${'Sentence about the skill and its use. '.repeat(40)}`.trim();
    const original = enc(`---\nname: wordy\ndescription: ${JSON.stringify(long)}\n---\n\n# Wordy\n`);
    const built = build({ 'skills/wordy/SKILL.md': original, 'skills/wordy/extra.txt': enc('e') });
    assert.deepEqual(built.problems, []);
    const file = built.planned.find((f) => f.dest.endsWith('SKILL.md'));
    assert.notEqual(file.sha256, sha256Hex(original));
    assert.match(String(file.content), /^---\nname: wordy\ndescription: "Sentence/);
    assert.ok(String(file.content).endsWith('---\n\n# Wordy\n'));
    assert.equal(file.sha256, sha256Hex(file.content));
    assert.equal(built.details.skills.patched.length, 1);
    assert.equal(built.details.skills.patched[0].skill, 'wordy');
    assert.ok(built.details.skills.patched[0].after.length <= DESCRIPTION_MAX);
    assert.equal(built.details.skills.valid, 1);
    const note = built.notes.find((n) => n.code === 'skill-patched');
    assert.equal(note.level, 'warn');
    assert.match(note.message, /1 skill broke a Kiro rule and had only their frontmatter repaired \(wordy: description-length\)/);
    assert.ok(built.planned.find((f) => f.dest.endsWith('extra.txt')).content.equals(enc('e')), 'other files are not touched');
  });

  it('stops on a skill it cannot repair, naming the file and the rules it breaks', () => {
    const built = build({
      'skills/good/SKILL.md': enc(skillMd('good')),
      'skills/bad/SKILL.md': enc(skillMd('not-bad')),
      'skills/none/references/x.md': enc('x'),
      'skills/broken/SKILL.md': enc('no frontmatter\n'),
    });
    assert.deepEqual(built.problems.map((p) => `${p.code} ${p.path}`).sort(), [
      'skill-invalid skills/bad/SKILL.md',
      'skill-invalid skills/broken/SKILL.md',
      'skill-md-missing skills/none/references/x.md',
    ]);
    assert.match(built.problems.find((p) => p.path === 'skills/bad/SKILL.md').message, /name-dir-mismatch/);
    assert.match(built.problems.find((p) => p.path === 'skills/broken/SKILL.md').message, /frontmatter-missing/);
    assert.equal(built.details.skills.valid, 1);
  });

  it('refuses a SKILL.md that is not UTF-8', () => {
    const built = build({ 'skills/bad/SKILL.md': Buffer.from([0x2d, 0x2d, 0x2d, 0xff, 0xfe]) });
    assert.deepEqual(built.problems.map((p) => p.code), ['source-encoding']);
  });
});

describe('buildPlanned: steering', () => {
  const rule = (paths, body) => `---\npaths:\n${paths.map((p) => `  - "${p}"`).join('\n')}\n---\n${body}`;
  const agentsMd = (rows = ['| planner | Planning | Big features |', '| helper | Helping | Small jobs |'], purposePad = '') => [
    '# Sample',
    '',
    '## Core Principles',
    '',
    '1. **Agent-First** — Delegate',
    '',
    '## Available Agents',
    '',
    '| Agent | Purpose | When to Use |',
    '|-------|---------|-------------|',
    ...rows.map((row) => row.replace('Planning', `Planning${purposePad}`)),
    '',
    '## Agent Orchestration',
    '',
    'Use agents proactively:',
    '- Big feature → **ecc:planner**',
    '',
  ].join('\n');

  // A file set to null in `over` is left out, so the profile does not list it.
  const sources = (over = {}) => Object.fromEntries(Object.entries({
    '.kiro/steering/coding-style.md': '---\ninclusion: auto\nname: coding-style\ndescription: Style.\n---\n\n# Style\n',
    '.kiro/steering/dev-mode.md': '---\ninclusion: manual\ndescription: Dev\n---\n\n# Dev\n\nUse `#dev-mode`.\n',
    '.kiro/steering/python-patterns.md': '---\ninclusion: fileMatch\nfileMatchPattern: "*.py,*.pyi"\ndescription: Py\n---\n\n# Py\n',
    'rules/perl/coding-style.md': rule(['**/*.pl'], '# Perl Coding Style\n\n> Extends [common/coding-style.md](../common/coding-style.md).\n'),
    'rules/perl/testing.md': rule(['**/*.t', '**/*.pl'], '# Perl Testing\n'),
    'rules/vue/patterns.md': rule(['**/*.vue'], '# Vue Patterns\n\nSee the [skill](../../skills/tdd-workflow/SKILL.md).\n'),
    'rules/common/testing.md': '# Common testing\n',
    'rules/golang/patterns.md': rule(['**/*.go'], '# Go\n'),
    'rules/README.md': '# Rules\n',
    'AGENTS.md': agentsMd(),
    'agents/planner.md': '---\nname: planner\ndescription: Plans.\ntools: Read\n---\nbody\n',
    'agents/helper.md': '---\nname: helper\ndescription: Helps with small jobs. Use often.\ntools: Read\n---\nbody\n',
    'skills/tdd-workflow/SKILL.md': skillMd('tdd-workflow'),
    ...over,
  }).filter(([, text]) => text !== null));
  const toBytes = (files) => Object.fromEntries(Object.entries(files).map(([path, text]) => [path, enc(text)]));
  const build = (over = {}, extra = {}) => {
    const { profile, sourceFiles } = fixture(toBytes(sources(over)));
    return buildPlanned({ parts: ['steering'], profile, sourceFiles, ...extra });
  };
  const text = (built, dest) => String(built.planned.find((file) => file.dest === dest).content);

  it('builds the adapter files, one file per pack, and the two always-on files, sorted by destination', () => {
    const built = build();
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.planned.map((f) => f.dest), [
      '.kiro/steering/ecc-agents.md',
      '.kiro/steering/ecc-coding-style.md',
      '.kiro/steering/ecc-dev-mode.md',
      '.kiro/steering/ecc-kiro-harness.md',
      '.kiro/steering/ecc-perl-rules.md',
      '.kiro/steering/ecc-python-patterns.md',
      '.kiro/steering/ecc-vue-rules.md',
    ]);
    assert.ok(built.planned.every((f) => f.category === 'steering' && f.part === 'steering' && f.sha256 === sha256Hex(f.content)));
  });

  it('records where each file comes from', () => {
    const sourceOf = Object.fromEntries(build().planned.map((f) => [f.dest.split('/').pop(), f.source]));
    assert.deepEqual(sourceOf, {
      'ecc-agents.md': 'AGENTS.md',
      'ecc-coding-style.md': '.kiro/steering/coding-style.md',
      'ecc-dev-mode.md': '.kiro/steering/dev-mode.md',
      'ecc-kiro-harness.md': null,
      'ecc-perl-rules.md': ['rules/perl/coding-style.md', 'rules/perl/testing.md'],
      'ecc-python-patterns.md': '.kiro/steering/python-patterns.md',
      'ecc-vue-rules.md': ['rules/vue/patterns.md'],
    });
  });

  it('converts the adapter files, and leaves the rules of other packs and the common rules out', () => {
    const built = build();
    assert.match(text(built, '.kiro/steering/ecc-coding-style.md'), /^---\ninclusion: always\nname: ecc-coding-style\n/);
    assert.match(text(built, '.kiro/steering/ecc-python-patterns.md'), /^---\ninclusion: fileMatch\nfileMatchPattern: \["\*\*\/\*\.py", "\*\*\/\*\.pyi"\]\n/);
    assert.match(text(built, '.kiro/steering/ecc-dev-mode.md'), /Use `#ecc-dev-mode`\./);
    assert.ok(!built.planned.some((f) => /golang|common/.test(f.dest)));
  });

  it('turns a pack into one fileMatch file with the union of the paths, fixed links and the skill link', () => {
    const built = build();
    const perl = text(built, '.kiro/steering/ecc-perl-rules.md');
    assert.match(perl, /^---\ninclusion: fileMatch\nfileMatchPattern: \["\*\*\/\*\.pl", "\*\*\/\*\.t"\]\n/);
    assert.match(perl, /Extends \[ecc-coding-style\]\(ecc-coding-style\.md\)\./);
    assert.doesNotMatch(perl, /\.\.\/common/);
    assert.match(text(built, '.kiro/steering/ecc-vue-rules.md'), /\[skill\]\(\.\.\/skills\/tdd-workflow\/SKILL\.md\)/);
  });

  it('writes the baseline from AGENTS.md: the counts, the roster, no ecc: prefix', () => {
    const agents = text(build(), '.kiro/steering/ecc-agents.md');
    assert.match(agents, /gives this project 2 custom agents and 1 skills\./);
    assert.match(agents, /\| planner \| Planning \| Big features \|\n\| helper \| Helping \| Small jobs \|\n$/);
    assert.match(agents, /- Big feature → \*\*planner\*\*/);
    assert.doesNotMatch(agents, /ecc:/);
  });

  it('sums up what it built', () => {
    const { steering } = build().details;
    assert.deepEqual(steering, {
      files: 7,
      adapter: { files: 3, always: 1, fileMatch: 1, manual: 1, references: 1 },
      packs: { files: 2, sources: 3, overridden: [], linksMapped: 2, linksUnlinked: 0 },
      baseline: { files: 2, rosterRows: 2, fromDescriptions: [], dropped: [] },
      alwaysOn: { files: 3, bytes: steering.alwaysOn.bytes, limit: 25000 },
    });
    assert.ok(steering.alwaysOn.bytes > 1000 && steering.alwaysOn.bytes < 5000);
  });

  it('counts the always-on bytes of exactly the files that are always on', () => {
    const built = build();
    const alwaysOn = built.planned.filter((f) => /^---\ninclusion: always\n/.test(String(f.content)));
    assert.equal(alwaysOn.length, 3);
    assert.equal(built.details.steering.alwaysOn.bytes, alwaysOn.reduce((sum, f) => sum + Buffer.byteLength(String(f.content)), 0));
  });

  it('counts bytes, not characters', () => {
    const multibyte = build({ 'AGENTS.md': agentsMd(undefined, 'é'.repeat(10)) });
    const plain = build({ 'AGENTS.md': agentsMd(undefined, 'e'.repeat(10)) });
    assert.equal(multibyte.details.steering.alwaysOn.bytes, plain.details.steering.alwaysOn.bytes + 10);
  });

  it('accepts always-on steering of exactly 25,000 bytes and refuses one byte more', () => {
    const base = build().details.steering.alwaysOn.bytes;
    const exact = build({ 'AGENTS.md': agentsMd(undefined, 'x'.repeat(25000 - base)) });
    assert.equal(exact.details.steering.alwaysOn.bytes, 25000);
    assert.deepEqual(exact.problems, []);

    const over = build({ 'AGENTS.md': agentsMd(undefined, 'x'.repeat(25001 - base)) });
    assert.equal(over.details.steering.alwaysOn.bytes, 25001);
    assert.deepEqual(over.problems.map((p) => p.code), ['always-on-too-large']);
    assert.match(over.problems[0].message, /the always-on steering is 25001 bytes, over the limit of 25000; it is sent with every request \(largest: ecc-agents\.md \d+, /);
  });

  it('uses the patterns from the override file for a pack, and says so', () => {
    const built = build({}, { languageGlobs: { vue: ['**/*.vue', '**/*.nuxt'], golang: ['**/*.go'] } });
    assert.match(text(built, '.kiro/steering/ecc-vue-rules.md'), /^---\ninclusion: fileMatch\nfileMatchPattern: \["\*\*\/\*\.vue", "\*\*\/\*\.nuxt"\]\n/);
    assert.match(text(built, '.kiro/steering/ecc-perl-rules.md'), /fileMatchPattern: \["\*\*\/\*\.pl", "\*\*\/\*\.t"\]/, 'other packs keep the derived patterns');
    assert.deepEqual(built.details.steering.packs.overridden, ['vue']);
    const note = built.notes.find((n) => n.code === 'steering-globs-overridden');
    assert.equal(note.level, 'info');
    assert.match(note.message, /1 rule pack uses the file patterns from assets\/language-globs\.json instead of the ones in the rules \(vue\)/);
  });

  it('fills in roster rows for agents AGENTS.md leaves out, from the agent files, and says so', () => {
    const built = build({ 'AGENTS.md': agentsMd(['| planner | Planning | Big features |']) });
    assert.deepEqual(built.problems, []);
    assert.match(text(built, '.kiro/steering/ecc-agents.md'), /\| helper \| Helps with small jobs \| See the agent description \|\n$/);
    assert.deepEqual(built.details.steering.baseline.fromDescriptions, ['helper']);
    assert.match(built.notes.find((n) => n.code === 'steering-roster-fallback').message, /AGENTS\.md leaves 1 agent out of its roster \(helper\); its row comes from the agent description/);
  });

  it('leaves out roster rows for agents that are not in the profile, and says so', () => {
    const built = build({ 'AGENTS.md': agentsMd(['| planner | Planning | Big features |', '| helper | Helping | Small jobs |', '| ghost | Boo | Never |']) });
    assert.doesNotMatch(text(built, '.kiro/steering/ecc-agents.md'), /ghost/);
    assert.deepEqual(built.details.steering.baseline.dropped, ['ghost']);
    assert.match(built.notes.find((n) => n.code === 'steering-roster-extra').message, /names 1 agent that is not installed \(ghost\); left out/);
  });

  it('builds the same bytes every time', () => {
    const a = build().planned.map((f) => f.sha256);
    const b = build().planned.map((f) => f.sha256);
    assert.deepEqual(a, b);
  });

  it('builds without packs that the profile does not list', () => {
    const built = build({ 'rules/perl/coding-style.md': null, 'rules/perl/testing.md': null });
    assert.deepEqual(built.problems, []);
    assert.equal(built.details.steering.packs.files, 1);
    assert.ok(!built.planned.some((f) => f.dest.includes('perl')));
  });

  it('stops, naming the file, when a steering source cannot be converted', () => {
    const built = build({
      '.kiro/steering/dev-mode.md': '---\ninclusion: sometimes\n---\nx\n',
      'rules/perl/testing.md': '# no frontmatter\n',
      'AGENTS.md': '# no sections\n',
    });
    assert.deepEqual(built.problems.map((p) => `${p.code} ${p.path}`).sort(), [
      'agents-md-section AGENTS.md',
      'rule-paths rules/perl',
      'steering-inclusion .kiro/steering/dev-mode.md',
    ]);
    assert.ok(built.problems.every((p) => p.message.includes(p.path.replace('rules/perl', 'rules/perl/testing.md'))));
    assert.ok(built.planned.some((f) => f.dest.endsWith('ecc-coding-style.md')), 'the files that are fine are still planned');
  });

  it('reports a profile without AGENTS.md, a source that was not read and a source that is not UTF-8', () => {
    assert.deepEqual(build({ 'AGENTS.md': null }).problems.map((p) => p.code), ['agents-md-missing']);

    const { profile, sourceFiles } = fixture(toBytes(sources()));
    sourceFiles.delete('rules/vue/patterns.md');
    sourceFiles.delete('AGENTS.md');
    sourceFiles.set('.kiro/steering/dev-mode.md', Buffer.from([0x2d, 0xff, 0xfe]));
    const built = buildPlanned({ parts: ['steering'], profile, sourceFiles });
    assert.deepEqual(built.problems.map((p) => `${p.code} ${p.path}`).sort(), [
      'source-encoding .kiro/steering/dev-mode.md',
      'source-missing AGENTS.md',
      'source-missing rules/vue/patterns.md',
    ]);
  });

  it('survives an agent file that is missing or unreadable when it only needs a description', () => {
    const { profile, sourceFiles } = fixture(toBytes(sources({ 'AGENTS.md': agentsMd(['| planner | Planning | Big features |']) })));
    sourceFiles.delete('agents/helper.md');
    const built = buildPlanned({ parts: ['steering'], profile, sourceFiles });
    assert.deepEqual(built.problems, []);
    assert.match(String(built.planned.find((f) => f.dest.endsWith('ecc-agents.md')).content), /\| helper \| ECC agent \| See the agent description \|/);

    sourceFiles.set('agents/helper.md', enc('---\nname: [broken\n---\n'));
    assert.deepEqual(buildPlanned({ parts: ['steering'], profile, sourceFiles }).problems, []);
    sourceFiles.set('agents/helper.md', Buffer.from([0xff, 0xfe]));
    assert.deepEqual(buildPlanned({ parts: ['steering'], profile, sourceFiles }).problems, []);
  });

  it('runs together with the other parts', () => {
    const { profile, sourceFiles } = fixture(toBytes(sources()));
    const built = buildPlanned({ parts: ['agents', 'skills', 'steering'], profile, sourceFiles });
    assert.deepEqual(built.problems, []);
    assert.deepEqual(Object.keys(built.details).sort(), ['skills', 'steering']);
    assert.equal(built.planned.filter((f) => f.part === 'steering').length, 7);
    assert.equal(built.planned.filter((f) => f.part === 'agents').length, 2);
  });
});

describe('buildPlanned: commands', () => {
  const commandFile = (description, body, front = '') => `---\ndescription: ${description}\n${front}---\n${body}`;
  const CREDIT = '> Adapted from PRPs-agentic-eng by Wirasm, see CLAUDE.md and /plan.';
  const CLASSES = {
    plan: { class: 'A' },
    'code-review': { class: 'A' },
    'quality-gate': { class: 'B', builtin: 'quality-gate', design: 'B10' },
    'orch-add-feature': { class: 'C', reason: 'invokes skills that are not in the profile', missing: 'C2: six skills', design: 'C2' },
    'multi-plan': { class: 'B', reason: 'codeagent-wrapper', missing: 'a Kiro-native overlay', design: 'B2' },
    'api-design': { class: 'A', skill: 'api-design' },
  };
  const QUALITY_GATE_SH = '#!/bin/bash\necho "gate ✓"\n';

  // A file set to null in `over` is left out, so the profile does not list it.
  const sources = (over = {}) =>
    Object.fromEntries(
      Object.entries({
        'commands/plan.md': commandFile('Plan a change. Use /code-review after.', '# Plan\n\nRead CLAUDE.md and run /code-review on $ARGUMENTS. See /api-design.\n', 'argument-hint: "[task]"\n'),
        'commands/code-review.md': commandFile('Review code.', `# Code review\n\n${CREDIT}\n\nReview it.\n`),
        'commands/quality-gate.md': commandFile('Formatter gate.', 'Run node scripts/hooks/quality-gate.js.\n'),
        'commands/orch-add-feature.md': commandFile('Add a feature.', 'Invoke the `orch-add-feature` skill with $ARGUMENTS.\n'),
        'commands/multi-plan.md': commandFile('Multi plan.', 'Uses ~/.claude/bin/codeagent-wrapper for $ARGUMENTS.\n'),
        'commands/api-design.md': commandFile('API design.', 'Thin wrapper.\n'),
        '.kiro/scripts/quality-gate.sh': QUALITY_GATE_SH,
        '.kiro/scripts/format.sh': '#!/bin/bash\necho format\n',
        'skills/api-design/SKILL.md': skillMd('api-design'),
        'agents/planner.md': '---\nname: planner\ndescription: Plans.\ntools: Read\n---\nbody\n',
        ...over,
      }).filter(([, text]) => text !== null),
    );
  const toBytes = (files) => Object.fromEntries(Object.entries(files).map(([path, text]) => [path, enc(text)]));
  const build = ({ files = {}, assets = {}, raw, ...extra } = {}) => {
    const { profile, sourceFiles } = fixture(toBytes(sources(files)));
    return buildPlanned({
      parts: ['commands'],
      profile,
      sourceFiles,
      sourceExecutable: new Set(['.kiro/scripts/quality-gate.sh', '.kiro/scripts/format.sh']),
      commandAssets: raw === undefined ? minimalCommandAssets({ classes: CLASSES, ...assets }) : raw,
      ...extra,
    });
  };
  const fileOf = (built, dest) => built.planned.find((file) => file.dest === dest);
  const text = (built, dest) => String(fileOf(built, dest).content);
  const codes = (built) => built.problems.map((problem) => problem.code).sort();

  it('registers the class A commands and the quality gate, and the two scripts, sorted by destination', () => {
    const built = build();
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.planned.map((file) => file.dest), [
      '.kiro/ecc/scripts/format.sh',
      '.kiro/ecc/scripts/quality-gate.sh',
      '.kiro/steering/ecc-code-review.md',
      '.kiro/steering/ecc-plan.md',
      '.kiro/steering/ecc-quality-gate.md',
    ]);
    assert.ok(built.planned.every((file) => file.part === 'commands' && file.sha256 === sha256Hex(file.content)));
    assert.deepEqual(built.planned.map((file) => file.category), ['command-script', 'command-script', 'command', 'command', 'command']);
    assert.deepEqual(built.planned.map((file) => file.source), [
      '.kiro/scripts/format.sh',
      '.kiro/scripts/quality-gate.sh',
      'commands/code-review.md',
      'commands/plan.md',
      ['commands/quality-gate.md', '.kiro/scripts/quality-gate.sh'],
    ]);
  });

  it('writes manual steering with the header first and the rewritten text after it', () => {
    const built = build();
    const plan = text(built, '.kiro/steering/ecc-plan.md');
    assert.ok(plan.startsWith('---\ninclusion: manual\ndescription: "Plan a change. Use /ecc-code-review after."\n---\n'));
    assert.match(plan, /\nInvoked as `\/ecc-plan`\. ARGS is the text after `\/ecc-plan`.* Usage: `\/ecc-plan \[task\]`\.\n\n# Plan\n\nRead AGENTS\.md and run \/ecc-code-review on ARGS\./);
    assert.ok(plan.endsWith('\n') && !plan.endsWith('\n\n'));
  });

  it('leaves the slash name of a command that a skill gives alone', () => {
    const plan = text(build(), '.kiro/steering/ecc-plan.md');
    assert.match(plan, /See \/api-design\./);
    assert.doesNotMatch(plan, /\/ecc-api-design/);
  });

  it('keeps a line that credits someone exactly as it is, and says how many lines it kept', () => {
    const built = build();
    assert.ok(text(built, '.kiro/steering/ecc-code-review.md').split('\n').includes(CREDIT));
    assert.equal(built.details.commands.rewrites.protectedLines, 1);
    assert.deepEqual(built.details.commands.rewrites.byRule, { 'arguments-placeholder': 1, 'claude-md': 1, 'command-names': 1 });
    assert.equal(built.details.commands.rewrites.replacements, 3);
    assert.equal(built.details.commands.rewrites.commandsChanged, 1);
  });

  it('installs the scripts of the Kiro adapter byte for byte, and gives them the execute bit they have', () => {
    const built = build();
    const gate = fileOf(built, '.kiro/ecc/scripts/quality-gate.sh');
    assert.ok(Buffer.from(gate.content).equals(enc(QUALITY_GATE_SH)));
    assert.equal(gate.mode, 0o755);
    const plain = build({ sourceExecutable: new Set() });
    assert.equal(fileOf(plain, '.kiro/ecc/scripts/format.sh').mode, undefined);
    assert.deepEqual(built.details.commands.scripts, ['.kiro/ecc/scripts/format.sh', '.kiro/ecc/scripts/quality-gate.sh']);
  });

  it('builds /ecc-quality-gate from the adapter script, and stops when the script is not there', () => {
    const gate = text(build(), '.kiro/steering/ecc-quality-gate.md');
    assert.match(gate, /```bash\nbash \.kiro\/ecc\/scripts\/quality-gate\.sh\n```/);
    assert.doesNotMatch(gate, /scripts\/hooks/);
    const missing = build({ files: { '.kiro/scripts/quality-gate.sh': null } });
    assert.deepEqual(codes(missing), ['command-script-missing']);
    assert.match(missing.problems[0].message, /quality-gate runs \.kiro\/ecc\/scripts\/quality-gate\.sh, which the profile does not provide/);
  });

  it('leaves class B and C commands pending, with what each one needs, and does not install them', () => {
    const built = build();
    assert.ok(!built.planned.some((file) => /multi-plan|orch-add-feature/.test(file.dest)));
    assert.deepEqual(built.details.commands.pending, [
      { name: 'multi-plan', class: 'B', reason: 'codeagent-wrapper', missing: 'a Kiro-native overlay', design: 'B2' },
      { name: 'orch-add-feature', class: 'C', reason: 'invokes skills that are not in the profile', missing: 'C2: six skills', design: 'C2' },
    ]);
    const note = built.notes.find((item) => item.code === 'commands-pending');
    assert.equal(note.level, 'info');
    assert.match(note.message, /2 commands are pending and not installed: 1 need a Kiro-native rewrite \(class B\) and 1 need a piece this install does not have \(class C\)/);
  });

  it('does not register a command whose skill gives the same entry, and says so', () => {
    const built = build();
    assert.deepEqual(built.details.commands.skipped, [{ name: 'api-design', skill: 'api-design' }]);
    assert.ok(!built.planned.some((file) => file.dest.includes('api-design')));
    assert.match(built.notes.find((item) => item.code === 'commands-skipped').message, /api-design: \/api-design/);
    const gone = build({ files: { 'skills/api-design/SKILL.md': null } });
    assert.deepEqual(codes(gone), ['command-skill-missing']);
  });

  it('counts the commands: total, registered, pending, skipped', () => {
    const { commands } = build().details;
    assert.deepEqual([commands.total, commands.registered, commands.pending.length, commands.skipped.length], [6, 3, 2, 1]);
    assert.equal(commands.withOverlay, 0);
  });

  it('stops the plan, naming the command and the wording, when an installed text would still have Claude Code wording', () => {
    const built = build({ files: { 'commands/plan.md': commandFile('Plan.', 'Save to ~/.claude/plans/x.\n') } });
    assert.deepEqual(codes(built), ['command-lint']);
    assert.equal(built.problems[0].path, 'commands/plan.md');
    assert.match(built.problems[0].message, /plan is not installed: the text still has Claude Code wording \(claude-home\)/);
    assert.ok(!built.planned.some((file) => file.dest.endsWith('ecc-plan.md')), 'the command is not installed');
    assert.ok(built.planned.some((file) => file.dest.endsWith('ecc-code-review.md')), 'the others are still planned');
  });

  it('lints a pending command too, but only to report', () => {
    const built = build();
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.details.commands.stillClaudeSpecific, ['multi-plan']);
    assert.deepEqual(built.details.commands.matches, { 'multi-plan': ['claude-home'] });
    assert.equal(built.details.commands.clean, 4);
  });

  it('uses a current overlay instead of the ECC text, lints it, and shows its credit', () => {
    const sha = sha256Hex(sources()['commands/orch-add-feature.md']);
    const overlay = (body, hash = sha) => `---\nsource: "commands/orch-add-feature.md"\nsha256: "${hash}"\ncredit: ["Adapted from ECC, MIT License."]\ndescription: "Kiro text."\n---\n${body}`;
    const built = build({ assets: { overlays: new Map([['orch-add-feature', overlay('Do the work in Kiro.\n')]]) } });
    assert.deepEqual(built.problems, []);
    const file = text(built, '.kiro/steering/ecc-orch-add-feature.md');
    assert.match(file, /description: "Kiro text\."/);
    assert.match(file, /> Credit: Adapted from ECC, MIT License\.\n\nDo the work in Kiro\.\n$/);
    assert.ok(!built.details.commands.pending.some((item) => item.name === 'orch-add-feature'));
    assert.equal(built.details.commands.withOverlay, 1);
    assert.deepEqual(built.details.commands.overlays, [{ name: 'orch-add-feature', status: 'used' }]);

    const dirty = build({ assets: { overlays: new Map([['orch-add-feature', overlay('Read CLAUDE.md.\n')]]) } });
    assert.deepEqual(codes(dirty), ['command-lint']);
  });

  it('reports a stale overlay, keeps a class B or C command pending, and uses the ECC text for a class A command', () => {
    const stale = (name) => `---\nsource: "commands/${name}.md"\nsha256: "${'0'.repeat(64)}"\ncredit: ["c"]\n---\nOverlay text.\n`;
    const built = build({ assets: { overlays: new Map([['orch-add-feature', stale('orch-add-feature')], ['plan', stale('plan')]]) } });
    assert.deepEqual(built.problems, []);
    assert.equal(built.details.commands.pending.find((item) => item.name === 'orch-add-feature').overlay, 'stale');
    assert.doesNotMatch(text(built, '.kiro/steering/ecc-plan.md'), /Overlay text/);
    assert.match(text(built, '.kiro/steering/ecc-plan.md'), /Read AGENTS\.md/);
    const note = built.notes.find((item) => item.code === 'command-overlay-stale');
    assert.equal(note.level, 'warn');
    assert.match(note.message, /2 overlays in assets\/commands\/overlays are out of date \(orch-add-feature, plan\)/);
    assert.deepEqual(built.details.commands.overlays, [{ name: 'orch-add-feature', status: 'stale' }, { name: 'plan', status: 'stale' }]);
  });

  it('ignores an overlay for a command ECC does not have, and stops on an overlay that is broken', () => {
    const orphan = build({ assets: { overlays: new Map([['ghost', '---\nsource: "commands/ghost.md"\n---\nx']]) } });
    assert.deepEqual(orphan.problems, []);
    assert.match(orphan.notes.find((item) => item.code === 'command-overlay-orphan').message, /1 overlay in assets\/commands\/overlays names no ECC command \(ghost\); it is ignored/);
    const broken = build({ assets: { overlays: new Map([['plan', 'no header']]) } });
    assert.deepEqual(codes(broken), ['command-overlay-invalid']);
    assert.equal(broken.problems[0].path, 'assets/commands/overlays/plan.md');
  });

  it('stops when the data files are missing, naming each one', () => {
    const built = build({ raw: undefined === 0 ? null : {} });
    assert.deepEqual(codes(built), ['command-assets-missing', 'command-assets-missing', 'command-assets-missing', 'command-assets-missing']);
    assert.deepEqual(built.problems.map((problem) => problem.path), ['assets/commands/classes.json', 'assets/commands/rewrite-rules.json', 'assets/commands/snippets.json', 'assets/commands/lint-patterns.json']);
    assert.deepEqual(built.planned, []);
    const none = buildPlanned({ parts: ['commands'], ...fixture(toBytes(sources())), sourceFiles: new Map() });
    assert.equal(none.problems.length, 4);
  });

  it('stops when a data file is invalid, naming the file and the fault', () => {
    const assets = minimalCommandAssets({ classes: CLASSES });
    assets.rules.rules[0].pattern = '(broken';
    const built = build({ raw: assets });
    assert.deepEqual(codes(built), ['command-assets-invalid']);
    assert.match(built.problems[0].message, /^assets\/commands\/rewrite-rules\.json: "claude-md": "pattern" is not a valid regular expression/);
  });

  it('stops when a command has no class', () => {
    const built = build({ files: { 'commands/new-one.md': commandFile('New.', 'Text.\n') } });
    assert.deepEqual(codes(built), ['command-class-missing']);
    assert.equal(built.problems[0].message, 'new-one has no class in assets/commands/classes.json');
  });

  it('stops when a rule that names a command does not match it as often as it says', () => {
    const rules = [{ id: 'fix-plan', rule: 'R9', commands: ['plan'], expect: 2, pattern: 'Nothing like this', replacement: 'x', why: 'a test' }];
    const built = build({ assets: { rules: [...SAMPLE_RULES, ...rules] } });
    assert.deepEqual(codes(built), ['command-rule-missed']);
    assert.match(built.problems[0].message, /plan: the rule "fix-plan" should match 2 times and matched 0/);
    assert.equal(built.problems[0].path, 'commands/plan.md');
  });

  it('stops when a rule would change a credit line', () => {
    const rules = [{ id: 'greedy', rule: 'R1', commands: ['code-review'], pattern: '[\\s\\S]+', replacement: 'gone', why: 'a test' }];
    assert.deepEqual(codes(build({ assets: { rules: [...SAMPLE_RULES, ...rules] } })), ['command-rewrite-dropped-protected']);
  });

  it('checks the names against skills, agents, steering and the commands of Kiro', () => {
    const built = build();
    assert.deepEqual(built.details.commands.names.collisions, []);
    assert.deepEqual(built.details.commands.names.checked, { skills: 1, agents: 1, steering: 2, builtins: 52 });
    assert.deepEqual(built.details.commands.names.avoided, [{ name: 'plan', with: 'a Kiro built-in command' }]);
    assert.match(built.notes.find((item) => item.code === 'command-names').message, /no clash\. Without the ecc- prefix plan \(a Kiro built-in command\) would clash/);

    const clash = build({ files: { 'skills/ecc-plan/SKILL.md': skillMd('ecc-plan') } });
    assert.deepEqual(codes(clash), ['command-name-collision']);
    assert.match(clash.problems[0].message, /ecc-plan is also a skill/);
    assert.deepEqual(codes(build({ existing: { globalAgents: new Set(['ecc-plan']) } })), ['command-name-collision']);
    assert.deepEqual(codes(build({ files: { 'rules/perl/testing.md': '---\npaths:\n  - "**/*.t"\n---\nx', 'commands/perl-rules.md': commandFile('Perl.', 'Text.\n') }, assets: { classes: { ...CLASSES, 'perl-rules': { class: 'A' } } } })), ['command-name-collision']);
  });

  it('notes the Claude Code settings that are left out of the commands it installs', () => {
    const front = 'allowed-tools: ["Read"]\nagent: ecc:security-reviewer\nsubtask: true\n';
    const built = build({ files: { 'commands/code-review.md': commandFile('Review code.', 'Review it.\n', front) } });
    const note = built.notes.find((item) => item.code === 'command-fields-dropped');
    assert.equal(note.level, 'info');
    assert.match(note.message, /left out: agent \(code-review\); allowed-tools \(code-review\); subtask \(code-review\)|left out: allowed-tools \(code-review\); agent \(code-review\); subtask \(code-review\)/);
    const review = text(built, '.kiro/steering/ecc-code-review.md');
    assert.match(review, /This command runs in the `security-reviewer` sub-agent\. Delegate with the sub-agent tool by agent name\./);
    assert.deepEqual(built.details.commands.dropped, { agent: ['code-review'], 'allowed-tools': ['code-review'], subtask: ['code-review'] });
  });

  it('adds the snippet a rule asks for once, at the end', () => {
    const rules = [{ id: 'skills-dir', rule: 'R4', pattern: '~/\\.claude/skills', replacement: '~/.kiro/skills', append: 'S3', why: 'a test' }];
    const built = build({ files: { 'commands/plan.md': commandFile('Plan.', 'Save in ~/.claude/skills/a and ~/.claude/skills/b.\n') }, assets: { rules: [...SAMPLE_RULES, ...rules] } });
    const plan = text(built, '.kiro/steering/ecc-plan.md');
    assert.match(plan, /Save in ~\/\.kiro\/skills\/a and ~\/\.kiro\/skills\/b\.\n\n## Skill limits\n\nSkill folder name equals `name`/);
    assert.equal(plan.split('## Skill limits').length, 2);
  });

  it('builds the same bytes every time, and runs together with the other parts', () => {
    assert.deepEqual(build().planned.map((file) => file.sha256), build().planned.map((file) => file.sha256));
    const { profile, sourceFiles } = fixture(toBytes(sources()));
    const built = buildPlanned({ parts: ['agents', 'skills', 'commands'], profile, sourceFiles, commandAssets: minimalCommandAssets({ classes: CLASSES }) });
    assert.deepEqual(built.problems, []);
    assert.equal(built.planned.filter((file) => file.part === 'commands').length, 5);
    assert.deepEqual(Object.keys(built.details).sort(), ['commands', 'skills']);
  });
});

describe('buildPlanned: hooks', () => {
  const GUARD_TEXT = '// the guard\n';
  const hook = (name, when, then = { type: 'askAgent', prompt: `Prompt of ${name}.` }, extra = {}) => [legacyHookPath(name), enc(legacyHookText({ name, when, then, ...extra }))];
  const build = (hooks, extra = { hookAssets: { guard: GUARD_TEXT } }) => {
    const { profile, sourceFiles } = fixture(Object.fromEntries(hooks));
    return buildPlanned({ parts: ['hooks'], profile, sourceFiles, ...extra });
  };
  const SAVE = { type: 'fileEdited', patterns: ['*.py'] };
  const PUSH = { type: 'preToolUse', toolTypes: ['shell'] };

  it('writes one file per converted hook to .kiro/hooks/ecc-<name>.json, sorted by path, and records the ECC file it came from', () => {
    const built = build([hook('python-lint', SAVE), hook('session-summary', { type: 'agentStop' })]);
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.planned.map((f) => f.dest), ['.kiro/hooks/ecc-python-lint.json', '.kiro/hooks/ecc-session-summary.json']);
    assert.deepEqual(built.planned.map((f) => [f.category, f.part, f.source]), [
      ['hook', 'hooks', '.kiro/hooks/python-lint.kiro.hook'],
      ['hook', 'hooks', '.kiro/hooks/session-summary.kiro.hook'],
    ]);
    for (const file of built.planned) assert.equal(file.sha256, sha256Hex(file.content));
    assert.equal(JSON.parse(built.planned[0].content).hooks[0].matcher, '\\.py$');
  });

  it('plans the guard script, with no ECC source, when a hook runs it, and not otherwise', () => {
    const withPush = build([hook('git-push-review', PUSH), hook('python-lint', SAVE)]);
    assert.deepEqual(withPush.problems, []);
    const guard = withPush.planned.find((f) => f.dest === '.kiro/ecc/scripts/git-push-guard.mjs');
    assert.deepEqual([guard.content, guard.source, guard.category, guard.part, guard.sha256], [GUARD_TEXT, null, 'hook-script', 'hooks', sha256Hex(GUARD_TEXT)]);
    assert.equal(guard.mode, undefined);
    assert.deepEqual(withPush.details.hooks.scripts, ['.kiro/ecc/scripts/git-push-guard.mjs']);

    const without = build([hook('python-lint', SAVE)], {});
    assert.deepEqual(without.problems, [], 'no guard is needed, so none is asked for');
    assert.deepEqual(without.planned.map((f) => f.category), ['hook']);
    assert.deepEqual(without.details.hooks.scripts, []);
  });

  it('asks for the guard, by its path in the skill, when a hook runs it and the text is not there', () => {
    for (const hookAssets of [undefined, {}, { guard: '' }, { guard: 7 }]) {
      const built = build([hook('git-push-review', PUSH)], { hookAssets });
      assert.deepEqual(built.problems.map((p) => [p.code, p.path]), [['hook-assets-missing', 'scripts/runtime/git-push-guard.mjs']], JSON.stringify(hookAssets));
      assert.deepEqual(built.planned.map((f) => f.category), ['hook'], 'the hook is planned; the plan as a whole is refused');
    }
  });

  it('counts the hooks: converted, switched off, by kind of action and by trigger', () => {
    const built = build([hook('git-push-review', PUSH), hook('python-lint', SAVE), hook('session-summary', { type: 'agentStop' }), hook('summary-two', { type: 'agentStop' })]);
    assert.deepEqual(built.details.hooks, {
      total: 4,
      converted: 4,
      disabled: 4,
      agentActions: 3,
      commandActions: 1,
      byTrigger: { PostFileSave: 1, PreToolUse: 1, Stop: 2 },
      adapted: [{ name: 'git-push-review', why: built.details.hooks.adapted[0].why }],
      skipped: [],
      scripts: ['.kiro/ecc/scripts/git-push-guard.mjs'],
    });
    assert.match(built.details.hooks.adapted[0].why, /cannot look at the command/);
  });

  it('leaves out a hook that is started by hand, says so, and names the command for quality-gate', () => {
    const built = build([hook('quality-gate', { type: 'userTriggered' }, { type: 'runCommand', command: 'bash x.sh' }), hook('python-lint', SAVE)]);
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.planned.map((f) => f.dest), ['.kiro/hooks/ecc-python-lint.json']);
    assert.equal(built.details.hooks.total, 2);
    assert.deepEqual(built.details.hooks.skipped.map((s) => s.name), ['quality-gate']);
    const note = built.notes.find((n) => n.code === 'hooks-skipped');
    assert.match(note.message, /^1 hook not converted \(quality-gate\): a hook that is started by hand has no v1 trigger\. The commands part installs quality-gate as \/ecc-quality-gate$/);

    const other = build([hook('my-gate', { type: 'userTriggered' }, { type: 'runCommand', command: 'x' })]);
    assert.doesNotMatch(other.notes.find((n) => n.code === 'hooks-skipped').message, /ecc-quality-gate/);
  });

  it('says in a note that the hooks are off and what the agent ones cost, and which were adapted', () => {
    const built = build([hook('git-push-review', PUSH), hook('python-lint', SAVE)]);
    assert.deepEqual(built.notes.map((n) => [n.level, n.code]), [['info', 'hooks-disabled'], ['info', 'hooks-adapted']]);
    assert.match(built.notes[0].message, /^2 hooks are installed switched off\. Turn one on in the Agent Hooks panel of the IDE, or set "enabled" to true in its file in \.kiro\/hooks\. 1 runs an agent prompt, which uses credits each time the hook fires; 1 runs a script and uses none$/);
    assert.match(built.notes[1].message, /^1 hook differs from a one to one conversion \(git-push-review\); details\.hooks\.adapted says why$/);
    const one = build([hook('python-lint', SAVE)]);
    assert.match(one.notes[0].message, /^1 hook is installed switched off\. .* 1 runs an agent prompt, which uses credits each time the hook fires; 0 run a script and use none$/);
  });

  it('reports a hook it cannot convert with its code and its ECC path, and still converts the others', () => {
    const built = build([hook('bad-glob', { type: 'fileEdited', patterns: ['src/*.py'] }), hook('python-lint', SAVE), hook('bad-type', { type: 'sessionTeardown' })]);
    assert.deepEqual(built.problems.map((p) => [p.code, p.path]), [
      ['hook-glob-unsupported', '.kiro/hooks/bad-glob.kiro.hook'],
      ['hook-trigger-unknown', '.kiro/hooks/bad-type.kiro.hook'],
    ]);
    assert.deepEqual(built.planned.map((f) => f.dest), ['.kiro/hooks/ecc-python-lint.json']);
  });

  it('reports an ECC file that was not read, and one that is not text', () => {
    const { profile, sourceFiles } = fixture(Object.fromEntries([hook('python-lint', SAVE), hook('other', SAVE)]));
    sourceFiles.delete(legacyHookPath('other'));
    assert.deepEqual(buildPlanned({ parts: ['hooks'], profile, sourceFiles }).problems.map((p) => p.code), ['source-missing']);
    sourceFiles.set(legacyHookPath('other'), Buffer.from([0xff, 0xfe, 0x00]));
    assert.deepEqual(buildPlanned({ parts: ['hooks'], profile, sourceFiles }).problems.map((p) => p.code), ['source-encoding']);
  });

  it('refuses two hooks that would be written to one path', () => {
    const { profile, sourceFiles } = fixture({});
    const text = enc(legacyHookText({ name: 'same', when: SAVE, then: { type: 'askAgent', prompt: 'x' } }));
    for (const path of ['.kiro/hooks/same.kiro.hook', '.kiro/more/same.kiro.hook']) {
      profile.entries.push({ category: 'adapter-hook', name: 'same', path, sha256: sha256Hex(text) });
      sourceFiles.set(path, text);
    }
    const built = buildPlanned({ parts: ['hooks'], profile, sourceFiles });
    assert.ok(built.problems.some((p) => p.code === 'dest-duplicate' && p.path === '.kiro/hooks/ecc-same.json'), JSON.stringify(built.problems));
  });

  it('plans nothing, and says nothing, when the profile has no hooks', () => {
    const built = build([]);
    assert.deepEqual([built.planned, built.problems, built.notes], [[], [], []]);
    assert.deepEqual(built.details.hooks, { total: 0, converted: 0, disabled: 0, agentActions: 0, commandActions: 0, byTrigger: {}, adapted: [], skipped: [], scripts: [] });
  });
});

describe('buildPlanned: several parts and bad plans', () => {
  it('builds agents and skills together, sorted by destination', () => {
    const { profile, sourceFiles } = fixture({
      'agents/planner.md': enc('---\nname: planner\ndescription: Plans.\ntools: Read\n---\nbody\n'),
      'skills/s/SKILL.md': enc(skillMd('s')),
    });
    const built = buildPlanned({ parts: ['agents', 'skills'], profile, sourceFiles });
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.planned.map((f) => f.dest), ['.kiro/agents/planner.md', '.kiro/skills/s/SKILL.md']);
    assert.deepEqual(Object.keys(built.details), ['skills']);
  });

  it('only builds the parts it is asked for', () => {
    const { profile, sourceFiles } = fixture({
      'agents/planner.md': enc('---\nname: planner\ndescription: Plans.\ntools: Read\n---\nbody\n'),
      'skills/s/SKILL.md': enc(skillMd('s')),
    });
    const built = buildPlanned({ parts: ['skills'], profile, sourceFiles });
    assert.deepEqual(built.planned.map((f) => f.category), ['skill']);
  });

  it('reports a source file that was not read', () => {
    const { profile } = fixture({ 'agents/planner.md': enc('x'), 'skills/s/SKILL.md': enc(skillMd('s')) });
    const built = buildPlanned({ parts: ['agents'], profile, sourceFiles: new Map() });
    assert.deepEqual(built.problems.map((p) => p.code), ['source-missing']);
  });

  it('refuses a plan where two files would land in one place', () => {
    const { profile, sourceFiles } = fixture({
      'skills/s/SKILL.md': enc(skillMd('s')),
      '.agents/skills/s/SKILL.md': enc(skillMd('s')),
    });
    const built = buildPlanned({ parts: ['skills'], profile, sourceFiles });
    assert.ok(built.problems.some((p) => p.code === 'dest-duplicate' && p.path === '.kiro/skills/s/SKILL.md'));
  });

  it('refuses a destination the installer must not use', () => {
    const { profile, sourceFiles } = fixture({ 'skills/s/SKILL.md': enc(skillMd('s')), 'skills/s/x.md': enc('x') });
    profile.entries.find((e) => e.rel === 'x.md').rel = '../../settings/mcp.json';
    const built = buildPlanned({ parts: ['skills'], profile, sourceFiles });
    assert.ok(built.problems.some((p) => p.code === 'dest-unsafe' && /settings/.test(p.message)), JSON.stringify(built.problems));
  });
  it('refuses a destination in the folder of this skill', () => {
    const { profile, sourceFiles } = fixture({ 'skills/ecc-kiro-setup/SKILL.md': enc(skillMd('ecc-kiro-setup')), 'skills/ecc-kiro-setup/x.md': enc('x') });
    const built = buildPlanned({ parts: ['skills'], profile, sourceFiles });
    const unsafe = built.problems.filter((p) => p.code === 'dest-unsafe');
    assert.deepEqual(unsafe.map((p) => p.path), ['.kiro/skills/ecc-kiro-setup/SKILL.md', '.kiro/skills/ecc-kiro-setup/x.md']);
    assert.ok(unsafe.every((p) => /ecc-kiro-setup skill itself/.test(p.message)), JSON.stringify(unsafe));
  });
});

describe('buildPlanned: mcp', () => {
  const CATALOG = 'mcp-configs/mcp-servers.json';
  const ADAPTER = '.kiro/settings/mcp.json.example';
  const catalogText = JSON.stringify({
    mcpServers: {
      github: { command: 'npx', args: ['-y', '@example/github'], env: { TOKEN: 'YOUR_TOKEN_HERE' }, description: 'GitHub' },
      hosted: { type: 'http', url: 'https://mcp.example.com/mcp', description: 'Hosted' },
    },
    _comments: { usage: 'copy to ~/.claude.json' },
  });
  const adapterText = JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['-y', 'docs-mcp'], disabled: false, autoApprove: ['search'] } } });

  const withEntries = (files) => {
    const entries = Object.entries(files).map(([path, text]) => ({ category: path === CATALOG ? 'mcp-catalog' : 'adapter-mcp-example', path, sha256: sha256Hex(enc(text)) }));
    return { profile: { entries }, sourceFiles: new Map(Object.entries(files).map(([path, text]) => [path, enc(text)])) };
  };
  const build = (files = { [CATALOG]: catalogText, [ADAPTER]: adapterText }) => {
    const { profile, sourceFiles } = withEntries(files);
    return buildPlanned({ parts: ['mcp'], profile, sourceFiles });
  };

  it('plans the example and the table in .kiro/ecc, as one category and one part, from both sources', () => {
    const built = build();
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.planned.map((f) => f.dest), ['.kiro/ecc/mcp-servers.md', '.kiro/ecc/mcp.json.example']);
    for (const file of built.planned) {
      assert.equal(file.category, 'mcp');
      assert.equal(file.part, 'mcp');
      assert.deepEqual(file.source, [CATALOG, ADAPTER]);
      assert.equal(file.sha256, sha256Hex(file.content));
    }
    const example = JSON.parse(String(built.planned.find((f) => f.dest.endsWith('.example')).content));
    assert.deepEqual(Object.keys(example.mcpServers), ['github', 'hosted', 'docs']);
    assert.ok(Object.values(example.mcpServers).every((server) => server.disabled === true));
  });

  it('reports what it wrote and what it left out', () => {
    const built = build();
    assert.deepEqual(built.details.mcp, {
      servers: 3,
      fromCatalog: 2,
      fromAdapter: 1,
      local: 2,
      remote: 1,
      left: { autoApprove: 1, description: 2, type: 1 },
      files: ['.kiro/ecc/mcp.json.example', '.kiro/ecc/mcp-servers.md'],
    });
    assert.deepEqual(built.notes.map((n) => [n.level, n.code]), [['info', 'mcp-examples'], ['info', 'mcp-left-out']]);
    assert.match(built.notes[0].message, /^3 MCP servers are written to \.kiro\/ecc\/mcp\.json\.example, every one with "disabled": true, and a table of what they are to \.kiro\/ecc\/mcp-servers\.md\. Kiro reads neither file\. /);
    assert.match(built.notes[0].message, /copy its entry into \.kiro\/settings\/mcp\.json yourself; Kiro does not let the agent write there$/);
    assert.match(built.notes[1].message, /^left out of the entries: autoApprove \(1\), description \(2\), type \(1\)\. /);
  });

  it('says nothing about left-out fields when nothing was left out', () => {
    const built = build({ [CATALOG]: '{"mcpServers": {"a": {"command": "a"}}}', [ADAPTER]: '{"mcpServers": {}}' });
    assert.deepEqual(built.notes.map((n) => n.code), ['mcp-examples']);
    assert.deepEqual(built.details.mcp.left, {});
  });

  it('writes nothing under .kiro/settings', () => {
    assert.ok(build().planned.every((f) => !f.dest.startsWith('.kiro/settings')));
  });

  it('stops when either source is not in the profile, naming it', () => {
    const only = (path) => {
      const files = { [CATALOG]: catalogText, [ADAPTER]: adapterText };
      return build({ [path]: files[path] });
    };
    const noAdapter = only(CATALOG);
    assert.deepEqual(noAdapter.problems.map((p) => p.code), ['mcp-source-missing']);
    assert.match(noAdapter.problems[0].message, /no adapter-mcp-example file/);
    assert.deepEqual(noAdapter.planned, []);
    assert.match(only(ADAPTER).problems[0].message, /no mcp-catalog file/);
  });

  it('stops when a source was not read, is not UTF-8, or does not convert', () => {
    const { profile, sourceFiles } = withEntries({ [CATALOG]: catalogText, [ADAPTER]: adapterText });
    sourceFiles.delete(CATALOG);
    assert.deepEqual(buildPlanned({ parts: ['mcp'], profile, sourceFiles }).problems.map((p) => p.code), ['source-missing']);
    sourceFiles.set(CATALOG, Buffer.from([0xff, 0xfe]));
    assert.deepEqual(buildPlanned({ parts: ['mcp'], profile, sourceFiles }).problems.map((p) => [p.code, p.path]), [['source-encoding', CATALOG]]);

    const broken = build({ [CATALOG]: '{"mcpServers": {"a": {"command": "a", "surprise": 1}}}', [ADAPTER]: adapterText });
    assert.deepEqual(broken.problems.map((p) => p.code), ['mcp-unknown-field']);
    assert.deepEqual(broken.planned, []);
  });
});

describe('buildPlanned: license', () => {
  const LICENSE = Buffer.from('MIT License\nCopyright (c) 2026 Somebody\n', 'utf8');
  const profile = { entries: [{ category: 'license', path: 'LICENSE', sha256: sha256Hex(LICENSE) }] };
  const build = (overrides = {}) => buildPlanned({ parts: ['license'], profile, sourceFiles: new Map([['LICENSE', LICENSE]]), ...overrides });

  it('copies the LICENSE byte for byte and writes the notices beside it', () => {
    const built = build();
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.planned.map((f) => f.dest), ['.kiro/ecc/LICENSE', '.kiro/ecc/THIRD_PARTY_NOTICES.md']);
    const [license, notices] = built.planned;
    assert.ok(Buffer.from(license.content).equals(LICENSE));
    assert.equal(license.sha256, sha256Hex(LICENSE));
    assert.equal(license.source, 'LICENSE');
    assert.equal(notices.source, null, 'written here, not copied from ECC');
    assert.ok(String(notices.content).includes(`- sha256 of that LICENSE file: ${sha256Hex(LICENSE)}.`));
    for (const file of built.planned) assert.deepEqual([file.category, file.part], ['license', 'license']);
    assert.deepEqual(built.details.license, { files: ['.kiro/ecc/LICENSE', '.kiro/ecc/THIRD_PARTY_NOTICES.md'], licenseSha256: sha256Hex(LICENSE) });
  });

  it('stops without a LICENSE in the profile, or when it was not read', () => {
    const none = buildPlanned({ parts: ['license'], profile: { entries: [] }, sourceFiles: new Map() });
    assert.deepEqual(none.problems.map((p) => p.code), ['license-missing']);
    assert.deepEqual(none.planned, []);
    const unread = build({ sourceFiles: new Map() });
    assert.deepEqual(unread.problems.map((p) => [p.code, p.path]), [['source-missing', 'LICENSE']]);
  });
});

describe('buildPlanned: isolation', () => {
  const build = (harnessDirs) => buildPlanned({ parts: ['isolation'], profile: { entries: [] }, sourceFiles: new Map(), harnessDirs });

  it('plans one block in .kiroignore for the folders that exist, sorted, once each', () => {
    const built = build(['.kimi-code', '.claude', '.claude']);
    assert.deepEqual(built.problems, []);
    assert.equal(built.planned.length, 1);
    const [file] = built.planned;
    assert.deepEqual([file.dest, file.category, file.part, file.source], ['.kiroignore', 'kiroignore', 'isolation', null]);
    assert.equal(file.sha256, sha256Hex(file.content));
    assert.deepEqual(String(file.content).split('\n').slice(2, 4), ['.claude/', '.kimi-code/']);
    assert.deepEqual(built.details.isolation, { folders: ['.claude', '.kimi-code'], block: true });
  });

  it('tells the user about the IDE setting, because without it the IDE does not read the file', () => {
    const [note] = build(['.claude']).notes;
    assert.deepEqual([note.level, note.code], ['info', 'isolation-ide']);
    assert.match(note.message, /^a block in \.kiroignore asks Kiro to ignore \.claude\. The IDE reads only the ignore files named in its Agent Ignore Files setting \(kiroAgent\.agentIgnoreFiles\), so add \.kiroignore there\. /);
    assert.match(note.message, /kiro-cli 2\.28\.0 with --v3 did not enforce \.kiroignore in a headless test$/);
  });

  it('plans nothing when no other harness has a folder here, and leaves .kiroignore alone', () => {
    for (const none of [[], undefined]) {
      const built = none === undefined ? buildPlanned({ parts: ['isolation'], profile: { entries: [] }, sourceFiles: new Map() }) : build(none);
      assert.deepEqual(built.planned, []);
      assert.deepEqual(built.problems, []);
      assert.deepEqual(built.details.isolation, { folders: [], block: false });
      assert.deepEqual(built.notes.map((n) => n.code), ['isolation-none']);
    }
  });

  it('refuses a folder name that is not a known harness folder', () => {
    assert.throws(() => build(['.claude', 'src']), /not a known harness folder/);
  });
});
