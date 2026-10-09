// The real ECC v2.2.3 steering: the 22 files of the Kiro adapter, the 11 language rule packs and
// AGENTS.md, turned into Kiro steering. These tests read the pinned checkout in the source cache and
// are skipped when it is not there (fetch it with: ecc-kiro.mjs verify --fetch).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import nodeFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

import { EXIT, runCli } from '../skills/ecc-kiro-setup/scripts/lib/cli.mjs';
import { ALWAYS_ON_LIMIT_BYTES } from '../skills/ecc-kiro-setup/scripts/lib/constants.mjs';
import { defaultProfilePath } from '../skills/ecc-kiro-setup/scripts/lib/commands/verify.mjs';
import { parseFrontmatter } from '../skills/ecc-kiro-setup/scripts/lib/frontmatter.mjs';
import { resolveCacheRoot } from '../skills/ecc-kiro-setup/scripts/lib/paths.mjs';
import { buildPlanned, entriesFor } from '../skills/ecc-kiro-setup/scripts/lib/plan.mjs';
import { PACKS, validateLanguageGlobs } from '../skills/ecc-kiro-setup/scripts/lib/rule-packs.mjs';
import { globProblem } from '../skills/ecc-kiro-setup/scripts/lib/steering.mjs';
import { cacheCheckoutPath, readVerifiedFiles } from '../skills/ecc-kiro-setup/scripts/io/source.mjs';
import { makeTempDir, pinnedGit } from './fixtures.mjs';
import { captureStreams, memoryProbes } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..', 'skills', 'ecc-kiro-setup');
const checkout = cacheCheckoutPath(resolveCacheRoot(process.env, os.homedir()));
const haveCheckout = existsSync(path.join(checkout, 'AGENTS.md')) && existsSync(path.join(checkout, 'rules', 'react', 'hooks.md'));
const SNAPSHOT = JSON.parse(readFileSync(path.join(HERE, 'snapshots', 'steering-v2.2.3.json'), 'utf8'));

const decoder = new TextDecoder('utf-8', { fatal: true });
const ADAPTER_DIR = '.kiro/steering/';
const CORE = ['coding-style', 'development-workflow', 'git-workflow', 'lessons-learned', 'patterns', 'performance', 'security', 'testing'];
const MODES = ['dev-mode', 'research-mode', 'review-mode'];
const REWRITTEN_BY_HAND = ['git-workflow', 'lessons-learned'];

/** A small glob matcher, written apart from the installer, to see which files a pattern would load for. */
function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** The `paths:` globs of a rule file, read with a plain line scan instead of the installer's parser. */
function rawPaths(text) {
  const lines = text.split('\n');
  assert.equal(lines[0], '---');
  const end = lines.indexOf('---', 1);
  return lines.slice(1, end).filter((line) => line.startsWith('  - ')).map((line) => JSON.parse(line.slice(4)));
}

const bodyOf = (text) => parseFrontmatter(text).body;

describe('the real ECC steering', { skip: haveCheckout ? false : 'ECC v2.2.3 is not in the source cache' }, () => {
  let profile;
  let read;
  let built;
  let text;
  let planned;

  const source = (rel) => decoder.decode(read.files.get(rel));
  const dataOf = (dest) => parseFrontmatter(text.get(dest)).data;
  const destOf = (name) => `.kiro/steering/${name}.md`;
  const profileNames = (category) => profile.entries.filter((entry) => entry.category === category).map((entry) => entry.name);

  before(async () => {
    profile = JSON.parse(readFileSync(defaultProfilePath(SKILL_DIR), 'utf8'));
    const entries = entriesFor(['steering'], profile);
    read = await readVerifiedFiles({ dir: checkout, entries });
    assert.deepEqual(read.missing, []);
    assert.deepEqual(read.mismatched, []);
    built = buildPlanned({ parts: ['steering'], profile, sourceFiles: read.files });
    planned = built.planned;
    text = new Map(planned.map((file) => [file.dest, String(file.content)]));
  });

  it('reads 22 adapter files, AGENTS.md, 68 agents and the 60 rule files of the 11 packs, all matching the profile', () => {
    const entries = entriesFor(['steering'], profile);
    const count = (category) => entries.filter((entry) => entry.category === category).length;
    assert.deepEqual([count('adapter-steering'), count('agents-md'), count('agent'), count('rule')], [22, 1, 68, 60]);
    assert.equal(read.files.size, 151);
    assert.deepEqual([...new Set(entries.filter((entry) => entry.category === 'rule').map((entry) => entry.pack))].sort(), Object.keys(PACKS));
  });

  it('plans 35 files without a problem or a note', () => {
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.notes, []);
    assert.equal(planned.length, 35);
    assert.equal(new Set(planned.map((file) => file.dest)).size, 35);
    assert.ok(planned.every((file) => /^\.kiro\/steering\/ecc-[a-z0-9-]+\.md$/.test(file.dest) && file.category === 'steering' && file.part === 'steering'));
  });

  it('puts the frontmatter first in every file, with only the keys Kiro reads, and no auto inclusion', () => {
    for (const [dest, content] of text) {
      assert.ok(content.startsWith('---\n'), dest);
      const parsed = parseFrontmatter(content);
      assert.equal(parsed.hasFrontmatter, true, dest);
      assert.ok(Object.keys(parsed.data).every((key) => ['inclusion', 'name', 'description', 'fileMatchPattern'].includes(key)), dest);
      assert.ok(['always', 'fileMatch', 'manual'].includes(parsed.data.inclusion), `${dest}: ${parsed.data.inclusion}`);
      assert.ok(parsed.data.description.length > 10, dest);
      assert.ok(content.endsWith('\n') && !content.endsWith('\n\n'), `${dest} ends with one line break`);
    }
  });

  it('matches the snapshot: which files are always on, which are manual, and the patterns of the rest', () => {
    const byMode = (mode) => [...text.keys()].filter((dest) => dataOf(dest).inclusion === mode).map((dest) => dest.split('/').pop().replace(/\.md$/, '')).sort();
    assert.deepEqual(byMode('always'), SNAPSHOT.always);
    assert.deepEqual(byMode('manual'), SNAPSHOT.manual);
    const fileMatch = Object.fromEntries(byMode('fileMatch').map((name) => [name, dataOf(destOf(name)).fileMatchPattern]));
    assert.deepEqual(fileMatch, SNAPSHOT.fileMatch);
    assert.equal(byMode('fileMatch').length, 22);
  });

  it('keeps the always-on files, the ones sent with every request, within 25,000 bytes', () => {
    const alwaysOn = [...text].filter(([dest]) => dataOf(dest).inclusion === 'always');
    assert.equal(alwaysOn.length, 10);
    const bytes = alwaysOn.reduce((sum, [, content]) => sum + Buffer.byteLength(content), 0);
    assert.ok(bytes <= 25000, `the always-on steering is ${bytes} bytes`);
    assert.equal(ALWAYS_ON_LIMIT_BYTES, 25000);
    assert.deepEqual(built.details.steering.alwaysOn, { files: 10, bytes, limit: 25000 });
  });

  it('turns the 8 core files, which were auto, into always-on files that keep their descriptions', () => {
    for (const stem of CORE) {
      const before = parseFrontmatter(source(`${ADAPTER_DIR}${stem}.md`)).data;
      assert.equal(before.inclusion, 'auto', stem);
      const after = dataOf(destOf(`ecc-${stem}`));
      assert.deepEqual(after, { inclusion: 'always', name: `ecc-${stem}`, description: before.description.trim() }, stem);
    }
  });

  it('turns each comma-joined pattern of the 11 adapter language files into a list, one glob per item', () => {
    const languages = profileNames('adapter-steering').filter((stem) => parseFrontmatter(source(`${ADAPTER_DIR}${stem}.md`)).data.inclusion === 'fileMatch');
    assert.equal(languages.length, 11);
    for (const stem of languages) {
      const old = parseFrontmatter(source(`${ADAPTER_DIR}${stem}.md`)).data.fileMatchPattern;
      assert.equal(typeof old, 'string', stem);
      const expected = old.split(',').map((piece) => `**/${piece.trim()}`);
      const after = dataOf(destOf(`ecc-${stem}`)).fileMatchPattern;
      assert.deepEqual(after, expected, stem);
      assert.ok(after.every((glob) => !glob.includes(',') && globProblem(glob) === null), stem);
    }
    assert.deepEqual(dataOf(destOf('ecc-typescript-patterns')).fileMatchPattern, ['**/*.ts', '**/*.tsx']);
  });

  it('points the three manual modes at their new names', () => {
    for (const stem of MODES) {
      const before = source(`${ADAPTER_DIR}${stem}.md`);
      const after = text.get(destOf(`ecc-${stem}`));
      assert.match(before, new RegExp(`\`#${stem}\``));
      assert.match(after, new RegExp(`\`#ecc-${stem}\``));
      assert.doesNotMatch(after.replaceAll(`#ecc-${stem}`, ''), new RegExp(`#${stem}`));
      assert.equal(bodyOf(after), bodyOf(before).replaceAll(`#${stem}`, `#ecc-${stem}`), stem);
      assert.deepEqual(dataOf(destOf(`ecc-${stem}`)), { inclusion: 'manual', description: parseFrontmatter(before).data.description }, stem);
    }
  });

  it('copies every other adapter body unchanged', () => {
    const unchanged = profileNames('adapter-steering').filter((stem) => !MODES.includes(stem) && !REWRITTEN_BY_HAND.includes(stem));
    assert.equal(unchanged.length, 17);
    for (const stem of unchanged) assert.equal(bodyOf(text.get(destOf(`ecc-${stem}`))), bodyOf(source(`${ADAPTER_DIR}${stem}.md`)), stem);
  });

  it('drops the note about Claude settings from git-workflow and the install.sh lessons from lessons-learned, and nothing else', () => {
    const git = { before: bodyOf(source(`${ADAPTER_DIR}git-workflow.md`)), after: bodyOf(text.get(destOf('ecc-git-workflow'))) };
    assert.match(git.before, /~\/\.claude\/settings\.json/);
    assert.doesNotMatch(git.after, /~\/\.claude|includeCoAuthoredBy/);
    assert.equal(git.after, git.before.replace(/\nNote: ECC-managed[^\n]*\n/, ''));

    const lessons = { before: bodyOf(source(`${ADAPTER_DIR}lessons-learned.md`)), after: bodyOf(text.get(destOf('ecc-lessons-learned'))) };
    assert.match(lessons.before, /install\.sh/);
    assert.doesNotMatch(lessons.after, /install\.sh|askAgent|runCommand|Kiro Hooks/);
    assert.match(lessons.after, /^1\. If you turn on the `ecc-extract-patterns` hook, it suggests patterns after agent sessions$/m);
    for (const heading of ['Project-Specific Patterns', 'Code Style Preferences', 'ECC Install', 'Common Pitfalls', 'Architecture Decisions', 'Notes']) {
      assert.match(lessons.after, new RegExp(`^## ${heading}$`, 'm'), heading);
    }
    assert.equal(lessons.after.split('\n---\n').length, lessons.before.split('\n---\n').length, 'the user-editable sections are all still there');
  });

  it('makes each pack match the union of the paths of its rule files, counted here with a plain line scan', () => {
    for (const pack of Object.keys(PACKS)) {
      const files = profile.entries.filter((entry) => entry.category === 'rule' && entry.pack === pack).sort((a, b) => (a.file < b.file ? -1 : 1));
      const union = [];
      for (const file of files) for (const glob of rawPaths(source(file.path))) if (!union.includes(glob)) union.push(glob);
      assert.deepEqual(dataOf(destOf(`ecc-${pack}-rules`)).fileMatchPattern, union, pack);
      assert.equal(SNAPSHOT.packFiles[pack], files.length, pack);
    }
  });

  it('puts the rule files of a pack one after the other, in file-name order, each under its own heading', () => {
    for (const pack of Object.keys(PACKS)) {
      const files = profile.entries.filter((entry) => entry.category === 'rule' && entry.pack === pack).sort((a, b) => (a.file < b.file ? -1 : 1));
      const content = text.get(destOf(`ecc-${pack}-rules`));
      let from = 0;
      for (const file of files) {
        const heading = /^# .+$/m.exec(bodyOf(source(file.path)))[0];
        const at = content.indexOf(`\n${heading}\n`, from);
        assert.ok(at >= from, `${file.path}: "${heading}" comes after the previous file`);
        from = at + 1;
      }
    }
  });

  it('leaves no link that would be dead: every relative link reaches an installed steering file, a heading of its own file or an installed skill', () => {
    const dests = new Set([...text.keys()].map((dest) => dest.split('/').pop()));
    const skills = new Set(profile.entries.filter((entry) => entry.category === 'skill').map((entry) => entry.skill));
    const slug = (heading) => heading.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/ /g, '-');
    let checked = 0;
    for (const [dest, content] of text) {
      const headings = new Set();
      let fenced = false;
      const links = [];
      for (const line of content.split('\n')) {
        if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
        if (fenced) continue;
        const heading = /^#{1,6} +(.+?) *$/.exec(line);
        if (heading) headings.add(slug(heading[1]));
        const bare = line.replace(/`[^`]*`/g, '');
        for (const match of bare.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) links.push(match[1]);
      }
      for (const target of links) {
        if (/^(?:https?|mailto):/.test(target)) continue;
        checked += 1;
        if (target.startsWith('#')) assert.ok(headings.has(target.slice(1)), `${dest}: no heading for ${target}`);
        else if (target.startsWith('../skills/')) assert.ok(skills.has(target.split('/')[2]), `${dest}: ${target}`);
        else assert.ok(dests.has(target), `${dest}: ${target} is not an installed steering file`);
      }
    }
    assert.ok(checked >= 60, `only ${checked} links were checked`);
    assert.deepEqual([built.details.steering.packs.linksMapped, built.details.steering.packs.linksUnlinked], [65, 2]);
  });

  it('leaves none of the wording the conversion is meant to replace', () => {
    for (const [dest, content] of text) {
      assert.doesNotMatch(content, /\.\.\/common\/|\.\.\/typescript\/|\.\.\/\.\.\/skills\//, dest);
      assert.doesNotMatch(content, /Configure in `~\/\.claude\/settings\.json`/, dest);
      assert.doesNotMatch(content, /inclusion: auto/, dest);
      assert.doesNotMatch(content, /^fileMatchPattern: "/m, dest);
    }
    const agents = text.get(destOf('ecc-agents'));
    assert.doesNotMatch(agents, /ecc:[a-z]/);
    assert.doesNotMatch(agents, /Agent Instructions|293 skills|94 commands/, 'nothing about the full ECC plugin is claimed');
  });

  it('warns the packs with Claude hook examples, and no others', () => {
    const warned = Object.keys(PACKS).filter((pack) => text.get(destOf(`ecc-${pack}-rules`)).includes('The hook examples use Claude Code names'));
    assert.deepEqual(warned, ['angular', 'arkts', 'csharp', 'dart', 'fsharp', 'nuxt', 'perl', 'react-native', 'vue', 'web']);
  });

  it('maps, in the harness note, every $CLAUDE_ variable the other installed files still show', () => {
    const harness = destOf('ecc-kiro-harness');
    const shown = new Set();
    for (const [dest, content] of text) if (dest !== harness) for (const match of content.matchAll(/\$CLAUDE_[A-Z_]+/g)) shown.add(match[0]);
    assert.deepEqual([...shown].sort(), ['$CLAUDE_FILE_PATHS'], 'ECC text shows a variable the harness note has to explain');
    for (const variable of shown) assert.ok(text.get(harness).includes(variable), variable);
    assert.match(text.get(harness), /\{\{filePath\}\}/);
    assert.ok(text.get(destOf('ecc-dart-rules')).includes('dart format $CLAUDE_FILE_PATHS'));
  });

  it('lists all 68 agents in the roster, once each, as AGENTS.md does, with no row made up', () => {
    const rows = text.get(destOf('ecc-agents')).split('\n').filter((line) => /^\| [a-z0-9-]+ \|/.test(line));
    const names = rows.map((row) => row.split('|')[1].trim());
    assert.equal(names.length, 68);
    assert.deepEqual([...names].sort(), profileNames('agent').sort());
    assert.deepEqual(built.details.steering.baseline, { files: 2, rosterRows: 68, fromDescriptions: [], dropped: [] });
    assert.match(text.get(destOf('ecc-agents')), /ECC v2\.2\.3 gives this project 68 custom agents and 88 skills\./);
    for (const row of rows) assert.ok(source('AGENTS.md').includes(row), row);
  });

  it('names an ECC script in the harness note that the skills part installs', () => {
    assert.match(text.get(destOf('ecc-kiro-harness')), /\.kiro\/skills\/continuous-learning-v2\/scripts\/instinct-cli\.py/);
    assert.ok(profile.entries.some((entry) => entry.category === 'skill' && entry.skill === 'continuous-learning-v2' && entry.rel === 'scripts/instinct-cli.py'));
  });

  it('does not install the common rules, and does not duplicate the languages the adapter already covers', () => {
    const inProfile = new Set(profile.entries.filter((entry) => entry.category === 'rule').map((entry) => entry.pack));
    const left = [...inProfile].filter((pack) => !Object.hasOwn(PACKS, pack)).sort();
    assert.deepEqual(left, ['', 'common', 'cpp', 'golang', 'java', 'kotlin', 'php', 'python', 'ruby', 'rust', 'swift', 'typescript']);
    const adapter = new Set(profileNames('adapter-steering'));
    for (const language of left.filter((pack) => !['', 'common'].includes(pack))) assert.ok(adapter.has(`${language}-patterns`), language);
    assert.ok(![...text.keys()].some((dest) => /ecc-(?:common|hooks|agents-rules|code-review)/.test(dest)));
  });

  it('sums up what it built', () => {
    assert.deepEqual(built.details.steering, {
      files: 35,
      adapter: { files: 22, always: 8, fileMatch: 11, manual: 3, references: 3 },
      packs: { files: 11, sources: 60, overridden: [], linksMapped: 65, linksUnlinked: 2 },
      baseline: { files: 2, rosterRows: 68, fromDescriptions: [], dropped: [] },
      alwaysOn: { files: 10, bytes: built.details.steering.alwaysOn.bytes, limit: 25000 },
    });
  });

  it('builds the same bytes every time', () => {
    const again = buildPlanned({ parts: ['steering'], profile, sourceFiles: read.files });
    assert.deepEqual(again.planned.map((file) => file.sha256), planned.map((file) => file.sha256));
  });

  it('uses the override file\'s patterns for a pack and leaves the others alone', () => {
    const again = buildPlanned({ parts: ['steering'], profile, sourceFiles: read.files, languageGlobs: { vue: ['**/*.vue'], arkts: ['**/*.ets'] } });
    assert.deepEqual(again.problems, []);
    const data = (name) => parseFrontmatter(String(again.planned.find((file) => file.dest === destOf(name)).content)).data;
    assert.deepEqual(data('ecc-vue-rules').fileMatchPattern, ['**/*.vue']);
    assert.deepEqual(data('ecc-arkts-rules').fileMatchPattern, ['**/*.ets']);
    assert.deepEqual(data('ecc-react-rules').fileMatchPattern, SNAPSHOT.fileMatch['ecc-react-rules']);
    assert.deepEqual(again.details.steering.packs.overridden, ['arkts', 'vue']);
    assert.deepEqual(again.notes.map((note) => note.code), ['steering-globs-overridden']);
  });

  describe('which files load for which kind of file', () => {
    const loadedFor = (file) => Object.entries(SNAPSHOT.fileMatch).filter(([, globs]) => globs.some((glob) => globToRegExp(glob).test(file))).map(([name]) => name);

    it('loads one file for a Python, Go, Rust or Ruby source and nothing for a text file', () => {
      assert.deepEqual(loadedFor('main.py'), ['ecc-python-patterns']);
      assert.deepEqual(loadedFor('cmd/server/main.go'), ['ecc-golang-patterns']);
      assert.deepEqual(loadedFor('src/lib.rs'), ['ecc-rust-patterns']);
      assert.deepEqual(loadedFor('app/models/user.rb'), ['ecc-ruby-patterns']);
      assert.deepEqual(loadedFor('README.txt'), []);
    });

    it('loads the pack of the framework for a framework file', () => {
      assert.ok(loadedFor('src/app/user.component.ts').includes('ecc-angular-rules'));
      assert.ok(loadedFor('lib/main.dart').includes('ecc-dart-rules'));
      assert.deepEqual(loadedFor('lib/Foo/Bar.pm'), ['ecc-perl-rules']);
      assert.ok(loadedFor('Services/Orders.cs').includes('ecc-csharp-rules'));
      assert.ok(loadedFor('nuxt.config.ts').includes('ecc-nuxt-rules'));
      assert.ok(loadedFor('src/Button.vue').includes('ecc-vue-rules'));
    });

    it('without the override file, loads five files for any TypeScript file and six for a tsx file: the paths in the rules are that broad', () => {
      assert.deepEqual(loadedFor('src/index.ts'), ['ecc-arkts-rules', 'ecc-react-native-rules', 'ecc-typescript-patterns', 'ecc-typescript-security', 'ecc-vue-rules']);
      assert.deepEqual(loadedFor('src/App.tsx'), ['ecc-react-native-rules', 'ecc-react-rules', 'ecc-typescript-patterns', 'ecc-typescript-security', 'ecc-vue-rules', 'ecc-web-rules']);
    });

    it('matches the glob syntax the way Kiro documents it', () => {
      const matches = (glob, file) => globToRegExp(glob).test(file);
      assert.ok(matches('**/*.ts', 'a.ts') && matches('**/*.ts', 'src/deep/a.ts') && !matches('**/*.ts', 'a.tsx') && !matches('**/*.ts', 'a.ts.bak'));
      assert.ok(matches('**/pages/**', 'app/pages/index.vue') && matches('**/pages/**', 'pages/a/b.vue') && !matches('**/pages/**', 'app/page/a.vue'));
      assert.ok(matches('**/appsettings*.json', 'src/appsettings.Development.json') && matches('**/nuxt.config.*', 'nuxt.config.ts'));
    });
  });

  // Decision O8: the rules of arkts, react-native and vue name **/*.ts (react-native also **/*.tsx), so a plain
  // TypeScript file would load about 50 KB of unrelated rules. The skill ships narrower patterns for those three packs.
  // The angular and react packs are not narrowed (open item O9): the last test here pins what that means.
  describe('the file patterns the skill ships in assets/language-globs.json', () => {
    const SHIPPED = JSON.parse(readFileSync(path.join(SKILL_DIR, 'assets', 'language-globs.json'), 'utf8'));
    const NARROWED = ['arkts', 'react-native', 'vue'];
    const nameOf = (dest) => dest.split('/').pop().replace(/\.md$/, '');
    let narrowed;
    let narrowedText;

    const dataOfNarrowed = (dest) => parseFrontmatter(narrowedText.get(dest)).data;
    const effectivePatterns = () =>
      Object.fromEntries([...narrowedText.keys()].filter((dest) => dataOfNarrowed(dest).inclusion === 'fileMatch').sort().map((dest) => [nameOf(dest), dataOfNarrowed(dest).fileMatchPattern]));
    const loadedFor = (file) => Object.entries(effectivePatterns()).filter(([, globs]) => globs.some((glob) => globToRegExp(glob).test(file))).map(([name]) => name);
    const bytesOf = (names) => names.reduce((sum, name) => sum + Buffer.byteLength(narrowedText.get(destOf(name))), 0);

    before(() => {
      narrowed = buildPlanned({ parts: ['steering'], profile, sourceFiles: read.files, languageGlobs: SHIPPED.packs });
      narrowedText = new Map(narrowed.planned.map((file) => [file.dest, String(file.content)]));
    });

    it('is a valid file that narrows exactly arkts, react-native and vue, as the snapshot says', () => {
      assert.deepEqual(validateLanguageGlobs(SHIPPED), []);
      assert.deepEqual(Object.keys(SHIPPED.packs).sort(), NARROWED);
      assert.deepEqual(Object.fromEntries(Object.entries(SHIPPED.packs).map(([pack, globs]) => [`ecc-${pack}-rules`, globs])), SNAPSHOT.shipped);
      for (const globs of Object.values(SHIPPED.packs)) assert.ok(globs.every((glob) => globProblem(glob) === null));
    });

    it('gives those three packs its patterns and leaves the 19 other file-type files as they were', () => {
      assert.deepEqual(narrowed.problems, []);
      for (const pack of NARROWED) assert.deepEqual(dataOfNarrowed(destOf(`ecc-${pack}-rules`)).fileMatchPattern, SHIPPED.packs[pack], pack);
      const effective = effectivePatterns();
      assert.deepEqual(effective, { ...SNAPSHOT.fileMatch, ...SNAPSHOT.shipped });
      assert.equal(Object.keys(effective).length, 22);
      assert.deepEqual(narrowed.details.steering.packs.overridden, NARROWED);
      assert.deepEqual(narrowed.notes.map((note) => note.code), ['steering-globs-overridden']);
    });

    it('changes nothing else: the other 32 files are identical, and a narrowed pack differs only in its fileMatchPattern line', () => {
      const changed = narrowed.planned.filter((file, index) => file.sha256 !== planned[index].sha256).map((file) => file.dest);
      assert.deepEqual(narrowed.planned.map((file) => file.dest), planned.map((file) => file.dest));
      assert.deepEqual(changed, NARROWED.map((pack) => destOf(`ecc-${pack}-rules`)));
      const withoutPattern = (content) => content.replace(/^fileMatchPattern: .*\n/m, '');
      for (const pack of NARROWED) assert.equal(withoutPattern(narrowedText.get(destOf(`ecc-${pack}-rules`))), withoutPattern(text.get(destOf(`ecc-${pack}-rules`))), pack);
    });

    it('keeps the always-on files exactly as they are without the override file', () => {
      assert.deepEqual(narrowed.details.steering.alwaysOn, built.details.steering.alwaysOn);
      assert.ok(narrowed.details.steering.alwaysOn.bytes <= ALWAYS_ON_LIMIT_BYTES);
    });

    it('names, for React Native, platform files the pack talks about, config files and the standard platform extensions', () => {
      const packText = profile.entries.filter((entry) => entry.category === 'rule' && entry.pack === 'react-native').map((entry) => source(entry.path)).join('\n');
      assert.match(packText, /Component\.ios\.tsx/);
      assert.match(packText, /Component\.android\.tsx/);
      assert.match(packText, /`eas\.json`/);
      assert.deepEqual(SHIPPED.packs['react-native'], ['**/*.native.ts', '**/*.native.tsx', '**/*.ios.ts', '**/*.ios.tsx', '**/*.android.ts', '**/*.android.tsx', '**/metro.config.*', '**/eas.json']);
    });

    it('loads, for each kind of file, the files and the number of bytes in the snapshot', () => {
      for (const [file, expected] of Object.entries(SNAPSHOT.loads)) {
        const loaded = loadedFor(file);
        assert.deepEqual(loaded, expected.files, file);
        assert.equal(bytesOf(loaded), expected.bytes, file);
      }
    });

    it('does not load arkts, react-native or vue for a plain TypeScript or TSX file', () => {
      for (const file of ['src/index.ts', 'src/App.tsx', 'src/utils/format.ts', 'lib/Form.tsx', 'test/index.test.ts']) {
        const loaded = loadedFor(file);
        assert.ok(!loaded.some((name) => ['ecc-arkts-rules', 'ecc-react-native-rules', 'ecc-vue-rules'].includes(name)), `${file}: ${loaded}`);
      }
      assert.deepEqual(loadedFor('src/index.ts'), ['ecc-typescript-patterns', 'ecc-typescript-security']);
    });

    it('loads each narrowed pack for the files it is meant for', () => {
      assert.ok(loadedFor('entry/src/main/ets/pages/Index.ets').includes('ecc-arkts-rules'));
      assert.ok(loadedFor('oh-package.json5').includes('ecc-arkts-rules'));
      assert.ok(loadedFor('entry/src/ohosTest/ets/test/List.test.ets').includes('ecc-arkts-rules'));
      assert.ok(loadedFor('src/Settings.android.ts').includes('ecc-react-native-rules'));
      assert.ok(loadedFor('src/Share.native.tsx').includes('ecc-react-native-rules'));
      assert.ok(loadedFor('app/metro.config.cjs').includes('ecc-react-native-rules'));
      assert.ok(loadedFor('components/Card.vue').includes('ecc-vue-rules'));
    });

    it('still loads the Angular pack for a spec file and the React pack for any ts file under app/ or pages/ (open item O9)', () => {
      assert.ok(loadedFor('src/app/foo.spec.ts').includes('ecc-angular-rules'));
      assert.ok(loadedFor('src/foo.spec.ts').includes('ecc-angular-rules'));
      assert.ok(loadedFor('src/app/user.service.ts').includes('ecc-react-rules'));
      assert.ok(loadedFor('src/pages/api.ts').includes('ecc-react-rules'));
      assert.ok(loadedFor('src/hooks/use-cart.ts').includes('ecc-react-rules'));
      assert.deepEqual(Object.keys(SHIPPED.packs).filter((pack) => ['angular', 'react'].includes(pack)), []);
    });

    it('is used by plan without any option, so the narrowed packs are what the user gets', async () => {
      const project = await makeTempDir();
      try {
        const home = path.join(project.dir, 'home');
        const root = path.join(project.dir, 'project');
        await nodeFs.mkdir(path.join(home, '.kiro'), { recursive: true });
        await nodeFs.mkdir(root, { recursive: true });
        const streams = captureStreams();
        const code = await runCli(['plan', '--only', 'steering', '--json', '--source', checkout, '--root', root], {
          stdout: streams.stdout,
          stderr: streams.stderr,
          probes: memoryProbes({ cwd: root, homedir: home }),
          skillDir: SKILL_DIR,
          // The cache is a real git checkout, so the source step asks git for HEAD; the fake answers with the pinned commit.
          services: { git: pinnedGit(), fs: nodeFs, now: () => new Date('2026-10-07T10:00:00.000Z') },
        });
        assert.equal(code, EXIT.OK, streams.err);
        const report = JSON.parse(streams.out);
        assert.equal(report.ok, true);
        assert.deepEqual(report.problems, []);
        assert.equal(report.counts.create, 35);
        assert.deepEqual(report.details.steering.packs.overridden, NARROWED);
        assert.deepEqual(report.notes.map((note) => note.code), ['steering-globs-overridden']);
        assert.deepEqual(await nodeFs.readdir(root), [], 'plan writes nothing');
      } finally {
        await project.cleanup();
      }
    });
  });
});
