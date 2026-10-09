// Command-line option definitions and parsing.

import { UsageError } from './exit.mjs';

export const OPTION_SPECS = Object.freeze({
  json: { type: 'boolean', help: 'print machine-readable JSON' },
  root: { type: 'string', help: 'project root (default: current directory)' },
  format: { type: 'string', help: 'output style of "audit": text (default) or json' },
  source: { type: 'string', help: 'read ECC from this checkout instead of the cache' },
  fetch: { type: 'boolean', help: 'download ECC from github.com into the cache when it is missing or incomplete' },
  profile: { type: 'string', help: 'profile file to use (default: the bundled profile)' },
  kimi: { type: 'string', help: 'Kimi install state to derive a profile from (default: .kimi-code/ecc-install-state.json)' },
  extras: { type: 'string', help: 'extra profile entries to add on top of the Kimi install (default: assets/profiles/extras-v<version>.json)' },
  out: { type: 'string', help: 'file that "profile --write" writes (default: the bundled profile)' },
  write: { type: 'boolean', help: 'write the file instead of only checking it' },
  only: { type: 'string', help: 'limit the run to these parts, comma-separated (default: every part this build has)' },
  action: { type: 'string', help: 'what "plan" previews: install (default), update or uninstall' },
  yes: { type: 'boolean', help: 'apply the changes; without it install, update and uninstall refuse to change anything' },
  'dry-run': { type: 'boolean', help: 'show what would change and write nothing' },
  help: { type: 'boolean', help: 'show help' },
});

/**
 * @param {string[]} argv arguments after the command name
 * @param {readonly string[]} allowed option names the command accepts
 * @returns {{ options: Record<string, string | boolean>, positionals: string[] }}
 */
export function parseArguments(argv, allowed) {
  const options = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
      const spec = Object.hasOwn(OPTION_SPECS, name) ? OPTION_SPECS[name] : undefined;
      if (!spec || (name !== 'help' && !allowed.includes(name))) throw new UsageError(`unknown option --${name}`);
      if (spec.type === 'boolean') {
        if (equals !== -1) throw new UsageError(`--${name} does not take a value`);
        options[name] = true;
      } else {
        let value;
        if (equals !== -1) {
          value = arg.slice(equals + 1);
        } else {
          value = argv[i + 1];
          i += 1;
        }
        if (value === undefined || value === '' || (equals === -1 && value.startsWith('--'))) {
          throw new UsageError(`--${name} needs a value`);
        }
        options[name] = value;
      }
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') throw new UsageError(`unknown option ${arg}`);
    positionals.push(arg);
  }
  return { options, positionals };
}
