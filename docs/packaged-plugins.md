# Packaged plugin

Desktop distributors can set `BUZZ_BUILD_PACKAGED_PLUGIN` to the path of one
single-file plugin artifact produced by `buzzodz plugin pack`. Cargo embeds the
artifact in the native plugin manager. The input is absent by default; ordinary
builds include no additional plugin or distributor configuration.

The distributor approves the plugin and its host access as part of the application
release. This input is compile-time only. Managed plugin policies remain advisory.

On the first normal catalog read for each profile, Buzz installs and enables the
artifact using external plugin storage. It records a receipt beside the registry before
returning the catalog. Existing installations retain their code, source and enabled
state. Later app releases leave those installations untouched; plugin updates use
the existing review flow.

Disabling or removing the plugin persists across restart and app upgrades. Removal
keeps the receipt, so automatic provisioning does not reinstall it. Manual reinstall
remains available. Safe mode defers provisioning and pauses external plugins as
usual. Receipts live in the profile's `packaged-plugins/` folder, so older versions
can still read the registry. Receipts distinguish provisioning from explicit removal.
Settings recovery restores packages the user kept and preserves explicit removals.
Erasing the profile removes both.

If provisioning fails, Buzz reports the error to stderr and retains its ordinary
plugin catalog. No receipt is written for a failed installation; later reads retry.

Older versions did not record plugin removals. A plugin removed before this
capability was introduced cannot be distinguished from one never installed.
The first distributor build provisions it once; subsequent removal is preserved.
