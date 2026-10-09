// The usage report over Kiro's local session log: what it reads, what it adds up, what it never prints, and the
// real script run as a process with KIRO_HOME pointing at a fake store.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { formatCostCsv, formatCostText, formatSkillsText, installedSkills, parseArguments, readSessions, run, sessionsDir, summarizeCost, summarizeSkills } from '../skills/ecc-kiro-setup/scripts/runtime/usage-report.mjs';
import { makeTempDir } from './fixtures.mjs';

const SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'skills', 'ecc-kiro-setup', 'scripts', 'runtime', 'usage-report.mjs');
const NOW = new Date('2026-10-08T12:00:00.000Z');
const SECRET = 'SECRET MESSAGE TEXT that must never reach the output';

const usage = (timestamp, credits, extra = {}) => ({ id: `${timestamp}-usage`, timestamp, payload: { type: 'usage_summary', promptTurnSummaries: [{ unit: 'credit', usage: credits, usedTools: ['fs_write'] }], status: 'success', ...extra } });
const skill = (timestamp, name) => ({ id: `${timestamp}-${name}`, timestamp, payload: { type: 'tool_call', toolName: 'disclose_context', args: { name }, status: 'completed' } });
const user = (timestamp) => ({ id: `${timestamp}-user`, timestamp, payload: { type: 'user', content: SECRET } });
const lines = (records) => `${records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record))).join('\n')}\n`;

/** Write sessions under <home>/.kiro/sessions/<hash>/sess_<id>/ . */
async function writeStore(home, sessions) {
  for (const [index, session] of sessions.entries()) {
    const dir = path.join(home, '.kiro', 'sessions', session.hash ?? 'hash1', `sess_${index}`);
    await mkdir(dir, { recursive: true });
    if (session.meta !== undefined) await writeFile(path.join(dir, 'session.json'), typeof session.meta === 'string' ? session.meta : JSON.stringify(session.meta));
    if (session.messages !== undefined) await writeFile(path.join(dir, 'messages.jsonl'), lines(session.messages));
  }
}

const SESSIONS = [
  { meta: { modelId: 'claude-opus-5', workspacePaths: ['/work/a'], title: SECRET }, messages: [user('2026-10-08T01:00:00.000Z'), usage('2026-10-08T01:00:05.000Z', 0.5), usage('2026-10-07T09:00:00.000Z', 0.25), skill('2026-10-08T01:00:06.000Z', 'tdd-workflow'), skill('2026-09-01T00:00:00.000Z', 'old-skill')] },
  { hash: 'hash2', meta: { modelId: 'glm-5', workspacePaths: ['/work/b'] }, messages: [usage('2026-10-08T02:00:00.000Z', 1), usage('2026-09-20T02:00:00.000Z', 9), skill('2026-10-02T02:00:00.000Z', 'tdd-workflow'), skill('2026-10-03T02:00:00.000Z', 'api-design')] },
];

describe('sessionsDir', () => {
  it('honors KIRO_HOME, then the home folder', () => {
    assert.equal(sessionsDir({ KIRO_HOME: '/k' }, '/h'), path.join('/k', 'sessions'));
    assert.equal(sessionsDir({}, '/h'), path.join('/h', '.kiro', 'sessions'));
    assert.equal(sessionsDir({ KIRO_HOME: '' }, '/h'), path.join('/h', '.kiro', 'sessions'));
  });
});

describe('readSessions', () => {
  let tmp;
  before(async () => {
    tmp = await makeTempDir();
  });
  after(() => tmp.cleanup());

  it('reads the usage and the skill activations of every session, with the model and the workspace', async () => {
    const home = path.join(tmp.dir, 'read');
    await writeStore(home, SESSIONS);
    const { sessions, skipped } = readSessions(path.join(home, '.kiro', 'sessions'));
    assert.deepEqual(skipped, { sessions: 0, lines: 0 });
    assert.equal(sessions.length, 2);
    const first = sessions.find((item) => item.workspace === '/work/a');
    assert.equal(first.modelId, 'claude-opus-5');
    assert.deepEqual(first.usage.map((item) => item.credits), [0.5, 0.25]);
    assert.deepEqual(first.skills.map((item) => item.name), ['tdd-workflow', 'old-skill']);
    assert.ok(!JSON.stringify(sessions).includes(SECRET), 'message text and titles are not kept');
  });
  it('skips what it does not understand, and counts it', async () => {
    const home = path.join(tmp.dir, 'odd');
    await writeStore(home, [
      { meta: '{ broken', messages: ['not json', { timestamp: 'nonsense', payload: { type: 'usage_summary', promptTurnSummaries: [{ usage: 1 }] } }, { id: 'x' }, usage('2026-10-08T01:00:00.000Z', 'many'), usage('2026-10-08T01:00:00.000Z', -3), skill('2026-10-08T01:00:00.000Z', 'Bad Name!'), { timestamp: '2026-10-08T01:00:00.000Z', payload: { type: 'tool_call', toolName: 'disclose_context', args: {} } }, { timestamp: '2026-10-08T01:00:00.000Z', payload: { type: 'something_new', x: 1 } }] },
      { meta: { modelId: 'm' } },
    ]);
    const { sessions, skipped } = readSessions(path.join(home, '.kiro', 'sessions'));
    assert.deepEqual(skipped, { sessions: 1, lines: 3 });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].modelId, 'unknown');
    assert.equal(sessions[0].workspace, 'unknown');
    assert.deepEqual(sessions[0].usage.map((item) => item.credits), [0, 0], 'a bad number counts as nothing');
    assert.deepEqual(sessions[0].skills, []);
  });
  it('returns nothing when there is no store', () => {
    assert.deepEqual(readSessions(path.join(tmp.dir, 'none')), { sessions: [], skipped: { sessions: 0, lines: 0 } });
  });
});

describe('summarizeCost', () => {
  const sessions = () => {
    const mk = (modelId, workspace, usageList) => ({ id: 's', modelId, workspace, usage: usageList.map(([at, credits]) => ({ at: new Date(at), credits })), skills: [] });
    return [mk('claude-opus-5', '/work/a', [['2026-10-08T01:00:05Z', 0.5], ['2026-10-07T09:00:00Z', 0.25]]), mk('glm-5', '/work/b', [['2026-10-08T02:00:00Z', 1], ['2026-09-20T02:00:00Z', 9]])];
  };
  it('adds credits per day, per model and per workspace over the last seven days, today included', () => {
    const report = summarizeCost(sessions(), { now: NOW, utc: true });
    assert.equal(report.since, '2026-10-02');
    assert.equal(report.total, 1.75);
    assert.equal(report.requests, 3);
    assert.deepEqual(report.perDay, [{ key: '2026-10-07', credits: 0.25 }, { key: '2026-10-08', credits: 1.5 }]);
    assert.deepEqual(report.perModel, [{ key: 'glm-5', credits: 1 }, { key: 'claude-opus-5', credits: 0.75 }]);
    assert.deepEqual(report.perWorkspace, [{ key: '/work/b', credits: 1 }, { key: '/work/a', credits: 0.75 }]);
  });
  it('takes the number of days from the option, and leaves records from the future out', () => {
    assert.equal(summarizeCost(sessions(), { now: NOW, utc: true, days: 1 }).total, 1.5);
    assert.equal(summarizeCost(sessions(), { now: NOW, utc: true, days: 30 }).total, 10.75);
    const future = [{ id: 's', modelId: 'm', workspace: 'w', usage: [{ at: new Date('2030-01-01T00:00:00Z'), credits: 5 }], skills: [] }];
    assert.equal(summarizeCost(future, { now: NOW, utc: true }).total, 0);
  });
  it('rounds the sums so that float noise does not show', () => {
    const noisy = [{ id: 's', modelId: 'm', workspace: 'w', usage: [0.1, 0.2].map((credits) => ({ at: new Date('2026-10-08T01:00:00Z'), credits })), skills: [] }];
    assert.equal(summarizeCost(noisy, { now: NOW, utc: true }).total, 0.3);
  });
  it('writes CSV with a header and a total, and protects cells that a spreadsheet would run as a formula', () => {
    const report = summarizeCost(sessions(), { now: NOW, utc: true });
    assert.equal(formatCostCsv(report).split('\n')[0], 'kind,key,credits');
    assert.match(formatCostCsv(report), /\nday,2026-10-08,1\.5\n/);
    assert.match(formatCostCsv(report), /\ntotal,all,1\.75\n$/);
    const hostile = { perDay: [], perModel: [{ key: '=HYPERLINK("x")', credits: 1 }, { key: 'a,b', credits: 2 }], perWorkspace: [], total: 3 };
    assert.match(formatCostCsv(hostile), /\nmodel,"'=HYPERLINK\(""x""\)",1\n/);
    assert.match(formatCostCsv(hostile), /\nmodel,"a,b",2\n/);
  });
  it('says credits, not dollars, in the text form', () => {
    const text = formatCostText(summarizeCost(sessions(), { now: NOW, utc: true }), { sessions: 1, lines: 2 });
    assert.match(text, /^Credits used in the last 7 days \(since 2026-10-02\): 1\.75 in 3 usage records/);
    assert.match(text, /These are credits, not dollars\. Run \/usage in the Kiro CLI for your balance\./);
    assert.match(text, /Skipped: 1 unreadable sessions, 2 lines/);
  });
});

describe('summarizeSkills', () => {
  const sessions = () => [
    { id: 'a', modelId: 'm', workspace: 'w', usage: [], skills: [{ at: new Date('2026-10-08T01:00:00Z'), name: 'tdd-workflow' }, { at: new Date('2026-09-01T00:00:00Z'), name: 'old-skill' }] },
    { id: 'b', modelId: 'm', workspace: 'w', usage: [], skills: [{ at: new Date('2026-10-02T02:00:00Z'), name: 'tdd-workflow' }, { at: new Date('2026-10-03T02:00:00Z'), name: 'api-design' }] },
  ];
  it('counts activations over 30 days with the day of the last one, and lists installed skills that never ran', () => {
    const report = summarizeSkills(sessions(), { now: NOW, utc: true, installed: ['tdd-workflow', 'api-design', 'unused-a', 'unused-b'] });
    assert.deepEqual(report.used, [
      { name: 'tdd-workflow', activations: 2, lastUsed: '2026-10-08', installed: true },
      { name: 'api-design', activations: 1, lastUsed: '2026-10-03', installed: true },
    ]);
    assert.deepEqual(report.neverUsed, ['unused-a', 'unused-b']);
    assert.equal(report.installedKnown, true);
  });
  it('marks a skill that ran but is not installed here, and says nothing about "never used" without a list', () => {
    const report = summarizeSkills(sessions(), { now: NOW, utc: true, installed: ['tdd-workflow'] });
    assert.equal(report.used.find((item) => item.name === 'api-design').installed, false);
    const none = summarizeSkills(sessions(), { now: NOW, utc: true });
    assert.equal(none.installedKnown, false);
    assert.equal(none.used[0].installed, null);
    assert.doesNotMatch(formatSkillsText(none, { sessions: 0, lines: 0 }), /never activated/);
  });
  it('is honest that outcomes are not recorded', () => {
    assert.match(formatSkillsText(summarizeSkills([], { now: NOW }), { sessions: 0, lines: 0 }), /Success rates and failure clusters are not available/);
  });
});

describe('parseArguments', () => {
  it('reads the command and the options', () => {
    assert.deepEqual(parseArguments(['cost']).options, { command: 'cost', days: 7, csv: false, json: false, utc: false, installed: null });
    assert.deepEqual(parseArguments(['skills']).options.days, 30);
    const options = parseArguments(['cost', '--days', '3', '--csv', '--utc']).options;
    assert.deepEqual([options.days, options.csv, options.utc], [3, true, true]);
    assert.equal(parseArguments(['cost', '--days=14']).options.days, 14);
    assert.deepEqual(parseArguments(['skills', '--installed', 'a-b, c-d,Bad Name,,']).options.installed, ['a-b', 'c-d']);
  });
  it('refuses what it does not know', () => {
    for (const argv of [[], ['report'], ['cost', '--days', '0'], ['cost', '--days', 'x'], ['cost', '--days', '99999'], ['cost', '--wat'], ['skills', '--csv'], ['skills', '--installed']]) {
      assert.ok(parseArguments(argv).error, JSON.stringify(argv));
    }
  });
});

describe('installedSkills', () => {
  let tmp;
  before(async () => {
    tmp = await makeTempDir();
  });
  after(() => tmp.cleanup());
  it('lists the skill folders of the project and of the Kiro home, once each', async () => {
    const project = path.join(tmp.dir, 'project');
    const kiroHome = path.join(tmp.dir, 'kiro');
    for (const dir of [path.join(project, '.kiro', 'skills', 'tdd-workflow'), path.join(kiroHome, 'skills', 'tdd-workflow'), path.join(kiroHome, 'skills', 'mine')]) await mkdir(dir, { recursive: true });
    await writeFile(path.join(project, '.kiro', 'skills', 'a-file'), 'x');
    assert.deepEqual(installedSkills({ cwd: project, env: { KIRO_HOME: kiroHome }, home: '/nowhere' }), ['mine', 'tdd-workflow']);
  });
});

describe('the script as a process', () => {
  let tmp;
  let home;
  before(async () => {
    tmp = await makeTempDir();
    home = path.join(tmp.dir, 'home');
    const recent = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
    await writeStore(home, [{ meta: { modelId: 'claude-opus-5', workspacePaths: ['/work/a'], title: SECRET }, messages: [user(recent(0)), usage(recent(0), 0.5), usage(recent(1), 0.25), skill(recent(0), 'tdd-workflow')] }]);
  });
  after(() => tmp.cleanup());
  const spawn = (args) =>
    new Promise((resolve) => {
      execFile(process.execPath, [SCRIPT, ...args], { cwd: tmp.dir, env: { ...process.env, KIRO_HOME: path.join(home, '.kiro') } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
    });
  it('prints the cost report, as JSON and as CSV, and never the text of a message or a title', async () => {
    const text = await spawn(['cost']);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /Credits used in the last 7 days .*: 0\.75 in 2 usage records/);
    const json = JSON.parse((await spawn(['cost', '--json'])).stdout);
    assert.deepEqual([json.unit, json.total, json.perModel], ['credits', 0.75, [{ key: 'claude-opus-5', credits: 0.75 }]]);
    assert.match((await spawn(['cost', '--csv'])).stdout, /^kind,key,credits\n/);
    for (const args of [['cost'], ['cost', '--json'], ['cost', '--csv'], ['skills'], ['skills', '--json']]) {
      assert.ok(!(await spawn(args)).stdout.includes('SECRET MESSAGE'), args.join(' '));
    }
  });
  it('prints the skill report for the skills it is told are installed', async () => {
    const result = await spawn(['skills', '--installed', 'tdd-workflow,never-run']);
    assert.match(result.stdout, /tdd-workflow {2}1 {2}last used \d{4}-\d{2}-\d{2}\n/);
    assert.match(result.stdout, /never activated in this period \(1\):\n {2}never-run/);
  });
  it('exits 2 with a usage line for a wrong command, and reads an empty store as zero', async () => {
    const bad = await spawn(['nope']);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /^usage: usage-report\.mjs/);
    assert.equal(run(['cost'], { env: { KIRO_HOME: path.join(tmp.dir, 'empty') }, now: NOW }).stdout.split('\n')[0].endsWith('0 in 0 usage records'), true);
  });
});
