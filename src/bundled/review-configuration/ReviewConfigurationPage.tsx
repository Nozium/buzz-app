import { useEffect, useRef, useState, type ReactNode } from "react";
import { useChannelList, useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { ListChecksIcon } from "../../shared/design-system/icons";
import { Button } from "../../shared/design-system/ui/Button";
import { Field } from "../../shared/design-system/ui/Field";
import { FullPageSurface } from "../../shared/design-system/ui/FullPageSurface";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { Input } from "../../shared/design-system/ui/Input";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { Select } from "../../shared/design-system/ui/Select";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import {
  loadConfigurations,
  repositoryName,
  saveConfiguration,
  type ReviewConfig,
  type SavedReviewConfig,
} from "./configuration";
import "./review-configuration.css";

function Frame({ children }: { children: ReactNode }) {
  return (
    <FullPageSurface aria-label="Review Configuration">
      <div className="review-config-page text-body">
        <PanelHeader
          title={
            <PanelHeaderLabel
              title="Review Configuration"
              icon={<ListChecksIcon />}
            />
          }
        />
        <div className="review-config-scroll">
          <div className="review-config-content">{children}</div>
        </div>
      </div>
    </FullPageSurface>
  );
}

export function ReviewConfigurationPage({ relay }: { relay: RelayData }) {
  const connection = useRelayConnection(relay);
  if (connection.status === "ready")
    return (
      <ReviewConfigurationCommunity
        key={`${connection.scope}:${connection.generation}`}
        session={connection.session}
      />
    );
  return (
    <Frame>
      <p>
        {connection.status === "connecting"
          ? "Connecting to your community…"
          : "Connect to a community to configure reviews."}
      </p>
      {connection.status === "error" && (
        <>
          <p role="alert">{connection.error}</p>
          <Button onClick={() => relay.retry()}>Retry connection</Button>
        </>
      )}
    </Frame>
  );
}

export function ReviewConfigurationCommunity({
  session,
}: {
  session: RelaySession;
}) {
  const list = useChannelList(session.channels);
  const [channel, setChannel] = useState("");
  const [editing, setEditing] = useState(false);
  const channels = list.channels.filter(
    (item) =>
      !item.metadataPending &&
      !item.huddle &&
      !item.archived &&
      !item.pending &&
      (item.channelType === "stream" || item.channelType === "forum"),
  );
  const selected = channels.find((item) => item.id === channel);
  const writable =
    !!selected &&
    !selected.metadataCached &&
    !selected.cached &&
    !selected.readOnly &&
    !!session.configArtifactWriter;
  return (
    <Frame>
      <p>
        Register repositories and save their review lane instructions. These are
        draft settings; saving does not start reviews or send reminders.
      </p>
      <Select
        label="Review channel"
        variant="field"
        value={channel}
        onValueChange={setChannel}
        disabled={editing}
        placeholder="Choose a channel"
        groups={[
          {
            label: "Channels",
            options: channels.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          },
        ]}
        description="Settings are shared with this channel. Members who can post can edit them. Choose a private channel for private instructions."
      />
      {list.status === "loading" && <p role="status">Loading channels…</p>}
      {list.status === "error" && (
        <p role="alert">Could not load channels. Reconnect to try again.</p>
      )}
      {channel && !writable && (
        <p role="alert">
          Saving is unavailable until channel access is confirmed. Your open
          draft is preserved.
        </p>
      )}
      {channel && (
        <ChannelConfiguration
          key={channel}
          session={session}
          channel={channel}
          writable={writable}
          onEditingChange={setEditing}
        />
      )}
    </Frame>
  );
}

function ChannelConfiguration({
  session,
  channel,
  writable,
  onEditingChange,
}: {
  session: RelaySession;
  channel: string;
  writable: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const [rows, setRows] = useState<SavedReviewConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warning, setWarning] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<SavedReviewConfig | "new">();
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    onEditingChange(editor !== undefined);
    if (editor === undefined) editorTrigger.current?.focus();
    return () => onEditingChange(false);
  }, [editor, onEditingChange]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload explicitly requests a fresh snapshot.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadConfigurations(
      session,
      channel,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    )
      .then((next) => {
        if (!controller.signal.aborted) {
          setRows(next.rows);
          setRemaining(
            next.truncated ? 0 : 100 - next.rows.length - next.unreadable,
          );
          setWarning(
            [
              next.unreadable
                ? `${next.unreadable} saved configuration(s) could not be read. They may use a newer format or contain invalid data; other repositories remain editable.`
                : "",
              next.truncated
                ? "Showing the first 100 configurations. Use another review channel for additional repositories."
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load configurations.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session, channel, reload]);
  return (
    <>
      <InlineHeader title="Repositories" />
      <div className="review-config-actions">
        <Button
          disabled={loading || !!editor}
          onClick={() => {
            setNotice("");
            setReload((value) => value + 1);
          }}
        >
          Reload
        </Button>
        <Button
          variant="prominent"
          disabled={
            loading || !!error || !!editor || !writable || remaining <= 0
          }
          onClick={(event) => {
            editorTrigger.current = event.currentTarget;
            setNotice("");
            setEditor("new");
          }}
        >
          Register repository
        </Button>
      </div>
      {!session.configArtifactWriter && (
        <p role="alert">
          This connection cannot save settings. Reconnect with a supported Buzz
          client.
        </p>
      )}
      {!loading && !error && warning && <p role="alert">{warning}</p>}
      {loading ? (
        <p role="status">Loading configurations…</p>
      ) : error ? (
        <p role="alert">{error} Use Reload to try again.</p>
      ) : rows.length ? (
        <table className="review-config-table">
          <caption className="sr-only">Saved repository configurations</caption>
          <thead>
            <tr>
              <th scope="col">Repository</th>
              <th scope="col">Lanes</th>
              <th scope="col">Settings</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.artifactId}>
                <th scope="row">{row.config.repository}</th>
                <td>{row.config.lanes.map((lane) => lane.name).join(", ")}</td>
                <td>
                  <Button
                    aria-label={`Edit ${row.config.repository}`}
                    disabled={!!editor || !writable}
                    onClick={(event) => {
                      editorTrigger.current = event.currentTarget;
                      setNotice("");
                      setEditor(row);
                    }}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>
          {warning
            ? "No readable configurations in this channel."
            : "No repositories configured in this channel. Register one to save its review lanes."}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {editor && (
        <ConfigurationEditor
          key={editor === "new" ? "new" : editor.revision}
          session={session}
          channel={channel}
          writable={writable}
          previous={editor === "new" ? undefined : editor}
          existing={rows}
          onCancel={() => setEditor(undefined)}
          onSaved={(saved) => {
            if (editor === "new") setRemaining((value) => value - 1);
            setRows((current) =>
              [
                ...current.filter((row) => row.artifactId !== saved.artifactId),
                saved,
              ].sort((a, b) =>
                a.config.repository.localeCompare(b.config.repository),
              ),
            );
            setEditor(undefined);
            setNotice(
              `Saved ${saved.config.repository}. Reviews are not enabled yet.`,
            );
          }}
        />
      )}
    </>
  );
}

function ConfigurationEditor({
  session,
  channel,
  writable,
  previous,
  existing,
  onCancel,
  onSaved,
}: {
  session: RelaySession;
  channel: string;
  writable: boolean;
  previous: SavedReviewConfig | undefined;
  existing: readonly SavedReviewConfig[];
  onCancel: () => void;
  onSaved: (saved: SavedReviewConfig) => void;
}) {
  const [draft, setDraft] = useState<ReviewConfig>(
    () =>
      previous?.config ?? {
        version: 1,
        repository: "",
        reminderMinutes: 15,
        lanes: [{ id: crypto.randomUUID(), name: "General", instructions: "" }],
      },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  async function save() {
    if (operation.current || !writable) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      if (
        !previous &&
        existing.some(
          (row) => row.config.repository === repositoryName(draft.repository),
        )
      )
        throw new Error(
          "This repository is already configured in this channel. Cancel and edit its saved settings.",
        );
      const result = await saveConfiguration(
        session,
        channel,
        draft,
        previous,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      );
      if (!controller.signal.aborted) onSaved(result);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          `${reason instanceof Error ? reason.message : "Could not save settings."} Your draft is still here. If settings changed elsewhere or the save timed out, copy your changes, then Cancel and Reload before retrying.`,
        );
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="review-config-form"
    >
      <InlineHeader
        title={previous ? "Edit repository" : "Register repository"}
      />
      <SettingsGroup layout="form">
        <Field
          label="GitHub repository"
          description="Use owner/repository or the full repository URL."
        >
          <Input
            autoFocus
            required
            value={draft.repository}
            readOnly={!!previous}
            disabled={busy}
            maxLength={250}
            placeholder="example-org/project"
            onValueChange={(repository) => setDraft({ ...draft, repository })}
          />
        </Field>
      </SettingsGroup>
      {draft.lanes.map((lane, index) => (
        <section key={lane.id} className="review-config-lane">
          <div className="review-config-actions">
            <InlineHeader title={`Lane ${index + 1}`} />
            <Button
              disabled={busy || draft.lanes.length === 1}
              onClick={() =>
                setDraft({
                  ...draft,
                  lanes: draft.lanes.filter((item) => item.id !== lane.id),
                })
              }
            >
              Remove lane {index + 1}
            </Button>
          </div>
          <SettingsGroup layout="form">
            <Field label={`Lane ${index + 1} name`}>
              <Input
                required
                maxLength={80}
                disabled={busy}
                value={lane.name}
                onValueChange={(name) =>
                  setDraft({
                    ...draft,
                    lanes: draft.lanes.map((item) =>
                      item.id === lane.id ? { ...item, name } : item,
                    ),
                  })
                }
              />
            </Field>
            <Field
              label={`Lane ${index + 1} instructions`}
              description="Save the instructions reviewers should receive for this lane."
            >
              <Textarea
                required
                rows={5}
                maxLength={8000}
                disabled={busy}
                value={lane.instructions}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    lanes: draft.lanes.map((item) =>
                      item.id === lane.id
                        ? { ...item, instructions: event.target.value }
                        : item,
                    ),
                  })
                }
              />
            </Field>
          </SettingsGroup>
        </section>
      ))}
      <div>
        <Button
          disabled={busy || draft.lanes.length >= 12}
          onClick={() =>
            setDraft({
              ...draft,
              lanes: [
                ...draft.lanes,
                { id: crypto.randomUUID(), name: "", instructions: "" },
              ],
            })
          }
        >
          Add lane
        </Button>
      </div>
      <p>
        Reminder interval: 15 minutes. Reviewer selection, routing, and reminder
        delivery will be available in a later version.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="review-config-actions">
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="prominent"
          loading={busy}
          disabled={!writable}
        >
          Save settings
        </Button>
      </div>
    </form>
  );
}
