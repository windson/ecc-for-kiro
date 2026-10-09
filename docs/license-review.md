# License and terms review for ecc-for-kiro

Engineering diligence, not legal advice. Reviewed 2026-10-07. Read-only run. The ECC checkout was not changed.
"Verified" means a URL or file path is cited. "Not verified" means I could not confirm it, or it needs a lawyer.

## Summary
- MIT for our own code: confirmed. Nothing in ECC's license or in Kiro and AWS terms blocks publishing the repo. Not legal advice.
- ECC v2.2.3 is MIT, Copyright (c) 2026 Affaan Mustafa. All 476 pinned files exist and match their sha256. No installed file states another license.
- Installed ECC files do credit outside MIT projects (Supabase, PRPs, Plankton, context-keeper). ECC does not ship their notices. We should keep the credits and add a notices file.
- Kiro is an AWS trademark. The name ecc-for-kiro matches the AWS "YourApp for Mark" fair use form. Risk is low to medium. Use the disclaimer in section 4.
- Powers are third-party by Kiro's own docs. Sharing from GitHub needs no AWS agreement. Registry submission does (Publisher Terms with an indemnity). The owner must accept those first.
- Fix before publishing: one test embeds a 39-word description copied from an ECC SKILL.md. Replace it with synthetic text.
- New decision O5 (Kiro-native command rewrites stored as overlays) would put ECC-derived text in our repo. Ship ECC's MIT notice beside it, or generate the rewrites at install time. See section 4.

## 1. ECC evidence
- Verified. License is MIT, "Copyright (c) 2026 Affaan Mustafa". File `~/.cache/ecc-kiro/ECC-v2.2.3-c05b2d6/LICENSE`. [LICENSE at tag](https://github.com/affaan-m/ECC/blob/v2.2.3/LICENSE).
- Verified. Its sha256 (326146379f01...21b2) equals the `license` entry in `.kiro/skills/ecc-kiro-setup/assets/profiles/kimi-parity-v2.2.3.json`. GitHub's API and ECC `package.json` also say MIT.
- Verified. Tag v2.2.3 is an annotated tag by Affaan Mustafa pointing at commit c05b2d6614f6. It carries an SSH signature block (signature itself not checked). README.md lines 104 and 2044-2046 say the repo is MIT and stays free.
- Verified. In the whole tag tree (4212 files, scanned by file name) the license files are `LICENSE`, `pi/core/LICENSE` and `skills/taste-application/scripts/LICENSE`. All three are the same MIT text and holder. The last two are not in our install set. No NOTICE, COPYING, THIRD-PARTY or ATTRIBUTION file exists.
- Verified. Profile check: 476 entries, 0 missing, 0 hash mismatches. Counts: 82 SKILL.md (30 in `.agents/skills`, 52 in `skills`), 68 agents, 94 commands, 122 rules.
- Verified. `license:` frontmatter is set in 31 of 82 skills (30 in `.agents/skills/*`, plus `skills/verification-loop`). All say MIT. No LICENSE or NOTICE file sits inside any installed skill folder.
- Verified. Header scan of all 476 files (408 md, 17 py, 15 sh, 9 mjs, 5 js, others): no SPDX line, no "Licensed under", no copyright line except the root LICENSE. No GPL, AGPL, LGPL, MPL, CC, SSPL or BUSL words. No minified or vendored library files.
- Verified. GitHub code search on ECC's default branch found 0 hits for SPDX-License-Identifier, "Apache License", "Licensed under" and "All rights reserved".
- Verified. Credits inside installed files, with the upstream license read from GitHub:
  - `agents/database-reviewer.md:100` adapts Supabase Agent Skills. [supabase/agent-skills](https://github.com/supabase/agent-skills) is MIT, (c) 2026 Supabase.
  - `commands/code-review.md:8` and `commands/prp-{commit,implement,plan,pr,prd}.md` adapt PRPs-agentic-eng by Wirasm. [Wirasm/prp](https://github.com/Wirasm/prp) is MIT, (c) 2025-2026 Rasmus Widing.
  - `skills/plankton-code-quality/SKILL.md:10,192-194` credits @alxfazio. [alexfazio/plankton](https://github.com/alexfazio/plankton) is MIT, (c) 2025 Alessandro Fazio. It is an integration guide.
  - `skills/ck/` (SKILL.md plus 9 scripts, lines 7-8 of SKILL.md) names author and repo [sreedhargs89/context-keeper](https://github.com/sreedhargs89/context-keeper). MIT, (c) 2026 Sreedhar GS. The files carry no upstream notice.
  - `skills/ecc-recipes/SKILL.md:5-6` (KyawZinLatt) and `skills/santa-method/SKILL.md:5` (Ronald Skelton) are community contributions.
  - Inspiration only: `.agents/skills/frontend-slides/SKILL.md:11` (MIT), `skills/plan-canvas/SKILL.md:16` (lavish-axi, MIT, "rebuilt"), `skills/dev-team/SKILL.md:6` (BMAD-METHOD, MIT), `agents/gan-*` (an Anthropic paper).
  - Named tools, not bundled: `skills/nasiko-control-plane/SKILL.md:22` (Nasiko, Apache-2.0) and `skills/codehealth-mcp` (CodeScene MCP server: Apache-2.0 parts plus closed parts under CodeScene terms).
- Verified. ECC has about 398 contributors (GitHub API). `CONTRIBUTING.md` has no CLA or DCO text. [GitHub ToS D.6](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#6-contributions-under-repository-license) licenses contributions under the repo license.
- Verified. `docs/skill-adaptation-policy.md` in ECC covers naming and branding of adapted work. It says nothing about license notices.
- Not verified. Whether the adapted parts are "substantial portions" under MIT. Whether every contributor owned what they contributed. Whether "ECC" is a claimed trademark (no policy found in the tag tree or README).

## 2. Kiro and AWS terms
- Verified. Kiro's footer links Site Terms, License, Responsible AI Policy, Legal and Privacy ([kiro.dev/powers/submit](https://kiro.dev/powers/submit/)). Kiro has no page of its own for trademark or brand. Ten likely URLs (`/brand`, `/legal`, `/trademark`, `/press`, `/terms` and others) returned 404.
- Verified. [Kiro License](https://kiro.dev/license/): the IDE and CLI are AWS Content under the AWS Customer Agreement and the AWS IP License.
- Verified. [AWS Customer Agreement](https://aws.amazon.com/agreement/) (updated 2026-08-14). 6.4 applies the Trademark Guidelines and bars implying support or endorsement. 11.2 incorporates the Guidelines. 11.9 bars press releases and other public communication about your use of AWS Content.
- Not verified. Whether 11.9 is meant to reach community READMEs. Kiro's [community page](https://kiro.dev/community/) invites project posts, so risk looks low. Keep our write-ups factual.
- Verified. [AWS IP License](https://aws.amazon.com/legal/aws-ip-license-terms/) (2025-10-27), sections 3 and 4: use AWS Content only with the Services. No modify, distribute or derivative works of it. We copy no Kiro software or docs.
- Verified. [AWS Service Terms](https://aws.amazon.com/service-terms/) sections that name Kiro:
  - 50.14: contracting party, abuse detection, 60-day input storage on Free Tier.
  - 50.3: AWS may use AI Content from Free Tier and individual plans, with an opt-out.
  - 50.10: paid Kiro is an indemnified gen AI service. 1.24 lists Kiro among gen AI features.
  - None of them covers third-party steering, agents, skills, hooks, commands or Powers.
- Verified. Kiro docs read (steering, hooks, skills, mcp, custom-agents, permissions, powers, privacy-and-security, installation, kiroignore) do not limit sharing such files. The skills page allows an optional `license` field ([skills.md](https://kiro.dev/docs/skills.md)).
- Verified. [Install powers](https://kiro.dev/docs/powers/installation.md) warns that Powers are third-party tools that may have separate terms, and Kiro is not responsible. [Create powers](https://kiro.dev/docs/powers/create/) says to push to a public GitHub repo and others import by URL. The docs mention no approval step.
- Verified. [Powers Publisher Terms](https://kiro.dev/powers/terms/) (2026-05-19) apply only if you submit to the directory. Key clauses:
  - You are solely responsible for the power and user support. You may set your own license.
  - You give AWS a sublicensable right to distribute and promote the power, with your name and logos.
  - AWS may decline or remove it at any time. You then support existing users for 90 days.
  - The IP indemnity is broad. AWS liability is capped at USD 500. Washington law applies.
  - You authorize AWS to collect usage metrics on your power.
- Verified. [Submit a power](https://kiro.dev/powers/submit/) is the registry process. Requirements:
  - A public GitHub repo with `plugin.json` (`$schema`, name, version, description, author.name, keywords, SPDX license).
  - A README with a privacy policy link and a support contact.
  - The power is tested and unique, with no beta MCP servers.
  - Submitting means accepting the Publisher Terms. AWS says it "will reach out" if the power fits.
  - The page addresses organizations. Individual names appear as publishers in the directory.
- Verified. [kirodotdev/powers](https://github.com/kirodotdev/powers) README: the registry lists more than the repo holds, and extra powers are hosted by their authors. The repo has no LICENSE file, so do not copy its text.
- Verified. The optional [showcase form](https://kiro.dev/showcase/submit/) asks for a marketing license to AWS and a non-infringement warranty.
- Verified. [AWS Trademark Guidelines](https://aws.amazon.com/trademark-guidelines/) list Kiro as an AWS Mark (section 17). Key sections:
  - 13: plain-text fair use as "[Your Brand] [for / with / works with] [Mark]", with no implied affiliation.
  - 7: do not build AWS Marks into product or organization names.
  - 5, 9, 10: no implied endorsement, no altered logos, no imitated site look.
  - 11: no marks in domain names. A mark in a URL path is allowed for related content, which fits `github.com/<owner>/ecc-for-kiro`.
  - 16: contact trademarks@amazon.com.
- Not verified. Whether section 7 binds a Kiro user who is not a licensee. It is written for licensees and agreement signers, but Customer Agreement 6.4 points to the Guidelines. Kiro's USPTO registration status is also not verified.
- Verified. [AWS Site Terms](https://aws.amazon.com/terms/) (2025-06-04) give a personal-use license. They bar copying and derivative use of site content and bar robots and data mining. The CC BY-SA grant covers only docs.aws.amazon.com. So we paraphrase and link only.
- Verified. A 10-word overlap scan of our `.kiro/**` files against every Kiro, AWS and spec page I read found no copied text.
- Not verified. Whether kiro.dev/docs has its own open license. I found none, and kirodotdev/Kiro has no LICENSE file.
- Not verified. Whether deep links are allowed. The Site Terms grant a link right to the AWS home page only. Deep links are common practice.

## 3. Specs and tools
- Verified. [agentskills/agentskills](https://github.com/agentskills/agentskills): root `LICENSE` and `skills-ref/LICENSE` are Apache-2.0. `docs/LICENSE` is CC BY 4.0 and covers `docs/specification.mdx`. The README states the same split. The spec's `license` field is a license name or a bundled file name.
- Verified. [agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec) `LICENSE.md`: spec text and docs are CC BY 4.0. Schemas and code are Apache-2.0. The site repo (Copyright 2026 Vercel, Inc.) uses the same split.
- Verified. The schema file itself has no license key. Spec 1.1.0 exists. Kiro docs and the submit page still use the 1.0.0 schema URL.
- Verified. Using the `$schema` URL needs no notice. Vendoring the schema would need the Apache-2.0 text. We do neither today (no `plugin.json` or schema under `.kiro/skills/ecc-kiro-setup`).
- Verified. [vercel-labs/skills](https://github.com/vercel-labs/skills) is MIT, Copyright (c) 2026 Vercel, Inc. It sends anonymous telemetry by default. Turn it off with `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`. For public repos it sends repo and skill identifiers. Our code never calls it.
- Verified. No naming rules found for "Agent Skills" or "Agent Plugins". `agent-plugins-spec/GOVERNANCE.md` section 10 says only that the name is held in trust. Use both names descriptively, without logos.
- Verified. Our scripts import only Node built-ins (`node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:test`). No dependency license applies today.

## 4. Recommendations
MIT: confirm. ECC is permissive. The repo will hold no ECC expression after the test fix, unless overlay option 2 below is chosen. There are no dependencies. MIT is an SPDX id, as the Kiro registry asks. Apache-2.0 (used by kirodotdev/KiroCrew) is an option if a patent grant matters. It is not needed.

Files in the repo:
1. `LICENSE`: already in the private repo github.com/windson/ecc-for-kiro (Verified via GitHub API: MIT, Copyright (c) 2026 and the owner's name, no other file yet). Keep it when the repo goes public.
2. `skills/ecc-kiro-setup/LICENSE`: same text, so copies made by `npx skills add` or IDE import carry it. Keep `license: MIT` in `SKILL.md`.
3. `plugin.json`: `"license": "MIT"`, `author.name`, `repository`, `homepage`. The 1.0.0 schema rejects unknown keys, so credits cannot go here.
4. `package.json`: `license`, `repository` and a `files` allowlist so scratch files never ship.
5. `THIRD_PARTY_NOTICES.md` (not `NOTICE`, which Apache uses in a special way): ECC name, holder, MIT, tag, commit and LICENSE sha256, marked "downloaded at install time, not included". Add the credited projects from section 1 with holders and one copy of the MIT text. Link Agent Skills, Agent Plugins and the skills CLI. Add trademark lines.
6. `README.md`: the disclaimer below, what is downloaded and from where, a Privacy section (we collect nothing, only `git clone` from github.com), a support contact, the skills CLI telemetry note, and a link to the notices. The registry needs the privacy link and the contact.

Files in the installed output:
1. `.kiro/ecc/LICENSE`: ECC's file, copied from the hash-checked checkout. Already planned.
2. `.kiro/ecc/THIRD_PARTY_NOTICES.md`: generated at install. ECC credit with tag and commit, the section 1 credits with holders, and a line that some ECC skills describe third-party commercial services. Track it as tool-owned so uninstall removes it.
3. Keep ECC credit lines and `license: MIT` frontmatter in converted files. Add a test, with synthetic input, that a credit line survives conversion.
4. Keep the MCP catalog as an `.example` file. It has 34 entries, mostly third-party packages or hosted services with their own terms.

Overlays (decision O5, `.kiro/docs/setup-walkthrough.md:326-327`):
- Verified. The plan stores Kiro-native rewrites of ECC commands as overlays pinned to the ECC file sha256 and calls them "owned text". No overlay file exists yet.
- Not verified. A rewrite of ECC text is likely a derivative work. It keeps ECC's MIT notice unless it is a clean-room rewrite. A lawyer should judge each file. The six PRP and code-review commands also carry Rasmus Widing's MIT notice (Verified, section 1).
- Option 1 (preferred): keep only transform rules in the repo (find anchors and short inserted Kiro text). Apply them to the downloaded file at install time. The repo stays free of ECC text.
- Option 2: store whole rewritten commands under `overlays/`. Add `overlays/NOTICE-ECC.md` with ECC's copyright and MIT text plus the upstream holders. Put the source path, sha256 and credit lines in each file header.
- Either option keeps MIT valid for our own code. Neither blocks publishing.

Disclaimer wording for README and notices:
> ecc-for-kiro is an independent community project. It is not affiliated with, endorsed by, or sponsored by Amazon Web Services, Amazon.com, Inc., the Kiro team, or the authors of ECC.
> Kiro is a trademark of Amazon.com, Inc. or its affiliates. Claude is a trademark of Anthropic, PBC. All other names belong to their owners.
> ECC is a separate open source project by Affaan Mustafa and contributors, under the MIT License. This repository does not contain ECC. The installer downloads a pinned ECC release from github.com and converts it on your machine.

With option 2, replace "This repository does not contain ECC." with "It includes adapted ECC command text under the MIT License. See THIRD_PARTY_NOTICES.md."
Use plain text only for the Kiro name. No Kiro or AWS logos. No hidden text or meta keywords with the Kiro name (Site Terms). Start the repo description with "Unofficial". Do not add CI that scrapes kiro.dev or AWS pages.

Do not commit:
- `.kimi-code/` (3.6 MB of ECC content), `.claude/`, anything from `~/.cache/ecc-kiro`, and installer output (`.kiro/ecc/`, ECC agents, skills, steering, hooks).
- ECC text in tests: `.kiro/skills/ecc-kiro-setup/scripts/test/frontmatter.test.mjs` lines 370-393 copy a 39-word description from `.agents/skills/benchmark-methodology/SKILL.md` (lines 375-379 and 390).
- Whole rewritten ECC commands, unless the option 2 notices ship with them.
- Kiro or AWS logos, screenshots, copied docs text, or text from kirodotdev/powers.
- Internal docs with local paths, such as `.kiro/docs/ecc-kiro-setup-plan.md:4` (`/Users/...`). Review `setup-walkthrough.md` as well.
- Secrets. A scan of `.kiro/**` found none.
- Fine to commit: the profile JSON (paths, names, sha256) and `scripts/test/snapshots/agent-tools-v2.2.3.json` (agent names and tool classes). They hold facts, not ECC text.

Blockers and gates:
- No hard blocker found.
- Gate 1: replace the test text and add the files above.
- Gate 2: the owner accepts the name risk. Optional: ask trademarks@amazon.com. Keep a rename ready.
- Gate 3: do not submit to the Kiro registry until the owner has read the Publisher Terms and accepts the indemnity.
- Watch: ECC version bumps. CI `verify --fetch` should fail if the LICENSE sha256 changes.

## Method and limits
- Scripts checked sha256 of all entries, frontmatter keys, license words, and word overlaps. Scratch files in /tmp were deleted.
- The workspace changed during the review (new steering and rule-pack files). I reran the scans at the end on 58 files. Only `frontmatter.test.mjs` has a 12-word match with ECC. Short one-line anchors in `lib/steering.mjs:130` and in two tests also match. They are functional and small.
- Not read: AWS AUP, Responsible AI Policy, Privacy Notice, Free Tier and Students terms.
- GitHub code search covers the default branch, not the tag. The file-name scan used the tag tree.
- One early `git status` in the checkout touched only the `.git` folder timestamp. The index and all files are unchanged.
- Content was rephrased for compliance with licensing restrictions.
