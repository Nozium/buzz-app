// @vitest-environment jsdom
import { memo } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { RailArrangement, RailGroup, RailSourceRow } from "./RailArrangement";
import type { RailEntry } from "./rail-pins";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Live component refreshes can retain an element's previous component identity.
// A real React wrapper exercises that boundary without mocking React's lifecycle.
test("row previews use entry metadata even when component identity is wrapped", () => {
  const SourceRow = memo(RailSourceRow);
  const entries: RailEntry[] = Array.from({ length: 6 }, (_, index) => ({
    id: `chat-${index}`,
    label: `Chat ${index + 1}`,
    kind: "chat",
    target: {
      version: 1,
      kind: "conversation",
      channelId: `chat-${index}`,
      scope: { viewer: "a".repeat(64), communityOrigin: "https://example.org" },
    },
  }));
  render(
    <RailArrangement
      partition="preview-test"
      isPinned={() => false}
      onTogglePin={() => {}}
      openSection={() => {}}
      renderEntry={(entry) => <NavigationItem label={entry.label} />}
      sections={[
        {
          id: "solo",
          title: "Solo",
          content: (
            <RailGroup id="solo" title="Solo">
              {entries.map((entry) => (
                <SourceRow key={entry.id} section="solo" entry={entry}>
                  <NavigationItem label={entry.label} />
                </SourceRow>
              ))}
            </RailGroup>
          ),
        },
      ]}
    />,
  );
  expect(screen.getByRole("button", { name: "Chat 4" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Chat 5" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Chat 6" })).toBeNull();
  expect(screen.getByRole("button", { name: "View more Solo" })).not.toBeNull();
});
