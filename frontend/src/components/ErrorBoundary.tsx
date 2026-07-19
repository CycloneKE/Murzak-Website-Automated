import React from "react";
import { reportClientError } from "../services/clientLog";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  props: Props;
  state: State;

  constructor(props: Props) {
    super(props);
    this.props = props;
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportClientError({
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack || undefined,
      source: "react-error-boundary",
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-murzak-base dark:bg-murzak-ink text-murzak-ink dark:text-slate-100">
          <div className="max-w-md w-full text-center glass-panel rounded-[2rem] p-8 border border-murzak-border">
            <p className="text-label font-black uppercase tracking-widest text-red-500 mb-3">Something went wrong</p>
            <h1 className="text-xl font-black mb-3">This page hit an unexpected error.</h1>
            <p className="text-body-sm text-slate-600 dark:text-slate-300 mb-6">
              Reloading usually fixes it. If it keeps happening, our team has already been notified.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 rounded-xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase hover:scale-105 transition-all"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
