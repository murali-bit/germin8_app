import React from 'react';
import { StatusScreen, primaryBtn, ghostBtn } from './StatusScreen';

const isChunkError = (e: Error) =>
  /dynamically imported module|importing a module script|ChunkLoadError|Loading chunk/i.test(`${e.name} ${e.message}`);

export const ErrorPage: React.FC<{ error?: Error; standalone?: boolean }> = ({ error, standalone = true }) => {
  const chunk = error ? isChunkError(error) : false;
  return (
    <StatusScreen
      standalone={standalone}
      code={chunk ? 'Page could not load' : 'Unexpected error'}
      title={
        chunk ? (
          <>
            Slow connection, or we just <span style={{ color: '#C9A332' }}>updated</span>.
          </>
        ) : (
          <>
            Well, that <span style={{ color: '#C9A332' }}>broke</span>.
          </>
        )
      }
      body={
        chunk
          ? 'This page did not finish downloading. Reload and you will be back in a few seconds.'
          : 'Something went wrong on our side, not yours. Nothing you entered is lost. Try again, it usually works.'
      }
      actions={
        <>
          <button type="button" className={primaryBtn} onClick={() => window.location.reload()}>
            {chunk ? 'Reload page' : 'Try again'}
          </button>
          <a href="/" className={ghostBtn}>
            Back to homepage
          </a>
        </>
      }
    />
  );
};

interface State {
  error?: Error;
}

/** Catches render errors (and failed lazy chunks). `resetKey` clears the error on navigation. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey?: string; standalone?: boolean },
  State
> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: undefined });
  }

  render() {
    if (this.state.error) return <ErrorPage error={this.state.error} standalone={this.props.standalone} />;
    return this.props.children;
  }
}
