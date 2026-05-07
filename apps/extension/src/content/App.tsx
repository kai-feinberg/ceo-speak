import type { CorporateLevel, Suggestion } from "@text-intel/shared";

type AppProps = {
  state: {
    activeSuggestion: Suggestion | null;
    position: { top: number; left: number } | null;
    isAnalyzing: boolean;
    level: CorporateLevel;
    apiKeyDraft: string;
    hasApiKey: boolean;
    apiKeyMessage: string | null;
  };
  onApply: (suggestion: Suggestion) => void;
  onDismiss: (id: string) => void;
  onLevelChange: (level: CorporateLevel) => void;
  onApiKeyDraftChange: (value: string) => void;
  onApiKeySave: () => void;
  onApiKeyClear: () => void;
};

const levels: CorporateLevel[] = ["associate", "manager", "ceo"];

export function App({
  state,
  onApply,
  onDismiss,
  onLevelChange,
  onApiKeyDraftChange,
  onApiKeySave,
  onApiKeyClear
}: AppProps) {
  const suggestion = state.activeSuggestion;

  return (
    <>
      <div className="ti-toolbar">
        <div className="ti-toolbar__row">
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
        <div className="ti-key">
          <input
            aria-label="OpenRouter API key"
            className="ti-key__input"
            placeholder={state.hasApiKey ? "OpenRouter key saved" : "OpenRouter key"}
            type="password"
            value={state.apiKeyDraft}
            onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)}
          />
          <button className="ti-key__button" type="button" onClick={onApiKeySave}>
            Save
          </button>
          {state.hasApiKey ? (
            <button className="ti-key__button ti-key__button--quiet" type="button" onClick={onApiKeyClear}>
              Clear
            </button>
          ) : null}
        </div>
        {state.apiKeyMessage ? <div className="ti-key__message">{state.apiKeyMessage}</div> : null}
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
