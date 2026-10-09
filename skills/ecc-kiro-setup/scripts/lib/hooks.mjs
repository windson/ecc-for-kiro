// Converting the hooks of ECC's Kiro adapter (.kiro.hook files, the format Kiro retired) into Kiro v1
// hook files (https://kiro.dev/docs/ide/whats-new-v1/hooks.md).
//
// Pure: text in, text out. A hook keeps its description and its agent prompt. What changes:
//   - the trigger gets its v1 name (fileEdited is PostFileSave and so on), and the file patterns
//     (`*.ts`) or tool types (`write`) become the regular expression a v1 matcher is;
//   - the hook is called ecc-<name>, so it cannot collide with the user's own, and it ships
//     switched off (`enabled: false`), whatever the source says;
//   - three hooks are adapted by hand, each with its reason (ADAPTATIONS below);
//   - a hook that is started by hand (userTriggered) has no v1 trigger and is left out.
// Every converted hook is checked against the v1 format (lib/hook-schema.mjs) before it is returned.

import { CodedError } from './exit.mjs';
import { HOOK_FILE_VERSION, HOOK_TRIGGERS, LEGACY_TRIGGERS, validateHookFile } from './hook-schema.mjs';
import { SCRIPT_DIR } from './slash-commands.mjs';

/** Where Kiro looks for a project's hook files. Kiro always asks before the agent writes here. */
export const HOOK_DIR = '.kiro/hooks';
export const HOOK_CATEGORY = 'hook';
export const HOOK_SCRIPT_CATEGORY = 'hook-script';

/** Every hook this tool installs starts with this, so it cannot collide with the user's own. */
export const HOOK_PREFIX = 'ecc-';

/** The guard script: where it is in the skill folder, where it is installed, and the command that runs it. */
export const GUARD_FILE = 'git-push-guard.mjs';
export const GUARD_SOURCE = `scripts/runtime/${GUARD_FILE}`;
export const GUARD_DEST = `${SCRIPT_DIR}/${GUARD_FILE}`;
export const GUARD_COMMAND = `node ${GUARD_DEST}`;

/** `auto-format` becomes `ecc-auto-format`. */
export const hookName = (stem) => `${HOOK_PREFIX}${stem}`;

/** Project-relative path of an installed hook file. */
export const hookDest = (stem) => `${HOOK_DIR}/${hookName(stem)}.json`;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const STEM = /^[a-z0-9][a-z0-9-]*$/;
const LEGACY_SUFFIX = '.kiro.hook';

// ---- file patterns to a matcher ------------------------------------------------------------------------

const EXTENSION_GLOB = /^\*\.([A-Za-z0-9]+)$/;
const DIRECTORY_GLOB = /^\*\*\/([A-Za-z0-9_.-]+)\/\*\*$/;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const group = (items) => (items.length === 1 ? items[0] : `(${items.join('|')})`);

// Turn the file patterns of a .kiro.hook file into one v1 matcher, a regular expression tested against
// the path of the file. Two shapes are understood and everything else is refused:
//   *.ts          any file with that extension         ->  \.ts$
//   **/auth/**    any file below a folder of that name ->  (^|/)auth/
// Several patterns of one shape share a group: *.ts and *.tsx become \.(ts|tsx)$. Both shapes together
// are joined with |. The path may be absolute or relative, so a folder is looked for after a slash or
// at the start.
/**
 * @param {unknown} globs the `when.patterns` list
 * @param {string} where used in error messages
 * @returns {string} the matcher, as the text of a regular expression
 */
export function globsToMatcher(globs, where = 'patterns') {
  if (!Array.isArray(globs) || globs.length === 0) throw new CodedError('hook-patterns', `${where}: needs a list of file patterns`);
  const extensions = [];
  const folders = [];
  for (const glob of globs) {
    const extension = typeof glob === 'string' ? EXTENSION_GLOB.exec(glob) : null;
    const folder = typeof glob === 'string' ? DIRECTORY_GLOB.exec(glob) : null;
    if (extension !== null) {
      if (!extensions.includes(extension[1])) extensions.push(extension[1]);
    } else if (folder !== null && !/^\.+$/.test(folder[1])) {
      if (!folders.includes(folder[1])) folders.push(folder[1]);
    } else {
      throw new CodedError('hook-glob-unsupported', `${where}: the pattern ${JSON.stringify(glob)} is not supported; only *.ext and **/dir/** can be turned into a matcher`, {
        fix: 'Write the matcher by hand as an adaptation in lib/hooks.mjs, with its reason.',
      });
    }
  }
  const branches = [];
  if (extensions.length > 0) branches.push(`\\.${group(extensions)}$`);
  if (folders.length > 0) branches.push(`(^|/)${group(folders.map(escapeRegex))}/`);
  return branches.join('|');
}

/** The tool categories Kiro's matchers know by name (https://kiro.dev/docs/hooks/types.md). */
export const TOOL_TYPES = Object.freeze(['read', 'write', 'shell', 'web', 'spec']);

function toolMatcher(toolTypes, where) {
  if (!Array.isArray(toolTypes) || toolTypes.length === 0) throw new CodedError('hook-tool-types', `${where}: toolTypes needs a list of tool categories`);
  for (const type of toolTypes) {
    if (!TOOL_TYPES.includes(type)) throw new CodedError('hook-tool-types', `${where}: unknown tool type ${JSON.stringify(type)} (expected one of ${TOOL_TYPES.join(', ')})`);
  }
  return [...new Set(toolTypes)].join('|');
}

// ---- reading a source hook --------------------------------------------------------------------------------

const LEGACY_KEYS = Object.freeze(['name', 'version', 'enabled', 'description', 'when', 'then']);
const WHEN_KEYS = Object.freeze(['type', 'patterns', 'toolTypes']);
const THEN_KEYS = Object.freeze(['type', 'prompt', 'command']);

const fileStem = (sourcePath) => {
  const base = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
  return base.endsWith(LEGACY_SUFFIX) ? base.slice(0, -LEGACY_SUFFIX.length) : base;
};

/**
 * Read one .kiro.hook file and check its shape. Anything unexpected stops the conversion, so a
 * field added by a later ECC release is never dropped by accident.
 * @param {{ path: string, text: string }} input `path` is the ECC-relative path, for example `.kiro/hooks/auto-format.kiro.hook`
 */
export function parseLegacyHook({ path: sourcePath, text }) {
  const fail = (code, message, fix) => {
    throw new CodedError(code, `${sourcePath}: ${message}`, fix === undefined ? undefined : { fix });
  };
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return fail('hook-json', `not valid JSON (${error.message})`);
  }
  if (!isObject(value)) return fail('hook-shape', 'the hook must be a JSON object');
  const keys = (object, allowed, label) => {
    const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) fail('hook-key-unknown', `unexpected key(s) in ${label}: ${unknown.join(', ')}`, 'Decide what the key means in Kiro, then teach lib/hooks.mjs about it.');
  };
  keys(value, LEGACY_KEYS, 'the hook');

  const stem = fileStem(sourcePath);
  if (!STEM.test(stem)) fail('hook-name', `${JSON.stringify(stem)} is not a usable hook name (lowercase letters, digits and hyphens)`);
  if (value.name !== stem) fail('hook-name', `name ${JSON.stringify(value.name)} does not match the file name ${JSON.stringify(stem)}`);
  if (value.description !== undefined && typeof value.description !== 'string') fail('hook-shape', 'description must be text');

  if (!isObject(value.when) || typeof value.when.type !== 'string') return fail('hook-shape', 'the hook has no "when" with a type');
  keys(value.when, WHEN_KEYS, '"when"');
  for (const key of ['patterns', 'toolTypes']) {
    const list = value.when[key];
    if (list !== undefined && (!Array.isArray(list) || !list.every((item) => typeof item === 'string'))) fail('hook-shape', `when.${key} must be a list of text`);
  }

  if (!isObject(value.then) || typeof value.then.type !== 'string') return fail('hook-shape', 'the hook has no "then" with a type');
  keys(value.then, THEN_KEYS, '"then"');
  const [kind, field, other] = value.then.type === 'askAgent' ? ['agent', 'prompt', 'command'] : value.then.type === 'runCommand' ? ['command', 'command', 'prompt'] : [null, null, null];
  if (kind === null) return fail('hook-action', `unknown action ${JSON.stringify(value.then.type)} (expected askAgent or runCommand)`);
  if (typeof value.then[field] !== 'string' || value.then[field].trim() === '') fail('hook-action', `a ${value.then.type} action needs a non-empty "${field}"`);
  if (value.then[other] !== undefined) fail('hook-action', `a ${value.then.type} action takes "${field}", not "${other}"`);

  return {
    name: stem,
    description: value.description,
    when: { type: value.when.type, patterns: value.when.patterns, toolTypes: value.when.toolTypes },
    then: { kind, text: value.then[field] },
  };
}

// ---- building a v1 hook -------------------------------------------------------------------------------------

/** A v1 hook, keys in the order a person would write them. It is always switched off. */
function makeHook({ name, description, trigger, matcher, action }) {
  const hook = { name };
  if (description !== undefined) hook.description = description;
  hook.trigger = trigger;
  if (matcher !== undefined) hook.matcher = matcher;
  hook.action = action;
  hook.enabled = false;
  return hook;
}

/** The text of a hook file: one hook, two-space JSON, a final newline. */
export const renderHookFile = (hook) => `${JSON.stringify({ version: HOOK_FILE_VERSION, hooks: [hook] }, null, 2)}\n`;

function replaceOnce(text, find, replacement, where) {
  const found = typeof text === 'string' ? text.split(find).length - 1 : 0;
  if (found !== 1) {
    throw new CodedError('hook-adaptation', `${where}: expected ${JSON.stringify(find)} exactly once, found it ${found} times`, {
      fix: 'The ECC text changed. Look at the new text and update the adaptation in lib/hooks.mjs.',
    });
  }
  return text.replace(find, () => replacement);
}

// ---- hooks adapted by hand -----------------------------------------------------------------------------------

/**
 * Matches the files whose creation doc-file-warning cares about: Markdown, MDX and reStructuredText
 * files, README and CHANGELOG files, and anything under docs/.
 */
export const DOC_MATCHER = '\\.(md|mdx|rst)$|(^|/)(README|CHANGELOG)[^/]*$|(^|/)docs/';

/**
 * Three hooks do not convert one to one. Each entry says why, what the source hook has to look like
 * (so a changed source cannot silently get the wrong adaptation), and how the converted hook differs.
 */
const ADAPTATIONS = Object.freeze({
  'git-push-review': {
    why: 'a v1 tool matcher cannot look at the command, so an agent prompt on the shell tool would run on every shell call; a script that acts only on git push needs no agent run and no credits',
    expects: Object.freeze({ type: 'preToolUse', toolTypes: ['shell'], kind: 'agent' }),
    adapt: (hook) =>
      makeHook({
        name: hook.name,
        description: 'Blocks git push until the pre-push checklist is acknowledged. A script reads the command, so no agent run is needed and no credits are used.',
        trigger: hook.trigger,
        matcher: hook.matcher,
        action: { type: 'command', command: GUARD_COMMAND },
      }),
    usesGuard: true,
  },
  'doc-file-warning': {
    why: 'a v1 tool matcher cannot look at the file path, so a hook on the write tool would run on every write; the file triggers can, but they run after the write, not before it',
    expects: Object.freeze({ type: 'preToolUse', toolTypes: ['write'], kind: 'agent' }),
    adapt: (hook, where) => {
      // Short phrases, each found exactly once, so that none of ECC's prose is copied into this tool.
      let prompt = hook.action.prompt;
      prompt = replaceOnce(prompt, 'You are about to create or modify a file.', 'A file was just created.', where);
      prompt = replaceOnce(prompt, "If you're creating documentation", 'If you created documentation', where);
      prompt = replaceOnce(prompt, 'or skip it.', 'or remove it.', where);
      prompt = replaceOnce(prompt, ' Proceed with the write operation if appropriate.', ' Otherwise carry on.', where);
      return makeHook({
        name: hook.name,
        description: 'Asks the agent to check documentation files right after it creates them, to avoid unnecessary documentation. A v1 hook runs after the write, not before it.',
        trigger: 'PostFileCreate',
        matcher: DOC_MATCHER,
        action: { type: 'agent', prompt },
      });
    },
  },
  'extract-patterns': {
    why: 'the lessons file is installed as ecc-lessons-learned.md',
    expects: Object.freeze({ type: 'agentStop', kind: 'agent' }),
    adapt: (hook, where) =>
      makeHook({
        ...hook,
        description: replaceOnce(hook.description, 'lessons-learned.md', 'ecc-lessons-learned.md', where),
        action: { type: 'agent', prompt: replaceOnce(hook.action.prompt, '.kiro/steering/lessons-learned.md', '.kiro/steering/ecc-lessons-learned.md', where) },
      }),
  },
});

/** The hooks that are adapted by hand, with the reason. For the report and the tests. */
export const ADAPTED_HOOKS = Object.freeze(Object.fromEntries(Object.entries(ADAPTATIONS).map(([name, entry]) => [name, entry.why])));

function checkExpected(legacy, expects, where) {
  const same =
    legacy.when.type === expects.type &&
    legacy.then.kind === expects.kind &&
    (expects.toolTypes === undefined || JSON.stringify(legacy.when.toolTypes) === JSON.stringify(expects.toolTypes));
  if (!same) {
    throw new CodedError('hook-adaptation', `${where}: the adaptation for ${legacy.name} expects a ${expects.type} hook${expects.toolTypes ? ` on ${expects.toolTypes.join(', ')}` : ''} with an ${expects.kind} action, and the source is different`, {
      fix: 'The ECC hook changed. Look at it and update the adaptation in lib/hooks.mjs.',
    });
  }
}

// ---- converting -------------------------------------------------------------------------------------------------

/**
 * Convert one ECC adapter hook.
 * @param {{ path: string, text: string }} input `path` is the ECC-relative path
 * @returns {{ name: string, skipped: { reason: string } }
 *   | { name: string, dest: string, hook: object, content: string, adapted: string | null, usesGuard: boolean }}
 */
export function convertHook({ path: sourcePath, text }) {
  const legacy = parseLegacyHook({ path: sourcePath, text });
  const { name, when, then } = legacy;

  if (when.type === 'userTriggered') {
    return { name, skipped: { reason: 'it is started by hand, and a v1 hook cannot be (IDE 1.0 cannot create a manual hook); a manually included steering file is the Kiro way' } };
  }
  if (!Object.hasOwn(LEGACY_TRIGGERS, when.type)) {
    throw new CodedError('hook-trigger-unknown', `${sourcePath}: unknown hook type ${JSON.stringify(when.type)}`, {
      fix: 'Decide what it means in Kiro, then add it to LEGACY_TRIGGERS in lib/hook-schema.mjs.',
    });
  }
  const trigger = LEGACY_TRIGGERS[when.type];
  const { subject } = HOOK_TRIGGERS[trigger];

  let matcher;
  const extra = (key) => {
    if (when[key] !== undefined) throw new CodedError('hook-patterns', `${sourcePath}: a ${when.type} hook does not take ${key}`);
  };
  if (subject === 'path') {
    extra('toolTypes');
    matcher = globsToMatcher(when.patterns, `${sourcePath}: when.patterns`);
  } else if (subject === 'tool') {
    extra('patterns');
    matcher = toolMatcher(when.toolTypes, `${sourcePath}: when.toolTypes`);
  } else {
    extra('patterns');
    extra('toolTypes');
  }

  const action = then.kind === 'agent' ? { type: 'agent', prompt: then.text } : { type: 'command', command: then.text };
  let hook = makeHook({ name: hookName(name), description: legacy.description, trigger, matcher, action });

  let adapted = null;
  let usesGuard = false;
  if (Object.hasOwn(ADAPTATIONS, name)) {
    const entry = ADAPTATIONS[name];
    checkExpected(legacy, entry.expects, sourcePath);
    hook = entry.adapt(hook, sourcePath);
    adapted = entry.why;
    usesGuard = entry.usesGuard === true;
  }

  const found = validateHookFile({ version: HOOK_FILE_VERSION, hooks: [hook] }, { requireDisabled: true });
  if (found.length > 0) throw new CodedError('hook-invalid', `${sourcePath}: the converted hook breaks the v1 format: ${found[0].message}${found.length > 1 ? ` (and ${found.length - 1} more)` : ''}`);

  return { name, dest: hookDest(name), hook, content: renderHookFile(hook), adapted, usesGuard };
}
