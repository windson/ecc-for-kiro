// The real ECC v2.2.3 commands: the 94 files of commands/, the two scripts of the Kiro adapter and the
// data that ships in assets/commands. These tests read the pinned checkout in the source cache and
// are skipped when it is not there (fetch it with: ecc-kiro.mjs verify --fetch).

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import nodeFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { EXIT, runCli } from '../skills/ecc-kiro-setup/scripts/lib/cli.mjs';
import { defaultProfilePath } from '../skills/ecc-kiro-setup/scripts/lib/commands/verify.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';
import { resolveCacheRoot } from '../skills/ecc-kiro-setup/scripts/lib/paths.mjs';
import { buildPlanned, entriesFor } from '../skills/ecc-kiro-setup/scripts/lib/plan.mjs';
import * as S from '../skills/ecc-kiro-setup/scripts/lib/slash-commands.mjs';
import { cacheCheckoutPath, readVerifiedFiles } from '../skills/ecc-kiro-setup/scripts/io/source.mjs';
import { shippedCommandAssets } from './command-assets.mjs';
import { makeTempDir, pinnedGit } from './fixtures.mjs';
import { captureStreams, memoryProbes } from './helpers.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..', 'skills', 'ecc-kiro-setup');
const checkout = cacheCheckoutPath(resolveCacheRoot(process.env, os.homedir()));
const haveCheckout = existsSync(path.join(checkout, 'AGENTS.md')) && existsSync(path.join(checkout, 'commands', 'plan.md'));
const SNAPSHOT = JSON.parse(readFileSync(path.join(HERE, 'snapshots', 'commands-v2.2.3.json'), 'utf8'));
const decoder = new TextDecoder('utf-8', { fatal: true });

// Written apart from the data files, so that a pattern dropped from lint-patterns.json is noticed here.
const NOT_IN_AN_INSTALLED_COMMAND = [
  /~\/\.claude/,
  /(^|[^\w/])\.claude\//m,
  /CLAUDE\.md/,
  /CLAUDE_[A-Z_]+/,
  /\$ARGUMENTS/,
  /\bClaude\b/,
  /\bTask tool\b/,
  /\bAskUserQuestion\b/,
  /codeagent-wrapper/,
  /node -e/,
  /scripts\/hooks\//,
  /session-manager/,
];
const HEADER_ONLY = ['build-fix', 'feature-dev', 'gradle-build', 'refactor-clean', 'test-coverage', 'update-codemaps', 'update-docs'];

describe('the real ECC commands', { skip: haveCheckout ? false : 'ECC v2.2.3 is not in the source cache' }, () => {
  let profile;
  let read;
  let built;
  let assets;
  let commands;
  let text;

  const source = (rel) => decoder.decode(read.files.get(rel));
  const stem = (dest) => dest.split('/').pop().replace(/\.md$/, '');
  const destOf = (name) => `.kiro/steering/ecc-${name}.md`;

  before(() => {
    profile = JSON.parse(readFileSync(defaultProfilePath(SKILL_DIR), 'utf8'));
    assets = shippedCommandAssets();
    return readVerifiedFiles({ dir: checkout, entries: entriesFor(['commands'], profile) }).then((result) => {
      read = result;
      assert.deepEqual(read.missing, []);
      assert.deepEqual(read.mismatched, []);
      built = buildPlanned({ parts: ['commands'], profile, sourceFiles: read.files, sourceExecutable: read.executable, commandAssets: assets });
      commands = built.details.commands;
      text = new Map(built.planned.map((file) => [file.dest, Buffer.isBuffer(file.content) ? file.content : String(file.content)]));
    });
  });

  it('reads the 94 commands and the 2 scripts of the Kiro adapter, all matching the profile', () => {
    const entries = entriesFor(['commands'], profile);
    assert.deepEqual([entries.filter((e) => e.category === 'command').length, entries.filter((e) => e.category === 'adapter-script').length], [94, 2]);
    assert.equal(read.files.size, 96);
  });

  describe('the data files that ship', () => {
    it('load and are valid', () => {
      assert.deepEqual(S.validateClasses(assets.classes), []);
      assert.deepEqual(S.validateRewriteRules(assets.rules), []);
      assert.deepEqual(S.validateSnippets(assets.snippets), []);
      assert.deepEqual(S.validateLintPatterns(assets.lint), []);
      // Whatever overlay ships must be current, so none is stale or orphaned. NOTICE-ECC.md is the notice, not an overlay.
      assert.deepEqual(commands.overlays.filter((item) => item.status !== 'used'), []);
    });

    it('give every one of the 94 commands a class, and no command that does not exist: 62 A, 31 B, 1 C', () => {
      const names = profile.entries.filter((e) => e.category === 'command').map((e) => e.name).sort();
      assert.deepEqual(Object.keys(assets.classes.commands).sort(), names);
      const byClass = { A: 0, B: 0, C: 0 };
      for (const entry of Object.values(assets.classes.commands)) byClass[entry.class] += 1;
      assert.deepEqual(byClass, { A: 62, B: 31, C: 1 });
    });

    it('leave two commands to a skill of the same name, and one to the engine', () => {
      const entries = Object.entries(assets.classes.commands);
      assert.deepEqual(entries.filter(([, e]) => e.skill !== undefined).map(([name, e]) => [name, e.skill]), [['ecc-guide', 'ecc-guide'], ['plan-canvas', 'plan-canvas']]);
      assert.deepEqual(entries.filter(([, e]) => e.builtin !== undefined).map(([name]) => name), ['quality-gate']);
      const skills = new Set(profile.entries.filter((e) => e.category === 'skill').map((e) => e.skill));
      assert.ok(skills.has('ecc-guide') && skills.has('plan-canvas'));
    });

    it('name the 21 optional skills that the install does not have, and none of the orch skills, which are not optional', () => {
      const skills = new Set(profile.entries.filter((e) => e.category === 'skill').map((e) => e.skill));
      assert.ok(assets.rules.uninstalledSkills.every((name) => !skills.has(name)), 'none of the listed skills is installed');
      assert.equal(assets.rules.uninstalledSkills.length, 21);
      assert.ok(assets.rules.uninstalledSkills.every((name) => !name.startsWith('orch-')), 'the orch skills are not optional');
    });

    it('cover every rule R1 to R16 of the map that has a rewrite, and say which do not', () => {
      const covered = new Set(assets.rules.rules.map((rule) => rule.rule));
      for (const number of ['R1', 'R2', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R13', 'R14']) assert.ok(covered.has(number), number);
      assert.match(assets.rules.description, /R11, R12, R15 and R16 have no rewrite/);
    });
  });

  it('plans without a problem: 92 commands registered, none pending, 2 left to a skill', () => {
    assert.deepEqual(built.problems, []);
    assert.equal(commands.total, 94);
    assert.equal(commands.registered, 92);
    assert.deepEqual(commands.pending, []);
    assert.equal(commands.skipped.length, 2);
    assert.equal(built.planned.filter((f) => f.category === 'command').length, 92);
    assert.equal(built.planned.filter((f) => f.category === 'command-script').length, 2);
    assert.equal(commands.withOverlay, 30);
    assert.deepEqual(commands.overlays.map((item) => item.name), Object.entries(assets.classes.commands).filter(([, e]) => e.class !== 'A' && e.skill === undefined && e.builtin === undefined).map(([name]) => name).sort());
  });

  it('matches the snapshot: which commands are registered, pending and left to a skill', () => {
    const registered = built.planned.filter((f) => f.category === 'command').map((f) => stem(f.dest).replace(/^ecc-/, '')).sort();
    assert.deepEqual(registered, SNAPSHOT.registered);
    assert.deepEqual(Object.fromEntries(commands.pending.map((item) => [item.name, item.class])), SNAPSHOT.pending);
    assert.deepEqual(commands.skipped.map((item) => item.name), SNAPSHOT.skipped);
    assert.deepEqual(commands.scripts, SNAPSHOT.scripts);
  });

  it('registers the five orch-* commands as class A, now that their skills are in the profile, and they pass the lint', () => {
    const orch = ['orch-add-feature', 'orch-build-mvp', 'orch-change-feature', 'orch-fix-defect', 'orch-refine-code'];
    const skills = new Set(profile.entries.filter((e) => e.category === 'skill').map((e) => e.skill));
    for (const name of orch) {
      assert.deepEqual(assets.classes.commands[name], { class: 'A' }, name);
      assert.ok(skills.has(name) && skills.has('orch-pipeline'), `${name} and orch-pipeline are installed skills`);
      assert.ok(text.has(destOf(name)), `${name} is registered`);
      assert.ok(!commands.pending.some((item) => item.name === name), `${name} is not pending`);
      assert.match(String(text.get(destOf(name))), /inclusion: manual/);
    }
  });
  it('registers every command except the two left to a skill: the class A commands, the quality gate and the 30 that an overlay delivers', () => {
    const rest = Object.entries(assets.classes.commands).filter(([, e]) => e.skill === undefined).map(([name]) => name);
    assert.deepEqual([...SNAPSHOT.registered].sort(), rest.sort());
    assert.equal(SNAPSHOT.registered.length, 92);
  });

  it('makes the five orch-* wrappers load their skill by file and wait at each gate', () => {
    for (const name of ['orch-add-feature', 'orch-build-mvp', 'orch-change-feature', 'orch-fix-defect', 'orch-refine-code']) {
      const body = String(text.get(destOf(name)));
      assert.ok(body.includes(`Load the \`${name}\` skill: read \`.kiro/skills/${name}/SKILL.md\` and \`.kiro/skills/orch-pipeline/SKILL.md\`, then follow them with \`ARGS\` as the `), name);
      assert.match(body, /At each gate, stop and wait for the user's reply\. Never approve a gate yourself\./, name);
      assert.doesNotMatch(body, /Invoke the `orch-/, name);
      assert.match(body, /## Delegation\n\nDelegate with the sub-agent tool by agent name\./, name);
    }
  });

  it('has no pending command: every class B and C command that is not left to a skill has a current overlay', () => {
    assert.deepEqual(commands.pending, []);
    for (const [name, entry] of Object.entries(assets.classes.commands)) {
      if (entry.class === 'A' || entry.skill !== undefined || entry.builtin !== undefined) continue;
      assert.equal(commands.overlays.find((item) => item.name === name)?.status, 'used', name);
      assert.ok(text.has(destOf(name)), `${name} is registered`);
    }
    const epic = Object.keys(assets.classes.commands).filter((name) => name.startsWith('epic-'));
    assert.equal(epic.length, 7);
    assert.match(String(text.get(destOf('hookify'))), /hookify-guard\.mjs/);
    assert.match(String(text.get(destOf('cost-report'))), /usage-report\.mjs/);
  });

  describe('every command that is installed', () => {
    const installed = () => built.planned.filter((f) => f.category === 'command');

    it('is lint clean, checked here with patterns written apart from the data file', () => {
      for (const file of installed()) {
        const lines = String(file.content).split('\n');
        const kept = S.protectedLines(lines);
        const checked = lines.filter((_, index) => !kept.has(index)).join('\n');
        for (const pattern of NOT_IN_AN_INSTALLED_COMMAND) assert.doesNotMatch(checked, pattern, `${file.dest} matches ${pattern}`);
      }
    });

    it('is lint clean with the shipped patterns too, and the lint sees every command by name', () => {
      const names = Object.entries(assets.classes.commands).filter(([, e]) => e.skill === undefined).map(([name]) => name);
      const compiled = S.compileRewriteRules(assets.rules, { commands: names, installedSkills: new Set(profile.entries.filter((e) => e.category === 'skill').map((e) => e.skill)) });
      const lint = S.compileLintPatterns(assets.lint.patterns, { commands: names, uninstalledSkills: compiled.uninstalledSkills });
      assert.ok(lint.length >= 30);
      for (const file of installed()) assert.deepEqual(S.lintCommand(String(file.content), lint), [], file.dest);
    });

    it('starts with its frontmatter, says inclusion: manual, and has the header S1 right after it', () => {
      for (const file of installed()) {
        const content = String(file.content);
        const name = stem(file.dest).replace(/^ecc-/, '');
        const parsed = parseFrontmatter(content);
        assert.ok(content.startsWith('---\ninclusion: manual\ndescription: "'), file.dest);
        assert.deepEqual(Object.keys(parsed.data), ['inclusion', 'description'], file.dest);
        assert.ok(parsed.data.description.length > 10 && parsed.data.description.length <= 1024, file.dest);
        assert.ok(parsed.body.startsWith(`\nInvoked as \`/ecc-${name}\`. ARGS is the text after \`/ecc-${name}\` in the user's latest message. If invoked with \`#ecc-${name}\`, ARGS is the rest of that message. Empty ARGS follows the no-argument path. Usage: \`/ecc-${name}`), file.dest);
        assert.ok(content.endsWith('\n') && !content.endsWith('\n\n'), file.dest);
      }
    });

    it('keeps the credit lines of ECC exactly as they are, the 9 lines of the snapshot', () => {
      let seen = 0;
      for (const [name, lines] of Object.entries(SNAPSHOT.creditAndLicenseLines)) {
        const original = source(`commands/${name}.md`).split('\n');
        const installedLines = String(text.get(destOf(name))).split('\n');
        for (const line of lines) {
          assert.ok(original.includes(line), `${name}: the ECC file has the line`);
          assert.ok(installedLines.includes(line), `${name}: the installed file keeps the line`);
          seen += 1;
        }
      }
      assert.equal(seen, 9);
      assert.equal(commands.rewrites.protectedLines, 9);
      const lines = String(text.get(destOf('prp-plan'))).split('\n');
      assert.ok(lines.includes('> Adapted from PRPs-agentic-eng by Wirasm. Part of the PRP workflow series.'));
    });

    it('is the text of ECC apart from the header, for the seven commands the map says need the header only', () => {
      for (const name of HEADER_ONLY) {
        const parsed = parseFrontmatter(String(text.get(destOf(name))));
        const original = S.parseCommand({ path: `commands/${name}.md`, text: source(`commands/${name}.md`) });
        const body = parsed.body.replace(/^\nInvoked as [^\n]*\n\n/, '');
        assert.equal(body, `${original.body.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '')}\n`, name);
        assert.equal(parsed.data.description, original.description, name);
      }
    });

    it('matches the snapshot: the number of times each rule changed a command', () => {
      assert.deepEqual(commands.rewrites.byRule, SNAPSHOT.rewritesByRule);
      assert.equal(commands.rewrites.replacements, Object.values(SNAPSHOT.rewritesByRule).reduce((sum, n) => sum + n, 0));
      assert.equal(commands.rewrites.commandsChanged, 54);
    });

    it('turns the maps rules into the text the map promises', () => {
      const body = (name) => String(text.get(destOf(name)));
      // R6: the instinct CLI, from the project, else from the user folder; the resolver blocks are gone.
      const status = body('instinct-status');
      assert.match(status, /\npython3 \.kiro\/skills\/continuous-learning-v2\/scripts\/instinct-cli\.py status\n/);
      assert.doesNotMatch(status, /ECC_ROOT|CLAUDE_PLUGIN_ROOT|node -e|everything-claude-code|marketplaces/);
      assert.match(body('instinct-import'), /Or, if the skill is installed for your user instead of this project:\n\n```bash\npython3 ~\/\.kiro\/skills\/continuous-learning-v2\/scripts\/instinct-cli\.py import/);
      assert.match(body('projects'), /~\/\.local\/share\/ecc-homunculus\/projects\.json/);
      // R5: session files are plain files under ~/.kiro/ecc/session-data, and the legacy folder lookup is gone.
      assert.match(body('save-session'), /mkdir -p \$\{KIRO_HOME:-\$HOME\/\.kiro\}\/ecc\/session-data\n/);
      assert.doesNotMatch(body('resume-session'), /legacy\s+`?~|sessions\/2024-01-15-session/);
      // R7: plans, PRDs and the PRP files go to .kiro/ecc.
      assert.match(body('prp-plan'), /`\.kiro\/ecc\/PRPs\/plans\/\{kebab-case-feature-name\}\.plan\.md`/);
      assert.match(body('plan'), /write `\.kiro\/ecc\/plans\/\{name\}\.plan\.md`/);
      // R4 and S3: skills are written to .kiro/skills, with the limits of Kiro.
      for (const name of ['learn', 'learn-eval', 'skill-create']) assert.match(body(name), /\n## Skill limits\n\nSkill folder name equals `name`, lowercase letters, digits and hyphens, at most 64 characters\. Description at most 1024 characters\.\n$/, name);
      // R9 and S2: delegation by name.
      assert.match(body('gan-build'), /Delegate to the `gan-planner` sub-agent with the user's brief[\s\S]*\n## Delegation\n\nDelegate with the sub-agent tool by agent name\./);
      // R3: the agent and subtask settings become one sentence.
      assert.match(body('security-scan'), /\nThis command runs in the `security-reviewer` sub-agent\. Delegate with the sub-agent tool by agent name\./);
      // R13: an optional skill that is not installed says so.
      assert.match(body('go-review'), /- Skills: `skills\/golang-patterns\/` \(optional skill, not installed\), `skills\/golang-testing\/` \(optional skill, not installed\)/);
      // R1: ARGS, defined by the header.
      assert.match(body('prp-implement'), /mv "ARGS" \.kiro\/ecc\/PRPs\/plans\/completed\//);
      // R2: the prefix, also in the description, and not on the skill that gives /plan-canvas.
      assert.match(parseFrontmatter(body('code-review')).data.description, /use \/ecc-review-pr, and for the adversarially-verified Workflow pass use \/ecc-orch-review\./);
      assert.match(body('plan'), /\/plan-canvas/);
      assert.doesNotMatch(body('plan'), /\/ecc-plan-canvas/);
    });
  });

  it('builds /ecc-quality-gate from the adapter script, and installs quality-gate.sh and format.sh byte for byte with their execute bits', () => {
    const gate = String(text.get(destOf('quality-gate')));
    assert.match(gate, /```bash\nbash \.kiro\/ecc\/scripts\/quality-gate\.sh\n```/);
    assert.match(gate, /bash \.kiro\/ecc\/scripts\/format\.sh <path>/);
    for (const name of ['quality-gate', 'format']) {
      const file = built.planned.find((f) => f.dest === `.kiro/ecc/scripts/${name}.sh`);
      assert.ok(Buffer.from(file.content).equals(Buffer.from(read.files.get(`.kiro/scripts/${name}.sh`))), name);
      assert.equal(file.mode, 0o755, `${name}.sh has its execute bit`);
      assert.ok((statSync(path.join(checkout, '.kiro', 'scripts', `${name}.sh`)).mode & 0o111) !== 0, `${name}.sh is executable in the checkout`);
    }
  });

  it('does not register ecc-guide or plan-canvas, and the skills keep /ecc-guide and /plan-canvas', () => {
    assert.ok(![...text.keys()].some((dest) => /ecc-guide|plan-canvas/.test(dest)));
    for (const name of ['code-review', 'plan']) assert.doesNotMatch(String(text.get(destOf(name))), /\/ecc-ecc-guide|\/ecc-plan-canvas/);
  });

  it('finds no clash between the /ecc-<name> names and the skills, agents, steering and commands of Kiro', () => {
    assert.deepEqual(commands.names.collisions, []);
    assert.deepEqual(commands.names.checked, { skills: 88, agents: 68, steering: 35, builtins: S.KIRO_BUILTIN_COMMANDS.length });
    assert.deepEqual(commands.names.avoided, SNAPSHOT.avoided);
    const steeringBuilt = buildPlanned({ parts: ['steering'], profile, sourceFiles: read.files });
    const dests = new Set(built.planned.map((file) => file.dest));
    assert.deepEqual(steeringBuilt.planned.map((file) => file.dest).filter((dest) => dests.has(dest)), [], 'no steering file of the steering part has the name of a command');
  });

  it('notes the Claude Code settings that are left out', () => {
    assert.deepEqual(commands.dropped, SNAPSHOT.dropped);
  });

  it('reports no Claude Code wording left in any registered command', () => {
    assert.deepEqual(commands.matches, SNAPSHOT.stillClaudeSpecific);
    assert.deepEqual(commands.stillClaudeSpecific, Object.keys(SNAPSHOT.stillClaudeSpecific));
    assert.deepEqual(commands.stillClaudeSpecific, []);
    assert.equal(commands.clean, 92);
  });

  describe('a stale overlay', () => {
    it('is reported, and the command stays pending; a current one is used, then linted', () => {
      const sha = profile.entries.find((e) => e.path === 'commands/hookify.md').sha256;
      const overlay = (hash, body) => `---\nsource: "commands/hookify.md"\nsha256: "${hash}"\ncredit: ["Adapted from ECC, MIT License."]\n---\n${body}`;
      const plan = (text) =>
        buildPlanned({ parts: ['commands'], profile, sourceFiles: read.files, sourceExecutable: read.executable, commandAssets: { ...assets, overlays: new Map([['hookify', text]]) } });

      const stale = plan(overlay('0'.repeat(64), 'New text.\n'));
      assert.deepEqual(stale.problems, []);
      assert.equal(stale.details.commands.registered, 62);
      assert.equal(stale.details.commands.pending.find((item) => item.name === 'hookify').overlay, 'stale');

      const current = plan(overlay(sha, 'A Kiro-native text that runs the hookify rules.\n'));
      assert.deepEqual(current.problems, []);
      assert.equal(current.details.commands.registered, 63);
      assert.equal(current.details.commands.withOverlay, 1);
      assert.match(String(current.planned.find((f) => f.dest === destOf('hookify')).content), /> Credit: Adapted from ECC, MIT License\.\n\nA Kiro-native text/);

      const dirty = plan(overlay(sha, 'Rules live in ~/.claude/hookify.\n'));
      assert.deepEqual(dirty.problems.map((p) => p.code), ['command-lint']);
    });
  });

  describe('the four helper scripts of the Kimi install', () => {
    const helper = async (name) => {
      const dir = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'ecc-helper-'));
      try {
        return await run(process.execPath, [path.join(checkout, 'scripts', name), '--help'], { cwd: dir, timeout: 20000 }).then(
          (result) => ({ code: 0, out: result.stdout }),
          (error) => ({ code: error.code, out: `${error.stdout}${error.stderr}` }),
        );
      } finally {
        await nodeFs.rm(dir, { recursive: true, force: true });
      }
    };

    it('are not installed: three fail at once for want of ECC files that are not part of the install, and one checks a Claude layout', async () => {
      for (const [name, module] of [['auto-update.js', './lib/install-lifecycle'], ['setup-package-manager.js', './lib/package-manager'], ['skills-health.js', './lib/skill-evolution/health']]) {
        const result = await helper(name);
        assert.notEqual(result.code, 0, name);
        assert.ok(result.out.includes(`Cannot find module '${module}'`), name);
      }
      const audit = await helper('harness-audit.js');
      assert.equal(audit.code, 0);
      assert.match(audit.out, /Usage: node scripts\/harness-audit\.js/);
      assert.ok(!commands.scripts.some((dest) => /harness-audit|auto-update|setup-package-manager|skills-health/.test(dest)));
      assert.match(readFileSync(path.join(checkout, 'scripts', 'harness-audit.js'), 'utf8'), /\.claude\/plugins/);
    });
  });

  describe('plan and install on the real skill folder and the real cache', () => {
    const invoke = async (argv, root, home) => {
      const streams = captureStreams();
      const code = await runCli(argv, {
        stdout: streams.stdout,
        stderr: streams.stderr,
        probes: memoryProbes({ cwd: root, homedir: home }),
        skillDir: SKILL_DIR,
        services: { git: pinnedGit(), fs: nodeFs, now: () => new Date('2026-10-07T10:00:00.000Z') },
      });
      return { code, out: streams.out, err: streams.err };
    };

    it('plans without any option but --only, writes nothing, and installs the 92 commands and 2 scripts idempotently', async () => {
      const project = await makeTempDir();
      try {
        const home = path.join(project.dir, 'home');
        const root = path.join(project.dir, 'project');
        await nodeFs.mkdir(path.join(home, '.kiro'), { recursive: true });
        await nodeFs.mkdir(root, { recursive: true });
        const args = ['--only', 'commands', '--source', checkout, '--root', root];

        const preview = await invoke(['plan', '--json', ...args], root, home);
        assert.equal(preview.code, EXIT.OK, preview.err);
        const report = JSON.parse(preview.out);
        assert.deepEqual(report.problems, []);
        assert.equal(report.counts.create, 94);
        assert.equal(report.details.commands.registered, 92);
        assert.deepEqual(await nodeFs.readdir(root), [], 'plan writes nothing');

        const installed = await invoke(['install', '--yes', '--json', ...args], root, home);
        assert.equal(installed.code, EXIT.OK, installed.err);
        assert.deepEqual(JSON.parse(installed.out).applied, { written: 94, removed: 0 });
        assert.equal((await nodeFs.readdir(path.join(root, '.kiro', 'steering'))).length, 92);
        for (const name of ['quality-gate.sh', 'format.sh']) assert.ok(((await nodeFs.stat(path.join(root, '.kiro', 'ecc', 'scripts', name))).mode & 0o111) !== 0, `${name} is executable`);
        assert.match(await nodeFs.readFile(path.join(root, '.kiro', 'steering', 'ecc-code-review.md'), 'utf8'), /\n> PR review mode adapted from PRPs-agentic-eng by Wirasm\. Part of the PRP workflow series\.\n/);

        const again = JSON.parse((await invoke(['install', '--yes', '--json', ...args], root, home)).out);
        assert.deepEqual(again.applied, { written: 0, removed: 0 });
        assert.equal(again.counts.unchanged, 94);
      } finally {
        await project.cleanup();
      }
    });
  });
});
