// The feature check behind the fail-closed steps of the loop and review commands: what it can confirm, what it
// refuses to guess, and the exit codes the commands rely on.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FEATURES, INSTRUCTIONS, checkFeature, readCliSetting, run } from '../skills/ecc-kiro-setup/scripts/runtime/feature-check.mjs';

const SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'skills', 'ecc-kiro-setup', 'scripts', 'runtime', 'feature-check.mjs');
const reading = (value) => ({ readSetting: async (key) => (key === 'chat.enableWorkflows' ? value : assert.fail(`asked for ${key}`)) });

describe('checkFeature', () => {
  it('confirms Workflows when the CLI setting is on, in the spellings it prints', async () => {
    for (const value of ['true', 'True', 'on', 'enabled', 'yes', '1', 'true (global)']) {
      const result = await checkFeature('workflows', reading(value));
      assert.deepEqual([result.enabled, result.status, result.instructions], [true, 'on', []], value);
    }
  });
  it('says off, with the enable steps for the CLI and the IDE, when the setting is not on', async () => {
    for (const value of ['false', 'off', '', 'something']) {
      const result = await checkFeature('workflows', reading(value));
      assert.deepEqual([result.enabled, result.status], [false, 'off'], value);
      assert.deepEqual(result.instructions, INSTRUCTIONS.workflows);
    }
    const joined = INSTRUCTIONS.workflows.join('\n');
    assert.match(joined, /\/settings, choose Features, enable Workflows, then exit and start Kiro CLI again/);
    assert.match(joined, /Workspace Configuration[^\n]*Workflows/);
    assert.match(joined, /not available for your account/);
  });
  it('does not guess when the CLI gives no answer: it is not confirmed, so it counts as off', async () => {
    const result = await checkFeature('workflows', reading(null));
    assert.deepEqual([result.enabled, result.status], [false, 'unknown']);
    assert.match(result.detail, /kiroAgent\.workflows\.enabled cannot be read from here/);
  });
  it('never confirms /goal, because Kiro documents no way to ask', async () => {
    const result = await checkFeature('goal', { readSetting: async () => assert.fail('goal reads no setting') });
    assert.deepEqual([result.enabled, result.status], [false, 'unknown']);
    assert.match(result.instructions.join('\n'), /type \/goal and look for it in the command list/);
    assert.match(result.instructions.join('\n'), /Do not start an open-ended loop in its place/);
  });
  it('rejects a feature it does not know', async () => {
    await assert.rejects(checkFeature('nope'), /unknown feature "nope"/);
    assert.deepEqual([...FEATURES], ['workflows', 'goal']);
  });
});

describe('readCliSetting', () => {
  const fake = (error, stdout = '', stderr = '') => (command, args, options, callback) => {
    assert.deepEqual([command, args], ['kiro-cli', ['settings', 'chat.enableWorkflows']]);
    assert.ok(options.timeout > 0, 'it cannot hang');
    callback(error, stdout, stderr);
  };
  it('returns the printed value, trimmed', async () => {
    assert.equal(await readCliSetting('chat.enableWorkflows', fake(null, 'true\n')), 'true');
  });
  it('reads "No value associated" as an empty answer: the setting was never turned on', async () => {
    const error = Object.assign(new Error('failed'), { code: 1 });
    assert.equal(await readCliSetting('chat.enableWorkflows', fake(error, '', 'error: No value associated with chat.enableWorkflows')), '');
  });
  it('returns null when the CLI is missing, times out, fails some other way or cannot be started', async () => {
    assert.equal(await readCliSetting('chat.enableWorkflows', fake(Object.assign(new Error('x'), { code: 'ENOENT' }))), null);
    assert.equal(await readCliSetting('chat.enableWorkflows', fake(Object.assign(new Error('x'), { code: 1 }), '', 'error: something else')), null);
    assert.equal(await readCliSetting('chat.enableWorkflows', () => { throw new Error('spawn failed'); }), null);
  });
});

describe('run', () => {
  it('exits 0 with the status on stdout when the feature is on', async () => {
    const result = await run(['workflows'], reading('true'));
    assert.deepEqual([result.exitCode, result.stderr], [0, '']);
    assert.match(result.stdout, /^workflows: on\. chat\.enableWorkflows is on\.\n$/);
  });
  it('exits 1 with the instructions on stderr and nothing on stdout when it is off or unknown', async () => {
    for (const [feature, deps] of [['workflows', reading('false')], ['workflows', reading(null)], ['goal', undefined]]) {
      const result = await run([feature], deps);
      assert.deepEqual([result.exitCode, result.stdout], [1, ''], feature);
      assert.ok(result.stderr.split('\n').length > 3, 'the instructions are there');
    }
  });
  it('prints JSON with --json, and the same exit code', async () => {
    const off = await run(['workflows', '--json'], reading('false'));
    assert.equal(off.exitCode, 1);
    assert.deepEqual(JSON.parse(off.stdout).status, 'off');
    const on = await run(['--json', 'workflows'], reading('true'));
    assert.deepEqual([on.exitCode, JSON.parse(on.stdout).enabled], [0, true]);
  });
  it('exits 2 for a wrong call', async () => {
    for (const argv of [[], ['nope'], ['workflows', 'goal'], ['workflows', '--wat']]) {
      const result = await run(argv, reading('true'));
      assert.deepEqual([result.exitCode, result.stdout], [2, ''], JSON.stringify(argv));
      assert.match(result.stderr, /^usage: feature-check\.mjs <workflows\|goal> \[--json\]\n$/);
    }
  });
});

describe('the script as a process', () => {
  const spawn = (args, env) =>
    new Promise((resolve) => {
      execFile(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
    });
  it('fails closed for /goal and for Workflows when kiro-cli cannot be found', async () => {
    const goal = await spawn(['goal']);
    assert.equal(goal.code, 1);
    assert.match(goal.stderr, /goal: not confirmed/);
    const workflows = await spawn(['workflows'], { PATH: '/nonexistent' });
    assert.equal(workflows.code, 1);
    assert.match(workflows.stderr, /workflows: not confirmed\. kiro-cli did not answer/);
  });
  it('exits 2 and prints the usage for a wrong call', async () => {
    const result = await spawn([]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /^usage: /);
  });
});
