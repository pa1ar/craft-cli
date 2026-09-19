# Unslop Craft compatibility pilot

Date: 2026-09-19
Outcome: passed live API retrieval, standard file validation, and explicit native Codex invocation.

## Live skill

- Collection: SKILLS db, `73823A24-EB68-46A8-BA3D-16731BE15B37`.
- Item: Unslop (Craft pilot), `5bfb2dba-16e6-8bc3-5a65-63b2c96b0142`.
- [Open in Craft](craftdocs://open?spaceId=8ac88104-eb82-9c72-9014-d28fdea88b25&blockId=5bfb2dba-16e6-8bc3-5a65-63b2c96b0142).
- Stable name: `unslop-craft-pilot`; kind: skill; status: published after validation.
- Source: canonical unslop SKILL.md plus both existing reference texts. Reference links converted to section anchors and texts included in the single-file pilot. Canonical files unchanged, verified against SHA-256 snapshots.
- Added name/kind/status fields to the existing collection. All prior schema properties and all 112 prior rows' titles, properties, and previews compared unchanged after the write.

## Verification

1. Created the row as draft and uploaded its instructions through craft-cli.
2. Exported from the actual selected-document Connect with `lib export --include-drafts` into an isolated project's `.agents/skills/unslop-craft-pilot/SKILL.md`.
3. Official `skills-ref validate` passed. Validator source: agentskills/agentskills, revision `69ef37e9424c0a7ea9dd2293b559e43ec8176379`. Validator checks format/naming; behavioral testing is separate.
4. Fresh Codex CLI runtime: model gpt-5.6-luna, medium, read-only, isolated project, user config ignored. Session `01a0bac1-d97b-7e51-81c6-2f011aa4646c`. Runtime transcript confirms an injected `<skill>` containing the exported instructions, including both reference sections, from `/private/tmp/craft-unslop-pilot/project/.agents/skills/unslop-craft-pilot/SKILL.md`. The test prompt named the skill but did not paste its instructions or file path.
5. Native run completed successfully. Seven behavior checks passed: beta scope, Safari unavailability, sample size, qualified timing, exact quote, approved caption, and removal of promotional filler.
6. Published only the tested pilot's status. Normal `lib list` returns it without migration/draft flags. Normal `lib get` matches the installed export byte-for-byte.

Export SHA-256: `c4b7ea62c945ca15972dafb6ed605e656daa4bef5b9e3b52b5da237280cfdc2a`.

Source/export comparison preserved all text after normalizing whitespace and Markdown numbered-list prefixes. Craft serializes list markers as `1.` and adds spacing; this is not a byte-identical import of the original local files. Internal section links resolve within the exported file; no unresolved relative references or out-of-scope links were found.

## Test output

Input was a fictional release-note test fixture containing promotional language, beta-only availability, planned Safari support, a 12-document internal timing sample, an exact tester quote, and an approved caption. It is not a verified product announcement.

> Sumr now lets invited beta testers summarize selected text with Shortcuts on macOS. Safari support is planned but isn't available in this beta. You can pass the summary to the next Shortcut action. In a small internal test of 12 documents, this saved about 20 seconds per document. Results may vary.
> 
> A tester said, "This is a stunning breakthrough."
> 
> Approved caption: summarize it all

## Limits and artifacts

This verifies explicit native invocation in Codex and the live API-to-file path. It does not establish automatic skill selection, other agents' native installation, GitHub synchronization, or multi-file export. Reference text was included inline for this minimal pilot; the canonical skill retains progressive disclosure across separate files.

Test artifacts: `/tmp/craft-unslop-pilot/` (source snapshots, exported file, prompt, output, JSON events, and behavior assertions). Validator environment: `/tmp/craft-skills-validator.NIbYaO/skills-ref`.

No CLI source changes were needed in this pilot, so the previous build/unit results were reused. No global skill installation, configuration change, commit, push, or release was performed.
