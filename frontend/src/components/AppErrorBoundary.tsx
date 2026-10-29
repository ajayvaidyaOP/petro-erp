import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Fuel, RotateCw, ShieldAlert } from 'lucide-react';

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
      <main className="hero-mesh grid min-h-dvh place-items-center bg-carbon-950 p-6 text-ink-100">
        <section className="card w-full max-w-lg overflow-hidden">
          <span aria-hidden className="brand-gradient block h-[3px] w-full" />
          <div className="p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="brand-gradient grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-onbrand shadow-glow">
                <Fuel className="h-5 w-5" strokeWidth={2.3} aria-hidden />
              </span>
              <div>
                <p className="font-display text-lg font-extrabold tracking-[-0.02em] text-ink-100">
                  Petro<span className="text-accent">Flow</span>
                </p>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-500">Fuel station ERP</p>
              </div>
            </div>

            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger/8 p-4">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-danger/25 bg-danger/12 text-danger">
                <ShieldAlert className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h1 className="font-display text-[17px] font-bold tracking-tight text-ink-100">
                  This screen could not be displayed
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-ink-400">
                  Your saved data has not been cleared. Reload the app, or sign in again if the problem keeps
                  happening.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="brand-gradient inline-flex min-h-10 items-center gap-2 rounded-xl border border-fuel/40 px-4 text-sm font-semibold text-onbrand shadow-glow transition hover:brightness-[1.06] active:scale-[.985]"
              >
                <RotateCw className="h-4 w-4" aria-hidden />
                Reload app
              </button>
              <a
                href="/login"
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-carbon-600/80 bg-carbon-900/80 px-4 text-sm font-semibold text-ink-200 shadow-sheen transition hover:border-accent/55 hover:text-ink-100"
              >
                Back to sign in
              </a>
            </div>
          </div>
        </section>
      </main>
    );
  }
}
