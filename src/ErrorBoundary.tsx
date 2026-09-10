import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

/**
 * Last-resort white-screen guard: a single bad row must never blank the app.
 * Shows a minimal recoverable panel instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(e: unknown): State {
    return { message: e instanceof Error ? e.message : String(e) };
  }

  componentDidCatch(): void {
    // Intentionally silent: details go to the footer diagnostics when possible.
  }

  render() {
    if (this.state.message !== null) {
      return (
        <div className="app">
          <div className="banner warn" role="alert">
            <span>Something went wrong while rendering. Try reloading. ({this.state.message})</span>
            <button className="pill small" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
