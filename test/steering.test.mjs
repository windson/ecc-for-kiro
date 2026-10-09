import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CodedError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';
import {
  ADAPTER_PATCHES,
  INCLUSIONS,
  STEERING_DIR,
  STEERING_PREFIX,
  applyPatches,
  convertAdapterSteering,
  globProblem,
  globsFromPatternValue,
  rewriteSteeringReferences,
  steeringDest,
  steeringName,
  writeSteering,
} from '../skills/ecc-kiro-setup/scripts/lib/steering.mjs';

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CodedError, `expected a CodedError, got ${error}`);
    return error.code;
  }
  return assert.fail('expected a throw');
};

/** An adapter steering file as ECC ships it. */
const adapter = (frontmatter, body = '\n# Title\n\nSome rules.\n') => `---\n${frontmatter}\n---\n${body}`;

describe('names and places', () => {
  it('prefixes every steering file with ecc- and puts it in .kiro/steering', () => {
    assert.equal(STEERING_PREFIX, 'ecc-');
    assert.equal(STEERING_DIR, '.kiro/steering');
    assert.equal(steeringName('coding-style'), 'ecc-coding-style');
    assert.equal(steeringDest('coding-style'), '.kiro/steering/ecc-coding-style.md');
  });

  it('knows the four inclusion modes Kiro documents', () => {
    assert.deepEqual([...INCLUSIONS], ['always', 'fileMatch', 'manual', 'auto']);
  });
});

describe('writeSteering', () => {
  it('writes an always-on file with plain words for the mode and the name, and a quoted description', () => {
    const text = writeSteering({ inclusion: 'always', name: 'ecc-testing', description: 'Testing rules: 80% coverage.', body: '\n# Testing\n' });
    assert.equal(text, '---\ninclusion: always\nname: ecc-testing\ndescription: "Testing rules: 80% coverage."\n---\n\n# Testing\n');
  });

  it('writes the patterns of a fileMatch file as a one-line list', () => {
    const text = writeSteering({ inclusion: 'fileMatch', patterns: ['**/*.ts', '**/*.tsx'], description: 'TS', body: '\nBody\n' });
    assert.equal(text, '---\ninclusion: fileMatch\nfileMatchPattern: ["**/*.ts", "**/*.tsx"]\ndescription: "TS"\n---\n\nBody\n');
  });

  it('writes a manual file with only a description', () => {
    assert.equal(writeSteering({ inclusion: 'manual', description: 'A mode', body: '\nBody\n' }), '---\ninclusion: manual\ndescription: "A mode"\n---\n\nBody\n');
  });

  it('writes an auto file when it has the name and description Kiro requires', () => {
    const text = writeSteering({ inclusion: 'auto', name: 'api-design', description: 'API design. Use for endpoints.', body: '\nBody\n' });
    assert.deepEqual(parseFrontmatter(text).data, { inclusion: 'auto', name: 'api-design', description: 'API design. Use for endpoints.' });
  });

  it('starts with the frontmatter and separates it from the body with one blank line', () => {
    const noBlank = writeSteering({ inclusion: 'manual', body: '# Title\n' });
    const blank = writeSteering({ inclusion: 'manual', body: '\n# Title\n' });
    assert.equal(noBlank, blank);
    assert.ok(noBlank.startsWith('---\ninclusion: manual\n---\n\n# Title'));
  });

  it('reads back as the same data, whatever the description holds', () => {
    const awkward = 'Has a colon: yes, "quotes", a *star*, a # hash, and @mention';
    for (const input of [
      { inclusion: 'always', name: 'ecc-x', description: awkward },
      { inclusion: 'fileMatch', patterns: ['**/*.component.ts', '**/pages/**'], description: awkward },
      { inclusion: 'manual', description: awkward },
    ]) {
      const parsed = parseFrontmatter(writeSteering({ ...input, body: '\nBody\n' }));
      assert.equal(parsed.hasFrontmatter, true);
      assert.equal(parsed.data.inclusion, input.inclusion);
      assert.equal(parsed.data.description, awkward);
      if (input.patterns) assert.deepEqual(parsed.data.fileMatchPattern, input.patterns);
      assert.equal(parsed.body, '\nBody\n');
    }
  });

  it('refuses combinations Kiro would misread', () => {
    assert.throws(() => writeSteering({ inclusion: 'sometimes', body: '' }), /unknown inclusion/);
    assert.throws(() => writeSteering({ inclusion: 'fileMatch', body: '' }), /at least one pattern/);
    assert.throws(() => writeSteering({ inclusion: 'fileMatch', patterns: [], body: '' }), /at least one pattern/);
    assert.throws(() => writeSteering({ inclusion: 'always', patterns: ['**/*.ts'], body: '' }), /only belong in a fileMatch file/);
    assert.throws(() => writeSteering({ inclusion: 'auto', name: 'x', body: '' }), /needs a name and a description/);
    assert.throws(() => writeSteering({ inclusion: 'always', name: 'Bad Name', body: '' }), /invalid steering name/);
  });
});

describe('globProblem', () => {
  it('accepts the globs ECC uses', () => {
    for (const glob of ['**/*.ts', '**/*.component.ts', '**/nuxt.config.*', '**/pages/**', '**/appsettings*.json', '**/__tests__/**/*.tsx', '**/use-*.ts', '*.py', '**/{a}']) {
      assert.equal(globProblem(glob), null, glob);
    }
  });

  it('rejects what Kiro cannot match or what could leave the project', () => {
    assert.match(globProblem(''), /empty/);
    assert.match(globProblem(undefined), /empty/);
    assert.match(globProblem(42), /empty/);
    assert.match(globProblem('a'.repeat(201)), /longer than 200/);
    assert.match(globProblem('**/*.ts or *.js'), /whitespace/);
    assert.match(globProblem('src\\*.ts'), /backslash/);
    assert.match(globProblem('a\u0000b'), /control character/);
    assert.match(globProblem('/etc/*.conf'), /relative/);
    assert.match(globProblem('../x/*.ts'), /stay inside/);
    assert.match(globProblem('src/../x'), /stay inside/);
    assert.match(globProblem('*.ts,*.tsx'), /comma/);
    assert.match(globProblem('**/*.[ch'), /unbalanced \[\]/);
    assert.match(globProblem('**/{a'), /unbalanced \{\}/);
  });
});

describe('globsFromPatternValue', () => {
  const where = 'x.md';

  it('turns ECC\'s comma-joined string into a list, with ** in front of a pattern that has no folder part', () => {
    assert.deepEqual(globsFromPatternValue('*.ts,*.tsx', where), ['**/*.ts', '**/*.tsx']);
    assert.deepEqual(globsFromPatternValue('*.cpp,*.hpp,*.h,*.cc,*.cxx', where), ['**/*.cpp', '**/*.hpp', '**/*.h', '**/*.cc', '**/*.cxx']);
    assert.deepEqual(globsFromPatternValue('*.py', where), ['**/*.py']);
  });

  it('trims blanks, keeps patterns that already name a folder, and lists each once', () => {
    assert.deepEqual(globsFromPatternValue(' *.ts , src/**/*.ts , **/*.ts, *.ts ', where), ['**/*.ts', 'src/**/*.ts']);
  });

  it('accepts a list, which Kiro already understands', () => {
    assert.deepEqual(globsFromPatternValue(['*.go', 'cmd/**'], where), ['**/*.go', 'cmd/**']);
  });

  it('stops on a value it cannot use, naming the file', () => {
    for (const bad of ['', ' , ', '*.ts,,*.tsx', '/abs/*.ts', '../*.ts', 'a b', 42, null, {}, [1], ['a,b']]) {
      assert.equal(codeOf(() => globsFromPatternValue(bad, where)), 'steering-pattern', JSON.stringify(bad));
    }
    assert.throws(() => globsFromPatternValue('/abs', 'steering/x.md'), /steering\/x\.md: the pattern "\/abs"/);
  });
});

describe('rewriteSteeringReferences', () => {
  const known = new Set(['dev-mode', 'review-mode', 'coding-style']);

  it('points #name references at the installed names and counts them', () => {
    const { text, count } = rewriteSteeringReferences('Use `#dev-mode` to start.\nOr (#review-mode).\n', known);
    assert.equal(text, 'Use `#ecc-dev-mode` to start.\nOr (#ecc-review-mode).\n');
    assert.equal(count, 2);
  });

  it('leaves names that are not steering files, headings, and names that are part of something longer', () => {
    const input = ['# dev-mode', '## Heading', 'See #other-mode and #dev-mode-extra and issue#dev-mode and [a](#dev-mode) and &#dev-mode;', '#1'].join('\n');
    const { text, count } = rewriteSteeringReferences(input, known);
    assert.equal(count, 0);
    assert.equal(text, input);
  });

  it('does not rewrite twice: an installed name is not in the known set', () => {
    const once = rewriteSteeringReferences('`#dev-mode`', known).text;
    assert.equal(rewriteSteeringReferences(once, known).count, 0);
  });
});

describe('applyPatches', () => {
  const patch = { find: /^OLD$/m, replace: 'NEW $& text', why: 'a test' };

  it('replaces text that occurs exactly once, taking the replacement literally', () => {
    assert.equal(applyPatches('a\nOLD\nb\n', [patch], 'f.md'), 'a\nNEW $& text\nb\n');
  });

  it('stops when the text is missing or occurs twice', () => {
    assert.equal(codeOf(() => applyPatches('nothing here\n', [patch], 'f.md')), 'steering-patch-missed');
    assert.equal(codeOf(() => applyPatches('OLD\nOLD\n', [patch], 'f.md')), 'steering-patch-missed');
    assert.throws(() => applyPatches('x', [patch], 'f.md'), /f\.md: expected to find the text to rewrite \(a test\) once, found it 0 times/);
  });

  it('applies several patches in order', () => {
    const second = { find: /^NEW/m, replace: 'DONE', why: 'second' };
    assert.equal(applyPatches('OLD\n', [{ find: /^OLD$/m, replace: 'NEW', why: 'first' }, second], 'f.md'), 'DONE\n');
  });

  it('is only used for the two files that need it, each with a reason', () => {
    assert.deepEqual(Object.keys(ADAPTER_PATCHES).sort(), ['git-workflow', 'lessons-learned']);
    for (const patches of Object.values(ADAPTER_PATCHES)) {
      for (const item of patches) {
        assert.ok(item.find instanceof RegExp);
        assert.equal(typeof item.replace, 'string');
        assert.ok(item.why.length > 10);
      }
    }
  });
});

describe('convertAdapterSteering', () => {
  const run = (path, text, known) => convertAdapterSteering({ path, text, known });

  it('turns an auto file into an always-on file with the ecc- name', () => {
    const body = '\n# Coding Style\n\nALWAYS do it.\n';
    const result = run('.kiro/steering/coding-style.md', adapter('inclusion: auto\nname: coding-style\ndescription: Core rules.', body));
    assert.equal(result.inclusion, 'always');
    assert.equal(result.name, 'ecc-coding-style');
    assert.equal(result.dest, '.kiro/steering/ecc-coding-style.md');
    assert.equal(result.patterns, null);
    assert.equal(result.description, 'Core rules.');
    const parsed = parseFrontmatter(result.content);
    assert.deepEqual(parsed.data, { inclusion: 'always', name: 'ecc-coding-style', description: 'Core rules.' });
    assert.equal(parsed.body, body, 'the body is copied unchanged');
    assert.ok(result.content.startsWith('---\n'));
  });

  it('keeps a file that is already always-on, and works without a name or description', () => {
    const result = run('.kiro/steering/testing.md', adapter('inclusion: always'));
    assert.equal(result.inclusion, 'always');
    assert.deepEqual(parseFrontmatter(result.content).data, { inclusion: 'always', name: 'ecc-testing' });
    assert.equal(result.description, null);
  });

  it('turns a comma-joined fileMatchPattern into a list and writes no name', () => {
    const result = run('.kiro/steering/typescript-patterns.md', adapter('inclusion: fileMatch\nfileMatchPattern: "*.ts,*.tsx"\ndescription: TS patterns'));
    assert.equal(result.inclusion, 'fileMatch');
    assert.deepEqual(result.patterns, ['**/*.ts', '**/*.tsx']);
    assert.deepEqual(parseFrontmatter(result.content).data, {
      inclusion: 'fileMatch',
      fileMatchPattern: ['**/*.ts', '**/*.tsx'],
      description: 'TS patterns',
    });
    assert.match(result.content, /^---\ninclusion: fileMatch\nfileMatchPattern: \["\*\*\/\*\.ts", "\*\*\/\*\.tsx"\]\n/);
  });

  it('keeps a manual file manual and points its #name reference at the ecc- name', () => {
    const known = new Set(['dev-mode']);
    const body = '\n# Development Mode\n\n## Invocation\n\nUse `#dev-mode` to activate this context.\n';
    const result = run('.kiro/steering/dev-mode.md', adapter('inclusion: manual\ndescription: Dev mode', body), known);
    assert.equal(result.inclusion, 'manual');
    assert.equal(result.references, 1);
    assert.deepEqual(parseFrontmatter(result.content).data, { inclusion: 'manual', description: 'Dev mode' });
    assert.ok(result.content.endsWith('Use `#ecc-dev-mode` to activate this context.\n'));
  });

  it('removes the note about Claude settings from git-workflow and nothing else', () => {
    const body = '\n# Git Workflow\n\nTypes: feat, fix\n\nNote: ECC-managed installs set `"x": false` in `~/.claude/settings.json`, so commits carry no trailer.\n\n## Pull Request Workflow\n\nSteps.\n';
    const result = run('.kiro/steering/git-workflow.md', adapter('inclusion: auto\nname: git-workflow\ndescription: Git', body));
    assert.equal(parseFrontmatter(result.content).body, '\n# Git Workflow\n\nTypes: feat, fix\n\n## Pull Request Workflow\n\nSteps.\n');
    assert.equal(result.patched, true);
  });

  it('replaces the adapter\'s hook lessons in lessons-learned with a note on the installer', () => {
    const body = [
      '',
      '# Lessons Learned',
      '',
      '1. The `extract-patterns` hook will suggest patterns after agent sessions',
      '2. Review suggestions',
      '',
      '---',
      '',
      '## Kiro Hooks',
      '',
      '### `install.sh` is additive-only',
      'The installer skips files.',
      '',
      '### Prefer `askAgent`',
      'Reasons.',
      '',
      '---',
      '',
      '## Common Pitfalls',
      '',
      'Keep this.',
      '',
    ].join('\n');
    const result = run('.kiro/steering/lessons-learned.md', adapter('inclusion: auto\nname: lessons-learned\ndescription: Lessons', body));
    const out = parseFrontmatter(result.content).body;
    assert.match(out, /^1\. If you turn on the `ecc-extract-patterns` hook, it suggests patterns after agent sessions$/m);
    assert.doesNotMatch(out, /install\.sh|askAgent|Kiro Hooks/);
    assert.match(out, /## ECC Install\n\n### Your edits are kept\nThe ECC installer only updates files it installed and you did not edit\./);
    assert.match(out, /meant to be edited\.\n\n---\n\n## Common Pitfalls\n\nKeep this\.\n$/);
    assert.match(out, /^2\. Review suggestions$/m);
  });

  it('stops when the text a patch is meant to fix is not there', () => {
    assert.equal(codeOf(() => run('.kiro/steering/git-workflow.md', adapter('inclusion: auto\nname: git-workflow'))), 'steering-patch-missed');
  });

  it('copies the body of an unpatched file byte for byte', () => {
    const body = '\n# Rules\r\n\r\nWindows line breaks, a trailing space \nand a tab\t\n\n\n';
    const result = run('.kiro/steering/security.md', adapter('inclusion: auto\nname: security', body));
    assert.equal(parseFrontmatter(result.content).body, body);
  });

  it('stops on a file it does not understand, naming it', () => {
    const cases = [
      ['no frontmatter\n', 'steering-frontmatter'],
      ['---\ninclusion: auto\nname: [unclosed\n---\n', 'steering-frontmatter'],
      [adapter('inclusion: auto\nname: coding-style\nextra: 1'), 'steering-key-unknown'],
      [adapter('inclusion: auto\nname: other-name'), 'steering-name'],
      [adapter('name: coding-style'), 'steering-inclusion'],
      [adapter('inclusion: sometimes'), 'steering-inclusion'],
      [adapter('inclusion: fileMatch'), 'steering-pattern'],
      [adapter('inclusion: fileMatch\nfileMatchPattern: ""'), 'steering-pattern'],
      [adapter('inclusion: manual\nfileMatchPattern: "*.py"'), 'steering-pattern'],
      [adapter('inclusion: auto\nfileMatchPattern: "*.py"'), 'steering-pattern'],
      [adapter('inclusion: manual\ndescription: ""'), 'steering-description'],
      [adapter('inclusion: manual\ndescription: [a]'), 'steering-description'],
    ];
    for (const [text, code] of cases) assert.equal(codeOf(() => run('.kiro/steering/coding-style.md', text)), code, text);
    assert.equal(codeOf(() => run('.kiro/steering/Bad_Name.md', adapter('inclusion: manual'))), 'steering-name');
    assert.throws(() => run('.kiro/steering/coding-style.md', 'no frontmatter\n'), { code: 'steering-frontmatter', message: '.kiro/steering/coding-style.md: the file has no frontmatter' });
  });

  it('does not change the set of known names it was given', () => {
    const known = new Set(['dev-mode']);
    run('.kiro/steering/dev-mode.md', adapter('inclusion: manual'), known);
    assert.deepEqual([...known], ['dev-mode']);
  });
});
