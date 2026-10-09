// Exit codes and error types shared by the CLI and its commands.

export const EXIT = Object.freeze({ OK: 0, FAILED: 1, USAGE: 2 });

/** The command line was wrong: bad option, missing value, unknown command. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** A failure with a stable machine-readable code (for example from fetching the source). */
export class CodedError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ fix?: string }} [options]
   */
  constructor(code, message, { fix } = {}) {
    super(message);
    this.name = 'CodedError';
    this.code = code;
    this.fix = fix ?? null;
  }
}
