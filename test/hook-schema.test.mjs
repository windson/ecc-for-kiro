// The validator for Kiro v1 hook files: every rule, with one failing case that names the code.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACTION_TYPES, HOOK_FILE_VERSION, HOOK_TRIGGERS, LEGACY_TRIGGERS, TEMPLATE_VARIABLES, matcherProblem, validateHookFile } from '../skills/ecc-kiro-setup/scripts/lib/hook-schema.mjs';

const file = (...hooks) => ({ version: 'v1', hooks });
const agent = (extra = {}) => ({ name: 'sample', trigger: 'Stop', action: { type: 'agent', prompt: 'Say hello.' }, ...extra });
const command = (extra = {}) => ({ name: 'sample', trigger: 'PostFileSave', matcher: '\\.ts$', action: { type: 'command', command: 'prettier --write {{filePath}}' }, ...extra });
const codes = (value, options) => validateHookFile(value, options).map((problem) => problem.code);

describe('the portable triggers', () => {
  it('are the ten that IDE 1.0 and the CLI share, with what a matcher is tested against and which can block', () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(HOOK_TRIGGERS).map(([name, spec]) => [name, [spec.subject, spec.canBlock]])),
      {
        SessionStart: [null, false],
        Stop: [null, false],
        UserPromptSubmit: ['prompt', true],
        PreTaskExec: [null, true],
        PostTaskExec: [null, false],
        PreToolUse: ['tool', true],
        PostToolUse: ['tool', false],
        PostFileCreate: ['path', false],
        PostFileSave: ['path', false],
        PostFileDelete: ['path', false],
      },
    );
    assert.equal(HOOK_FILE_VERSION, 'v1');
    assert.deepEqual([...ACTION_TYPES], ['command', 'agent']);
    assert.deepEqual([...TEMPLATE_VARIABLES], ['filePath']);
  });

  it('are what the ten 0.x names became, as Kiro lists them for the migration', () => {
    assert.deepEqual({ ...LEGACY_TRIGGERS }, {
      agentSpawn: 'SessionStart',
      agentStop: 'Stop',
      promptSubmit: 'UserPromptSubmit',
      preToolUse: 'PreToolUse',
      postToolUse: 'PostToolUse',
      fileCreated: 'PostFileCreate',
      fileEdited: 'PostFileSave',
      fileDeleted: 'PostFileDelete',
      preTaskExecution: 'PreTaskExec',
      postTaskExecution: 'PostTaskExec',
    });
    for (const trigger of Object.values(LEGACY_TRIGGERS)) assert.ok(Object.hasOwn(HOOK_TRIGGERS, trigger), trigger);
  });

  it('are all accepted, with a matcher where the trigger tests one', () => {
    for (const [trigger, spec] of Object.entries(HOOK_TRIGGERS)) {
      const hook = agent({ trigger, ...(spec.subject === null ? {} : { matcher: 'x' }) });
      assert.deepEqual(validateHookFile(file(hook)), [], trigger);
    }
  });
});

describe('validateHookFile: the file', () => {
  it('accepts an agent hook and a command hook', () => {
    assert.deepEqual(validateHookFile(file(agent())), []);
    assert.deepEqual(validateHookFile(file(command())), []);
    assert.deepEqual(validateHookFile(file(agent({ description: 'Documentation only.', enabled: false }))), []);
  });

  it('accepts several hooks in one file', () => {
    assert.deepEqual(validateHookFile(file(agent({ name: 'one' }), command({ name: 'two' }))), []);
  });

  it('refuses a value that is not an object', () => {
    for (const value of [null, [], 'v1', 1, undefined]) assert.deepEqual(codes(value), ['hook-file-shape'], String(value));
  });

  it('refuses keys it does not know at the top of the file', () => {
    assert.deepEqual(codes({ ...file(agent()), enabled: false }), ['hook-file-key-unknown']);
  });

  it('wants version "v1"', () => {
    for (const version of [undefined, 'v2', 'V1', 1, '1.0.0']) assert.deepEqual(codes({ version, hooks: [agent()] }), ['hook-version'], String(version));
  });

  it('wants a non-empty list of hooks', () => {
    for (const hooks of [undefined, [], {}, 'x']) assert.deepEqual(codes({ version: 'v1', hooks }), ['hook-file-shape'], JSON.stringify(hooks));
  });

  it('refuses two hooks with one name in a file', () => {
    assert.deepEqual(codes(file(agent(), agent())), ['hook-name-duplicate']);
  });

  it('reports every problem it finds, not only the first', () => {
    const problems = validateHookFile({ version: 'v2', hooks: [{ name: '', trigger: 'nope', action: { type: 'agent' }, enable: false }] });
    assert.deepEqual(problems.map((item) => item.code).sort(), ['hook-action-prompt', 'hook-key-unknown', 'hook-name', 'hook-trigger', 'hook-version']);
  });
});

describe('validateHookFile: the hook', () => {
  it('refuses a hook that is not an object', () => {
    assert.deepEqual(codes(file('x')), ['hook-shape']);
    assert.deepEqual(codes(file(null)), ['hook-shape']);
  });

  it('refuses keys it does not know, so a typo like "enable" cannot leave a hook on', () => {
    const problems = validateHookFile(file(agent({ enable: false })), { requireDisabled: true });
    assert.deepEqual(problems.map((item) => item.code).sort(), ['hook-key-unknown', 'hook-not-disabled']);
    assert.match(problems.find((item) => item.code === 'hook-key-unknown').message, /unknown key\(s\): enable/);
  });

  it('wants a name that is text', () => {
    for (const name of [undefined, '', '  ', 7]) assert.deepEqual(codes(file(agent({ name }))), ['hook-name'], String(name));
  });

  it('wants a description that is text, when there is one', () => {
    assert.deepEqual(codes(file(agent({ description: 3 }))), ['hook-description']);
  });

  it('names the hook in its messages', () => {
    const [problem] = validateHookFile(file(agent({ trigger: 'nope' })));
    assert.match(problem.message, /^hooks\[0\] "sample": /);
  });
});

describe('validateHookFile: the trigger', () => {
  const trigger = (value) => validateHookFile(file(agent({ trigger: value })));

  it('refuses a trigger it does not know, and lists the portable ones', () => {
    const [problem] = trigger('SomethingElse');
    assert.equal(problem.code, 'hook-trigger');
    assert.match(problem.message, /unknown trigger "SomethingElse" \(the portable triggers are SessionStart, Stop, UserPromptSubmit/);
  });

  it('is case sensitive, because Kiro writes the triggers in PascalCase', () => {
    for (const value of ['poststop', 'stop', 'postfilesave', 'POSTFILESAVE']) assert.deepEqual(trigger(value).map((item) => item.code), ['hook-trigger'], value);
  });

  it('says what a 0.x name became', () => {
    const [problem] = trigger('fileEdited');
    assert.match(problem.message, /"fileEdited" is the 0\.x name; the v1 trigger is "PostFileSave"/);
    assert.match(trigger('agentStop')[0].message, /the v1 trigger is "Stop"/);
  });

  it('says that userTriggered has no v1 trigger', () => {
    assert.match(trigger('userTriggered')[0].message, /"userTriggered" has no v1 trigger; use a manually included steering file/);
  });

  it('refuses the triggers that only some surfaces have, with the reason', () => {
    assert.match(trigger('SessionEnd')[0].message, /"SessionEnd" is only available in the CLI \(V3\), so a hook file for every surface cannot use it/);
    assert.match(trigger('Manual')[0].message, /"Manual" is only available in Kiro Web and the CLI/);
    assert.match(trigger('AgentSpawn')[0].message, /"AgentSpawn" is a CLI-only alias of SessionStart/);
    assert.match(trigger('agentSpawn')[0].message, /CLI-only alias of SessionStart/);
  });

  it('refuses a trigger that is not text, and a name inherited from Object', () => {
    for (const value of [undefined, 3, null, ['Stop'], 'constructor', '__proto__', 'toString']) assert.deepEqual(trigger(value).map((item) => item.code), ['hook-trigger'], String(value));
  });
});

describe('matcherProblem', () => {
  it('accepts the shapes the converted hooks use', () => {
    for (const matcher of ['\\.(ts|tsx)$', 'write', 'shell', '(^|/)(auth|api)/', 'write|read', '\\.py$', '@git/status', '@mcp.*sql.*', '(?:a|b)c']) {
      assert.equal(matcherProblem(matcher), null, matcher);
    }
  });

  it('refuses text that is not a regular expression', () => {
    for (const matcher of ['(', '[a-', '*', '\\']) assert.match(matcherProblem(matcher), /is not a valid regular expression/, matcher);
  });

  it('refuses an empty matcher and one that is not text', () => {
    for (const matcher of ['', '   ', 3, null, undefined, ['x']]) assert.match(matcherProblem(matcher), /must be a non-empty regular expression/, String(matcher));
  });

  it('refuses lookahead and lookbehind, which not every regular expression engine has', () => {
    for (const matcher of ['a(?=b)', 'a(?!b)', '(?<=a)b', '(?<!a)b']) assert.match(matcherProblem(matcher), /lookahead or lookbehind/, matcher);
  });

  it('refuses backreferences', () => {
    for (const matcher of ['(a)\\1', '(a)(b)\\2', '(?<n>a)\\k<n>']) assert.match(matcherProblem(matcher), /backreference/, matcher);
  });

  it('does not take an escaped parenthesis for a lookahead, or an escaped backslash for a backreference', () => {
    assert.equal(matcherProblem('\\(?=x'), null);
    assert.equal(matcherProblem('a\\\\1'), null);
    assert.equal(matcherProblem('\\.(md|mdx)$'), null);
  });

  it('allows a named group, which is not a lookbehind', () => {
    assert.equal(matcherProblem('(?<ext>ts|js)$'), null);
  });
});

describe('validateHookFile: the matcher', () => {
  it('is checked as a regular expression', () => {
    assert.deepEqual(codes(file(command({ matcher: '(' }))), ['hook-matcher']);
    assert.deepEqual(codes(file(command({ matcher: '' }))), ['hook-matcher']);
    assert.deepEqual(codes(file(command({ matcher: 'a(?=b)' }))), ['hook-matcher']);
  });

  it('is refused on triggers that do not test one, because the hook would always fire', () => {
    for (const trigger of ['SessionStart', 'Stop', 'PreTaskExec', 'PostTaskExec']) {
      assert.deepEqual(codes(file(agent({ trigger, matcher: 'x' }))), ['hook-matcher-unused'], trigger);
    }
  });

  it('is allowed on the tool, file and prompt triggers', () => {
    for (const trigger of ['PreToolUse', 'PostToolUse', 'PostFileCreate', 'PostFileSave', 'PostFileDelete', 'UserPromptSubmit']) {
      assert.deepEqual(codes(file(agent({ trigger, matcher: 'x' }))), [], trigger);
    }
  });

  it('may be "*" on a tool trigger, which is how Kiro writes every tool, and nowhere else', () => {
    assert.deepEqual(codes(file(agent({ trigger: 'PreToolUse', matcher: '*' }))), []);
    assert.deepEqual(codes(file(agent({ trigger: 'PostToolUse', matcher: '*' }))), []);
    assert.deepEqual(codes(file(agent({ trigger: 'PostFileSave', matcher: '*' }))), ['hook-matcher']);
  });
});

describe('validateHookFile: the action', () => {
  const action = (value) => file(agent({ action: value }));

  it('wants an object with a type of command or agent', () => {
    for (const value of [undefined, 'agent', null, []]) assert.deepEqual(codes(action(value)), ['hook-action'], String(value));
    assert.deepEqual(codes(action({ type: 'shell', command: 'x' })), ['hook-action-type']);
    assert.deepEqual(codes(action({ command: 'x' })), ['hook-action-type']);
  });

  it('wants a command in a command action and a prompt in an agent action', () => {
    assert.deepEqual(codes(action({ type: 'command' })), ['hook-action-command']);
    assert.deepEqual(codes(action({ type: 'command', command: '  ' })), ['hook-action-command']);
    assert.deepEqual(codes(action({ type: 'agent' })), ['hook-action-prompt']);
    assert.deepEqual(codes(action({ type: 'agent', prompt: '' })), ['hook-action-prompt']);
    assert.deepEqual(codes(action({ type: 'agent', prompt: 5 })), ['hook-action-prompt']);
  });

  it('refuses the field of the other action type', () => {
    assert.deepEqual(codes(action({ type: 'command', command: 'x', prompt: 'y' })), ['hook-action-mismatch']);
    assert.deepEqual(codes(action({ type: 'agent', prompt: 'y', command: 'x' })), ['hook-action-mismatch']);
    assert.match(validateHookFile(action({ type: 'agent', prompt: 'y', command: 'x' }))[0].message, /an agent action takes "prompt", not "command"/);
  });

  it('refuses keys it does not know', () => {
    assert.deepEqual(codes(action({ type: 'agent', prompt: 'y', model: 'x' })), ['hook-action-key-unknown']);
  });
});

describe('validateHookFile: timeout and enabled', () => {
  it('takes a timeout in seconds for a command action, 0 included', () => {
    for (const timeout of [0, 1, 30, 2.5]) assert.deepEqual(codes(file(command({ timeout }))), [], String(timeout));
  });

  it('refuses a timeout that is not a number of seconds', () => {
    for (const timeout of [-1, '30', Number.NaN, Infinity, null, true]) assert.deepEqual(codes(file(command({ timeout }))), ['hook-timeout'], String(timeout));
  });

  it('refuses a timeout on an agent action, where Kiro ignores it', () => {
    assert.deepEqual(codes(file(agent({ timeout: 5 }))), ['hook-timeout-unused']);
  });

  it('wants enabled to be true or false', () => {
    assert.deepEqual(codes(file(agent({ enabled: true }))), []);
    for (const enabled of ['false', 0, null]) assert.deepEqual(codes(file(agent({ enabled }))), ['hook-enabled'], String(enabled));
  });

  it('can require every hook to be switched off, with "enabled": false written out', () => {
    const strict = { requireDisabled: true };
    assert.deepEqual(codes(file(agent({ enabled: false })), strict), []);
    assert.deepEqual(codes(file(agent()), strict), ['hook-not-disabled'], 'a missing enabled means on');
    assert.deepEqual(codes(file(agent({ enabled: true })), strict), ['hook-not-disabled']);
    assert.deepEqual(codes(file(agent({ enabled: 'false' })), strict).sort(), ['hook-enabled', 'hook-not-disabled']);
    assert.deepEqual(codes(file(agent({ enabled: false }), agent({ name: 'two' })), strict), ['hook-not-disabled'], 'every hook of a file counts');
    assert.deepEqual(codes(file(agent())), [], 'and without the option an unset enabled is fine');
  });
});

describe('validateHookFile: confirm', () => {
  const stop = (confirm, extra = {}) => file({ name: 'ask', trigger: 'Stop', action: { type: 'command', command: './submit.sh' }, confirm, ...extra });
  const good = { question: 'Submit?', options: [{ id: 'yes', label: 'Yes', run: true }, { id: 'no', label: 'No', run: false }] };

  it('is accepted on a command action on Stop, with a confirmCommand too', () => {
    assert.deepEqual(codes(stop(good)), []);
    assert.deepEqual(codes(stop({ ...good, confirmCommand: './options.sh' })), []);
  });

  it('is refused anywhere else', () => {
    assert.deepEqual(codes(stop(good, { trigger: 'PostFileSave' })), ['hook-confirm-unused']);
    assert.deepEqual(codes(stop(good, { action: { type: 'agent', prompt: 'x' } })), ['hook-confirm-unused']);
  });

  it('wants a question, a non-empty list of options, and an id, a label and a run flag for each', () => {
    assert.deepEqual(codes(stop('ask')), ['hook-confirm']);
    assert.deepEqual(codes(stop({ options: good.options })), ['hook-confirm']);
    assert.deepEqual(codes(stop({ question: 'x', options: [] })), ['hook-confirm']);
    assert.deepEqual(codes(stop({ question: 'x', options: 'yes' })), ['hook-confirm']);
    assert.deepEqual(codes(stop({ question: 'x', options: [{ label: 'Yes', run: true }] })), ['hook-confirm']);
    assert.deepEqual(codes(stop({ question: 'x', options: [{ id: 'y', run: true }] })), ['hook-confirm']);
    assert.deepEqual(codes(stop({ question: 'x', options: [{ id: 'y', label: 'Yes' }] })), ['hook-confirm']);
    assert.deepEqual(codes(stop({ question: 'x', options: ['yes'] })), ['hook-confirm']);
  });

  it('refuses a duplicate option id, an unknown key and a confirmCommand that is not a command', () => {
    assert.deepEqual(codes(stop({ question: 'x', options: [{ id: 'y', label: 'A', run: true }, { id: 'y', label: 'B', run: false }] })), ['hook-confirm']);
    assert.deepEqual(codes(stop({ ...good, extra: 1 })), ['hook-confirm']);
    assert.deepEqual(codes(stop({ ...good, options: [{ id: 'y', label: 'A', run: true, color: 'red' }] })), ['hook-confirm']);
    assert.deepEqual(codes(stop({ ...good, confirmCommand: '' })), ['hook-confirm']);
  });
});

describe('validateHookFile: template variables', () => {
  it('lets a file trigger use {{filePath}} in its command', () => {
    for (const trigger of ['PostFileCreate', 'PostFileSave', 'PostFileDelete']) {
      assert.deepEqual(codes(file(command({ trigger, action: { type: 'command', command: 'cat {{filePath}}' } }))), [], trigger);
    }
  });

  it('refuses {{filePath}} on a trigger that has no file', () => {
    const hook = { name: 'x', trigger: 'PreToolUse', matcher: 'shell', action: { type: 'command', command: 'cat {{filePath}}' } };
    assert.deepEqual(codes(file(hook)), ['hook-template-misplaced']);
  });

  it('refuses a variable Kiro does not document', () => {
    assert.deepEqual(codes(file(command({ action: { type: 'command', command: 'cat {{file}}' } }))), ['hook-template-unknown']);
    assert.deepEqual(codes(file(command({ action: { type: 'command', command: 'cat {{ filePath }}' } }))), ['hook-template-unknown']);
  });

  it('does not look inside an agent prompt, which may show braces', () => {
    assert.deepEqual(codes(file(agent({ action: { type: 'agent', prompt: 'Return {{"ok": true}} as JSON.' } }))), []);
  });
});
