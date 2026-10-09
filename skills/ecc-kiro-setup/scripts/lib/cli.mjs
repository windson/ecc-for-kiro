// Command routing and output for ecc-kiro.mjs.

import { ECC_TAG, SKILL_NAME, SKILL_VERSION } from './constants.mjs';
import { auditCommand } from './commands/audit.mjs';
import { doctorCommand } from './commands/doctor.mjs';
import { installCommand, planCommand, uninstallCommand, updateCommand } from './commands/plan.mjs';
import { profileCommand } from './commands/profile.mjs';
import { verifyCommand } from './commands/verify.mjs';
import { CodedError, EXIT, UsageError } from './exit.mjs';
import { OPTION_SPECS, parseArguments } from './options.mjs';

export { EXIT, UsageError, parseArguments };

/** Commands, in the order the usage text lists them. */
const COMMANDS = {
  doctor: doctorCommand,
  audit: auditCommand,
  verify: verifyCommand,
  profile: profileCommand,
  plan: planCommand,
  install: installCommand,
  update: updateCommand,
  uninstall: uninstallCommand,
};

export function usage() {
  const names = Object.keys(COMMANDS);
  const width = Math.max(...names.map((name) => name.length)) + 2;
  const lines = [`${SKILL_NAME} ${SKILL_VERSION} (ECC ${ECC_TAG})`, '', 'Usage: node ecc-kiro.mjs <command> [options]', '', 'Commands:'];
  for (const name of names) {
    const command = COMMANDS[name];
    lines.push(`  ${name.padEnd(width)}${command.summary}`);
    lines.push(`  ${' '.repeat(width)}options: ${command.options.map((option) => `--${option}`).join(' ')}${command.positionals ? ` ${command.positionals.usage} (${command.positionals.help})` : ''}`);
  }
  lines.push('', 'Options:');
  const flags = Object.entries(OPTION_SPECS).map(([name, spec]) => [spec.type === 'string' ? `--${name} <value>` : `--${name}`, spec.help]);
  const flagWidth = Math.max(...flags.map(([flag]) => flag.length)) + 2;
  for (const [flag, help] of flags) lines.push(`  ${flag.padEnd(flagWidth)}${help}`);
  lines.push('', 'Exit codes: 0 ok, 1 a check failed, 2 usage error.');
  return `${lines.join('\n')}\n`;
}

function reportError(stdout, stderr, json, command, code, message, fix = null) {
  if (json) {
    stdout.write(`${JSON.stringify({ ok: false, command, error: { code, message, fix } }, null, 2)}\n`);
  } else {
    stderr.write(`ecc-kiro: ${message}\n${fix ? `  fix: ${fix}\n` : ''}`);
  }
}

/**
 * Run the CLI and return the process exit code. Nothing here calls process.exit.
 * @param {string[]} argv
 * @param {{ stdout: {write(s: string): unknown}, stderr: {write(s: string): unknown}, probes: any, skillDir: string, services?: any }} context
 */
export async function runCli(argv, context) {
  const { stdout, stderr } = context;
  const json = argv.includes('--json');
  const [name, ...rest] = argv;

  try {
    if (name === undefined) {
      stderr.write(usage());
      return EXIT.USAGE;
    }
    if (name === 'help' || name === '--help' || name === '-h') {
      stdout.write(usage());
      return EXIT.OK;
    }
    if (!Object.hasOwn(COMMANDS, name)) throw new UsageError(`unknown command "${name}"`);

    const command = COMMANDS[name];
    const { options, positionals } = parseArguments(rest, command.options);
    if (options.help) {
      stdout.write(usage());
      return EXIT.OK;
    }
    const maxPositionals = command.positionals?.max ?? 0;
    if (positionals.length > maxPositionals) throw new UsageError(`unexpected argument "${positionals[maxPositionals]}"`);
    const log = (message) => stderr.write(`${message}\n`);
    return await command.run({ options, positionals, log, ...context });
  } catch (error) {
    if (error instanceof UsageError) {
      reportError(stdout, stderr, json, name ?? null, 'usage', `${error.message}. Run with --help for usage.`);
      return EXIT.USAGE;
    }
    if (error instanceof CodedError) {
      reportError(stdout, stderr, json, name ?? null, error.code, error.message, error.fix);
      return EXIT.FAILED;
    }
    reportError(stdout, stderr, json, name ?? null, 'failed', error instanceof Error ? error.message : String(error));
    return EXIT.FAILED;
  }
}
