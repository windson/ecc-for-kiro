// The instinct observer hooks run ECC's observe.sh as it is. This runs the real script from the pinned checkout
// with hook payloads of the shape Kiro sends (captured from a headless run of kiro-cli 2.28.0, V3), to show that no
// adapter is needed. Skipped without the source cache, bash, python3 or git.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resolveCacheRoot } from '../skills/ecc-kiro-setup/scripts/lib/paths.mjs';
import { INSTINCT_HOOK_FILE, OBSERVE_SCRIPT, instinctHooks } from '../skills/ecc-kiro-setup/scripts/lib/owned.mjs';
import { cacheCheckoutPath } from '../skills/ecc-kiro-setup/scripts/io/source.mjs';
import { makeTempDir } from './fixtures.mjs';

const checkout = cacheCheckoutPath(resolveCacheRoot(process.env, os.homedir()));
const skillSource = path.join(checkout, 'skills', 'continuous-learning-v2');
const have = (command) => {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const runnable = existsSync(path.join(skillSource, 'hooks', 'observe.sh')) && existsSync(path.join(skillSource, 'scripts', 'lib', 'homunculus-dir.sh')) && have('bash') && have('python3') && have('git');

describe('ECC observe.sh with the hook payloads of Kiro', { skip: runnable ? false : 'the source cache, bash, python3 or git is missing' }, () => {
  let tmp;
  let project;
  let homunculus;
  before(async () => {
    tmp = await makeTempDir();
    project = path.join(tmp.dir, 'project');
    homunculus = path.join(tmp.dir, 'homunculus');
    await mkdir(path.join(project, '.kiro', 'skills'), { recursive: true });
    execFileSync('git', ['init', '-q', project]);
    cpSync(skillSource, path.join(project, '.kiro', 'skills', 'continuous-learning-v2'), { recursive: true });
  });
  after(() => tmp.cleanup());

  const observe = (phase, payload) =>
    new Promise((resolve) => {
      const child = execFile('bash', [OBSERVE_SCRIPT, phase], { cwd: project, env: { ...process.env, CLV2_HOMUNCULUS_DIR: homunculus, CLAUDE_CODE_ENTRYPOINT: undefined, ECC_HOOK_PROFILE: undefined } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
      child.stdin.end(JSON.stringify(payload));
    });
  const observations = () => {
    const found = [];
    const walk = (dir) => {
      for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'observations.jsonl') found.push(...readFileSync(full, 'utf8').trim().split('\n').map((line) => JSON.parse(line)));
      }
    };
    walk(homunculus);
    return found;
  };
  // Shapes from the capture: write and shell tools, tool_response as text.
  const cwd = () => realpathSync(project);
  const base = (name, input, extra = {}) => ({ session_id: 'sess_19fd88fe-bf56-41be-8a44-d0556e536be5', cwd: cwd(), tool_name: name, tool_input: input, ...extra });

  it('records a tool call before it runs, with the Kiro tool name, the session and the project', async () => {
    const result = await observe('pre', base('fs_write', { path: `${cwd()}/hello.txt`, text: 'hi' }, { hook_event_name: 'PreToolUse' }));
    assert.equal(result.code, 0, result.stderr);
    const [first] = observations();
    assert.deepEqual([first.event, first.tool, first.session, first.project_name], ['tool_start', 'fs_write', 'sess_19fd88fe-bf56-41be-8a44-d0556e536be5', 'project']);
    assert.match(first.input, /hello\.txt/);
    assert.equal('output' in first, false);
  });
  it('records the result after it ran, from a tool_response that is plain text', async () => {
    const result = await observe('post', base('execute_bash', { command: 'ls', cwd: cwd() }, { hook_event_name: 'PostToolUse', tool_response: 'Output:\nhello.txt\n\n\nExit Code: 0' }));
    assert.equal(result.code, 0, result.stderr);
    const last = observations().at(-1);
    assert.deepEqual([last.event, last.tool], ['tool_complete', 'execute_bash']);
    assert.match(last.output, /hello\.txt/);
    assert.equal('input' in last, false);
  });
  it('scrubs a secret in a tool input before it is stored', async () => {
    await observe('pre', base('execute_bash', { command: 'curl -H "Authorization: Bearer abcdef0123456789abcdef" https://example.com' }));
    const last = observations().at(-1);
    assert.doesNotMatch(last.input, /abcdef0123456789abcdef/);
    assert.match(last.input, /\[REDACTED\]/);
  });
  it('keeps the observations of the project apart from the global folder, under the data folder it was given', () => {
    assert.ok(existsSync(path.join(homunculus, 'projects')));
    assert.ok(existsSync(path.join(homunculus, 'projects.json')));
  });
  it('exits 0 and writes nothing for an empty event', async () => {
    const before_ = observations().length;
    const result = await new Promise((resolve) => {
      const child = execFile('bash', [OBSERVE_SCRIPT, 'pre'], { cwd: project, env: { ...process.env, CLV2_HOMUNCULUS_DIR: homunculus } }, (error) => resolve({ code: error ? error.code : 0 }));
      child.stdin.end('');
    });
    assert.equal(result.code, 0);
    assert.equal(observations().length, before_);
  });
  it('is the script the hook files run, with the two phases it reads', () => {
    const text = readFileSync(path.join(skillSource, 'hooks', 'observe.sh'), 'utf8');
    assert.match(text, /HOOK_PHASE="\$\{1:-\}"/);
    assert.match(text, /event = "tool_start" if hook_phase == "pre" else "tool_complete"/);
    assert.deepEqual(instinctHooks().map((hook) => hook.action.command.split(' ').at(-1)), ['pre', 'post']);
    assert.ok(instinctHooks().every((hook) => hook.action.command.startsWith(`bash ${OBSERVE_SCRIPT} `)));
    assert.equal(INSTINCT_HOOK_FILE, '.kiro/hooks/ecc-instinct-observe.json');
  });
});
