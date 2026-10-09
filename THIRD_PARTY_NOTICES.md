# Third-party notices

ecc-for-kiro is MIT licensed and uses only Node built-in modules, so it carries no bundled dependencies. This file records the projects it credits, the released software it downloads, the specifications it follows, and the trademarks it names. It is engineering diligence, not legal advice.

## ECC (downloaded at install time, not included)

This repository does not contain ECC. The installer downloads a pinned ECC release from github.com and converts it on your machine.

- Project: ECC (https://github.com/affaan-m/ECC)
- License: MIT
- Copyright (c) 2026 Affaan Mustafa
- Release: tag `v2.2.3`
- Commit: `c05b2d6614f62f6db0047669aa4eefb223d478f9`
- LICENSE sha256: `326146379f01bb137c0a5d3c54770c1aa31076705c8b88a7f6b26a460f6221b2`

Some installed ECC command text is adapted into Kiro-native form in this project (see the repository's `skills/ecc-kiro-setup/assets/commands/overlays/`). That adapted text is used under ECC's MIT License, and ECC's MIT notice travels with it.

### MIT License (ECC)

```
MIT License

Copyright (c) 2026 Affaan Mustafa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Some ECC skills describe third-party commercial services. Those services carry their own terms, which are separate from the licenses listed here.

## Projects credited inside the installed ECC files

ECC's own files credit the projects below, which are MIT licensed. The credits are preserved through conversion. The MIT License text above applies to each, under its own copyright holder.

- Supabase Agent Skills (https://github.com/supabase/agent-skills). MIT, Copyright (c) 2026 Supabase.
- PRPs-agentic-eng (https://github.com/Wirasm/prp). MIT, Copyright (c) 2025-2026 Rasmus Widing.
- Plankton (https://github.com/alexfazio/plankton). MIT, Copyright (c) 2025 Alessandro Fazio.
- context-keeper (https://github.com/sreedhargs89/context-keeper). MIT, Copyright (c) 2026 Sreedhar GS.

## Specifications

- Agent Skills (https://github.com/agentskills/agentskills). Specification text under CC BY 4.0; schemas and reference code under Apache-2.0.
- Agent Plugins (https://github.com/agentplugins/agent-plugins-spec). Specification text and docs under CC BY 4.0; schemas and code under Apache-2.0. This project references the schema by URL and does not vendor it.
- vercel-labs/skills, the `skills` CLI (https://github.com/vercel-labs/skills). MIT, Copyright (c) 2026 Vercel, Inc. It sends anonymous telemetry by default; disable it with `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`. This project's code never calls it.

## Trademarks

Kiro is a trademark of Amazon.com, Inc. or its affiliates. Claude is a trademark of Anthropic, PBC. All other names belong to their owners.
