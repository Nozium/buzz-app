// @vitest-environment jsdom
import { Context } from "@deepseek-ai/cordis";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AddedTool } from "../../buzz-mcp/session-tools";
import type { BuzzClient } from "../../buzz-mcp/client";
import type { RelayData } from "../../features/relay/service";
import { SidebarSectionsService } from "../../features/channel-navigation/sidebar-sections-service";
import { ContributedRailSections } from "../../features/channel-navigation/ContributedRailSections";
import { createMemoryHistory } from "../../features/navigation/history";
import { createNavigationController } from "../../features/navigation/controller";
import { definitions } from "../../features/smart-sections/model";
import * as plugin from "./index";
import { SmartSectionsPage } from "./page";
import { sectionGenerator } from "./generate";
import type { PageNavigation } from "../../features/navigation/service";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("an agent previews/saves a section into the real registry, opens its row, revises it and removes it", async () => {
  const viewer = "a".repeat(64),
    origin = "https://relay.example.org",
    partition = `${origin}:${viewer}`;
  const root = new Context(),
    tools: AddedTool[] = [];
  const connection: ReturnType<RelayData["snapshot"]> = {
    status: "ready",
    generation: 1,
    viewer,
    origin,
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
  root.provide("pluginStatus", {
    isActive: () => true,
    subscribe: () => () => {},
  });
  root.provide("relay", relay);
  root.provide("decisions", {
    decide: vi.fn(),
    backend: () => undefined,
    status: () => "unavailable",
    subscribe: () => () => {},
    registerProvider: () => () => {},
  });
  root.provide("agents", {
    addTool: (tool: AddedTool) => tools.push(tool),
    relay: () => relay,
  } as never);
  root.provide("pages", { register() {} } as never);
  const noPanels: readonly never[] = [];
  const panels = {
    snapshot: () => noPanels,
    subscribe: () => () => {},
    resolve: () => undefined,
  };
  root.provide("panels", panels as never);
  const controller = createNavigationController(createMemoryHistory());
  root.provide("navigation", controller.navigation);
  const registry = new SidebarSectionsService(root);
  const fiber = root
    .extend({ pluginOwner: { id: "buzz.smart-sections", revision: "one" } })
    .plugin(plugin);
  try {
    await fiber.await();
    const service = root.reflect.get("smartSections");
    expect(service).toBeDefined();
    const rows = [
      {
        id: "pr-1",
        label: "Improve onboarding",
        subtitle: "#1",
        status: "Open",
        updatedAt: 1,
        text: "Onboarding",
        url: "https://github.com/example-org/example-repo/pull/1",
      },
    ];
    if (!service) throw new Error("Smart Sections plugin did not start");
    service.register({
      id: "example/pulls",
      title: "PRs",
      description: "PRs",
      configSchema: {},
      fields: [],
      parse: () => ({}),
      open: () => ({
        snapshot: () => ({ status: "ready", items: rows }),
        subscribe: () => () => {},
        async refresh() {},
        dispose() {},
      }),
    });
    const tool = tools.find((tool) => tool.name === "smart_sections");
    if (!tool) throw new Error("Smart Sections tool was not registered");
    const client = { key: "agent-key" } as BuzzClient;
    const call = (args: Record<string, unknown>) => tool.call(client, {}, args);
    const input = {
      title: "Onboarding PRs",
      request: "Track onboarding PRs",
      source: "example/pulls",
      config: {},
      criteria: "",
      paused: false,
      limit: 5,
    };
    expect(
      JSON.parse(
        (await call({ action: "preview", definition: input })) as string,
      ).items,
    ).toHaveLength(1);
    let saved: { id: string; revision: string } = { id: "", revision: "" };
    await act(async () => {
      saved = JSON.parse(
        (await call({ action: "save", definition: input })) as string,
      );
    });
    render(
      <ContributedRailSections
        registry={registry}
        navigator={controller.navigation}
        partition={partition}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Onboarding PRs" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Improve onboarding/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Improve onboarding/ }));
    expect(controller.navigation.snapshot().entry.target).toMatchObject({
      kind: "page",
      pluginId: "buzz.smart-sections",
      route: { params: { section: saved.id, item: "pr-1" } },
    });
    await act(async () => {
      saved = JSON.parse(
        (await call({
          action: "save",
          id: saved.id,
          expected_state: saved.revision,
          definition: { ...input, title: "Review queue" },
        })) as string,
      );
    });
    expect(
      screen.queryByRole("heading", { name: "Onboarding PRs" }),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "Review queue" })).toBeTruthy();
    await expect(
      call({ action: "remove", id: saved.id, expected_state: "stale" }),
    ).rejects.toThrow("Section changed");
    await act(async () => {
      await call({
        action: "remove",
        id: saved.id,
        expected_state: saved.revision,
      });
    });
    expect(registry.snapshot()).toEqual([]);
    expect(definitions(partition)).toEqual([]);
    const deliver = tools.find(
      (tool) => tool.name === "smart_sections_deliver",
    );
    if (!deliver) throw new Error("Missing flexible collection tool");
    await act(async () => {
      await deliver.call(
        client,
        { channel: "bestie-dm" },
        {
          title: "Stock watch",
          request: "Track AAPL prices",
          refresh_instructions: "Fetch a current sourced AAPL quote in USD",
          rows: [
            {
              id: "aapl",
              label: "AAPL",
              value: "$250.00 USD",
              observed_at: new Date().toISOString(),
              source_url: "https://finance.example.org/quote/AAPL",
              description: "Source reports delayed quotes.",
            },
          ],
        },
      );
    });
    const stock = screen.getByRole("button", { name: /AAPL/ });
    expect(stock.textContent).toContain("$250.00 USD");
    fireEvent.click(stock);
    const visit = controller.navigation.snapshot();
    render(
      <SmartSectionsPage
        service={service}
        relay={relay}
        navigator={controller.navigation}
        panels={panels as never}
        generator={sectionGenerator(relay, service, () => undefined)}
        navigation={
          {
            target: visit.entry.target,
            entryId: visit.entry.id,
            signal: visit.attempt.signal,
          } as PageNavigation
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "AAPL" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View source" }).getAttribute("href"),
    ).toBe("https://finance.example.org/quote/AAPL");
    expect(screen.getByText(/Source reports delayed quotes/)).toBeTruthy();
  } finally {
    cleanup();
    await fiber.dispose();
    await root.fiber.dispose();
    controller.dispose();
  }
});
