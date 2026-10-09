import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXIT, UsageError, parseArguments, runCli, usage } from '../skills/ecc-kiro-setup/scripts/lib/cli.mjs';
import { VALID_SKILL_MD, captureStreams, memoryProbes } from './helpers.mjs';

const ROOT = '/work/project';
const SKILL_DIR = `${ROOT}/.kiro/skills/ecc-kiro-setup`;

async function invoke(argv, probeOptions = {}) {
  const streams = captureStreams();
  const probes = memoryProbes({ ...probeOptions, files: { [`${SKILL_DIR}/SKILL.md`]: VALID_SKILL_MD, ...(probeOptions.files ?? {}) } });
  const code = await runCli(argv, { stdout: streams.stdout, stderr: streams.stderr, probes, skillDir: SKILL_DIR });
  return { code, out: streams.out, err: streams.err };
}

describe('runCli: help and usage', () => {
  it('prints usage to stderr and exits 2 when no command is given', async () => {
    const { code, out, err } = await invoke([]);
    assert.equal(code, EXIT.USAGE);
    assert.equal(out, '');
    assert.match(err, /Usage: node ecc-kiro\.mjs <command> \[options\]/);
  });

  it('prints usage to stdout and exits 0 for help, --help and -h', async () => {
    for (const argv of [['help'], ['--help'], ['-h'], ['doctor', '--help'], ['doctor', '-h']]) {
      const { code, out } = await invoke(argv);
      assert.equal(code, EXIT.OK, argv.join(' '));
      assert.match(out, /Commands:/);
    }
  });

  it('lists the seven commands in order, each with its options, and none as unavailable', () => {
    const text = usage();
    const lineFor = (name) => text.split('\n').find((line) => line.trimStart().startsWith(`${name} `));
    assert.match(lineFor('doctor'), /check tools/);
    const names = ['doctor', 'verify', 'profile', 'plan', 'install', 'update', 'uninstall'];
    const at = names.map((name) => text.indexOf(`\n  ${name} `));
    assert.ok(at.every((index, i) => index > 0 && (i === 0 || index > at[i - 1])), 'in this order');
    assert.doesNotMatch(text, /not available/);
    assert.match(text, /Exit codes: 0 ok, 1 a check failed, 2 usage error\./);
  });

  it('gives update the options of install, and uninstall the same without the ones about the ECC source', () => {
    const optionsOf = (name) => {
      const lines = usage().split('\n');
      return lines[lines.findIndex((line) => line.trimStart().startsWith(`${name} `)) + 1].trim().replace('options: ', '').split(' ');
    };
    assert.deepEqual(optionsOf('update'), optionsOf('install'));
    assert.deepEqual(optionsOf('uninstall'), ['--json', '--root', '--only', '--yes', '--dry-run']);
    assert.deepEqual(optionsOf('plan').slice(-2), ['--only', '--action']);
  });
});

describe('runCli: errors', () => {
  it('rejects unknown commands with exit 2', async () => {
    const { code, err } = await invoke(['bogus']);
    assert.equal(code, EXIT.USAGE);
    assert.match(err, /unknown command "bogus"/);
  });

  it('does not treat inherited object properties as commands', async () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal((await invoke([name])).code, EXIT.USAGE, name);
    }
  });

  it('prints errors as JSON on stdout when --json is given', async () => {
    const { code, out, err } = await invoke(['bogus', '--json']);
    assert.equal(code, EXIT.USAGE);
    assert.equal(err, '');
    const body = JSON.parse(out);
    assert.equal(body.ok, false);
    assert.equal(body.command, 'bogus');
    assert.equal(body.error.code, 'usage');
  });

  it('makes install, update and uninstall ask for --yes or --dry-run before they look at anything', async () => {
    for (const [name, verb, preview] of [['install', 'writes', '"plan"'], ['update', 'writes and removes', '"plan --action update"'], ['uninstall', 'removes', '"plan --action uninstall"']]) {
      const { code, err } = await invoke([name]);
      assert.equal(code, EXIT.USAGE, name);
      assert.ok(err.includes(`${name} ${verb} files. Preview with ${preview} (or --dry-run), then run again with --yes`), err);
      const both = JSON.parse((await invoke([name, '--yes', '--dry-run', '--json'])).out);
      assert.equal(both.error.code, 'usage', name);
      assert.match(both.error.message, /either --yes or --dry-run/, name);
    }
  });

  it('does not let uninstall take the options about the ECC source', async () => {
    for (const option of ['--source', '--fetch', '--profile']) {
      const argv = option === '--fetch' ? ['uninstall', option, '--yes'] : ['uninstall', option, '/x', '--yes'];
      const { code, err } = await invoke(argv);
      assert.equal(code, EXIT.USAGE, option);
      assert.match(err, new RegExp(`unknown option ${option}`), option);
    }
  });

  it('exits 1 and reports the message when a probe throws', async () => {
    const streams = captureStreams();
    const probes = memoryProbes();
    probes.stat = async () => {
      throw new Error('disk on fire');
    };
    const code = await runCli(['doctor'], { stdout: streams.stdout, stderr: streams.stderr, probes, skillDir: SKILL_DIR });
    assert.equal(code, EXIT.FAILED);
    assert.match(streams.err, /disk on fire/);

    const jsonStreams = captureStreams();
    const jsonCode = await runCli(['doctor', '--json'], { stdout: jsonStreams.stdout, stderr: jsonStreams.stderr, probes, skillDir: SKILL_DIR });
    assert.equal(jsonCode, EXIT.FAILED);
    assert.equal(JSON.parse(jsonStreams.out).error.code, 'failed');
  });
});

describe('runCli: doctor', () => {
  it('prints JSON and exits 0 when healthy', async () => {
    const { code, out, err } = await invoke(['doctor', '--json'], { cwd: ROOT });
    assert.equal(code, EXIT.OK);
    assert.equal(err, '');
    const report = JSON.parse(out);
    assert.equal(report.schema, 'ecc-kiro.doctor.v1');
    assert.equal(report.ok, true);
    assert.equal(report.target.root, ROOT);
  });

  it('prints a readable summary by default', async () => {
    const { code, out } = await invoke(['doctor'], { cwd: ROOT });
    assert.equal(code, EXIT.OK);
    assert.match(out, /doctor \(ECC v2\.2\.3/);
    assert.match(out, /Result: ok/);
  });

  it('inspects --root instead of the working directory', async () => {
    const spaced = await invoke(['doctor', '--json', '--root', '/other/dir'], { cwd: ROOT });
    assert.equal(JSON.parse(spaced.out).target.root, '/other/dir');
    const equals = await invoke(['doctor', '--json', '--root=/third/dir'], { cwd: ROOT });
    assert.equal(JSON.parse(equals.out).target.root, '/third/dir');
  });

  it('exits 1 when the report contains an error', async () => {
    const { code, out } = await invoke(['doctor', '--json'], { node: '16.0.0' });
    assert.equal(code, EXIT.FAILED);
    assert.equal(JSON.parse(out).ok, false);
  });

  it('rejects bad options and extra arguments with exit 2', async () => {
    for (const argv of [
      ['doctor', '--root'],
      ['doctor', '--root', '--json'],
      ['doctor', '--root='],
      ['doctor', '--bogus'],
      ['doctor', '-x'],
      ['doctor', '--json=1'],
      ['doctor', 'extra'],
      ['doctor', '--source', '/x'],
    ]) {
      const { code, out, err } = await invoke(argv);
      assert.equal(code, EXIT.USAGE, argv.join(' '));
      // Errors go to stderr, or to stdout as JSON when --json is one of the arguments.
      assert.match(err + out, /Run with --help for usage/, argv.join(' '));
    }
  });
});

describe('parseArguments', () => {
  const allowed = ['json', 'root', 'help'];

  it('parses flags, values and the equals form', () => {
    assert.deepEqual(parseArguments(['--json', '--root=/x'], allowed), { options: { json: true, root: '/x' }, positionals: [] });
    assert.deepEqual(parseArguments(['--root', '/y'], allowed).options, { root: '/y' });
  });

  it('treats everything after -- as positional and -h as help', () => {
    assert.deepEqual(parseArguments(['-h', '--', '--json', 'a'], allowed), { options: { help: true }, positionals: ['--json', 'a'] });
  });

  it('rejects options the command does not accept, including inherited property names', () => {
    for (const bad of ['--yes', '--constructor', '--__proto__', '--toString']) {
      assert.throws(() => parseArguments([bad], allowed), UsageError, bad);
    }
  });

  it('keeps a single dash as a positional', () => {
    assert.deepEqual(parseArguments(['-'], allowed).positionals, ['-']);
  });
});
