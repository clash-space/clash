/**
 * Builds the base URL that asset links are handed out under.
 *
 * The host is normally started with `port: 0`, so the port is only known once the socket is
 * bound. Anything that captured the requested port produced `http://127.0.0.1:0`, which is
 * unroutable; a reference that had to be read back then failed with a bare `fetch failed`.
 * Handing consumers a resolver instead of a string keeps the value correct after the bind.
 */
export function resolveMediaBaseUrl(boundPort: () => number | undefined): () => string {
  return () => {
    const port = boundPort();
    if (!port) {
      throw new Error("Local host is not listening yet; no media base URL is available.");
    }
    return `http://127.0.0.1:${port}`;
  };
}
