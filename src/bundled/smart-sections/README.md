# Smart Sections

User-owned, device-local live collections rendered through the existing version-1
sidebar section registry. Natural language is interpreted by tool-free inference into
a checked definition; the runtime never executes generated code or arbitrary tools.

`smart_sections` supports `sources`, `preview`, `list`, `save`, `remove`, and `refresh`.
Updates and removal require the definition's latest `revision` as `expected_state`.
The tool derives account/community authority from the calling agent's host session,
not caller-supplied identity fields. Definitions and display/decision caches use the
existing scoped view store. Its revision comparison detects stale foreground edits;
it is not a cross-window transaction. V1 does not promise cross-device sync.

Source adapters implement `Source` in `src/features/smart-sections/model.ts`. Register
through the optional `smartSections` service; return its unregister function from a
plugin effect. A source supplies a description/config schema for agent discovery,
validates and canonicalizes config in `parse`, and returns a snapshot/subscribe feed.
The feed owns refresh/disposal and retains previous items with `status: "error"` on
read failure. Report incomplete coverage with `partial`; do not label it complete.
Every entity has a stable ID, display metadata, minimal inference text, and an existing
navigation target or HTTPS URL. Agent collections show their observation and source;
other sources can use a registered detail panel. Source data is
untrusted evidence for decisions, never instructions. The host supplies navigation,
framing, shared rows and contribution isolation; adapters do not generate UI.

Equivalent source/session/config leases share a feed, including previews in that
same session. Disabling a source or changing account/community retires its active
sections' leases. A preview is temporary and cannot save a definition. Active Agents
reuses `session.agentChoices` and the session's shared activity observer; it adds no
collection-specific relay query, poll, replay or connection owner. Its inventory/archive
reads use those existing owners' `ensure` paths. It never infers idle from missing data.
GitHub uses the existing declared/authenticated CLI capability, one bounded repository
read per feed, a jittered startup/5-minute backstop, and capped backoff on errors.

Semantic membership uses `ctx.decisions`, not Attention's fail-open wake classifier.
Decisions are cached by SHA-256 of provider, criteria and candidate text; the returned
model is recorded. Up to 16 candidates share a request. Unknown candidates stay out;
changed confirmed members may stay stale. Failed inputs retry on explicit refresh,
provider changes or changed content. Late answers cannot replace newer content or a
retired session. Display metadata is cached without PR bodies/inference text.
Updates run only while this device's plugin is active. Direct sources do not wake an
agent. Flexible agent-maintained collections use the existing plugin wake API; they
do not create Attention timers.

## Natural-language creation and flexible sources

`DescribeSection` is the primary creation flow: describe, generate, preview, add.
`generate.ts` reuses `agentProtection.modelChoices/complete`, the existing bounded
tool-free inference contract. Runtime credentials remain with their owner. Claude
and Pi support this transport without an assigned agent; Codex and Goose require a
protection worker and are omitted here. Prefer an offered lightweight model by its
catalog name, without claiming a specific price or fabricating a model ID. A larger
model requires an explicit selection. Jev/TypeSafe continues to own optional matching
through Decisions; its current API cannot generate free-form section definitions.

The model receives the request, existing definition settings for refinement, and the
current direct-source catalog. It returns a schema-constrained definition or an
in-place clarification. Definitions and source configs are independently parsed, then
previewed against actual data before the user saves. No generated tools, code, URLs,
or row values execute. Cancellation, session replacement, disabled sources, and stale
definition revisions reject old work. Generation does not open a DM, wake Bestie,
or add another refresh loop. Sources retain their own update schedules. Missing data
adapters (including market quotes) are explained rather than invented. New source
plugins extend the same catalog; agent-collection creation remains tool-only.

`smart_sections_deliver` lets an agent research any accessible topic and deliver up to
100 typed, sourced rows plus a repeatable refresh plan. Values are compact (32 chars);
details retain the fuller observation. HTTPS reader-facing sources and actual ISO
observation times are required. It creates a normal section with the agent-collection
source, or revises one using its current definition revision. Collection snapshots and
refresh plans are device-local, account/community-scoped data; unlike the separate
metadata cache, this source retains its own agent-authored observation text.
Refinements stage replacement facts before publishing their definition reference.
A failed definition save preserves the prior facts and pending refresh; unreferenced
snapshots are discarded when storage permits.

Each pooled collection feed schedules one jittered refresh (15 minutes by default,
configurable from 5 to 1440). Its assigned agent receives a plugin wake in the original
conversation, then calls `smart_sections_publish`. That response must match the assigned
agent, definition revision and unexpired refresh token. The two-minute pending window
prevents overlapping wakes; timeouts and failures retain old values as stale and back
off, capped at an hour or the requested interval if longer. Success resets backoff.
Pause/removal, plugin disable or foreground community change disposes the feed timer;
late responses for a changed, paused, removed or expired section are refused. It adds
no collection-specific relay poll or catch-up query. Startup jitter and sharing bound
wakes; source retrieval happens through the agent's existing tools and permissions.
