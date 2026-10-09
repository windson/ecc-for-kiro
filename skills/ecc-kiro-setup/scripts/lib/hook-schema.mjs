// The Kiro v1 hook file format, and a validator for it.
//
// Pure: a parsed JSON value in, a list of problems out. The rules come from these Kiro pages,
// read on 2026-10-07:
//   https://kiro.dev/docs/hooks.md                   file schema, field reference, confirmation prompts
//   https://kiro.dev/docs/hooks/types.md             the triggers, what a matcher is tested against
//   https://kiro.dev/docs/hooks/actions.md           command and agent actions, exit codes
//   https://kiro.dev/docs/ide/whats-new-v1/hooks.md  the ten triggers of IDE 1.0 and the 0.x names
//
// A hook file this tool installs has to work in the IDE and in the CLI, so the trigger list is the
// ten triggers both have. Kiro documents a few more for one surface only (SessionEnd, Manual, the
// AgentSpawn alias); they are refused here, with the reason.
//
// The validator is strict about keys on purpose. A misspelled `enabled` would leave a hook on, and
// everything this tool installs ships switched off.

export const HOOK_FILE_VERSION = 'v1';

/**
 * The portable triggers. `subject` is what the matcher is tested against: a tool name, a file path,
 * the prompt text, or nothing (the hook then always fires). `canBlock` says whether a command that
 * exits 2 stops the event.
 */
export const HOOK_TRIGGERS = Object.freeze({
  SessionStart: Object.freeze({ subject: null, canBlock: false }),
  Stop: Object.freeze({ subject: null, canBlock: false }),
  UserPromptSubmit: Object.freeze({ subject: 'prompt', canBlock: true }),
  PreTaskExec: Object.freeze({ subject: null, canBlock: true }),
  PostTaskExec: Object.freeze({ subject: null, canBlock: false }),
  PreToolUse: Object.freeze({ subject: 'tool', canBlock: true }),
  PostToolUse: Object.freeze({ subject: 'tool', canBlock: false }),
  PostFileCreate: Object.freeze({ subject: 'path', canBlock: false }),
  PostFileSave: Object.freeze({ subject: 'path', canBlock: false }),
  PostFileDelete: Object.freeze({ subject: 'path', canBlock: false }),
});

/** The 0.x names (`when.type` of a .kiro.hook file) and the trigger each one became. userTriggered has none. */
export const LEGACY_TRIGGERS = Object.freeze({
  agentSpawn: 'SessionStart',
  agentStop: 'Stop',
  promptSubmit: 'UserPromptSubmit',
  preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  fileCreated: 'PostFileCreate',
  fileEdited: 'PostFileSave',
  fileDeleted: 'PostFileDelete',
  preTaskExecution: 'PreTaskExec',
  postTaskExecution: 'PostTaskExec',
});

/** Documented triggers that only some surfaces have. */
const ONE_SURFACE = Object.freeze({
  SessionEnd: 'is only available in the CLI (V3)',
  Manual: 'is only available in Kiro Web and the CLI (V3), and the IDE cannot create one',
  AgentSpawn: 'is a CLI-only alias of SessionStart',
  agentSpawn: 'is a CLI-only alias of SessionStart',
});

export const ACTION_TYPES = Object.freeze(['command', 'agent']);

/** Template variables a command action may use. Kiro documents one, for the file triggers. */
export const TEMPLATE_VARIABLES = Object.freeze(['filePath']);

const TOP_KEYS = Object.freeze(['version', 'hooks']);
const HOOK_KEYS = Object.freeze(['name', 'description', 'trigger', 'matcher', 'action', 'timeout', 'enabled', 'confirm']);
const ACTION_KEYS = Object.freeze(['type', 'command', 'prompt']);
const CONFIRM_KEYS = Object.freeze(['question', 'options', 'confirmCommand']);
const OPTION_KEYS = Object.freeze(['id', 'label', 'run']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isFileTrigger = (trigger) => typeof trigger === 'string' && Object.hasOwn(HOOK_TRIGGERS, trigger) && HOOK_TRIGGERS[trigger].subject === 'path';

/**
 * Why this matcher is not a regular expression every Kiro surface can read, or null when it is one.
 * Lookahead, lookbehind and backreferences are refused because the surfaces do not share an engine
 * and Kiro does not say which features they have in common.
 */
export function matcherProblem(matcher) {
  if (!isText(matcher)) return 'must be a non-empty regular expression';
  try {
    new RegExp(matcher);
  } catch (error) {
    return `is not a valid regular expression (${error.message})`;
  }
  // Escaped characters (\( and \\ for example) are not syntax, so look at the rest.
  const bare = matcher.replace(/\\[\s\S]/g, '');
  if (/\(\?<?[=!]/.test(bare)) return 'uses a lookahead or lookbehind, which not every regular expression engine supports';
  for (const escaped of matcher.matchAll(/\\([\s\S])/g)) {
    if (/[1-9k]/.test(escaped[1])) return 'uses a backreference, which not every regular expression engine supports';
  }
  return null;
}

/** Why this is not a trigger a portable hook file can use. */
function triggerProblem(trigger) {
  if (typeof trigger !== 'string') return 'trigger must be text';
  if (Object.hasOwn(LEGACY_TRIGGERS, trigger) && !Object.hasOwn(ONE_SURFACE, trigger)) return `"${trigger}" is the 0.x name; the v1 trigger is "${LEGACY_TRIGGERS[trigger]}"`;
  if (trigger === 'userTriggered') return '"userTriggered" has no v1 trigger; use a manually included steering file for an on-demand workflow';
  if (Object.hasOwn(ONE_SURFACE, trigger)) return `"${trigger}" ${ONE_SURFACE[trigger]}, so a hook file for every surface cannot use it`;
  return `unknown trigger ${JSON.stringify(trigger)} (the portable triggers are ${Object.keys(HOOK_TRIGGERS).join(', ')})`;
}

function checkAction(action, label, bad) {
  if (!isObject(action)) return bad('hook-action', `${label}: action must be an object`);
  const unknown = Object.keys(action).filter((key) => !ACTION_KEYS.includes(key));
  if (unknown.length > 0) bad('hook-action-key-unknown', `${label}: unknown key(s) in action: ${unknown.join(', ')}`);
  if (!ACTION_TYPES.includes(action.type)) return bad('hook-action-type', `${label}: action.type must be "command" or "agent"`);
  const [needed, other] = action.type === 'command' ? ['command', 'prompt'] : ['prompt', 'command'];
  const kind = `${action.type === 'agent' ? 'an' : 'a'} ${action.type} action`;
  if (!isText(action[needed])) bad(`hook-action-${needed}`, `${label}: ${kind} needs a non-empty "${needed}"`);
  if (action[other] !== undefined) bad('hook-action-mismatch', `${label}: ${kind} takes "${needed}", not "${other}"`);
}

function checkConfirm(hook, label, bad) {
  const { confirm } = hook;
  if (hook.trigger !== 'Stop' || hook.action?.type !== 'command') {
    bad('hook-confirm-unused', `${label}: confirm only belongs to a command action on the Stop trigger`);
  }
  if (!isObject(confirm)) return bad('hook-confirm', `${label}: confirm must be an object`);
  const unknown = Object.keys(confirm).filter((key) => !CONFIRM_KEYS.includes(key));
  if (unknown.length > 0) bad('hook-confirm', `${label}: unknown key(s) in confirm: ${unknown.join(', ')}`);
  if (!isText(confirm.question)) bad('hook-confirm', `${label}: confirm.question must be text`);
  if (confirm.confirmCommand !== undefined && !isText(confirm.confirmCommand)) bad('hook-confirm', `${label}: confirm.confirmCommand must be a command`);
  if (!Array.isArray(confirm.options) || confirm.options.length === 0) return bad('hook-confirm', `${label}: confirm.options must be a non-empty list`);
  const ids = new Set();
  for (const [index, option] of confirm.options.entries()) {
    const where = `${label}: confirm.options[${index}]`;
    if (!isObject(option)) {
      bad('hook-confirm', `${where} must be an object`);
      continue;
    }
    const extra = Object.keys(option).filter((key) => !OPTION_KEYS.includes(key));
    if (extra.length > 0) bad('hook-confirm', `${where}: unknown key(s): ${extra.join(', ')}`);
    if (!isText(option.id)) bad('hook-confirm', `${where}: id must be text`);
    else if (ids.has(option.id)) bad('hook-confirm', `${where}: the id ${JSON.stringify(option.id)} is used twice`);
    else ids.add(option.id);
    if (!isText(option.label)) bad('hook-confirm', `${where}: label must be text`);
    if (typeof option.run !== 'boolean') bad('hook-confirm', `${where}: run must be true or false`);
  }
}

function checkHook(hook, where, { bad, names, requireDisabled }) {
  if (!isObject(hook)) return bad('hook-shape', `${where} must be an object`);
  const label = isText(hook.name) ? `${where} "${hook.name}"` : where;
  const unknown = Object.keys(hook).filter((key) => !HOOK_KEYS.includes(key));
  if (unknown.length > 0) bad('hook-key-unknown', `${label}: unknown key(s): ${unknown.join(', ')}`);

  if (!isText(hook.name)) bad('hook-name', `${label}: name must be text`);
  else if (names.has(hook.name)) bad('hook-name-duplicate', `${label}: the name is used twice in this file`);
  else names.add(hook.name);
  if (hook.description !== undefined && typeof hook.description !== 'string') bad('hook-description', `${label}: description must be text`);

  // A list or number would be turned into a property name by hasOwn, so only text is looked up.
  const trigger = typeof hook.trigger === 'string' && Object.hasOwn(HOOK_TRIGGERS, hook.trigger) ? HOOK_TRIGGERS[hook.trigger] : undefined;
  if (trigger === undefined) bad('hook-trigger', `${label}: ${triggerProblem(hook.trigger)}`);

  if (hook.matcher !== undefined) {
    // "*" is how Kiro writes "every tool"; it is not a regular expression.
    const everyTool = hook.matcher === '*' && trigger?.subject === 'tool';
    const why = everyTool ? null : matcherProblem(hook.matcher);
    if (why !== null) bad('hook-matcher', `${label}: matcher ${why}`);
    if (trigger?.subject === null) bad('hook-matcher-unused', `${label}: ${hook.trigger} does not test a matcher, so the hook always fires`);
  }

  checkAction(hook.action, label, bad);
  const type = isObject(hook.action) ? hook.action.type : undefined;

  if (hook.timeout !== undefined) {
    if (typeof hook.timeout !== 'number' || !Number.isFinite(hook.timeout) || hook.timeout < 0) bad('hook-timeout', `${label}: timeout is a number of seconds, 0 or more`);
    else if (type === 'agent') bad('hook-timeout-unused', `${label}: timeout is ignored for an agent action`);
  }

  if (hook.enabled !== undefined && typeof hook.enabled !== 'boolean') bad('hook-enabled', `${label}: enabled must be true or false`);
  if (requireDisabled && hook.enabled !== false) bad('hook-not-disabled', `${label}: enabled must be false, because ECC hooks ship switched off`);

  if (hook.confirm !== undefined) checkConfirm(hook, label, bad);

  if (type === 'command' && typeof hook.action.command === 'string') {
    for (const found of hook.action.command.matchAll(/\{\{([^{}]*)\}\}/g)) {
      if (!TEMPLATE_VARIABLES.includes(found[1])) bad('hook-template-unknown', `${label}: unknown template variable ${found[0]} (Kiro documents {{filePath}})`);
      else if (!isFileTrigger(hook.trigger)) bad('hook-template-misplaced', `${label}: ${found[0]} is only available to the file triggers`);
    }
  }
}

/**
 * Check a parsed hook file against the documented v1 format.
 * @param {unknown} value the parsed JSON
 * @param {{ requireDisabled?: boolean }} [options] require `enabled: false` on every hook
 * @returns {{ code: string, message: string }[]} empty when the file is fine
 */
export function validateHookFile(value, { requireDisabled = false } = {}) {
  const problems = [];
  const bad = (code, message) => problems.push({ code, message });
  if (!isObject(value)) {
    bad('hook-file-shape', 'the file must be a JSON object');
    return problems;
  }
  const unknown = Object.keys(value).filter((key) => !TOP_KEYS.includes(key));
  if (unknown.length > 0) bad('hook-file-key-unknown', `unknown key(s) in the file: ${unknown.join(', ')}`);
  if (value.version !== HOOK_FILE_VERSION) bad('hook-version', `version must be "${HOOK_FILE_VERSION}" (found ${JSON.stringify(value.version ?? null)})`);
  if (!Array.isArray(value.hooks) || value.hooks.length === 0) {
    bad('hook-file-shape', '"hooks" must be a non-empty list');
    return problems;
  }
  const names = new Set();
  for (const [index, hook] of value.hooks.entries()) checkHook(hook, `hooks[${index}]`, { bad, names, requireDisabled });
  return problems;
}
