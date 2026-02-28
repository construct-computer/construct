import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Compact inline rendering for inside a window. Full-screen if false. */
  inline?: boolean;
  /** Label shown in the error (e.g. the window title). */
  label?: string;
  /** Called when the user clicks Retry. If not provided, resets the boundary. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` — ${this.props.label}` : ''}]`, error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = this.state.error?.message || 'Something went wrong';

    if (this.props.inline) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-3">
          <AlertTriangle className="w-8 h-8 text-red-400/80" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">
              {this.props.label ? `${this.props.label} crashed` : 'Something went wrong'}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-xs break-words">
              {message}
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--color-surface-raised)] border border-[var(--color-border)] hover:bg-[var(--color-accent-muted)] transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      );
    }

    // Full-screen fallback (root level)
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="max-w-md w-full p-8 text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-red-400/80 mx-auto" />
          <h1 className="text-lg font-medium text-white">Something went wrong</h1>
          <p className="text-sm text-white/60 break-words">{message}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reload
          </button>
        </div>
      </div>
    );
  }
}
