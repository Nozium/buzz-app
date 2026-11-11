# Review Configuration

An optional bundled plugin with a separate sidebar page for repository review
settings. Enable **Review Configuration** in Settings → Plugins → Manage plugins.
Choose a channel, register a GitHub repository, add named lanes, reviewer agents, and instructions,
and save. The repository table supports editing and an explicit reload.

This is configuration only. It does not submit PRs, dispatch reviewers, create
review threads, or send reminders. No agent or timer runs in the background.

## Getting started

Enable this plugin in **Settings → Plugins → Manage plugins**, then open its
sidebar entry. Choose a channel and register a repository. For each lane, select
reviewer agents and enter instructions, then save. Use the table to edit settings.
These selections do not start reviews or grant agents access to the channel.

---

## Storage and access

`configuration.ts` owns the save/load boundary. Each channel/repository pair has
one deterministic NIP-AR artifact of type `buzz.review.config` (kind 45010).
The signed event's `h` tag is its review channel. Its content is:

```json
{
  "version": 1,
  "repository": "example-org/project",
  "lanes": [
    {
      "id": "general",
      "name": "General",
      "instructions": "Check authorization, error handling, and tests.",
      "reviewers": []
    }
  ],
  "reminderMinutes": 15
}
```

The existing relay artifact writer persists the current head in `artifact_heads`,
the accepted revisions in `artifact_revisions`, and the signed payload in `events`.
There is no new SQL migration or local-only settings store. Ordinary channel
authorization applies: readers can see instructions, and members who can post
can edit them. Configuration is scoped to a channel, not globally unique across
the community. No GitHub credentials are stored or requested, and repository
existence/access is not checked in this first slice.

Edits carry the revision that the form loaded in `prev`; the relay rejects a
stale edit atomically. A failed or uncertain save keeps the draft. Copy any
changes before Cancel → Reload, then inspect the saved version before retrying.
An unsupported or malformed row shows a warning without hiding valid rows.
Channel metadata reconfirmation disables Save while retaining an open draft.

Opening a channel or clicking Reload makes one bounded snapshot query. There
are no reconnect subscriptions or polling timers. The first version supports
100 configurations per channel, 12 lanes per repository, and a 32 KB payload.
Larger result sets are explicitly marked incomplete; use a separate channel.
The reminder interval is saved for the planned executor but has no effect yet.

## Try it

1. Enable the plugin and open **Review Configuration** in the Messages sidebar.
2. Choose a writable stream or forum channel and click **Register repository**.
3. Enter a repository, select lane reviewers, add instructions, then **Save settings**.
4. Reload the page, choose the same channel, and verify the repository row.
5. Edit the instructions, save, and use **Reload** to confirm the new version.
6. In two clients, edit the same version; the second save must fail without
   discarding its draft after the first client saves.

Use a test channel. Saving does not activate any review automation.

Reviewer choices come from the session’s shared agent inventory. Saved public keys
remain visible and removable if an agent disappears or is archived. Unassigned
lanes may be saved as drafts. Dispatch must check agent ownership and channel
access when execution is implemented.
