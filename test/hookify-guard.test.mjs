// The hookify guard that the ecc-hookify hooks run: how it reads a rule, what it matches for each event, what it
// does with a block and a warning, and the real script run as a process the way Kiro runs it.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVENTS, RULE_DIR, evaluate, loadRules, matchRules, parseRule, readInput, subjectOf } from '../skills/ecc-kiro-setup/scripts/runtime/hookify-guard.mjs';
import { makeTempDir } from './fixtures.mjs';

const GUARD = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'skills', 'ecc-kiro-setup', 'scripts', 'runtime', 'hookify-guard.mjs');

// The payloads below have the shape Kiro sent in a headless run of kiro-cli 2.28.0 (V3).
const bashEvent = (command, cwd = '/work') => JSON.stringify({ session_id: 'sess_1', hook_event_name: 'PreToolUse', cwd, tool_name: 'execute_bash', tool_input: { command, description: 'x', cwd, run_in_background: false, timeout: null } });
const fileEvent = (file, cwd = '/work') => JSON.stringify({ session_id: 'sess_1', hook_event_name: 'PreToolUse', cwd, tool_name: 'fs_write', tool_input: { path: file, text: 'hi' } });
const promptEvent = (prompt, cwd = '/work') => JSON.stringify({ session_id: 'sess_1', hook_event_name: 'UserPromptSubmit', cwd, prompt });
const stopEvent = (sessionId = 'sess_1', cwd = '/work') => JSON.stringify({ session_id: sessionId, hook_event_name: 'Stop', cwd });

const rule = (fields, message = 'Do not do that.') => `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n${message}\n`;

describe('parseRule', () => {
  it('reads the format of the hookify command', () => {
    const { rule: parsed } = parseRule(rule({ name: 'no-rm', enabled: 'true', event: 'bash', action: 'block', pattern: '"rm\\s+-rf"' }, 'Line one.\nLine two.'), 'file-stem');
    assert.equal(parsed.name, 'no-rm');
    assert.equal(parsed.enabled, true);
    assert.equal(parsed.event, 'bash');
    assert.equal(parsed.action, 'block');
    assert.equal(parsed.pattern.source, 'rm\\s+-rf');
    assert.equal(parsed.message, 'Line one.\nLine two.');
  });
  it('takes the name from the file when there is none, and defaults to enabled, event all and a warning', () => {
    const { rule: parsed } = parseRule(rule({ pattern: 'x' }), 'from-file');
    assert.deepEqual([parsed.name, parsed.enabled, parsed.event, parsed.action], ['from-file', true, 'all', 'warn']);
  });
  it('removes one level of quotes: double quotes keep \\s, \\\\ becomes \\, single quotes keep everything', () => {
    assert.equal(parseRule(rule({ pattern: '"a\\\\s"' }), 's').rule.pattern.source, 'a\\s');
    assert.equal(parseRule(rule({ pattern: '"a\\s"' }), 's').rule.pattern.source, 'a\\s');
    assert.equal(parseRule(rule({ pattern: "'a\\s''b'" }), 's').rule.pattern.source, "a\\s'b");
    assert.equal(parseRule(rule({ pattern: 'a\\sb' }), 's').rule.pattern.source, 'a\\sb');
  });
  it('reads enabled: false in its spellings', () => {
    for (const value of ['false', 'False', 'no', 'off', '0']) assert.equal(parseRule(rule({ enabled: value, pattern: 'x' }), 's').rule.enabled, false, value);
  });
  it('gives a default message when the body is empty', () => {
    assert.equal(parseRule('---\nname: a\npattern: x\n---\n', 's').rule.message, 'The rule "a" matched.');
  });
  it('reports what is wrong instead of throwing', () => {
    const problem = (text) => parseRule(text, 's').problem;
    assert.match(problem('no header'), /does not start with/);
    assert.match(problem('---\nname: a\n'), /not closed/);
    assert.match(problem('---\njust text\n---\n'), /not a "key: value" line/);
    assert.match(problem(rule({ event: 'files', pattern: 'x' })), /event must be one of/);
    assert.match(problem(rule({ action: 'stop', pattern: 'x' })), /action must be block or warn/);
    assert.match(problem(rule({ event: 'bash', pattern: '"("' })), /pattern is not a regular expression/);
    assert.match(problem(rule({ event: 'bash' })), /needs a pattern/);
    assert.equal(parseRule(rule({ event: 'stop' }), 's').problem, undefined, 'a stop rule needs no pattern');
  });
  it('accepts a byte order mark and Windows line breaks', () => {
    const text = `\uFEFF${rule({ name: 'a', event: 'bash', pattern: 'x' }).replaceAll('\n', '\r\n')}`;
    assert.equal(parseRule(text, 's').rule.name, 'a');
  });
});

describe('subjectOf and matchRules', () => {
  const rules = (...specs) => specs.map((fields) => parseRule(rule(fields), fields.name).rule);
  it('takes the command, the path and the prompt out of the payloads Kiro sends', () => {
    assert.equal(subjectOf('bash', JSON.parse(bashEvent('ls -la'))), 'ls -la');
    assert.equal(subjectOf('file', JSON.parse(fileEvent('/work/src/a.ts'))), '/work/src/a.ts');
    assert.equal(subjectOf('prompt', JSON.parse(promptEvent('hello'))), 'hello');
    assert.equal(subjectOf('stop', JSON.parse(stopEvent())), undefined);
    assert.equal(subjectOf('bash', {}), undefined);
    assert.equal(subjectOf('bash', { tool_input: { command: ['git', 'push'] } }), 'git push');
    assert.equal(subjectOf('file', { tool_input: { file_path: 'a.py' } }), 'a.py');
  });
  it('matches by event and pattern, skips rules that are off, and lets "all" rules match any event with a subject', () => {
    const list = rules({ name: 'a', event: 'bash', pattern: 'rm' }, { name: 'b', event: 'file', pattern: 'rm' }, { name: 'c', event: 'all', pattern: 'rm' }, { name: 'd', event: 'bash', pattern: 'rm', enabled: 'false' }, { name: 'e', event: 'bash', pattern: 'zzz' });
    assert.deepEqual(matchRules(list, 'bash', JSON.parse(bashEvent('rm x'))).map((item) => item.name), ['a', 'c']);
    assert.deepEqual(matchRules(list, 'file', JSON.parse(fileEvent('/rm/x'))).map((item) => item.name), ['b', 'c']);
    assert.deepEqual(matchRules(list, 'prompt', JSON.parse(promptEvent('please rm it'))).map((item) => item.name), ['c']);
  });
  it('does not match a rule when the event carries nothing to test', () => {
    assert.deepEqual(matchRules(rules({ name: 'a', event: 'bash', pattern: '.*' }), 'bash', {}), []);
  });
  it('lets every enabled stop rule and "all" rule fire on stop', () => {
    const list = rules({ name: 'a', event: 'stop' }, { name: 'b', event: 'all', pattern: 'x' }, { name: 'c', event: 'bash', pattern: 'x' }, { name: 'd', event: 'stop', enabled: 'false' });
    assert.deepEqual(matchRules(list, 'stop', JSON.parse(stopEvent())).map((item) => item.name), ['a', 'b']);
  });
});

describe('evaluate', () => {
  let tmp;
  let project;
  let state;
  let counter = 0;
  before(async () => {
    tmp = await makeTempDir();
  });
  after(() => tmp.cleanup());
  beforeEach(async () => {
    counter += 1;
    project = path.join(tmp.dir, `project-${counter}`);
    state = path.join(tmp.dir, `state-${counter}`);
    await mkdir(path.join(project, ...RULE_DIR.split('/')), { recursive: true });
  });
  const put = (name, fields, message) => writeFile(path.join(project, ...RULE_DIR.split('/'), `${name}.local.md`), rule({ name, ...fields }, message));
  const run = (event, input) => evaluate(event, input, { cwd: project, tmp: state });

  it('blocks a shell command that a block rule matches, with exit 2 and the message on stderr', async () => {
    await put('no-rm', { event: 'bash', action: 'block', pattern: '"rm\\s+-rf"' }, 'Never delete recursively.');
    const result = run('bash', bashEvent('rm -rf victim'));
    assert.deepEqual([result.exitCode, result.stdout], [2, '']);
    assert.equal(result.stderr, '[no-rm] Never delete recursively.\n');
    assert.equal(run('bash', bashEvent('ls')).exitCode, 0);
  });
  it('warns with exit 1 when only warn rules match, and blocks when both match, showing both', async () => {
    await put('careful', { event: 'bash', action: 'warn', pattern: 'git' }, 'Mind the git.');
    assert.deepEqual([run('bash', bashEvent('git status')).exitCode, run('bash', bashEvent('git status')).stderr], [1, '[careful] Mind the git.\n']);
    await put('no-reset', { event: 'bash', action: 'block', pattern: 'reset --hard' }, 'No hard resets.');
    const both = run('bash', bashEvent('git reset --hard'));
    assert.equal(both.exitCode, 2);
    assert.equal(both.stderr, '[no-reset] No hard resets.\n[careful] Mind the git.\n');
  });
  it('tests the path of a write against file rules and a prompt against prompt rules', async () => {
    await put('no-env', { event: 'file', action: 'block', pattern: '\\.env$' }, 'Do not write secrets.');
    await put('no-pass', { event: 'prompt', action: 'block', pattern: 'password' }, 'No passwords in prompts.');
    assert.equal(run('file', fileEvent('/work/.env')).exitCode, 2);
    assert.equal(run('file', fileEvent('/work/a.ts')).exitCode, 0);
    assert.equal(run('prompt', promptEvent('my password is x')).exitCode, 2);
    assert.equal(run('prompt', promptEvent('hello')).exitCode, 0);
    assert.equal(run('bash', bashEvent('cat .env')).exitCode, 0, 'a file rule does not look at shell commands');
  });
  it('lets a stop rule that blocks do so once per session, as JSON on stdout, and then lets the agent stop', async () => {
    await put('run-tests', { event: 'stop', action: 'block' }, 'Run the tests before you stop.');
    const first = run('stop', stopEvent('sess_a'));
    assert.deepEqual([first.exitCode, first.stderr], [0, '']);
    assert.deepEqual(JSON.parse(first.stdout), { decision: 'block', reason: '[run-tests] Run the tests before you stop.' });
    const second = run('stop', stopEvent('sess_a'));
    assert.deepEqual([second.exitCode, second.stdout, second.stderr], [0, '', '']);
    assert.equal(JSON.parse(run('stop', stopEvent('sess_b')).stdout).decision, 'block', 'another session is blocked again');
  });
  it('does not block a stop rule when the session cannot be told apart, because it could not be stopped from firing again', async () => {
    await put('run-tests', { event: 'stop', action: 'block' });
    for (const id of [undefined, '', '../escape', 'a b']) {
      const input = JSON.stringify({ hook_event_name: 'Stop', cwd: project, ...(id === undefined ? {} : { session_id: id }) });
      assert.deepEqual([run('stop', input).exitCode, run('stop', input).stdout], [0, ''], String(id));
    }
  });
  it('does not block a stop rule when the state cannot be written', async () => {
    await put('run-tests', { event: 'stop', action: 'block' });
    const blocker = path.join(tmp.dir, `not-a-folder-${counter}`);
    await writeFile(blocker, 'file');
    const result = evaluate('stop', stopEvent('sess_c'), { cwd: project, tmp: path.join(blocker, 'inside') });
    assert.deepEqual([result.exitCode, result.stdout], [0, '']);
  });
  it('warns on stop with exit 1 and no state', async () => {
    await put('remember', { event: 'stop', action: 'warn' }, 'Did you update the changelog?');
    assert.deepEqual([run('stop', stopEvent('sess_d')).exitCode, run('stop', stopEvent('sess_d')).exitCode], [1, 1]);
    assert.deepEqual(await readdir(state).catch(() => []), [], 'a warning leaves no state');
  });
  it('never stops work: a bad event, an unknown event or a broken rule only gives a note on stderr', async () => {
    await put('no-rm', { event: 'bash', action: 'block', pattern: 'rm' });
    await writeFile(path.join(project, ...RULE_DIR.split('/'), 'broken.local.md'), '---\nevent: bash\npattern: "("\n---\n');
    for (const input of ['', '   ', 'not json', '[1]', 'null', '7']) {
      const result = run('bash', input);
      assert.equal(result.exitCode, 0, JSON.stringify(input));
      assert.match(result.stderr, /^ecc hookify: /);
    }
    assert.match(run('nope', bashEvent('rm')).stderr, /unknown event "nope"/);
    const withBroken = run('bash', bashEvent('ls'));
    assert.equal(withBroken.exitCode, 0);
    assert.match(withBroken.stderr, /broken\.local\.md: pattern is not a regular expression.*skipped/);
  });
  it('finds the rules from the cwd of the event when none is given, and does nothing when there are no rules', async () => {
    await put('no-rm', { event: 'bash', action: 'block', pattern: 'rm' });
    assert.equal(evaluate('bash', bashEvent('rm x', project), { tmp: state }).exitCode, 2);
    assert.deepEqual(evaluate('bash', bashEvent('rm x', path.join(tmp.dir, 'empty')), { tmp: state }), { exitCode: 0, stdout: '', stderr: '' });
  });
  it('ignores files that are not rules, rule files that are too big, and anything beyond the cap', async () => {
    await writeFile(path.join(project, ...RULE_DIR.split('/'), 'notes.md'), rule({ event: 'bash', action: 'block', pattern: 'rm' }));
    await writeFile(path.join(project, ...RULE_DIR.split('/'), 'big.local.md'), `${rule({ event: 'bash', action: 'block', pattern: 'rm' })}${'x'.repeat(70_000)}`);
    const loaded = loadRules(project);
    assert.deepEqual(loaded.rules, []);
    assert.match(loaded.warnings[0], /big\.local\.md: larger than 65536 bytes, skipped/);
    for (let i = 0; i < 205; i += 1) await put(`r${String(i).padStart(3, '0')}`, { event: 'bash', action: 'warn', pattern: 'zzz' });
    const many = loadRules(project);
    assert.equal(many.rules.length, 199, 'the first 200 files, less the one that is too big');
    assert.ok(many.warnings.some((warning) => /6 rule files beyond the first 200/.test(warning)));
  });
  it('knows the four events', () => assert.deepEqual([...EVENTS], ['bash', 'file', 'prompt', 'stop']));
});

describe('readInput', () => {
  it('reads a stream to the end, and gives up on a terminal, a failing stream and a silent one', async () => {
    const stream = new PassThrough();
    const pending = readInput(stream);
    stream.end('{"a":1}');
    assert.equal(await pending, '{"a":1}');
    assert.equal(await readInput(Object.assign(new PassThrough(), { isTTY: true })), null);
    const failing = new PassThrough();
    const failed = readInput(failing);
    failing.destroy(new Error('boom'));
    assert.equal(await failed, null);
    assert.equal(await readInput(new PassThrough(), 20), null);
  });
});

describe('the script as a process', () => {
  let tmp;
  let project;
  before(async () => {
    tmp = await makeTempDir();
    project = path.join(tmp.dir, 'project');
    await mkdir(path.join(project, ...RULE_DIR.split('/')), { recursive: true });
    await writeFile(path.join(project, ...RULE_DIR.split('/'), 'no-rm.local.md'), rule({ name: 'no-rm', event: 'bash', action: 'block', pattern: '"rm\\s+-rf"' }, 'Never delete recursively.'));
    await writeFile(path.join(project, ...RULE_DIR.split('/'), 'stop.local.md'), rule({ name: 'finish', event: 'stop', action: 'block' }, 'Finish the checklist.'));
  });
  after(() => tmp.cleanup());
  const spawn = (args, input) =>
    new Promise((resolve) => {
      const child = execFile(process.execPath, [GUARD, ...args], { cwd: project, env: { ...process.env, TMPDIR: tmp.dir } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
      child.stdin.end(input);
    });
  it('exits 2 with the message on stderr for a command a block rule matches, as the exact hook command runs it', async () => {
    const result = await spawn(['bash'], bashEvent('rm -rf victim', project));
    assert.deepEqual([result.code, result.stdout, result.stderr], [2, '', '[no-rm] Never delete recursively.\n']);
  });
  it('exits 0 and prints nothing for a command no rule matches', async () => {
    assert.deepEqual(await spawn(['bash'], bashEvent('ls', project)), { code: 0, stdout: '', stderr: '' });
  });
  it('prints the block decision for a stop rule, once', async () => {
    const first = await spawn(['stop'], stopEvent('sess_process', project));
    assert.equal(first.code, 0);
    assert.equal(JSON.parse(first.stdout).decision, 'block');
    assert.equal((await spawn(['stop'], stopEvent('sess_process', project))).stdout, '');
  });
  it('exits 0 with a note when the event is not JSON', async () => {
    const result = await spawn(['bash'], 'garbage');
    assert.equal(result.code, 0);
    assert.match(result.stderr, /not valid JSON/);
  });
});
