import React from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';

/** Keeps one broken panel from taking the whole editor down. */
export class ErrorBoundary extends React.Component<{ name: string; children: React.ReactNode }, { error: Error | null; key: number }> {
  state = { error: null as Error | null, key: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.name}] crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return <React.Fragment key={this.state.key}>{this.props.children}</React.Fragment>;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="tile size-11 rounded-xl text-danger">
          <TriangleAlert className="size-5" />
        </span>
        <div className="text-sm font-semibold">The {this.props.name} hit a problem</div>
        <div className="max-w-xs break-words font-mono text-[11px] text-dim">{this.state.error.message}</div>
        <button className="btn btn-sm mt-1" onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}>
          <RotateCcw className="size-3.5" /> Reload panel
        </button>
      </div>
    );
  }
}
