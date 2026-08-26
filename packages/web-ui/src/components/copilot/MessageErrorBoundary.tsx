import { Component, type ReactNode } from 'react';
import { FeedbackSurface } from '../ui/feedback';

interface Props {
  children: ReactNode;
  /** Identifier shown in the fallback so we can grep logs back to a specific message. */
  messageId?: string;
}

interface State {
  error: Error | null;
}

/**
 * Inline boundary so a single broken assistant/user message can't infinite-loop
 * (React error #185 "Maximum update depth exceeded") or hard-crash the entire
 * chat tree. The fallback intentionally leaves the surrounding chat usable.
 */
export class MessageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[MessageErrorBoundary]', this.props.messageId ?? '(no id)', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <FeedbackSurface tone="error" density="inline" className="text-sm">
          <div className="font-medium mb-1">Failed to render this message</div>
          <div className="font-mono text-xs opacity-80 break-all">
            {this.state.error.message}
          </div>
          {this.props.messageId && (
            <div className="font-mono text-[11px] opacity-60 mt-1">id: {this.props.messageId}</div>
          )}
        </FeedbackSurface>
      );
    }
    return this.props.children;
  }
}
