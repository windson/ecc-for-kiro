// The git push guard that the ecc-git-push-review hook runs: how it finds a push, what it does with an
// event, and the real script run as a process the way Kiro runs it.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, describe, it } from 'node:test';

import { ACK_VARIABLE, CHECKLIST, blockMessage, containsGitPush, evaluate, isAcknowledged, readInput } from '../skills/ecc-kiro-setup/scripts/runtime/git-push-guard.mjs';
import { makeTempDir } from './fixtures.mjs';
import { SHIPPED_GUARD_PATH } from './hook-assets.mjs';

const event = (toolInput, extra = {}) => JSON.stringify({ hook_event_name: 'preToolUse', cwd: '/work', session_id: 's', tool_name: 'execute_bash', tool_input: toolInput, ...extra });
const decide = (command) => evaluate(event({ command }));

describe('containsGitPush', () => {
  it('finds a push however the command is written', () => {
    for (const command of [
      'git push',
      'git push origin main',
      'git push -u origin feature/x',
      'git push --force-with-lease',
      'git -C /work/repo push',
      'git -c user.name=a -c user.email=b push --tags',
      'git --git-dir=.git --work-tree=. push',
      'git --no-pager push',
      '/usr/bin/git push',
      '  git   push  ',
      'git add . && git push',
      'git add . && git commit -m "x" && git push origin HEAD',
      'cd repo; git push',
      'cd repo\ngit push',
      'make test || git push',
      'git fetch & git push',
      'echo done | git push',
      '(cd repo && git push)',
      'echo $(git push)',
      'echo `git push`',
      'GIT_SSH_COMMAND="ssh -i key" git push',
      'FOO=1 BAR=2 git push',
      'sudo git push',
      'env GIT_TRACE=1 git push',
      'exec git push',
      'time git push',
      'if git push; then echo ok; fi',
      'bash -c "git push"',
      "sh -c 'git push origin main'",
      'bash -lc "cd x && git push"',
      'eval "git push"',
      'bash -c "bash -c \'git push\'"',
    ]) {
      assert.equal(containsGitPush(command), true, command);
    }
  });

  it('leaves every other command alone', () => {
    for (const command of [
      '',
      'ls -la',
      'git status',
      'git pull',
      'git pull --rebase origin main',
      'git log --oneline',
      'git remote -v',
      'git stash push',
      'git commit -m "push the button"',
      'git commit -m "docs: say how to git push"',
      'echo "run git push when ready"',
      'echo git push',
      'gitpush',
      'pushd repo',
      'git-push',
      'git',
      'git -C',
      'GIT_TRACE=1',
      'npm run push',
      'rsync -a src/ dest/',
      'bash script.sh',
      'bash -c "ls"',
      'eval "ls"',
    ]) {
      assert.equal(containsGitPush(command), false, JSON.stringify(command));
    }
  });

  it('reads what eval runs as the words joined, and what sh -c runs as the one word after -c', () => {
    assert.equal(containsGitPush('eval git push'), true);
    assert.equal(containsGitPush('eval "git" push'), true);
    assert.equal(containsGitPush('bash -c "git push" arg0 arg1'), true);
    assert.equal(containsGitPush('bash -c git push'), false, 'the script is "git"; push is only a parameter');
    assert.equal(containsGitPush('bash -c'), false);
    assert.equal(containsGitPush('bash script.sh git push'), false);
  });

  it('follows commands inside eval for three levels, and no further', () => {
    assert.equal(containsGitPush('eval git push'), true);
    assert.equal(containsGitPush('eval eval git push'), true);
    assert.equal(containsGitPush('eval eval eval git push'), true);
    assert.equal(containsGitPush('eval eval eval eval git push'), false);
  });

  it('takes a push after a semicolon inside a quote for a push (a known limit)', () => {
    assert.equal(containsGitPush('git commit -m "done; git push later"'), true);
  });
});

describe('isAcknowledged', () => {
  it('is true when the command line starts with ECC_PUSH_REVIEWED=1 and a space', () => {
    for (const command of ['ECC_PUSH_REVIEWED=1 git push', '  ECC_PUSH_REVIEWED=1 git push origin main', 'ECC_PUSH_REVIEWED=1\tgit push', 'ECC_PUSH_REVIEWED=1 git add . && git push']) {
      assert.equal(isAcknowledged(command), true, command);
    }
  });

  it('is false for anything else', () => {
    for (const command of ['git push', 'ECC_PUSH_REVIEWED=0 git push', 'ECC_PUSH_REVIEWED=10 git push', 'ECC_PUSH_REVIEWED= git push', 'ECC_PUSH_REVIEWED=1', 'ECC_PUSH_REVIEWED=1git push', 'git add . && ECC_PUSH_REVIEWED=1 git push', 'export ECC_PUSH_REVIEWED=1; git push', 'XECC_PUSH_REVIEWED=1 git push', 'ecc_push_reviewed=1 git push']) {
      assert.equal(isAcknowledged(command), false, command);
    }
  });
});

describe('evaluate', () => {
  it('lets an ordinary command run: exit 0 and nothing on stderr', () => {
    assert.deepEqual(decide('ls -la'), { exitCode: 0, stderr: '' });
    assert.deepEqual(decide('git status'), { exitCode: 0, stderr: '' });
  });

  it('blocks git push: exit 2, with the checklist and how to acknowledge it', () => {
    const result = decide('git push origin main');
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, blockMessage());
    for (const item of CHECKLIST) assert.ok(result.stderr.includes(item), item);
    assert.match(result.stderr, /run the same command again with ECC_PUSH_REVIEWED=1 in front of it/);
    assert.match(result.stderr, /\n {2}ECC_PUSH_REVIEWED=1 git push origin main\n$/);
  });

  it('blocks a push that is part of a longer command', () => {
    assert.equal(decide('git add . && git push').exitCode, 2);
    assert.equal(decide('cd /repo && git commit -m x; git push origin HEAD').exitCode, 2);
  });

  it('lets an acknowledged push run', () => {
    assert.deepEqual(decide('ECC_PUSH_REVIEWED=1 git push origin main'), { exitCode: 0, stderr: '' });
    assert.deepEqual(decide('ECC_PUSH_REVIEWED=1 git add . && git push'), { exitCode: 0, stderr: '' }, 'the acknowledgement covers the whole command line it starts');
  });

  it('does not take 0, 10 or an acknowledgement in the middle for an acknowledgement', () => {
    assert.equal(decide('ECC_PUSH_REVIEWED=0 git push').exitCode, 2);
    assert.equal(decide('ECC_PUSH_REVIEWED=10 git push').exitCode, 2);
    assert.equal(decide('git add . && ECC_PUSH_REVIEWED=1 git push').exitCode, 2);
  });

  it('finds the command wherever the event keeps it', () => {
    assert.equal(evaluate(event({ command: 'git push' })).exitCode, 2);
    assert.equal(evaluate(event({ cmd: 'git push', timeout: 30 })).exitCode, 2);
    assert.equal(evaluate(event({ args: { run: ['git push'] } })).exitCode, 2);
    assert.equal(evaluate(event('git push')).exitCode, 2, 'tool_input may be the command itself');
    assert.equal(evaluate(event({ command: ['git', 'push', 'origin'] })).exitCode, 2, 'a command given as words');
    assert.equal(evaluate(event({ description: 'Publish', command: 'git push' })).exitCode, 2);
    assert.equal(evaluate(event({ a: { b: { c: { d: 'git push' } } } })).exitCode, 2);
  });

  it('does not look at the names of the fields or at the tool name', () => {
    assert.equal(evaluate(event({ 'git push': 'x' })).exitCode, 0);
    assert.equal(evaluate(event({ command: 'ls' }, { tool_name: 'git push' })).exitCode, 0);
  });

  it('does not take a sentence that mentions git push for a push', () => {
    assert.equal(evaluate(event({ path: 'README.md', content: 'When ready, run git push to publish.' })).exitCode, 0);
    assert.equal(evaluate(event({ command: 'echo "git push"' })).exitCode, 0);
  });

  it('blocks when one of several strings is an unacknowledged push', () => {
    assert.equal(evaluate(event({ command: 'ECC_PUSH_REVIEWED=1 git push', script: 'git push' })).exitCode, 2);
    assert.equal(evaluate(event({ command: 'ECC_PUSH_REVIEWED=1 git push', note: 'ECC_PUSH_REVIEWED=1 git push' })).exitCode, 0);
  });

  it('lets the tool run, with a warning, when it cannot read the event', () => {
    for (const input of ['', '   \n', 'not json', '{', '[]', 'null', '42', '"git push"', '{"tool_name":"execute_bash"}']) {
      const result = evaluate(input);
      assert.equal(result.exitCode, 0, JSON.stringify(input));
      assert.match(result.stderr, /^ecc git-push-guard: .*; the command was not checked\.\n$/, JSON.stringify(input));
    }
    assert.match(evaluate('').stderr, /the hook event is empty/);
    assert.match(evaluate('not json').stderr, /not valid JSON/);
    assert.match(evaluate('[]').stderr, /not a JSON object/);
    assert.match(evaluate('{"a":1}').stderr, /no tool_input/);
  });

  it('keeps going on a very deep or very wide event', () => {
    let deep = 'git push';
    for (let i = 0; i < 50; i += 1) deep = { next: deep };
    assert.equal(evaluate(event(deep)).exitCode, 0, 'depth is limited');
    const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i < 300 ? 'ls' : 'git push']));
    assert.equal(evaluate(event(wide)).exitCode, 0, 'the number of strings read is limited');
  });
});

describe('the block message', () => {
  it('is the four-point checklist from ECC\'s git-push-review hook, in plain words', () => {
    assert.deepEqual([...CHECKLIST], ['All tests pass.', 'The code has been reviewed.', 'The commit messages are clear.', 'The target branch is correct.']);
    assert.equal(
      blockMessage(),
      [
        'ECC pre-push check: this command runs git push, so it was not run.',
        'Before you push, make sure that:',
        '  1. All tests pass.',
        '  2. The code has been reviewed.',
        '  3. The commit messages are clear.',
        '  4. The target branch is correct.',
        'When all four are true, run the same command again with ECC_PUSH_REVIEWED=1 in front of it, for example:',
        '  ECC_PUSH_REVIEWED=1 git push origin main',
        '',
      ].join('\n'),
    );
    assert.equal(ACK_VARIABLE, 'ECC_PUSH_REVIEWED');
    assert.doesNotMatch(blockMessage(), /[!—]/, 'no exclamation marks or em dashes');
  });
});

describe('readInput', () => {
  it('reads a stream to its end as UTF-8', async () => {
    const stream = new PassThrough();
    const pending = readInput(stream, 1000);
    stream.write(Buffer.from('{"a":"é'));
    stream.end(Buffer.from('"}'));
    assert.equal(await pending, '{"a":"é"}');
  });

  it('gives an empty string for a stream that ends at once', async () => {
    const stream = new PassThrough();
    stream.end();
    assert.equal(await readInput(stream, 1000), '');
  });

  it('gives null for a terminal, since nothing can arrive', async () => {
    const stream = new PassThrough();
    stream.isTTY = true;
    assert.equal(await readInput(stream, 1000), null);
  });

  it('gives null, and closes the stream, when nothing arrives in time', async () => {
    const stream = new PassThrough();
    assert.equal(await readInput(stream, 20), null);
    assert.equal(stream.destroyed, true);
  });

  it('gives null when the stream fails', async () => {
    const stream = new PassThrough();
    const pending = readInput(stream, 1000);
    stream.destroy(new Error('broken pipe'));
    assert.equal(await pending, null);
  });
});

describe('the script as a process', () => {
  let tmp;
  let installed;

  /** Run the script the way Kiro does: a process with the event on stdin. */
  function run(input, { script = SHIPPED_GUARD_PATH, cwd } = {}) {
    return new Promise((resolve) => {
      const child = execFile(process.execPath, [script], { cwd }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
      child.stdin.end(input);
    });
  }

  before(async () => {
    tmp = await makeTempDir('ecc-guard-test-');
    installed = path.join(tmp.dir, '.kiro', 'ecc', 'scripts', 'git-push-guard.mjs');
    await mkdir(path.dirname(installed), { recursive: true });
    await copyFile(SHIPPED_GUARD_PATH, installed);
  });
  after(() => tmp.cleanup());

  it('exits 0 with no output for an ordinary command', async () => {
    assert.deepEqual(await run(event({ command: 'npm test' })), { code: 0, stdout: '', stderr: '' });
  });

  it('exits 2 for git push and gives the checklist on stderr, nothing on stdout', async () => {
    const result = await run(event({ command: 'git push origin main' }));
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, blockMessage());
  });

  it('exits 2 for git add . && git push', async () => {
    assert.equal((await run(event({ command: 'git add . && git push' }))).code, 2);
  });

  it('exits 0 for an acknowledged push', async () => {
    assert.deepEqual(await run(event({ command: 'ECC_PUSH_REVIEWED=1 git push origin main' })), { code: 0, stdout: '', stderr: '' });
  });

  it('exits 0 with a warning for input it cannot read, and for no input at all', async () => {
    const garbled = await run('{ this is not json');
    assert.equal(garbled.code, 0);
    assert.match(garbled.stderr, /not valid JSON; the command was not checked/);
    const none = await run('');
    assert.equal(none.code, 0);
    assert.match(none.stderr, /the hook event is empty/);
  });

  it('runs from the installed place, with the working directory of the project, as the hook command does', async () => {
    const result = await new Promise((resolve) => {
      const child = execFile(process.execPath, ['.kiro/ecc/scripts/git-push-guard.mjs'], { cwd: tmp.dir }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
      child.stdin.end(event({ command: 'git push' }));
    });
    assert.equal(result.code, 2);
    assert.equal(result.stderr, blockMessage());
  });

  it('works wherever it is copied, because it imports nothing from the skill', async () => {
    const source = await readFile(SHIPPED_GUARD_PATH, 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    assert.ok(imports.length > 0);
    assert.ok(imports.every((name) => name.startsWith('node:')), imports.join(', '));
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/, 'no dynamic imports either');
    assert.equal((await run(event({ command: 'git push' }), { script: installed })).code, 2);
  });

  it('is not run when it is only imported', async () => {
    const result = await new Promise((resolve) => {
      execFile(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(SHIPPED_GUARD_PATH)}).then((m) => console.log(typeof m.evaluate))`], (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
    });
    assert.deepEqual(result, { code: 0, stdout: 'function\n', stderr: '' });
  });
});
