// The Kiro workflow recipe format, and a validator for it.
//
// Pure: a parsed JSON value in, a list of problems out. The rules come from these Kiro pages, read on 2026-10-08:
//   https://kiro.dev/docs/workflows/authoring.md   root fields, node types, templates, stop conditions, limits
//   https://kiro.dev/docs/workflows/patterns.md    complete recipes
//
// This is not Kiro's own validator (`validate_workflow`), which also needs a running Kiro. It checks what the
// pages say a recipe must satisfy, so a recipe this tool installs is known to be well formed: node types and
// their required fields, unique ids, at most 50 steps and 8 levels, a finite cap on every repeat, and the
// order rules for templates. It is strict about keys on purpose, like lib/hook-schema.mjs.

export const WORKFLOW_DIR = '.kiro/workflows';
export const WORKFLOW_SUFFIX = '.workflow.json';
export const MAX_STEPS = 50;
export const MAX_DEPTH = 8;

/** Agents Kiro ships for recipes. They exist only while Workflows are enabled and vary by account and client. */
export const BUNDLED_WORKFLOW_AGENTS = Object.freeze([
  'wf-planner',
  'wf-coder',
  'wf-design',
  'wf-design-reviewer',
  'wf-review-aggregator',
  'wf-pr-submitter',
  'wf-pr-responder',
  'wf-auto-researcher',
  'wf-workflow-creator',
  'semantic_reviewer',
]);

export const JOIN_POLICIES = Object.freeze(['all', 'allSettled', 'any']);
export const MAX_ITERATION_ACTIONS = Object.freeze(['abort', 'continue', 'pause']);

const ROOT_KEYS = Object.freeze(['name', 'description', 'inputs', 'modelId', 'effortLevel', 'steps']);
const NODE_KEYS = Object.freeze({
  step: ['type', 'id', 'agent', 'prompt', 'artifacts', 'captureOutput', 'completion', 'modelId', 'effortLevel'],
  sequence: ['type', 'id', 'steps'],
  repeat: ['type', 'id', 'steps', 'maxIterations', 'onMaxIterations', 'stopCondition', 'stopWhen'],
  parallel: ['type', 'id', 'branches', 'joinPolicy'],
  watch: ['type', 'id', 'handler', 'config', 'idleTimeoutSec'],
});
const STOP_CONDITION_KEYS = Object.freeze(['containsText', 'completionSignal', 'fileCheck']);
const FILE_CHECK_KEYS = Object.freeze(['path', 'jsonPath', 'value']);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TEMPLATE = /\{\{\s*([^{}]*?)\s*\}\}/g;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** Every `{{...}}` in a string. */
const templatesOf = (text) => [...String(text).matchAll(TEMPLATE)].map((match) => match[1]);

/**
 * Check a parsed recipe against the documented format.
 * @param {unknown} recipe
 * @param {{ knownAgents?: Iterable<string> }} [options] when given, a step whose agent is not in the list is a problem
 * @returns {{ code: string, message: string }[]} empty when the recipe is fine
 */
export function validateWorkflowRecipe(recipe, { knownAgents } = {}) {
  const problems = [];
  const bad = (code, message) => problems.push({ code, message });
  if (!isObject(recipe)) return [{ code: 'workflow-shape', message: 'the recipe must be a JSON object' }];

  const unknown = Object.keys(recipe).filter((key) => !ROOT_KEYS.includes(key));
  if (unknown.length > 0) bad('workflow-key-unknown', `unknown key(s) in the recipe: ${unknown.join(', ')}`);
  if (!isText(recipe.name)) bad('workflow-name', 'the recipe needs a name');
  if (recipe.description !== undefined && typeof recipe.description !== 'string') bad('workflow-description', 'description must be text');
  const inputs = new Set();
  if (recipe.inputs !== undefined) {
    if (!isObject(recipe.inputs)) bad('workflow-inputs', 'inputs must map each input name to a type hint');
    else {
      for (const [name, hint] of Object.entries(recipe.inputs)) {
        if (!ID.test(name)) bad('workflow-inputs', `the input name ${JSON.stringify(name)} is not usable in a template`);
        if (typeof hint !== 'string') bad('workflow-inputs', `the type hint of input "${name}" must be text`);
        inputs.add(name);
      }
    }
  }
  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
    bad('workflow-steps', '"steps" must be a non-empty list');
    return problems;
  }

  const agents = knownAgents === undefined ? null : new Set(knownAgents);
  const ids = new Set();
  let stepCount = 0;

  /**
   * Walk one container. `seen` holds what an earlier node has produced: ids with output, and artifact names.
   * It is copied for each parallel branch, so branches cannot see each other.
   */
  const walkList = (nodes, seen, depth, { inParallel }) => {
    nodes.forEach((node, index) => walkNode(node, seen, depth, { first: index === 0, inParallel }));
  };

  const checkTemplates = (text, label, seen, { first, inParallel }) => {
    for (const reference of templatesOf(text)) {
      if (reference === 'previous.output' || reference === 'previous') {
        if (inParallel) bad('workflow-template-order', `${label}: {{${reference}}} cannot be used inside a parallel branch, where branches have no order`);
        else if (first) bad('workflow-template-order', `${label}: {{${reference}}} cannot be used in the first node of a container`);
      } else if (reference.startsWith('artifacts.')) {
        const name = reference.slice('artifacts.'.length);
        if (!seen.artifacts.has(name)) bad('workflow-template-order', `${label}: {{${reference}}} names an artifact that no earlier step registers`);
      } else if (reference.endsWith('.output')) {
        const id = reference.slice(0, -'.output'.length);
        if (!seen.outputs.has(id)) bad('workflow-template-order', `${label}: {{${reference}}} refers to a step that does not run before this one`);
      } else if (!inputs.has(reference)) {
        bad('workflow-template-input', `${label}: {{${reference}}} is not a declared input, and Kiro leaves it as literal text`);
      }
    }
  };

  const walkNode = (node, seen, depth, { first, inParallel }) => {
    if (depth > MAX_DEPTH) {
      bad('workflow-depth', `nodes may nest at most ${MAX_DEPTH} levels deep`);
      return;
    }
    if (!isObject(node) || typeof node.type !== 'string' || !Object.hasOwn(NODE_KEYS, node.type)) {
      bad('workflow-node-type', `a node must be an object with a type of ${Object.keys(NODE_KEYS).join(', ')}`);
      return;
    }
    const label = `${node.type} "${node.id ?? '?'}"`;
    const extra = Object.keys(node).filter((key) => !NODE_KEYS[node.type].includes(key));
    if (extra.length > 0) bad('workflow-key-unknown', `${label}: unknown key(s): ${extra.join(', ')}`);
    if (!isText(node.id) || !ID.test(node.id)) bad('workflow-id', `${label}: a node needs an id of letters, digits, hyphens and underscores`);
    else if (ids.has(node.id)) bad('workflow-id-duplicate', `${label}: the id is used twice`);
    else ids.add(node.id);

    if (node.type === 'step') {
      stepCount += 1;
      if (!isText(node.agent)) bad('workflow-step', `${label}: needs an agent`);
      else if (agents !== null && !agents.has(node.agent)) bad('workflow-agent-unknown', `${label}: the agent "${node.agent}" is not an installed agent or a bundled workflow agent`);
      if (!isText(node.prompt)) bad('workflow-step', `${label}: needs a prompt`);
      else checkTemplates(node.prompt, label, seen, { first, inParallel });
      if (node.captureOutput !== undefined && typeof node.captureOutput !== 'boolean') bad('workflow-step', `${label}: captureOutput must be true or false`);
      for (const key of ['modelId', 'effortLevel']) {
        if (node[key] !== undefined && !isText(node[key])) bad('workflow-step', `${label}: ${key} must be text`);
      }
      if (node.completion !== undefined) checkStop(node.completion, label);
      if (node.artifacts !== undefined) {
        if (!isObject(node.artifacts)) bad('workflow-step', `${label}: artifacts must map a name to a file path`);
        else {
          for (const [name, file] of Object.entries(node.artifacts)) {
            if (!isText(file)) bad('workflow-step', `${label}: the artifact "${name}" needs a file path`);
            else {
              checkTemplates(file, label, seen, { first, inParallel });
              if (/^(\/|[A-Za-z]:)/.test(file) || file.split(/[\\/]/).includes('..')) bad('workflow-artifact-path', `${label}: the artifact path "${file}" must stay inside the workspace`);
            }
            seen.artifacts.add(name);
          }
        }
      }
      if (node.captureOutput !== false && isText(node.id)) seen.outputs.add(node.id);
      return;
    }

    if (node.type === 'sequence') {
      if (!Array.isArray(node.steps) || node.steps.length === 0) bad('workflow-container', `${label}: "steps" must be a non-empty list`);
      else walkList(node.steps, seen, depth + 1, { inParallel });
      return;
    }

    if (node.type === 'repeat') {
      if (!Number.isInteger(node.maxIterations) || node.maxIterations < 1) bad('workflow-repeat', `${label}: maxIterations must be a whole number, 1 or more (every repeat needs a finite cap)`);
      if (!MAX_ITERATION_ACTIONS.includes(node.onMaxIterations)) bad('workflow-repeat', `${label}: onMaxIterations must be one of ${MAX_ITERATION_ACTIONS.join(', ')}`);
      if (node.stopCondition !== undefined && node.stopWhen !== undefined) bad('workflow-repeat', `${label}: use stopCondition or stopWhen, not both`);
      if (node.stopCondition !== undefined) checkStop(node.stopCondition, label);
      if (node.stopWhen !== undefined && !isText(node.stopWhen)) bad('workflow-repeat', `${label}: stopWhen must be text`);
      if (!Array.isArray(node.steps) || node.steps.length === 0) bad('workflow-container', `${label}: "steps" must be a non-empty list`);
      else walkList(node.steps, seen, depth + 1, { inParallel });
      return;
    }

    if (node.type === 'parallel') {
      if (!JOIN_POLICIES.includes(node.joinPolicy)) bad('workflow-parallel', `${label}: joinPolicy must be one of ${JOIN_POLICIES.join(', ')}`);
      if (!Array.isArray(node.branches) || node.branches.length === 0) {
        bad('workflow-container', `${label}: "branches" must be a non-empty list`);
        return;
      }
      const joined = { outputs: new Set(seen.outputs), artifacts: new Set(seen.artifacts) };
      for (const branch of node.branches) {
        const own = { outputs: new Set(seen.outputs), artifacts: new Set(seen.artifacts) };
        walkNode(branch, own, depth + 1, { first: false, inParallel: true });
        for (const id of own.outputs) joined.outputs.add(id);
        for (const name of own.artifacts) joined.artifacts.add(name);
      }
      for (const id of joined.outputs) seen.outputs.add(id);
      for (const name of joined.artifacts) seen.artifacts.add(name);
      return;
    }

    // watch
    if (!isText(node.handler)) bad('workflow-watch', `${label}: needs a handler`);
    if (!isObject(node.config)) bad('workflow-watch', `${label}: needs a config object`);
    if (isText(node.id)) seen.outputs.add(node.id);
  };

  const checkStop = (condition, label) => {
    if (!isObject(condition)) return bad('workflow-stop', `${label}: a stop condition must be an object`);
    const extra = Object.keys(condition).filter((key) => !STOP_CONDITION_KEYS.includes(key));
    if (extra.length > 0) bad('workflow-stop', `${label}: unknown key(s) in the stop condition: ${extra.join(', ')}`);
    if (Object.keys(condition).length === 0) bad('workflow-stop', `${label}: a stop condition needs at least one of ${STOP_CONDITION_KEYS.join(', ')}`);
    if (condition.fileCheck !== undefined) {
      const check = condition.fileCheck;
      if (!isObject(check) || !isText(check.path) || !isText(check.jsonPath) || !Object.hasOwn(check, 'value')) bad('workflow-stop', `${label}: fileCheck needs a path, a jsonPath and a value`);
      else {
        const more = Object.keys(check).filter((key) => !FILE_CHECK_KEYS.includes(key));
        if (more.length > 0) bad('workflow-stop', `${label}: unknown key(s) in fileCheck: ${more.join(', ')}`);
        if (/^(\/|[A-Za-z]:)/.test(check.path) || check.path.split(/[\\/]/).includes('..')) bad('workflow-artifact-path', `${label}: the fileCheck path "${check.path}" must stay inside the workspace`);
      }
    }
    if (condition.containsText !== undefined && !isText(condition.containsText)) bad('workflow-stop', `${label}: containsText must be text`);
  };

  walkList(recipe.steps, { outputs: new Set(), artifacts: new Set() }, 1, { inParallel: false });
  if (stepCount > MAX_STEPS) bad('workflow-too-many-steps', `a recipe can contain at most ${MAX_STEPS} step nodes (this one has ${stepCount})`);
  return problems;
}
