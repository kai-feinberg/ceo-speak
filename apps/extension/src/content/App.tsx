import type { Suggestion } from "@text-intel/shared";

type AppProps = {
  state: {
    activeSuggestion: Suggestion | null;
    position: { top: number; left: number } | null;
    isAnalyzing: boolean;
  };
  onApply: (suggestion: Suggestion) => void;
  onDismiss: (id: string) => void;
};

export function App({ state, onApply, onDismiss }: AppProps) {
  if (!state.activeSuggestion || !state.position) {
    return state.isAnalyzing ? <div className="ti-status">Checking...</div> : null;
  }

  const suggestion = state.activeSuggestion;

  return (
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
  );
}
