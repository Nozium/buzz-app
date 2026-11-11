import type { AgentChoicesSnapshot } from "../../features/agents/choices";
import { Button } from "../../shared/design-system/ui/Button";
import { Select } from "../../shared/design-system/ui/Select";

/** Selection records identities only; it grants no channel access or execution authority. */
export function LaneReviewers({
  lane,
  reviewers,
  choices,
  disabled,
  onChange,
}: {
  lane: number;
  reviewers: readonly string[];
  choices: AgentChoicesSnapshot;
  disabled: boolean;
  onChange: (reviewers: readonly string[]) => void;
}) {
  const available = choices.selectable.filter(
    (agent) => !reviewers.includes(agent.pubkey),
  );
  return (
    <div className="review-config-reviewers">
      <Select
        label={`Lane ${lane} reviewers`}
        variant="field"
        value=""
        placeholder="Add reviewer…"
        disabled={disabled || reviewers.length >= 20 || available.length === 0}
        groups={[
          {
            label: "Agents",
            options: available.map((agent) => ({
              value: agent.pubkey,
              label: `${agent.managedName ?? agent.name} (${agent.pubkey.slice(0, 8)})`,
            })),
          },
        ]}
        onValueChange={(pubkey) => {
          if (available.some((agent) => agent.pubkey === pubkey))
            onChange([...reviewers, pubkey]);
        }}
        description="Choose one or more reviewers. The same agent can be assigned to several lanes."
      />
      {reviewers.length === 0 && <p>No reviewers assigned.</p>}
      {reviewers.map((pubkey) => {
        const agent = choices.identities.find((item) => item.pubkey === pubkey);
        const name = agent?.managedName ?? agent?.name ?? pubkey;
        const selectable = choices.selectable.some(
          (item) => item.pubkey === pubkey,
        );
        return (
          <div key={pubkey} className="review-config-actions">
            <span title={pubkey}>
              {name}
              {!selectable ? " — unavailable in this session" : ""}
            </span>
            <Button
              disabled={disabled}
              aria-label={`Remove ${name} from lane ${lane}`}
              onClick={() =>
                onChange(reviewers.filter((key) => key !== pubkey))
              }
            >
              Remove
            </Button>
          </div>
        );
      })}
    </div>
  );
}
