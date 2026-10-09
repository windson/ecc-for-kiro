import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CodedError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';
import {
  LANGUAGE_GLOBS_SCHEMA,
  PACKS,
  buildRulePack,
  packStem,
  parseRuleFile,
  rewriteRuleLinks,
  unionGlobs,
  validateLanguageGlobs,
} from '../skills/ecc-kiro-setup/scripts/lib/rule-packs.mjs';

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CodedError, `expected a CodedError, got ${error}`);
    return error.code;
  }
  return assert.fail('expected a throw');
};

/** A rule file as ECC ships it: a `paths:` block list, then the body. */
const rule = (paths, body) => `---\npaths:\n${paths.map((item) => `  - "${item}"`).join('\n')}\n---\n${body}`;

const STEERING = new Set(['coding-style', 'patterns', 'security', 'testing', 'performance', 'typescript-patterns', 'typescript-security']);
const SKILLS = new Set(['e2e-testing']);
const context = (extra = {}) => ({ where: 'rules/x/a.md', steering: STEERING, skills: SKILLS, siblings: new Map([['hooks.md', '#x-hooks']]), ...extra });

describe('the packs', () => {
  it('are the eleven ECC rule packs the Kiro adapter has no steering for', () => {
    assert.deepEqual(Object.keys(PACKS).sort(), ['angular', 'arkts', 'csharp', 'dart', 'fsharp', 'nuxt', 'perl', 'react', 'react-native', 'vue', 'web']);
    assert.ok(Object.isFrozen(PACKS));
  });

  it('give each pack a steering stem that cannot clash with a command named after a language', () => {
    assert.equal(packStem('react'), 'react-rules');
    assert.equal(packStem('react-native'), 'react-native-rules');
  });
});

describe('validateLanguageGlobs', () => {
  const good = { schema: LANGUAGE_GLOBS_SCHEMA, packs: { vue: ['**/*.vue'], perl: ['**/*.pl', '**/*.pm'] } };

  it('accepts a file that lists known packs with real globs, and an empty list of packs', () => {
    assert.deepEqual(validateLanguageGlobs(good), []);
    assert.deepEqual(validateLanguageGlobs({ schema: LANGUAGE_GLOBS_SCHEMA, packs: {} }), []);
  });

  it('reports what is wrong, in words', () => {
    const messages = (value) => validateLanguageGlobs(value).map((problem) => problem.message);
    assert.deepEqual(messages(null), ['the file must be a JSON object']);
    assert.deepEqual(messages([]), ['the file must be a JSON object']);
    assert.match(messages({ schema: 'other', packs: {} })[0], /unsupported schema "other"; expected ecc-kiro\.language-globs\.v1/);
    assert.match(messages({ schema: LANGUAGE_GLOBS_SCHEMA })[0], /"packs" must be an object/);
    assert.match(messages({ schema: LANGUAGE_GLOBS_SCHEMA, packs: [] })[0], /"packs" must be an object/);
    assert.match(messages({ ...good, packs: { python: ['**/*.py'] } })[0], /"python" is not a pack this build knows \(angular, /);
    assert.match(messages({ ...good, packs: { vue: [] } })[0], /"vue" needs a non-empty list of globs/);
    assert.match(messages({ ...good, packs: { vue: '**/*.vue' } })[0], /"vue" needs a non-empty list of globs/);
    assert.match(messages({ ...good, packs: { vue: ['**/*.vue', '../x'] } })[0], /"vue": the pattern "\.\.\/x" must be relative/);
  });

  it('does not take a pack name from the prototype', () => {
    const hostile = JSON.parse('{"schema": "ecc-kiro.language-globs.v1", "packs": {"__proto__": ["**/*.x"], "constructor": ["**/*.y"]}}');
    assert.equal(validateLanguageGlobs(hostile).length, 2);
  });

  it('reports every problem, with the code the command uses', () => {
    const problems = validateLanguageGlobs({ schema: 'x', packs: { nope: [], vue: [''] } });
    assert.equal(problems.length, 3);
    assert.ok(problems.every((problem) => problem.code === 'language-globs-invalid'));
  });
});

describe('parseRuleFile', () => {
  const file = (text) => ({ path: 'rules/perl/coding-style.md', text });

  it('reads the paths and keeps the body, without blank lines at either end', () => {
    const parsed = parseRuleFile(file(rule(['**/*.pl', '**/*.pm'], '\n\n# Perl Coding Style\n\nText.\n\n\n')));
    assert.deepEqual(parsed.paths, ['**/*.pl', '**/*.pm']);
    assert.equal(parsed.body, '# Perl Coding Style\n\nText.\n');
  });

  it('accepts a body that starts right after the frontmatter', () => {
    assert.equal(parseRuleFile(file(rule(['**/*.pl'], '# Title\n'))).body, '# Title\n');
  });

  it('stops on a rule it cannot place, naming the file', () => {
    assert.equal(codeOf(() => parseRuleFile(file('# no frontmatter\n'))), 'rule-paths');
    assert.equal(codeOf(() => parseRuleFile(file('---\npaths: [unclosed\n---\n'))), 'rule-frontmatter');
    assert.equal(codeOf(() => parseRuleFile(file('---\ntitle: x\n---\nbody\n'))), 'rule-key-unknown');
    assert.equal(codeOf(() => parseRuleFile(file('---\npaths:\n---\nbody\n'))), 'rule-paths');
    assert.equal(codeOf(() => parseRuleFile(file('---\npaths: "**/*.pl"\n---\nbody\n'))), 'rule-paths');
    assert.equal(codeOf(() => parseRuleFile(file('---\npaths: []\n---\nbody\n'))), 'rule-paths');
    assert.equal(codeOf(() => parseRuleFile(file(rule(['**/*.pl', '/abs'], 'x\n')))), 'rule-paths');
    assert.throws(() => parseRuleFile(file('# no frontmatter\n')), { message: 'rules/perl/coding-style.md: the rule has no frontmatter, so it names no file paths' });
  });
});

describe('rewriteRuleLinks', () => {
  const run = (text, extra) => rewriteRuleLinks(text, context(extra));

  it('points a link to a common rule at the steering file that holds it', () => {
    const { text, mapped, unlinked } = run('> This file extends [common/security.md](../common/security.md) with X.\n');
    assert.equal(text, '> This file extends [ecc-security](ecc-security.md) with X.\n');
    assert.deepEqual([mapped, unlinked], [1, 0]);
  });

  it('maps typescript rules the adapter has, and unlinks the ones it has not', () => {
    const { text, mapped, unlinked } = run('Extends [typescript/patterns.md](../typescript/patterns.md) and [typescript/coding-style.md](../typescript/coding-style.md).\n');
    assert.equal(text, 'Extends [ecc-typescript-patterns](ecc-typescript-patterns.md) and typescript/coding-style.md.\n');
    assert.deepEqual([mapped, unlinked], [1, 1]);
  });

  it('points the common hooks rule, which is about Claude hooks, at the harness note', () => {
    assert.equal(run('[common/hooks.md](../common/hooks.md)\n').text, '[ecc-kiro-harness](ecc-kiro-harness.md)\n');
  });

  it('turns a link to a common rule that is not installed into plain text', () => {
    const { text, unlinked } = run('See [common/agents.md](../common/agents.md) and [common/code-review.md](../common/code-review.md).\n');
    assert.equal(text, 'See common/agents.md and common/code-review.md.\n');
    assert.equal(unlinked, 2);
  });

  it('points a link to a skill at the installed skill, or drops it when the skill is not installed', () => {
    assert.equal(run('See [e2e-testing skill](../../skills/e2e-testing/SKILL.md).\n').text, 'See [e2e-testing skill](../skills/e2e-testing/SKILL.md).\n');
    assert.equal(run('See [other skill](../../skills/other/SKILL.md).\n').text, 'See other skill.\n');
  });

  it('points a link to a sibling rule of the same pack at that rule\'s heading in the same file', () => {
    assert.equal(run('See [hooks.md](./hooks.md) and [hooks.md](hooks.md).\n').text, 'See [hooks.md](#x-hooks) and [hooks.md](#x-hooks).\n');
  });

  it('leaves web links, anchors, empty links and code alone', () => {
    const input = [
      'A [site](https://example.com/a.md) and [mail](mailto:a@b.c) and [here](#top) and [empty]().',
      'A code span `arr[0](x)` and `[c](../common/x.md)`.',
      '```js',
      'handlers[event](payload); // [x](../common/security.md)',
      '```',
      '~~~',
      '[y](../common/testing.md)',
      '~~~',
      '',
    ].join('\n');
    const { text, mapped, unlinked } = run(input);
    assert.equal(text, input);
    assert.deepEqual([mapped, unlinked], [0, 0]);
  });

  it('rewrites links after a fenced block has closed, and a link whose label has code in it', () => {
    const input = ['```', '[a](../common/security.md)', '```', 'Then [`security`](../common/security.md).', ''].join('\n');
    assert.equal(run(input).text, ['```', '[a](../common/security.md)', '```', 'Then [`security`](ecc-security.md).', ''].join('\n'));
  });

  it('is not fooled by a longer fence or by a different kind of fence inside one', () => {
    const input = ['````', '```', '[a](../common/security.md)', '```', '````', '[b](../common/testing.md)', ''].join('\n');
    assert.equal(run(input).text, ['````', '```', '[a](../common/security.md)', '```', '````', '[b](ecc-testing.md)', ''].join('\n'));
  });

  it('stops on a relative link it does not know, so a dead link cannot slip through', () => {
    for (const bad of ['[x](../../README.md)', '[x](./missing.md)', '[x](other/file.md)', '[x](../common/security.md#secrets)', '[x](../a/b/c.md)', '[x](../common/Sec.md)']) {
      assert.equal(codeOf(() => run(`${bad}\n`)), 'rule-link-unknown', bad);
    }
    assert.throws(() => run('[x](./missing.md)\n'), { message: 'rules/x/a.md: cannot place the link to "./missing.md"' });
  });

  it('counts what it changed', () => {
    const { mapped, unlinked } = run('[a](../common/security.md) [b](../common/agents.md) [c](./hooks.md) [d](https://x.y)\n');
    assert.deepEqual([mapped, unlinked], [2, 1]);
  });
});

describe('unionGlobs', () => {
  it('lists each pattern once, in the order first seen', () => {
    assert.deepEqual(unionGlobs([['a', 'b'], ['b', 'c'], ['a', 'd']]), ['a', 'b', 'c', 'd']);
    assert.deepEqual(unionGlobs([]), []);
  });
});

describe('buildRulePack', () => {
  const files = [
    { path: 'rules/perl/testing.md', file: 'testing.md', text: rule(['**/*.t'], '# Perl Testing\n\n> This file extends [common/testing.md](../common/testing.md) with Perl.\n') },
    { path: 'rules/perl/coding-style.md', file: 'coding-style.md', text: rule(['**/*.pl', '**/*.pm'], '# Perl Coding Style\n\n> This file extends [common/coding-style.md](../common/coding-style.md) with Perl.\n\nSee [testing.md](./testing.md).\n') },
    { path: 'rules/perl/hooks.md', file: 'hooks.md', text: rule(['**/*.pl'], '# Perl Hooks\n\n## PostToolUse Hooks\nConfigure in `~/.claude/settings.json`:\n- perltidy\n') },
  ];
  const build = (extra = {}) => buildRulePack({ pack: 'perl', files, steering: STEERING, skills: SKILLS, ...extra });

  it('makes one fileMatch steering file named after the pack', () => {
    const pack = build();
    assert.equal(pack.name, 'ecc-perl-rules');
    assert.equal(pack.dest, '.kiro/steering/ecc-perl-rules.md');
    assert.equal(pack.inclusion, 'fileMatch');
    assert.equal(pack.files, 3);
    assert.deepEqual(pack.sources, ['rules/perl/coding-style.md', 'rules/perl/hooks.md', 'rules/perl/testing.md']);
    assert.ok(pack.content.startsWith('---\ninclusion: fileMatch\nfileMatchPattern: ['));
  });

  it('matches the union of the paths of its files, in the order of the sorted files', () => {
    const pack = build();
    assert.deepEqual(pack.patterns, ['**/*.pl', '**/*.pm', '**/*.t']);
    assert.deepEqual(pack.derivedPatterns, pack.patterns);
    assert.equal(pack.overridden, false);
    assert.deepEqual(parseFrontmatter(pack.content).data.fileMatchPattern, ['**/*.pl', '**/*.pm', '**/*.t']);
  });

  it('lets the override file replace the derived patterns', () => {
    const pack = build({ override: ['**/*.perl'] });
    assert.deepEqual(pack.patterns, ['**/*.perl']);
    assert.deepEqual(pack.derivedPatterns, ['**/*.pl', '**/*.pm', '**/*.t']);
    assert.equal(pack.overridden, true);
    assert.deepEqual(parseFrontmatter(pack.content).data.fileMatchPattern, ['**/*.perl']);
  });

  it('describes the pack by its label and the topics of its files', () => {
    const { data } = parseFrontmatter(build().content);
    assert.equal(data.description, 'Perl rules from ECC: coding style, hooks, testing');
    assert.deepEqual(Object.keys(data), ['inclusion', 'fileMatchPattern', 'description']);
  });

  it('puts the rule files in file-name order, each with its own heading, after a one-line origin note', () => {
    const { body } = parseFrontmatter(build().content);
    const headings = body.split('\n').filter((line) => line.startsWith('# '));
    assert.deepEqual(headings, ['# Perl Coding Style', '# Perl Hooks', '# Perl Testing']);
    assert.match(body, /^\n> ECC rules for Perl \(coding style, hooks, testing\), from rules\/perl\/ in ECC v2\.2\.3\./);
  });

  it('fixes the links of every file, including a link between two files of the pack', () => {
    const { body } = parseFrontmatter(build().content);
    assert.match(body, /\[ecc-coding-style\]\(ecc-coding-style\.md\)/);
    assert.match(body, /\[ecc-testing\]\(ecc-testing\.md\)/);
    assert.match(body, /See \[testing\.md\]\(#perl-testing\)\./);
    assert.doesNotMatch(body, /\.\.\/common/);
    const pack = build();
    assert.deepEqual([pack.linksMapped, pack.linksUnlinked], [3, 0]);
  });

  it('says where Kiro hooks live instead of where Claude Code reads them, and warns that the examples use Claude names', () => {
    const pack = build();
    assert.doesNotMatch(pack.content, /~\/\.claude/);
    assert.match(pack.content, /Configure as Kiro hooks \(`\.kiro\/hooks\/\*\.json`\):/);
    assert.match(pack.content, /The hook examples use Claude Code names; ecc-kiro-harness explains how they map to Kiro hooks\./);
  });

  it('adds no hook warning to a pack that does not talk about Claude hooks', () => {
    const pack = buildRulePack({ pack: 'perl', files: files.slice(0, 2), steering: STEERING, skills: SKILLS });
    assert.doesNotMatch(pack.content, /hook examples/);
  });

  it('builds the same bytes whatever order the files arrive in', () => {
    assert.equal(build().content, buildRulePack({ pack: 'perl', files: [...files].reverse(), steering: STEERING, skills: SKILLS }).content);
  });

  it('ends with one line break and has no runs of blank lines at the seams', () => {
    const { content } = build();
    assert.ok(content.endsWith('\n') && !content.endsWith('\n\n'));
    assert.doesNotMatch(content, /\n\n\n/);
  });

  it('stops on a bad pack, an empty pack or a file it cannot read', () => {
    assert.throws(() => buildRulePack({ pack: 'python', files, steering: STEERING, skills: SKILLS }), /unknown pack "python"/);
    assert.equal(codeOf(() => buildRulePack({ pack: 'perl', files: [], steering: STEERING, skills: SKILLS })), 'pack-empty');
    const noPaths = [{ path: 'rules/perl/a.md', file: 'a.md', text: '# nothing\n' }];
    assert.equal(codeOf(() => buildRulePack({ pack: 'perl', files: noPaths, steering: STEERING, skills: SKILLS })), 'rule-paths');
    const badLink = [{ path: 'rules/perl/a.md', file: 'a.md', text: rule(['**/*.pl'], '[x](../weird/thing.txt)\n') }];
    assert.equal(codeOf(() => buildRulePack({ pack: 'perl', files: badLink, steering: STEERING, skills: SKILLS })), 'rule-link-unknown');
  });

  it('does not touch links inside code blocks', () => {
    const code = [{ path: 'rules/perl/a.md', file: 'a.md', text: rule(['**/*.pl'], '# A\n\n```\n[x](../common/security.md)\n```\n') }];
    assert.match(buildRulePack({ pack: 'perl', files: code, steering: STEERING, skills: SKILLS }).content, /\n\[x\]\(\.\.\/common\/security\.md\)\n/);
  });
});
