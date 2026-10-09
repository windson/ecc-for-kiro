// The real ECC v2.2.3 through the whole life of an install: the MCP examples, the license files and the
// .kiroignore block it makes, then install, install again, update, uninstall --dry-run and uninstall in a
// temporary project, with the real skill folder and the real cache. These tests read the pinned checkout
// in the source cache and are skipped when it is not there (fetch it with: ecc-kiro.mjs verify --fetch).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import nodeFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

import { EXIT, runCli } from '../skills/ecc-kiro-setup/scripts/lib/cli.mjs';
import { defaultProfilePath } from '../skills/ecc-kiro-setup/scripts/lib/commands/verify.mjs';
import { sha256Hex } from '../skills/ecc-kiro-setup/scripts/lib/hash.mjs';
import { convertMcp } from '../skills/ecc-kiro-setup/scripts/lib/mcp.mjs';
import { resolveCacheRoot } from '../skills/ecc-kiro-setup/scripts/lib/paths.mjs';
import { buildPlanned, entriesFor } from '../skills/ecc-kiro-setup/scripts/lib/plan.mjs';
import { cacheCheckoutPath, readVerifiedFiles } from '../skills/ecc-kiro-setup/scripts/io/source.mjs';
import { makeTempDir, pinnedGit } from './fixtures.mjs';
import { captureStreams, memoryProbes } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..', 'skills', 'ecc-kiro-setup');
const checkout = cacheCheckoutPath(resolveCacheRoot(process.env, os.homedir()));
const haveCheckout = existsSync(path.join(checkout, 'AGENTS.md')) && existsSync(path.join(checkout, 'mcp-configs', 'mcp-servers.json'));
const SNAPSHOT = JSON.parse(readFileSync(path.join(HERE, 'snapshots', 'lifecycle-v2.2.3.json'), 'utf8'));
const decoder = new TextDecoder('utf-8', { fatal: true });

/** The project as a map from path to the hash of its content ("dir" for a folder). */
async function snapshot(dir, prefix = '', into = {}) {
  for (const entry of (await nodeFs.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) {
      into[`${rel}/`] = 'dir';
      await snapshot(path.join(dir, entry.name), `${rel}/`, into);
    } else {
      into[rel] = sha256Hex(await nodeFs.readFile(path.join(dir, entry.name)));
    }
  }
  return into;
}

describe('the real ECC files that the mcp, license and isolation parts use', { skip: haveCheckout ? false : 'ECC v2.2.3 is not in the source cache' }, () => {
  let profile;
  let read;
  let catalog;
  let adapter;
  let converted;
  let example;

  const text = (rel) => decoder.decode(read.files.get(rel));

  before(async () => {
    profile = JSON.parse(readFileSync(defaultProfilePath(SKILL_DIR), 'utf8'));
    read = await readVerifiedFiles({ dir: checkout, entries: entriesFor(['mcp', 'license'], profile) });
    assert.deepEqual(read.missing, []);
    assert.deepEqual(read.mismatched, []);
    catalog = JSON.parse(text('mcp-configs/mcp-servers.json')).mcpServers;
    adapter = JSON.parse(text('.kiro/settings/mcp.json.example')).mcpServers;
    converted = convertMcp({
      catalog: { path: 'mcp-configs/mcp-servers.json', text: text('mcp-configs/mcp-servers.json') },
      adapter: { path: '.kiro/settings/mcp.json.example', text: text('.kiro/settings/mcp.json.example') },
    });
    example = JSON.parse(converted.example).mcpServers;
  });

  describe('the MCP examples', () => {
    it('hold the 34 servers of the catalog and the 4 of the adapter, 27 local and 11 remote, in that order', () => {
      assert.equal(Object.keys(catalog).length, SNAPSHOT.counts.fromCatalog);
      assert.equal(Object.keys(adapter).length, SNAPSHOT.counts.fromAdapter);
      const { names, ...counts } = converted.summary;
      assert.deepEqual(names, SNAPSHOT.servers.map((server) => server.name));
      assert.deepEqual(Object.fromEntries(Object.entries(counts).filter(([key]) => key in SNAPSHOT.counts)), SNAPSHOT.counts);
    });

    it('switch every server off, and keep nothing that Kiro does not use', () => {
      assert.equal(Object.keys(example).length, 38);
      for (const [name, server] of Object.entries(example)) {
        assert.strictEqual(server.disabled, true, name);
        assert.ok(Object.keys(server).every((key) => ['command', 'args', 'env', 'url', 'headers', 'disabled'].includes(key)), `${name}: ${Object.keys(server)}`);
      }
      assert.doesNotMatch(converted.example, /"description"|"type"|"autoApprove"|"_comments"|"disabled": false/);
    });

    it('keep every command, argument, address and placeholder exactly as the sources have them', () => {
      for (const [name, source] of Object.entries({ ...catalog, ...adapter })) {
        const out = example[name];
        for (const key of ['command', 'args', 'url', 'env', 'headers']) assert.deepEqual(out[key], source[key], `${name}.${key}`);
      }
    });

    it('say, for each server, where it comes from, how it runs and what has to be filled in', () => {
      const facts = Object.entries(example).map(([name, server]) => ({
        name,
        from: name in catalog ? 'catalog' : 'adapter',
        runs: server.command !== undefined ? 'command' : 'url',
        fill: Object.entries({ ...server.env, ...server.headers }).filter(([, value]) => value.includes('YOUR_')).map(([key]) => key),
        argsToEdit: (server.args ?? []).some((arg) => /YOUR_|\/path\/to\/|\/absolute\/path\//.test(arg)),
      }));
      assert.deepEqual(facts, SNAPSHOT.servers);
    });

    it('count what was left out: 34 descriptions, 11 types and the 2 approval lists of the adapter', () => {
      assert.deepEqual(converted.summary.left, SNAPSHOT.left);
      assert.deepEqual(Object.entries(adapter).filter(([, server]) => server.autoApprove !== undefined).map(([name]) => name), ['bedrock-agentcore-mcp-server', 'strands-agents']);
    });

    it('have a table with one row per server, and the description of ECC in the row of each catalog server', () => {
      const rows = converted.table.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Server'));
      assert.equal(rows.length, 38);
      for (const [name, server] of Object.entries(catalog)) {
        const row = rows.find((line) => line.startsWith(`| ${name} | catalog |`));
        assert.ok(row, name);
        assert.ok(row.endsWith(`| ${server.description.replace(/\s+/g, ' ').trim().replaceAll('|', '\\|')} |`), name);
      }
      for (const name of Object.keys(adapter)) assert.ok(rows.some((line) => line.startsWith(`| ${name} | adapter |`)), name);
    });

    it('hold the jira server that /ecc-jira asks for, with the three values to fill in', () => {
      assert.deepEqual(example.jira, {
        command: 'uvx',
        args: ['mcp-atlassian==0.21.0'],
        env: { JIRA_URL: 'YOUR_JIRA_URL_HERE', JIRA_EMAIL: 'YOUR_JIRA_EMAIL_HERE', JIRA_API_TOKEN: 'YOUR_JIRA_API_TOKEN_HERE' },
        disabled: true,
      });
    });
  });

  describe('the license', () => {
    it('is the MIT license of ECC, copied byte for byte, with the hash the profile pins', () => {
      const built = buildPlanned({ parts: ['license'], profile, sourceFiles: read.files });
      assert.deepEqual(built.problems, []);
      const [license, notices] = built.planned;
      assert.equal(license.dest, '.kiro/ecc/LICENSE');
      assert.ok(Buffer.from(license.content).equals(Buffer.from(read.files.get('LICENSE'))));
      assert.equal(license.sha256, SNAPSHOT.licenseSha256);
      assert.match(text('LICENSE'), /^MIT License\n\nCopyright \(c\) 2026 Affaan Mustafa\n\n/);
      assert.ok(String(notices.content).includes(`- sha256 of that LICENSE file: ${SNAPSHOT.licenseSha256}.`));
    });
  });

  describe('the isolation block', () => {
    it('lists the folders that exist, in the shape the snapshot pins', () => {
      const built = buildPlanned({ parts: ['isolation'], profile, sourceFiles: read.files, harnessDirs: ['.kimi-code', '.claude'] });
      assert.deepEqual(String(built.planned[0].content).split('\n'), SNAPSHOT.block);
    });
  });

  describe('install, update and uninstall on the real skill folder and the real cache', () => {
    const NOW = new Date('2026-10-07T10:00:00.000Z');
    const LATER = new Date('2026-10-09T08:00:00.000Z');
    const invoke = async (argv, home, now = NOW) => {
      const streams = captureStreams();
      const code = await runCli(argv, {
        stdout: streams.stdout,
        stderr: streams.stderr,
        probes: memoryProbes({ cwd: '/nowhere', homedir: home }),
        skillDir: SKILL_DIR,
        services: { git: pinnedGit(), fs: nodeFs, now: () => now },
      });
      return { code, out: streams.out, err: streams.err };
    };
    const json = (result) => JSON.parse(result.out);

    it('write the 377 files of the snapshot, change nothing the second time, and uninstall puts the project back', async () => {
      const project = await makeTempDir();
      try {
        const home = path.join(project.dir, 'home');
        const root = path.join(project.dir, 'project');
        await nodeFs.mkdir(path.join(home, '.kiro'), { recursive: true });
        for (const dir of ['.claude', '.kimi-code', 'src', '.kiro/steering']) await nodeFs.mkdir(path.join(root, dir), { recursive: true });
        await nodeFs.writeFile(path.join(root, '.claude', 'settings.json'), '{}\n');
        await nodeFs.writeFile(path.join(root, '.kimi-code', 'AGENTS.md'), 'Kimi instructions\n');
        await nodeFs.writeFile(path.join(root, '.kiro', 'steering', 'mine.md'), 'my steering\n');
        await nodeFs.writeFile(path.join(root, '.kiroignore'), '# mine\nnode_modules/\n.env\n');
        const original = await snapshot(root);
        const installArgs = ['--source', checkout, '--root', root];
        const rootArgs = ['--root', root];

        // The preview, then the install.
        const preview = json(await invoke(['plan', '--json', ...installArgs], home));
        assert.deepEqual(preview.problems, []);
        assert.equal(preview.counts.create, SNAPSHOT.files.total);
        const byPart = { agents: 0, skills: 0, steering: 0, commands: 0, hooks: 0, owned: 0, mcp: 0, license: 0, isolation: 0 };
        const partOf = { agent: 'agents', skill: 'skills', steering: 'steering', command: 'commands', 'command-script': 'commands', hook: 'hooks', 'hook-script': 'hooks', 'owned-script': 'owned', 'owned-hook': 'owned', 'owned-agent': 'owned', 'owned-workflow': 'owned', mcp: 'mcp', license: 'license', kiroignore: 'isolation' };
        for (const item of preview.files) byPart[partOf[item.category]] += 1;
        assert.deepEqual({ ...byPart, total: preview.files.length }, SNAPSHOT.files);
        assert.deepEqual(preview.protected, [
          { path: '.kiro/agents', kind: 'directory', files: 68 + 3 },
          { path: '.kiro/hooks', kind: 'directory', files: 12 + 2 },
          { path: '.kiro/workflows', kind: 'directory', files: 1 },
          { path: '.kiroignore', kind: 'file', files: 1 },
        ]);
        assert.deepEqual(await snapshot(root), original, 'plan writes nothing');

        const installed = await invoke(['install', '--yes', '--json', ...installArgs], home);
        assert.equal(installed.code, EXIT.OK, installed.err);
        assert.deepEqual(json(installed).applied, { written: SNAPSHOT.files.total, removed: 0 });
        assert.deepEqual(json(installed).state, { path: '.kiro/ecc/install-state.json', status: 'complete', files: SNAPSHOT.files.total, written: true, removed: false });

        // What it wrote.
        const eccFolder = Object.keys(await snapshot(path.join(root, '.kiro', 'ecc'), '.kiro/ecc/')).filter((item) => !item.endsWith('/'));
        assert.deepEqual(eccFolder, SNAPSHOT.eccFolder);
        assert.equal(await nodeFs.stat(path.join(root, '.kiro', 'settings')).then(() => true, () => false), false, 'nothing under .kiro/settings');
        const installedExample = JSON.parse(await nodeFs.readFile(path.join(root, '.kiro/ecc/mcp.json.example'), 'utf8')).mcpServers;
        assert.deepEqual(Object.keys(installedExample), SNAPSHOT.servers.map((server) => server.name));
        assert.ok(Object.values(installedExample).every((server) => server.disabled === true));
        assert.equal(sha256Hex(await nodeFs.readFile(path.join(root, '.kiro/ecc/LICENSE'))), SNAPSHOT.licenseSha256);
        assert.equal(await nodeFs.readFile(path.join(root, '.kiroignore'), 'utf8'), `# mine\nnode_modules/\n.env\n\n${SNAPSHOT.block.join('\n')}\n`);
        const afterInstall = await snapshot(root);

        // Again: install, update, and the previews of update and uninstall change nothing.
        for (const argv of [['install', '--yes', '--json', ...installArgs], ['update', '--yes', '--json', ...installArgs]]) {
          const again = await invoke(argv, home, LATER);
          assert.equal(again.code, EXIT.OK, again.err);
          assert.deepEqual(json(again).applied, { written: 0, removed: 0 }, argv[0]);
          assert.equal(json(again).counts.unchanged, SNAPSHOT.files.total, argv[0]);
        }
        const updatePreview = json(await invoke(['update', '--dry-run', '--json', ...installArgs], home, LATER));
        assert.equal(updatePreview.changes, 0);
        const uninstallPreview = json(await invoke(['uninstall', '--dry-run', '--json', ...rootArgs], home, LATER));
        assert.equal(uninstallPreview.counts.remove, SNAPSHOT.files.total);
        assert.equal(uninstallPreview.changes, SNAPSHOT.files.total + 1, 'the files and the install record');
        assert.deepEqual(await snapshot(root), afterInstall, 'second runs and previews change nothing');

        // The uninstall needs no ECC source.
        const removed = await invoke(['uninstall', '--yes', '--json', ...rootArgs], home, LATER);
        assert.equal(removed.code, EXIT.OK, removed.err);
        assert.deepEqual(json(removed).applied, { written: 0, removed: SNAPSHOT.files.total });
        assert.equal(json(removed).state.removed, true);
        assert.deepEqual(await snapshot(root), original, 'the project is back as it was');
        assert.equal(await nodeFs.readFile(path.join(root, '.kiroignore'), 'utf8'), '# mine\nnode_modules/\n.env\n');
      } finally {
        await project.cleanup();
      }
    });

    it('leave the ecc-kiro-setup skill where it is, when the project already has it', async () => {
      const project = await makeTempDir();
      try {
        const home = path.join(project.dir, 'home');
        const root = path.join(project.dir, 'project');
        await nodeFs.mkdir(path.join(home, '.kiro'), { recursive: true });
        await nodeFs.mkdir(root, { recursive: true });
        // A copy of the skill, as a project would have it under .kiro/skills.
        await nodeFs.cp(SKILL_DIR, path.join(root, '.kiro', 'skills', 'ecc-kiro-setup'), { recursive: true, filter: (from) => !from.includes(`${path.sep}test`) });
        const original = await snapshot(root);
        assert.ok(Object.keys(original).some((item) => item === '.kiro/skills/ecc-kiro-setup/SKILL.md'));

        const installed = await invoke(['install', '--yes', '--json', '--source', checkout, '--root', root], home);
        assert.equal(installed.code, EXIT.OK, installed.err);
        assert.equal(json(installed).counts.create, SNAPSHOT.files.total - SNAPSHOT.files.isolation, 'no harness folder here, so no block');
        const removed = await invoke(['uninstall', '--yes', '--json', '--root', root], home, LATER);
        assert.equal(removed.code, EXIT.OK, removed.err);
        assert.deepEqual(await snapshot(root), original);
      } finally {
        await project.cleanup();
      }
    });
  });
});
