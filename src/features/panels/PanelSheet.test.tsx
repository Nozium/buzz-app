// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { PanelDock } from "./PanelDock";
import { PanelWorkspace } from "./PanelWorkspace";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";

afterEach(cleanup);

function Inspector() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [attempts, setAttempts] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open inspector
      </button>
      <PanelDock open={open} keepMounted className="">
        <PanelWorkspace
          value="notes"
          select={() => {}}
          items={[
            {
              id: "notes",
              label: "Notes",
              content: <textarea aria-label="Note draft" />,
              close() {
                setAttempts((n) => n + 1);
                setConfirm(true);
                return false;
              },
            },
          ]}
        />
      </PanelDock>
      {confirm && (
        <AlertDialog
          title="Keep this draft?"
          description={`Close attempts: ${attempts}`}
          onClose={() => setConfirm(false)}
          finalFocus={false}
          actions={
            <button
              type="button"
              onClick={() => {
                setConfirm(false);
                setOpen(false);
              }}
            >
              Keep draft and close
            </button>
          }
        />
      )}
    </>
  );
}

test("a detail card uses its owner's close guard and retains its editor across hiding and reopening", async () => {
  const user = userEvent.setup();
  render(<Inspector />);
  await user.click(screen.getByRole("button", { name: "Open inspector" }));
  const sheet = await screen.findByRole("dialog", { name: "Notes" });
  expect(sheet).toHaveAttribute("data-placement", "rail");
  const editor = screen.getByRole("textbox", { name: "Note draft" });
  await user.type(editor, "Keep this local draft");
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(sheet).toBeVisible();
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "Close attempts: 1",
  );
  expect(editor).toHaveValue("Keep this local draft");
  // The guard's confirmation belongs to this owner, not to the shared frame.
  await user.click(
    screen.getByRole("button", { name: "Keep draft and close" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Notes" }),
    ).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: "Open inspector" }));
  expect(await screen.findByRole("dialog", { name: "Notes" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Note draft" })).toHaveValue(
    "Keep this local draft",
  );
});

test("switching from a conversation to a tool keeps the editor mounted and lets the page receive input", async () => {
  function Workspace() {
    const [selected, select] = useState("reply");
    return (
      <>
        <input aria-label="Main draft" />
        <PanelDock open className="">
          <PanelWorkspace
            value={selected}
            select={select}
            items={[
              {
                id: "reply",
                label: "Reply",
                composer: true,
                content: <textarea aria-label="Reply draft" />,
                close() {},
              },
              {
                id: "profile",
                label: "Profile",
                content: <p>Person details</p>,
                close() {},
              },
            ]}
          />
        </PanelDock>
      </>
    );
  }
  const user = userEvent.setup();
  render(<Workspace />);
  const sheet = screen.getByRole("dialog", { name: "Reply" });
  expect(sheet).toHaveAttribute("data-placement", "bottom");
  const editor = within(sheet).getByRole("textbox", { name: "Reply draft" });
  await user.type(editor, "Unfinished reply");
  await user.click(within(sheet).getByRole("tab", { name: "Profile" }));
  const card = screen.getByRole("dialog", { name: "Profile" });
  expect(card).toBe(sheet);
  expect(card).toHaveAttribute("data-placement", "rail");
  expect(card).toHaveAttribute("aria-modal", "false");
  await user.type(
    screen.getByRole("textbox", { name: "Main draft" }),
    "Main message",
  );
  expect(card).toBeVisible();
  await user.click(within(card).getByRole("tab", { name: "Reply" }));
  expect(screen.getByRole("textbox", { name: "Reply draft" })).toBe(editor);
  expect(editor).toHaveValue("Unfinished reply");
  expect(sheet).toHaveAttribute("data-placement", "bottom");
});
