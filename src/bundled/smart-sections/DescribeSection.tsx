import { useEffect, useRef, useState } from "react";
import type { RelayData } from "../../features/relay/service";
import type {
  Definition,
  SectionInput,
} from "../../features/smart-sections/model";
import { Button } from "../../shared/design-system/ui/Button";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { Field } from "../../shared/design-system/ui/Field";
import { Select } from "../../shared/design-system/ui/Select";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import type {
  GeneratedSection,
  GenerationModel,
  SectionGenerator,
} from "./generate";
import styles from "./sections.module.css";

export function DescribeSection({
  relay,
  generator,
  section,
  close,
  manual,
  save,
}: {
  relay: RelayData;
  generator: SectionGenerator;
  section?: Definition | undefined;
  close(): void;
  manual(): void;
  save(input: SectionInput): void;
}) {
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [models, setModels] = useState<readonly GenerationModel[]>([]);
  const [model, setModel] = useState("");
  const [result, setResult] = useState<GeneratedSection>();
  const pending = useRef<AbortController>(undefined);
  const generatedFor = useRef<ReturnType<RelayData["snapshot"]>>(undefined);
  useEffect(() => {
    let live = true;
    void generator
      .models()
      .then(
        (choices) => {
          if (!live) return;
          setModels(choices);
          const lightweight = choices.findIndex((choice) => choice.lightweight);
          if (lightweight >= 0) setModel(String(lightweight));
          if (!choices.length)
            setError(
              "No direct generation model is available. Configure Claude or Pi in Settings → Agent setup, or configure this section manually.",
            );
        },
        (cause) => {
          if (live)
            setError(cause instanceof Error ? cause.message : String(cause));
        },
      )
      .finally(() => {
        if (live) setLoadingModels(false);
      });
    return () => {
      live = false;
      pending.current?.abort();
    };
  }, [generator]);
  const selected = model === "" ? undefined : models[Number(model)];
  const draft = result?.input;
  return (
    <Dialog
      open
      title={section ? `Change ${section.title}` : "Create a smart section"}
      description="Describe what you want. AI configures an available source and previews the rows here."
      onOpenChange={(open) => {
        if (!open) close();
      }}
      actions={
        <>
          <Button variant="ghost" onClick={manual} disabled={busy}>
            Configure manually
          </Button>
          {draft ? (
            <Button
              variant="prominent"
              onClick={() => {
                try {
                  const current = relay.snapshot(),
                    original = generatedFor.current;
                  if (
                    !original ||
                    current.status !== "ready" ||
                    original.session !== current.session ||
                    original.scope !== current.scope
                  )
                    throw new Error(
                      "Your community connection changed. Generate the section again.",
                    );
                  save(draft);
                } catch (cause) {
                  setResult(undefined);
                  setError(
                    cause instanceof Error ? cause.message : String(cause),
                  );
                }
              }}
            >
              {section ? "Save changes" : "Add section"}
            </Button>
          ) : (
            <Button
              variant="prominent"
              loading={busy}
              disabled={busy || !request.trim() || !selected}
              onClick={async () => {
                if (!selected) return;
                const controller = new AbortController();
                pending.current = controller;
                const signal = AbortSignal.any([
                  controller.signal,
                  AbortSignal.timeout(60_000),
                ]);
                generatedFor.current = relay.snapshot();
                setBusy(true);
                setError("");
                setResult(undefined);
                try {
                  const next = await generator.generate(
                    request,
                    selected,
                    signal,
                    section,
                  );
                  if (!controller.signal.aborted) setResult(next);
                } catch (cause) {
                  if (!controller.signal.aborted)
                    setError(
                      cause instanceof Error ? cause.message : String(cause),
                    );
                } finally {
                  if (!controller.signal.aborted) setBusy(false);
                }
              }}
            >
              Generate section
            </Button>
          )}
        </>
      }
    >
      <div className={styles.form}>
        <Field
          label={
            section
              ? "What would you like to change?"
              : "What would you like to see?"
          }
        >
          <Textarea
            value={request}
            disabled={busy}
            onChange={(event) => {
              setRequest(event.currentTarget.value);
              setResult(undefined);
              setError("");
            }}
            placeholder="Track open PRs about onboarding in example-org/example-repo"
            maxLength={2000}
          />
        </Field>
        {!section && (
          <div className={styles.actions}>
            {[
              "Track all my active agents",
              "Track open PRs in example-org/example-repo",
            ].map((example) => (
              <Button
                key={example}
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setRequest(example);
                  setResult(undefined);
                }}
              >
                {example}
              </Button>
            ))}
          </div>
        )}
        {loadingModels ? (
          <p role="status" className="text-caption text-secondary">
            Loading available models…
          </p>
        ) : (
          models.length > 0 && (
            <Select
              label="Generation model"
              variant="field"
              value={model}
              disabled={busy}
              placeholder="Choose a model"
              description="A lightweight model is preferred when available. Uses your existing provider sign-in. Sends your request, section settings, and available source descriptions."
              groups={[
                {
                  label: "Available models",
                  options: models.map((choice, index) => ({
                    value: String(index),
                    label: choice.label,
                  })),
                },
              ]}
              onValueChange={(value) => {
                setModel(value);
                setResult(undefined);
                setError("");
              }}
            />
          )
        )}
        <p className="text-caption text-secondary">
          No chat or agent needs to be running. Enabled sources supply real rows
          and automatic updates while Buzz is open. Optional matching uses your
          selected Decisions provider.
        </p>
        {result?.question && (
          <p role="status" className="text-body">
            {result.question} Update your description and generate again.
          </p>
        )}
        {result?.preview && (
          <div role="status" className={styles.form}>
            <p className="text-body-strong">{draft?.title}</p>
            <p className="text-caption text-secondary">
              {result.preview.items.length} confirmed matches ·{" "}
              {result.preview.unknown} unknown
              {result.preview.partial ? " · partial source coverage" : ""}
            </p>
            {result.preview.note && (
              <p className="text-body text-secondary">{result.preview.note}</p>
            )}
            {result.preview.items.slice(0, draft?.limit).map((row) => (
              <p key={row.id} className="text-body">
                {row.label} · {row.status}
              </p>
            ))}
            {draft?.criteria && (
              <p className="text-caption text-secondary">
                Matching: {draft.criteria}
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
