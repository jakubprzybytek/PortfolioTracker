import { Component, type ReactNode } from "react";

/**
 * Catches a render error in a view: shows what went wrong and a way back, instead of a blank page. `resetKey` (the
 * view) clears it when you move to another view.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  override state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override componentDidCatch(error: Error) {
    console.error("View failed:", error);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    // A new release replaced the chunk this view needs: reloading the page gets the new one.
    const stale = /dynamically imported module|Importing a module script failed/i.test(this.state.error.message);
    return (
      <div className="error-view" role="alert" data-testid="view-error">
        <h2>{stale ? "A new version of the app is out" : "Something went wrong in this view"}</h2>
        <p className="muted">{stale ? "Reload the page to get it." : this.state.error.message}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    );
  }
}
