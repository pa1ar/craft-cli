# Agent-ready local-first discovery

Craft issue: 1SS-626

## Outcome

Make the local-first read path visible in every agent entrypoint and describe the boundary accurately: simple document listing and search can use Craft Desktop's local cache, unsupported or authoritative reads fall back to the API, and writes always use the API.

## Scope

- Put the read-routing invariant near the top of the bundled and canonical skills.
- Update the canonical skill's stale source, command, rate-limit, and media references.
- Add explicit read routing to CLI help and `craft agent-context`.
- Update README positioning, setup copy, source guidance, and the mirrored 1ar.io installation block.
- Keep current API support claims precise and list newer Craft app features that do not have a REST surface.
- Publish a patch release after tests, typecheck, build, skill validation, and output checks pass.

## Ownership

The canonical craft-cli checkout contains unrelated collection-item work. Implement and release from an isolated worktree, and do not include those changes.
