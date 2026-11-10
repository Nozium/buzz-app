# GitHub

Preview GitHub repositories, pull requests, issues, and commits without leaving Buzz.

## Getting started

1. Pull request and issue links in messages show their state as their icon,
   and a pasted one shows its repository, number and title, such as
   `buzz#42 · Fix the thing`, all kept current while shown. Click any
   github.com link to open it in a side panel. In **Settings → Plugins → GitHub →
   Links**, turn off **Open GitHub links in Buzz** to open links and the linked-PR
   shortcut in your browser instead. This choice is saved on this device; pull
   request indicators and agent tools stay enabled.
2. On a pull request, switch between **Discussion** and **Checks**.
3. Switch a pull request from **Summary** to **Changes** to read its diff.
4. Choose **Open on GitHub** to see the full page.

## Solo pull requests

When an agent announces this chat’s own PR with `send`, it can include
`pull_request: { url, branch }`. This signed declaration, not links in message
text, lets GitHub automatically link an owned Solo. The plugin verifies that the
signed-in GitHub account authored the PR and that its head branch matches.
References, quotes and code never link a PR. Conflicting declarations in one
connection require an explicit manual link.
Existing links and manual unlink records always take precedence, including after
reconnect. Use `github_link_pr` or the PR panel to explicitly replace a link.

The sidebar keeps the PR lifecycle icon and adds separate checks, review,
review-thread and readiness indicators. Conflicts get their own signal. Unknown,
failed, stale or public-only reads cannot indicate merge readiness. “Ready on
GitHub” requires an open, clean, approved PR with settled passing checks and no
pending review requests or unresolved/unread review threads. It is not permission
to bypass your workflow’s approvals or merge policy.
