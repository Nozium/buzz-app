# Packaged plugins

Set `BUZZ_BUILD_PACKAGED_PLUGINS` to a JSON file listing artifacts produced by
`buzzodz plugin pack`. Paths are relative to the list file; absolute paths also work.

```json
["notes.json", "tasks.json"]
```

Cargo embeds each artifact; duplicate plugin ids fail the build. The default is an
empty list. The distributor approves each plugin's host access. Managed policies
remain recommendations.

Each profile installs and enables each package once, preserving existing installs.
Disable, remove and reviewed updates use the normal plugin lifecycle. Per-plugin
receipts preserve removals across restart and upgrades; recovery restores kept
packages. Safe mode defers installation. Failures log and retry independently.
Older versions did not record removals, so pre-feature uninstalls cannot be detected.
