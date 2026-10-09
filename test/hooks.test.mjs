// The hook converter: the translator from file patterns to a matcher, the reader of a source hook,
// the mapping of triggers and actions, and the three hooks that are adapted by hand. Synthetic input.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CodedError } from '../skills/ecc-kiro-setup/scripts/lib/exit.mjs';
import { HOOK_TRIGGERS, LEGACY_TRIGGERS, validateHookFile } from '../skills/ecc-kiro-setup/scripts/lib/hook-schema.mjs';
import {
  ADAPTED_HOOKS,
  DOC_MATCHER,
  GUARD_COMMAND,
  GUARD_DEST,
  HOOK_DIR,
  TOOL_TYPES,
  convertHook,
  globsToMatcher,
  hookDest,
  hookName,
  parseLegacyHook,
  renderHookFile,
} from '../skills/ecc-kiro-setup/scripts/lib/hooks.mjs';
import { legacyHookPath, legacyHookText } from './hook-assets.mjs';

const convert = (spec) => convertHook({ path: legacyHookPath(spec.name), text: legacyHookText(spec) });
const failure = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CodedError, `expected a CodedError, got ${error}`);
    return error;
  }
  return assert.fail('expected the call to throw');
};
const agentThen = (prompt = 'Check the file.') => ({ type: 'askAgent', prompt });
const matches = (matcher, path) => new RegExp(matcher).test(path);

describe('globsToMatcher', () => {
  it('turns an extension pattern into a match on the end of the path', () => {
    assert.equal(globsToMatcher(['*.py']), '\\.py$');
    assert.equal(globsToMatcher(['*.rs']), '\\.rs$');
  });

  it('puts several extensions in one group, in the order given, once each', () => {
    assert.equal(globsToMatcher(['*.ts', '*.tsx', '*.js']), '\\.(ts|tsx|js)$');
    assert.equal(globsToMatcher(['*.js', '*.ts', '*.tsx']), '\\.(js|ts|tsx)$');
    assert.equal(globsToMatcher(['*.ts', '*.ts']), '\\.ts$');
  });

  it('turns a folder pattern into a match on a folder of that name anywhere in the path', () => {
    assert.equal(globsToMatcher(['**/auth/**']), '(^|/)auth/');
    assert.equal(globsToMatcher(['**/auth/**', '**/api/**', '**/middleware/**']), '(^|/)(auth|api|middleware)/');
  });

  it('escapes dots in a folder name', () => {
    assert.equal(globsToMatcher(['**/.github/**']), '(^|/)\\.github/');
    assert.equal(globsToMatcher(['**/a.b/**']), '(^|/)a\\.b/');
    assert.equal(matches(globsToMatcher(['**/a.b/**']), 'x/aXb/file'), false, 'the dot is a dot, not any character');
  });

  it('joins both shapes with an alternation', () => {
    assert.equal(globsToMatcher(['*.ts', '**/auth/**']), '\\.ts$|(^|/)auth/');
    assert.equal(globsToMatcher(['**/auth/**', '*.ts', '*.tsx']), '\\.(ts|tsx)$|(^|/)auth/');
  });

  it('gives a matcher that picks the same files as the patterns', () => {
    const ext = globsToMatcher(['*.ts', '*.tsx']);
    for (const path of ['a.ts', 'src/app/main.tsx', '/abs/path/x.ts', '.ts']) assert.equal(matches(ext, path), true, path);
    for (const path of ['main.tsx.bak', 'a.js', 'ts', 'a.tsx/b.md', 'atsx']) assert.equal(matches(ext, path), false, path);

    const dir = globsToMatcher(['**/auth/**', '**/api/**']);
    for (const path of ['auth/login.ts', 'src/auth/login.ts', '/home/u/p/src/api/v1/users.ts', 'api/x']) assert.equal(matches(dir, path), true, path);
    for (const path of ['src/authors/a.ts', 'src/oauth/a.ts', 'auth.ts', 'src/api', 'rapid/x', 'api']) assert.equal(matches(dir, path), false, path);
  });

  it('always gives a regular expression that compiles', () => {
    for (const globs of [['*.a'], ['*.a', '*.b'], ['**/x/**'], ['**/x.y/**', '**/z-w/**'], ['*.a', '**/_q/**']]) {
      assert.doesNotThrow(() => new RegExp(globsToMatcher(globs)), JSON.stringify(globs));
    }
  });

  it('refuses every other kind of pattern, naming it', () => {
    for (const glob of ['*', '**', '**/*.ts', 'src/*.ts', '*.{ts,tsx}', '*.d.ts', '?.ts', '!*.ts', '**/*', '**/../**', '**/./**', '**/**', '**/a/b/**', '*.', '.ts', '', ' *.ts', '*.ts ', 'a/**', '**/a', '*.t s', '**/a b/**']) {
      const error = failure(() => globsToMatcher([glob], 'hook'));
      assert.equal(error.code, 'hook-glob-unsupported', JSON.stringify(glob));
      assert.ok(error.message.includes(JSON.stringify(glob)), error.message);
      assert.match(error.message, /^hook: the pattern /);
      assert.match(error.fix, /adaptation in lib\/hooks\.mjs/);
    }
    for (const glob of [3, null, undefined, ['*.ts'], {}]) assert.equal(failure(() => globsToMatcher([glob])).code, 'hook-glob-unsupported', String(glob));
  });

  it('refuses one unsupported pattern in a list of good ones', () => {
    assert.equal(failure(() => globsToMatcher(['*.ts', 'src/*.js', '**/auth/**'])).code, 'hook-glob-unsupported');
  });

  it('wants a non-empty list', () => {
    for (const value of [undefined, null, [], '*.ts', {}]) assert.equal(failure(() => globsToMatcher(value)).code, 'hook-patterns', String(value));
  });
});

describe('parseLegacyHook', () => {
  const parse = (value, path = legacyHookPath('sample')) => parseLegacyHook({ path, text: typeof value === 'string' ? value : JSON.stringify(value) });
  const base = (extra = {}) => ({ name: 'sample', version: '1.0.0', enabled: true, description: 'A sample.', when: { type: 'fileEdited', patterns: ['*.py'] }, then: { type: 'askAgent', prompt: 'Check it.' }, ...extra });

  it('reads an agent hook and a command hook', () => {
    assert.deepEqual(parse(base()), {
      name: 'sample',
      description: 'A sample.',
      when: { type: 'fileEdited', patterns: ['*.py'], toolTypes: undefined },
      then: { kind: 'agent', text: 'Check it.' },
    });
    const run = parse(base({ when: { type: 'userTriggered' }, then: { type: 'runCommand', command: 'bash x.sh' } }));
    assert.deepEqual(run.then, { kind: 'command', text: 'bash x.sh' });
  });

  it('does not need a description', () => {
    const { description, ...rest } = base();
    assert.equal(parse(rest).description, undefined);
  });

  it('refuses text that is not JSON, and JSON that is not an object', () => {
    assert.equal(failure(() => parse('{ nope')).code, 'hook-json');
    for (const value of ['[]', '"x"', 'null', '3']) assert.equal(failure(() => parse(value)).code, 'hook-shape', value);
  });

  it('names the file in every error', () => {
    assert.match(failure(() => parse('{ nope')).message, /^\.kiro\/hooks\/sample\.kiro\.hook: not valid JSON/);
  });

  it('stops on a key it does not know, so a field added by a later release is not dropped by accident', () => {
    for (const [value, where] of [
      [base({ priority: 1 }), 'the hook'],
      [base({ when: { type: 'fileEdited', patterns: ['*.py'], debounce: 5 } }), '"when"'],
      [base({ then: { type: 'askAgent', prompt: 'x', model: 'y' } }), '"then"'],
    ]) {
      const error = failure(() => parse(value));
      assert.equal(error.code, 'hook-key-unknown');
      assert.ok(error.message.includes(`in ${where}`), error.message);
      assert.match(error.fix, /teach lib\/hooks\.mjs/);
    }
  });

  it('wants the name to equal the file name, and to be usable as one', () => {
    assert.equal(failure(() => parse(base({ name: 'other' }))).code, 'hook-name');
    assert.equal(failure(() => parse(base({ name: undefined }))).code, 'hook-name');
    assert.equal(failure(() => parse(base({ name: 'Bad_Name' }), legacyHookPath('Bad_Name'))).code, 'hook-name');
    assert.equal(failure(() => parse(base({ name: '../x' }), '.kiro/hooks/../x.kiro.hook')).code, 'hook-name');
  });

  it('wants a description that is text, patterns and tool types that are lists of text, and when and then with a type', () => {
    assert.equal(failure(() => parse(base({ description: 4 }))).code, 'hook-shape');
    assert.equal(failure(() => parse(base({ when: { type: 'fileEdited', patterns: '*.py' } }))).code, 'hook-shape');
    assert.equal(failure(() => parse(base({ when: { type: 'preToolUse', toolTypes: [1] } }))).code, 'hook-shape');
    assert.equal(failure(() => parse(base({ when: undefined }))).code, 'hook-shape');
    assert.equal(failure(() => parse(base({ when: {} }))).code, 'hook-shape');
    assert.equal(failure(() => parse(base({ then: undefined }))).code, 'hook-shape');
    assert.equal(failure(() => parse(base({ then: { prompt: 'x' } }))).code, 'hook-shape');
  });

  it('wants an action of askAgent with a prompt, or runCommand with a command', () => {
    assert.equal(failure(() => parse(base({ then: { type: 'sendEmail', prompt: 'x' } }))).code, 'hook-action');
    assert.equal(failure(() => parse(base({ then: { type: 'askAgent' } }))).code, 'hook-action');
    assert.equal(failure(() => parse(base({ then: { type: 'askAgent', prompt: '  ' } }))).code, 'hook-action');
    assert.equal(failure(() => parse(base({ then: { type: 'runCommand', prompt: 'x' } }))).code, 'hook-action');
    assert.equal(failure(() => parse(base({ then: { type: 'askAgent', prompt: 'x', command: 'y' } }))).code, 'hook-action');
    assert.match(failure(() => parse(base({ then: { type: 'sendEmail', prompt: 'x' } }))).message, /unknown action "sendEmail" \(expected askAgent or runCommand\)/);
  });
});

describe('convertHook: the mapping', () => {
  it('maps every 0.x type in Kiro\'s migration table to its v1 trigger, with the matcher that trigger takes', () => {
    const shapes = { path: { patterns: ['*.py'] }, tool: { toolTypes: ['write'] }, prompt: {}, null: {} };
    for (const [legacy, trigger] of Object.entries(LEGACY_TRIGGERS)) {
      const subject = HOOK_TRIGGERS[trigger].subject;
      const result = convert({ name: 'sample', when: { type: legacy, ...shapes[String(subject)] }, then: agentThen() });
      assert.equal(result.hook.trigger, trigger, legacy);
      assert.equal(result.hook.matcher !== undefined, subject === 'path' || subject === 'tool', `${legacy}: a matcher only where the trigger tests one`);
    }
  });

  it('turns file patterns into a matcher on a file trigger, and refuses tool types there', () => {
    const edited = convert({ name: 'sample', when: { type: 'fileEdited', patterns: ['*.ts', '*.tsx'] }, then: agentThen() });
    assert.deepEqual([edited.hook.trigger, edited.hook.matcher], ['PostFileSave', '\\.(ts|tsx)$']);
    const created = convert({ name: 'sample', when: { type: 'fileCreated', patterns: ['**/auth/**'] }, then: agentThen() });
    assert.deepEqual([created.hook.trigger, created.hook.matcher], ['PostFileCreate', '(^|/)auth/']);
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'fileEdited' }, then: agentThen() })).code, 'hook-patterns');
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'fileEdited', patterns: ['*.py'], toolTypes: ['write'] }, then: agentThen() })).code, 'hook-patterns');
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'fileEdited', patterns: ['src/*.py'] }, then: agentThen() })).code, 'hook-glob-unsupported');
  });

  it('turns tool types into a matcher on a tool trigger, and refuses file patterns there', () => {
    const post = convert({ name: 'sample', when: { type: 'postToolUse', toolTypes: ['write'] }, then: agentThen() });
    assert.deepEqual([post.hook.trigger, post.hook.matcher], ['PostToolUse', 'write']);
    const pre = convert({ name: 'sample', when: { type: 'preToolUse', toolTypes: ['read', 'write', 'read'] }, then: agentThen() });
    assert.equal(pre.hook.matcher, 'read|write', 'joined with |, once each');
    for (const type of TOOL_TYPES) assert.equal(convert({ name: 'sample', when: { type: 'postToolUse', toolTypes: [type] }, then: agentThen() }).hook.matcher, type);
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'postToolUse', toolTypes: ['telepathy'] }, then: agentThen() })).code, 'hook-tool-types');
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'postToolUse', toolTypes: ['*'] }, then: agentThen() })).code, 'hook-tool-types');
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'postToolUse', toolTypes: [] }, then: agentThen() })).code, 'hook-tool-types');
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'postToolUse' }, then: agentThen() })).code, 'hook-tool-types');
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'postToolUse', toolTypes: ['write'], patterns: ['*.ts'] }, then: agentThen() })).code, 'hook-patterns');
  });

  it('gives no matcher to a trigger that does not test one, and refuses patterns there', () => {
    const stop = convert({ name: 'sample', when: { type: 'agentStop' }, then: agentThen() });
    assert.deepEqual([stop.hook.trigger, 'matcher' in stop.hook], ['Stop', false]);
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'agentStop', patterns: ['*.ts'] }, then: agentThen() })).code, 'hook-patterns');
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'agentStop', toolTypes: ['write'] }, then: agentThen() })).code, 'hook-patterns');
  });

  it('keeps the prompt of an agent action to the letter, and the command of a command action', () => {
    const prompt = 'Line one.\n\n1. A "quoted" thing, with \\ and é and\ttab.\nDo not force it.';
    const agent = convert({ name: 'sample', when: { type: 'agentStop' }, then: { type: 'askAgent', prompt } });
    assert.deepEqual(agent.hook.action, { type: 'agent', prompt });
    const run = convert({ name: 'sample', when: { type: 'fileEdited', patterns: ['*.ts'] }, then: { type: 'runCommand', command: 'bash .kiro/ecc/scripts/format.sh {{filePath}}' } });
    assert.deepEqual(run.hook.action, { type: 'command', command: 'bash .kiro/ecc/scripts/format.sh {{filePath}}' });
  });

  it('gives the hook the ecc- prefix for its name and its file, and keeps the description', () => {
    const result = convert({ name: 'auto-format', description: 'Formats files.', when: { type: 'fileEdited', patterns: ['*.ts'] }, then: agentThen() });
    assert.equal(result.hook.name, 'ecc-auto-format');
    assert.equal(result.dest, '.kiro/hooks/ecc-auto-format.json');
    assert.equal(result.name, 'auto-format', 'the plain name is what the source calls it');
    assert.equal(result.hook.description, 'Formats files.');
    assert.equal(hookName('x'), 'ecc-x');
    assert.equal(hookDest('x'), `${HOOK_DIR}/ecc-x.json`);
  });

  it('leaves the description out when the source has none', () => {
    const result = convertHook({ path: legacyHookPath('sample'), text: JSON.stringify({ name: 'sample', when: { type: 'agentStop' }, then: agentThen() }) });
    assert.equal('description' in result.hook, false);
  });

  it('switches every hook off, whatever the source says', () => {
    for (const enabled of [true, false, undefined]) {
      const result = convert({ name: 'sample', enabled, when: { type: 'agentStop' }, then: agentThen() });
      assert.equal(result.hook.enabled, false, String(enabled));
      assert.equal(JSON.parse(result.content).hooks[0].enabled, false, 'and the file says so in words');
    }
  });

  it('writes a v1 file: two-space JSON, one hook, keys in reading order, a final newline', () => {
    const result = convert({ name: 'sample', description: 'D.', when: { type: 'fileEdited', patterns: ['*.py'] }, then: agentThen('P.') });
    assert.equal(
      result.content,
      [
        '{',
        '  "version": "v1",',
        '  "hooks": [',
        '    {',
        '      "name": "ecc-sample",',
        '      "description": "D.",',
        '      "trigger": "PostFileSave",',
        '      "matcher": "\\\\.py$",',
        '      "action": {',
        '        "type": "agent",',
        '        "prompt": "P."',
        '      },',
        '      "enabled": false',
        '    }',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
    assert.equal(renderHookFile(result.hook), result.content);
    assert.deepEqual(validateHookFile(JSON.parse(result.content), { requireDisabled: true }), []);
  });

  it('leaves out a hook that is started by hand, with the reason', () => {
    const result = convert({ name: 'quality-gate', when: { type: 'userTriggered' }, then: { type: 'runCommand', command: 'bash x.sh' } });
    assert.equal(result.name, 'quality-gate');
    assert.equal('hook' in result, false);
    assert.match(result.skipped.reason, /started by hand.*cannot be.*manually included steering file/);
  });

  it('stops on a hook type it does not know, with a fix', () => {
    const error = failure(() => convert({ name: 'sample', when: { type: 'sessionTeardown' }, then: agentThen() }));
    assert.equal(error.code, 'hook-trigger-unknown');
    assert.match(error.fix, /LEGACY_TRIGGERS/);
    assert.equal(failure(() => convert({ name: 'sample', when: { type: 'constructor' }, then: agentThen() })).code, 'hook-trigger-unknown');
  });

  it('refuses to write a hook that breaks the v1 format, and says how', () => {
    const error = failure(() => convert({ name: 'sample', when: { type: 'fileEdited', patterns: ['*.py'] }, then: { type: 'runCommand', command: 'cat {{file}}' } }));
    assert.equal(error.code, 'hook-invalid');
    assert.match(error.message, /the converted hook breaks the v1 format: .*unknown template variable \{\{file\}\}/);
    const twice = failure(() => convert({ name: 'sample', when: { type: 'agentStop' }, then: { type: 'runCommand', command: 'cat {{filePath}} {{x}}' } }));
    assert.match(twice.message, /\(and 1 more\)$/);
  });
});

describe('convertHook: the hooks adapted by hand', () => {
  const GIT_PUSH = { name: 'git-push-review', description: 'Reviews shell commands.', when: { type: 'preToolUse', toolTypes: ['shell'] }, then: agentThen('Check the push.') };
  // Synthetic text with the phrases the adaptation looks for, not ECC's prompt.
  const DOC_PROMPT = [
    'You are about to create or modify a file. Think about whether it is a document.',
    '',
    "If you're creating documentation, give a reason or skip it. Proceed with the write operation if appropriate.",
  ].join('\n');
  const DOC = { name: 'doc-file-warning', description: 'Warn before creating documentation files', when: { type: 'preToolUse', toolTypes: ['write'] }, then: agentThen(DOC_PROMPT) };
  const EXTRACT = {
    name: 'extract-patterns',
    description: 'Suggest patterns to add to lessons-learned.md after agent execution completes',
    when: { type: 'agentStop' },
    then: agentThen('Suggest adding them to .kiro/steering/lessons-learned.md. Only suggest patterns that are useful.'),
  };

  it('names the three, each with its reason', () => {
    assert.deepEqual(Object.keys(ADAPTED_HOOKS).sort(), ['doc-file-warning', 'extract-patterns', 'git-push-review']);
    for (const why of Object.values(ADAPTED_HOOKS)) assert.ok(why.length > 20);
    assert.match(ADAPTED_HOOKS['git-push-review'], /cannot look at the command/);
    assert.match(ADAPTED_HOOKS['doc-file-warning'], /cannot look at the file path/);
  });

  it('replaces the git push prompt with the script, on the shell tool, for no credits', () => {
    const result = convert(GIT_PUSH);
    assert.deepEqual(result.hook, {
      name: 'ecc-git-push-review',
      description: 'Blocks git push until the pre-push checklist is acknowledged. A script reads the command, so no agent run is needed and no credits are used.',
      trigger: 'PreToolUse',
      matcher: 'shell',
      action: { type: 'command', command: 'node .kiro/ecc/scripts/git-push-guard.mjs' },
      enabled: false,
    });
    assert.equal(GUARD_COMMAND, `node ${GUARD_DEST}`);
    assert.equal(GUARD_DEST, '.kiro/ecc/scripts/git-push-guard.mjs');
    assert.equal(result.usesGuard, true);
    assert.equal(result.adapted, ADAPTED_HOOKS['git-push-review']);
  });

  it('moves the documentation hook to PostFileCreate on documentation paths, and rewords the prompt for after the write', () => {
    const result = convert(DOC);
    assert.equal(result.hook.trigger, 'PostFileCreate');
    assert.equal(result.hook.matcher, DOC_MATCHER);
    assert.match(result.hook.description, /right after it creates them.*after the write, not before it/);
    const { prompt } = result.hook.action;
    assert.equal(prompt, ['A file was just created. Think about whether it is a document.', '', 'If you created documentation, give a reason or remove it. Otherwise carry on.'].join('\n'));
    assert.doesNotMatch(prompt, /about to create|Proceed with the write|skip it/);
    assert.equal(result.usesGuard, false);
    assert.equal(result.adapted, ADAPTED_HOOKS['doc-file-warning']);
  });

  it('points the lessons hook at ecc-lessons-learned.md, in the description and in the prompt, once each', () => {
    const result = convert(EXTRACT);
    assert.equal(result.hook.description, 'Suggest patterns to add to ecc-lessons-learned.md after agent execution completes');
    assert.equal(result.hook.action.prompt, 'Suggest adding them to .kiro/steering/ecc-lessons-learned.md. Only suggest patterns that are useful.');
    assert.equal(result.hook.trigger, 'Stop');
    assert.equal('matcher' in result.hook, false);
  });

  it('stops when the source is not the hook the adaptation was written for', () => {
    const wrongTool = failure(() => convert({ ...GIT_PUSH, when: { type: 'preToolUse', toolTypes: ['write'] } }));
    assert.equal(wrongTool.code, 'hook-adaptation');
    assert.match(wrongTool.message, /expects a preToolUse hook on shell with an agent action, and the source is different/);
    assert.match(wrongTool.fix, /ECC hook changed/);
    assert.equal(failure(() => convert({ ...GIT_PUSH, when: { type: 'postToolUse', toolTypes: ['shell'] } })).code, 'hook-adaptation');
    assert.equal(failure(() => convert({ ...GIT_PUSH, then: { type: 'runCommand', command: 'x' } })).code, 'hook-adaptation');
    assert.equal(failure(() => convert({ ...DOC, when: { type: 'fileEdited', patterns: ['*.md'] } })).code, 'hook-adaptation');
    assert.equal(failure(() => convert({ ...EXTRACT, when: { type: 'fileEdited', patterns: ['*.md'] } })).code, 'hook-adaptation');
  });

  it('stops when the text it rewrites has changed or appears twice', () => {
    const gone = failure(() => convert({ ...DOC, then: agentThen('A different prompt that has neither sentence.') }));
    assert.equal(gone.code, 'hook-adaptation');
    assert.match(gone.message, /expected "You are about to create or modify a file\." exactly once, found it 0 times/);
    const partly = failure(() => convert({ ...DOC, then: agentThen(DOC_PROMPT.replace('or skip it.', 'or leave it.')) }));
    assert.match(partly.message, /expected "or skip it\." exactly once, found it 0 times/, 'every phrase is looked for, not only the first');
    const repeated = failure(() => convert({ ...DOC, then: agentThen(`${DOC_PROMPT}\nGive a reason or skip it.`) }));
    assert.match(repeated.message, /expected "or skip it\." exactly once, found it 2 times/);
    const twice = failure(() => convert({ ...EXTRACT, then: agentThen('See .kiro/steering/lessons-learned.md and .kiro/steering/lessons-learned.md.') }));
    assert.match(twice.message, /exactly once, found it 2 times/);
    const noDescription = failure(() => convertHook({ path: legacyHookPath('extract-patterns'), text: JSON.stringify({ name: 'extract-patterns', when: { type: 'agentStop' }, then: agentThen('See .kiro/steering/lessons-learned.md.') }) }));
    assert.equal(noDescription.code, 'hook-adaptation');
  });

  it('does not take a dollar sign in the replacement for a pattern', () => {
    const result = convert({ ...EXTRACT, then: agentThen('Add to .kiro/steering/lessons-learned.md for $& and $1.') });
    assert.equal(result.hook.action.prompt, 'Add to .kiro/steering/ecc-lessons-learned.md for $& and $1.');
  });
});

describe('the documentation matcher', () => {
  it('picks Markdown, MDX and reStructuredText files, README and CHANGELOG files, and anything under docs/', () => {
    for (const path of [
      'README.md', 'README', 'README.rst', 'CHANGELOG.md', 'CHANGELOG', 'docs/guide.md', 'docs/img/diagram.png', 'src/docs/api.json', 'NOTES.md', 'a/b/SUMMARY.md', 'page.mdx',
      'guide.rst', '/abs/project/docs/x.txt', 'sub/README.txt', '.kiro/specs/x/design.md',
    ]) {
      assert.equal(matches(DOC_MATCHER, path), true, path);
    }
  });

  it('leaves code and data files alone', () => {
    for (const path of ['src/index.ts', 'requirements.txt', 'package.json', 'src/readme_helper.ts', 'lib/docsify.js', 'mydocs/x.js', 'x.markdown.js', 'README/x.ts']) {
      assert.equal(matches(DOC_MATCHER, path), false, path);
    }
  });

  it('is a regular expression every surface can read', () => {
    assert.doesNotThrow(() => new RegExp(DOC_MATCHER));
    assert.deepEqual(validateHookFile({ version: 'v1', hooks: [{ name: 'd', trigger: 'PostFileCreate', matcher: DOC_MATCHER, action: { type: 'agent', prompt: 'x' }, enabled: false }] }, { requireDisabled: true }), []);
  });
});
