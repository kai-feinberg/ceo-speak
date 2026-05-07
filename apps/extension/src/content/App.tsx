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
    isSettingsOpen: boolean;
  };
  onApply: (suggestion: Suggestion) => void;
  onDismiss: (id: string) => void;
  onLevelChange: (level: CorporateLevel) => void;
  onSettingsToggle: () => void;
  onSettingsClose: () => void;
  onApiKeyDraftChange: (value: string) => void;
  onApiKeySave: () => void;
  onApiKeyClear: () => void;
};

const levels: CorporateLevel[] = ["associate", "manager", "ceo"];
const idleStatusByLevel: Record<CorporateLevel, string> = {
  associate: "📊 Creating slide deck...",
  manager: "💼 Making shareholder value...",
  ceo: "🌊 Boiling the ocean..."
};

export function App({
  state,
  onApply,
  onDismiss,
  onLevelChange,
  onSettingsToggle,
  onSettingsClose,
  onApiKeyDraftChange,
  onApiKeySave,
  onApiKeyClear
}: AppProps) {
  const suggestion = state.activeSuggestion;
  const status = state.isAnalyzing ? "💰 Boiling the ocean..." : idleStatusByLevel[state.level];

  return (
    <>
      <div className="ti-toolbar">
        <div className="ti-toolbar__row">
          <div className="ti-brand" aria-label="CEO Speak">
            <span className="ti-brand__mark">💸</span>
            <span className="ti-brand__text">CEO Speak</span>
            <span className="ti-brand__cash">$$$</span>
          </div>
          <div className={state.isAnalyzing ? "ti-toolbar__status ti-toolbar__status--active" : "ti-toolbar__status"}>
            {status}
          </div>
          <button
            className={state.isSettingsOpen ? "ti-icon-button ti-icon-button--active" : "ti-icon-button"}
            type="button"
            aria-label="Open settings"
            title="Open settings"
            onClick={onSettingsToggle}
          >
            ⚙️
          </button>
        </div>
        <div className="ti-mode-row">
          <div className="ti-mode-row__label">Skill level</div>
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
        </div>
      </div>

      {state.isSettingsOpen ? (
        <div className="ti-settings" role="dialog" aria-label="CEO Speak settings">
          <div className="ti-settings__header">
            <div>
              <div className="ti-settings__eyebrow">Settings</div>
              <div className="ti-settings__title">Jargon fuel tank</div>
            </div>
            <button className="ti-close-button" type="button" aria-label="Close settings" onClick={onSettingsClose}>
              x
            </button>
          </div>
          <label className="ti-key">
            <span className="ti-key__label">OpenRouter key</span>
            <input
              aria-label="OpenRouter API key"
              className="ti-key__input"
              placeholder={state.hasApiKey ? "Key saved. The board is listening." : "sk-or-v1-..."}
              type="password"
              value={state.apiKeyDraft}
              onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)}
            />
          </label>
          <div className="ti-settings__actions">
            <button className="ti-key__button" type="button" onClick={onApiKeySave}>
              💵 Fuel the machine
            </button>
            {state.hasApiKey ? (
              <button className="ti-key__button ti-key__button--quiet" type="button" onClick={onApiKeyClear}>
                🧾 Drain it
              </button>
            ) : null}
          </div>
          {state.apiKeyMessage ? <div className="ti-key__message">{state.apiKeyMessage}</div> : null}
        </div>
      ) : null}

      {suggestion && state.position ? (
        <div
          className="ti-popover"
          style={{
            transform: `translate(${Math.round(state.position.left)}px, ${Math.round(state.position.top)}px)`
          }}
        >
          <button className="ti-dismiss" type="button" aria-label="Dismiss suggestion" onClick={() => onDismiss(suggestion.id)}>
            x
          </button>
          <div className="ti-popover__meta">{suggestion.type}</div>
          <div className="ti-popover__message">{suggestion.message}</div>
          <button className="ti-suggestion" type="button" onClick={() => onApply(suggestion)}>
            {suggestion.replacement}
          </button>
        </div>
      ) : null}
    </>
  );
}
