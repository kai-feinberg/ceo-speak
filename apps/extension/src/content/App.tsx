import type { CorporateLevel, Suggestion } from "@text-intel/shared";

type AppProps = {
  state: {
    activeSuggestion: Suggestion | null;
    position: { top: number; left: number } | null;
    isAnalyzing: boolean;
    level: CorporateLevel;
  };
  onApply: (suggestion: Suggestion) => void;
  onDismiss: (id: string) => void;
  onLevelChange: (level: CorporateLevel) => void;
};

const levels: CorporateLevel[] = ["associate", "manager", "ceo"];

export function App({ state, onApply, onDismiss, onLevelChange }: AppProps) {
  const suggestion = state.activeSuggestion;

  return (
    <>
      <div className="ti-toolbar">
        <span className="ti-toolbar__label">Corpo level</span>
        <div className="ti-levels" role="group" aria-label="Corporate jargon level">
          {levels.map((level) => (
            <button
              key={level}
              className={level === state.level ? "ti-level ti-level--active" : "ti-level"}
              type="button"
              onClick={() => onLevelChange(level)}
            >
              {level}
            </button>
          ))}
        </div>
        {state.isAnalyzing ? <span className="ti-toolbar__status">Checking...</span> : null}
      </div>

      {suggestion && state.position ? (
        <div
          className="ti-popover"
          style={{
            transform: `translate(${Math.round(state.position.left)}px, ${Math.round(state.position.top)}px)`
          }}
        >
          <div className="ti-popover__meta">{suggestion.type}</div>
          <div className="ti-popover__message">{suggestion.message}</div>
          <button className="ti-suggestion" type="button" onClick={() => onApply(suggestion)}>
            {suggestion.replacement}
          </button>
          <button className="ti-dismiss" type="button" onClick={() => onDismiss(suggestion.id)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}
