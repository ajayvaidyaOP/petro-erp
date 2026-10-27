import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Keep rendering failures visible instead of leaving an empty preview. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('PetroFlow render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-navy-950 p-6 text-ink-100">
        <section className="max-w-md rounded-xl border border-navy-700 p-6">
          <h1 className="text-xl font-semibold">PetroFlow could not display this page</h1>
          <p className="mt-3 text-sm text-ink-400">Your saved data has not been cleared. Reload the app or return to sign in.</p>
          <div className="mt-6 flex gap-4">
            <button className="rounded bg-accent px-4 py-2 text-onaccent" onClick={() => window.location.reload()}>Reload app</button>
            <a className="px-4 py-2 underline" href="/login">Sign in</a>
          </div>
        </section>
      </main>
    );
  }
}
