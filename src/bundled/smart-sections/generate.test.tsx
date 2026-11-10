// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { Context } from "@deepseek-ai/cordis";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentProtectionService } from "../../features/agent-protection/service";
import type { ReviewModelProvider } from "../../features/agent-protection/models";
import type { Decisions } from "../../features/decisions/service";
import type { RelayData, RelaySnapshot } from "../../features/relay/service";
import { definitions, type Source } from "../../features/smart-sections/model";
import { createSmartSections } from "../../features/smart-sections/runtime";
import { composerDOMFixture } from "../../features/messages/composer-testing";
import { DescribeSection } from "./DescribeSection";
import { sectionGenerator } from "./generate";

composerDOMFixture();
const disposals: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  cleanup();
  for (const dispose of disposals.splice(0)) dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const partition = `https://relay.example.org:${"a".repeat(64)}`;
const model = { runtime: "example.direct", id: "small" };
const generated = {
  question: "",
  section: {
    title: "Onboarding PRs",
    source: "example/pulls",
    config: { repository: "example-org/example-repo" },
    criteria: "About onboarding",
    limit: 5,
  },
};
function fixture() {
  let connection: RelaySnapshot = {
    status: "ready",
    generation: 1,
    viewer: "a".repeat(64),
    origin: "https://relay.example.org",
    scope: partition,
    session: {} as never,
  };
  const relay: RelayData = {
    snapshot: () => connection,
    subscribe: () => () => {},
    retry() {},
    disconnect() {},
    async clearCache() {},
  };
  const decide = vi.fn<Decisions["decide"]>(async (request) => ({
    outcome: "answered",
    backend: "example/decisions",
    model: "jev",
    answers: Object.fromEntries(
      Object.keys(request.questions).map((id) => [
        id,
        { type: "yes_no", probability: 1 },
      ]),
    ),
  }));
  const sections = createSmartSections(relay, {
    decide,
    backend: () => "example/decisions",
    status: () => "ready",
    subscribe: () => () => {},
    registerProvider: () => () => {},
  });
  disposals.push(sections.dispose);
  const open = vi.fn<Source["open"]>(() => ({
    snapshot: () => ({
      status: "ready",
      items: [
        {
          id: "pr-1",
          label: "Improve onboarding",
          status: "Open",
          subtitle: "#1",
          text: "Onboarding improvements",
          updatedAt: 1,
          url: "https://example.org/pull/1",
        },
      ],
    }),
    subscribe: () => () => {},
    async refresh() {},
    dispose() {},
  }));
  const unregister = sections.register({
    id: "example/pulls",
    title: "Open pull requests",
    description: "Open PRs for one repository",
    configSchema: {
      type: "object",
      properties: { repository: { type: "string" } },
      required: ["repository"],
      additionalProperties: false,
    },
    fields: [],
    parse(config) {
      if (config.repository !== "example-org/example-repo")
        throw new Error("Unknown repository");
      return { repository: config.repository };
    },
    open,
  });
  const complete = vi.fn<ReviewModelProvider["complete"]>(async () => ({
    text: JSON.stringify(generated),
    model,
  }));
  const root = new Context();
  new AgentProtectionService(
    root,
    () => ({ owner: connection.viewer, agents: [] }),
    {
      read: async () => ({ revision: 0, defaults: null }),
      save: async () => {},
      update: async () => {},
    },
  );
  root
    .extend({ pluginOwner: { id: model.runtime, revision: "one" } })
    .agentProtection.registerModels({
      label: "Configured provider",
      models: async () => [{ id: model.id, label: "Small" }],
      complete,
    });
  const caller = root.extend({
    pluginOwner: { id: "buzz.smart-sections", revision: "one" },
  });
  disposals.push(() => root.fiber.dispose());
  const inference = {
    modelChoices: async () => [
      {
        runtime: "buzz.codex",
        label: "Isolated",
        models: [{ id: "nano", label: "Nano" }],
      },
      {
        runtime: "example.direct",
        label: "Configured provider",
        models: [
          { id: "large", label: "Large" },
          { id: "small", label: "Small" },
        ],
      },
    ],
    complete: (...args: Parameters<AgentProtectionService["complete"]>) =>
      caller.agentProtection.complete(...args),
  };
  const generator = sectionGenerator(relay, sections, () => inference);
  return {
    relay,
    sections,
    generator,
    inference,
    complete,
    decide,
    open,
    unregister,
    reconnect() {
      connection = { ...connection, session: {} as never, generation: 2 };
    },
  };
}
it("generates and previews real rows with selected Decisions matching, then saves without any Bestie or conversation", async () => {
  const h = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.complete.mockImplementationOnce(async () => {
    await gate;
    return { text: JSON.stringify(generated), model };
  });
  const save = vi.fn((input) => {
    h.sections.save(partition, input);
  });
  render(
    <DescribeSection
      relay={h.relay}
      generator={h.generator}
      close={() => {}}
      manual={() => {}}
      save={save}
    />,
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "What would you like to see?" }),
    {
      target: {
        value: "Track open PRs about onboarding in example-org/example-repo",
      },
    },
  );
  const generate = screen.getByRole("button", { name: "Generate section" });
  await waitFor(() => expect(generate.hasAttribute("disabled")).toBe(false));
  fireEvent.click(generate);
  try {
    await waitFor(() => expect(h.complete).toHaveBeenCalledOnce());
    expect(generate.hasAttribute("disabled")).toBe(true);
    expect(definitions(partition)).toEqual([]);
    expect(h.complete.mock.calls[0]?.[0]).toMatchObject({ id: model.id });
  } finally {
    await act(async () => release());
  }
  await screen.findByText("Improve onboarding · Open");
  expect(h.decide).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add section" }));
  expect(definitions(partition)[0]).toMatchObject({
    title: "Onboarding PRs",
    config: { repository: "example-org/example-repo" },
    criteria: "About onboarding",
  });
});
it("asks for missing details in place and lets the description be corrected", async () => {
  const h = fixture();
  h.complete.mockResolvedValueOnce({
    text: JSON.stringify({
      question: "Which repository should I track?",
      section: null,
    }),
    model,
  });
  render(
    <DescribeSection
      relay={h.relay}
      generator={h.generator}
      close={() => {}}
      manual={() => {}}
      save={() => {}}
    />,
  );
  const textbox = screen.getByRole("textbox", {
    name: "What would you like to see?",
  });
  fireEvent.change(textbox, { target: { value: "Show open PRs" } });
  const button = screen.getByRole("button", { name: "Generate section" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  await screen.findByText(/Which repository should I track/);
  expect(h.open).not.toHaveBeenCalled();
  fireEvent.change(textbox, {
    target: { value: "Show open PRs in example-org/example-repo" },
  });
  fireEvent.click(button);
  await screen.findByRole("button", { name: "Add section" });
  expect(definitions(partition)).toEqual([]);
});
it.each([
  ["malformed JSON", "not json"],
  [
    "invented source",
    JSON.stringify({
      ...generated,
      section: { ...generated.section, source: "invented/quotes" },
    }),
  ],
  [
    "invalid config",
    JSON.stringify({
      ...generated,
      section: { ...generated.section, config: { repository: "invented" } },
    }),
  ],
])("rejects %s before reading data or saving", async (_name, text) => {
  const h = fixture();
  h.complete.mockResolvedValueOnce({ text, model });
  await expect(
    h.generator.generate("Track open PRs", model, new AbortController().signal),
  ).rejects.toThrow();
  expect(h.open).not.toHaveBeenCalled();
  expect(definitions(partition)).toEqual([]);
});
it.each(["reconnect", "cancel", "source removed"])(
  "ignores an answer invalidated by %s",
  async (reason) => {
    const h = fixture(),
      controller = new AbortController();
    let release!: () => void;
    h.complete.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { text: JSON.stringify(generated), model };
    });
    const pending = h.generator.generate(
      "Track open PRs",
      model,
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow();
    await waitFor(() => expect(h.complete).toHaveBeenCalledOnce());
    if (reason === "reconnect") h.reconnect();
    else if (reason === "cancel") controller.abort();
    else h.unregister();
    release();
    await rejected;
    expect(h.open).not.toHaveBeenCalled();
    expect(definitions(partition)).toEqual([]);
  },
);
it("preserves pause state when generating a refinement and blocks saving into a replacement session", async () => {
  const h = fixture();
  const existing = h.sections.save(partition, {
    ...generated.section,
    request: "Track PRs",
    paused: true,
  });
  const result = await h.generator.generate(
    "Call it Onboarding PRs",
    model,
    new AbortController().signal,
    existing,
  );
  expect(result.input?.paused).toBe(true);
  const save = vi.fn();
  render(
    <DescribeSection
      relay={h.relay}
      generator={h.generator}
      close={() => {}}
      manual={() => {}}
      save={save}
    />,
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "What would you like to see?" }),
    { target: { value: "Track PRs" } },
  );
  const button = screen.getByRole("button", { name: "Generate section" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  await screen.findByRole("button", { name: "Add section" });
  h.reconnect();
  fireEvent.click(screen.getByRole("button", { name: "Add section" }));
  await screen.findByRole("alert");
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Generate section" })).toBeTruthy();
});
it("keeps manual configuration available when inference is missing", async () => {
  const h = fixture(),
    manual = vi.fn();
  render(
    <DescribeSection
      relay={h.relay}
      generator={sectionGenerator(h.relay, h.sections, () => undefined)}
      close={() => {}}
      manual={manual}
      save={() => {}}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "AI generation is unavailable",
  );
  fireEvent.click(screen.getByRole("button", { name: "Configure manually" }));
  expect(manual).toHaveBeenCalledOnce();
  expect(h.complete).not.toHaveBeenCalled();
});
it("does not silently choose a premium model when no lightweight model is offered", async () => {
  const h = fixture();
  h.inference.modelChoices = async () => [
    {
      runtime: "example.direct",
      label: "Configured provider",
      models: [{ id: "gemini-pro", label: "Gemini Pro" }],
    },
  ];
  render(
    <DescribeSection
      relay={h.relay}
      generator={h.generator}
      close={() => {}}
      manual={() => {}}
      save={() => {}}
    />,
  );
  await screen.findByRole("combobox", { name: "Generation model" });
  fireEvent.change(
    screen.getByRole("textbox", { name: "What would you like to see?" }),
    { target: { value: "Track PRs" } },
  );
  expect(
    screen
      .getByRole("button", { name: "Generate section" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(h.complete).not.toHaveBeenCalled();
});
it("aborts pending inference when the creation dialog closes", async () => {
  const h = fixture();
  let release!: () => void;
  h.complete.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { text: JSON.stringify(generated), model };
  });
  const view = render(
    <DescribeSection
      relay={h.relay}
      generator={h.generator}
      close={() => {}}
      manual={() => {}}
      save={() => {}}
    />,
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "What would you like to see?" }),
    { target: { value: "Track PRs" } },
  );
  const button = screen.getByRole("button", { name: "Generate section" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(h.complete).toHaveBeenCalledOnce());
  const signal = h.complete.mock.calls[0]?.[2];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => release());
  expect(h.open).not.toHaveBeenCalled();
  expect(definitions(partition)).toEqual([]);
});
