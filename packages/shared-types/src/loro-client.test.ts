import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { LoroSyncClient } from "./loro-client";

class CapturingWebSocket {
  static instances: CapturingWebSocket[] = [];

  readonly readyState = 1;
  readonly bufferedAmount = 0;
  binaryType = "";
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: unknown,
    readonly options: { headers?: Record<string, string> },
  ) {
    CapturingWebSocket.instances.push(this);
  }

  send() {}
  close(code = 1000, reason = "closed") {
    this.onclose?.({ code, reason });
  }
}

describe("LoroSyncClient", () => {
  it("sends agent surrogate presence headers when the caller is a spawned agent", async () => {
    CapturingWebSocket.instances = [];

    const client = new LoroSyncClient({
      serverUrl: "ws://127.0.0.1:49321",
      projectId: "project-agent",
      token: "local-test-key",
      clientType: "agent",
      userId: "local-user",
      agentName: "local-director",
      WebSocket: CapturingWebSocket as never,
    });

    const connected = client.connect();
    const socket = CapturingWebSocket.instances[0];
    expect(socket.options.headers).toMatchObject({
      "x-client-type": "agent",
      "x-user-id": "local-user",
      "x-agent-name": "local-director",
    });

    const snapshot = new LoroDoc().export({ mode: "snapshot" });
    socket.onmessage?.({ data: snapshot });
    await connected;
  });
});
