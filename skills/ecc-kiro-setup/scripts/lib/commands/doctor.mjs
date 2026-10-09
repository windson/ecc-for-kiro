import path from 'node:path';

import { collectDoctor, formatDoctor } from '../doctor.mjs';
import { EXIT } from '../exit.mjs';

export const doctorCommand = {
  summary: 'check tools, the project and any existing ECC install (read-only)',
  options: ['json', 'root'],
  async run({ options, stdout, probes, skillDir }) {
    const root = path.resolve(options.root ?? probes.cwd);
    const report = await collectDoctor({ root, skillDir, probes });
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctor(report));
    return report.ok ? EXIT.OK : EXIT.FAILED;
  },
};
