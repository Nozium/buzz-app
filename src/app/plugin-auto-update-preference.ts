import { useSyncExternalStore } from "react";

const preferenceKey = "buzz-plugin-auto-update.v1";
const changedEvent = "buzz-plugin-auto-update-changed";
let unsavedPreference: boolean | undefined;

/**
 * Device-local choice to install found plugin updates without a click when
 * they ask for no added access and keep their publisher. Off by default.
 */
export function pluginAutoUpdatePreference(): boolean {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return localStorage.getItem(preferenceKey) === "on";
  } catch {
    return false;
  }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== preferenceKey && event.key !== null) return;
    unsavedPreference = undefined;
    listener();
  };
  window.addEventListener(changedEvent, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(changedEvent, listener);
    window.removeEventListener("storage", storage);
  };
}
export function usePluginAutoUpdatePreference(): boolean {
  return useSyncExternalStore(subscribe, pluginAutoUpdatePreference);
}
export function setPluginAutoUpdatePreference(enabled: boolean): void {
  unsavedPreference = enabled;
  try {
    localStorage.setItem(preferenceKey, enabled ? "on" : "off");
    unsavedPreference = undefined;
  } catch {
    // Keep the active choice for this run when the device can't save it.
  }
  window.dispatchEvent(new Event(changedEvent));
}
