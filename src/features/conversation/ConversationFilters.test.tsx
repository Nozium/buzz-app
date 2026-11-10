// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { ActivityFilters, useActivityView } from "./ConversationList";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Filters({ scope }: { scope: string }) {
  const [view, setView] = useActivityView(scope);
  return <ActivityFilters view={view} onChange={setView} />;
}

test("switching community or account restores its own conversation filters without overwriting them", async () => {
  const user = userEvent.setup();
  const host = render(<Filters scope="viewer-a:community-a" />);
  await user.click(screen.getByRole("tab", { name: "Working" }));
  host.rerender(<Filters scope="viewer-a:community-b" />);
  expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.click(screen.getByRole("tab", { name: "Waiting" }));
  host.rerender(<Filters scope="viewer-b:community-a" />);
  expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  host.rerender(<Filters scope="viewer-a:community-a" />);
  expect(screen.getByRole("tab", { name: "Working" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  host.rerender(<Filters scope="viewer-a:community-b" />);
  expect(screen.getByRole("tab", { name: "Waiting" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  host.unmount();
  render(<Filters scope="viewer-a:community-a" />);
  expect(screen.getByRole("tab", { name: "Working" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
