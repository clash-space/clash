/**
 * Minimal port of @cloudflare/ai-chat's applyChunkToParts.
 *
 * Builds up a mutable message `parts` array from UI stream chunks.
 * Used server-side to construct the message for persistence,
 * mirroring what the client does via the same function.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function applyChunkToParts(parts: any[], chunk: any): boolean {
  switch (chunk.type) {
    case "text-start":
      parts.push({ type: "text", text: "", state: "streaming" });
      return true;

    case "text-delta": {
      const last = findLastByType(parts, "text");
      if (last) last.text += chunk.delta ?? "";
      else parts.push({ type: "text", text: chunk.delta ?? "", state: "streaming" });
      return true;
    }

    case "text-end": {
      const last = findLastByType(parts, "text");
      if (last) last.state = "done";
      return true;
    }

    case "reasoning-start":
      parts.push({ type: "reasoning", text: "", state: "streaming" });
      return true;

    case "reasoning-delta": {
      const last = findLastByType(parts, "reasoning");
      if (last) last.text += chunk.delta ?? "";
      else parts.push({ type: "reasoning", text: chunk.delta ?? "", state: "streaming" });
      return true;
    }

    case "reasoning-end": {
      const last = findLastByType(parts, "reasoning");
      if (last) last.state = "done";
      return true;
    }

    case "tool-input-start":
      parts.push({
        type: `tool-${chunk.toolName}`,
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: "input-streaming",
        input: undefined,
        ...(chunk.providerExecuted != null ? { providerExecuted: chunk.providerExecuted } : {}),
        ...(chunk.providerMetadata != null ? { callProviderMetadata: chunk.providerMetadata } : {}),
        ...(chunk.title != null ? { title: chunk.title } : {}),
      });
      return true;

    case "tool-input-delta": {
      const tool = findToolByCallId(parts, chunk.toolCallId);
      if (tool) tool.input = chunk.input;
      return true;
    }

    case "tool-input-available": {
      const existing = findToolByCallId(parts, chunk.toolCallId);
      if (existing) {
        existing.state = "input-available";
        existing.input = chunk.input;
        if (chunk.providerExecuted != null) existing.providerExecuted = chunk.providerExecuted;
        if (chunk.providerMetadata != null) existing.callProviderMetadata = chunk.providerMetadata;
        if (chunk.title != null) existing.title = chunk.title;
      } else {
        parts.push({
          type: `tool-${chunk.toolName}`,
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          state: "input-available",
          input: chunk.input,
          ...(chunk.providerExecuted != null ? { providerExecuted: chunk.providerExecuted } : {}),
          ...(chunk.providerMetadata != null ? { callProviderMetadata: chunk.providerMetadata } : {}),
          ...(chunk.title != null ? { title: chunk.title } : {}),
        });
      }
      return true;
    }

    case "tool-input-error": {
      const existing = findToolByCallId(parts, chunk.toolCallId);
      if (existing) {
        existing.state = "output-error";
        existing.errorText = chunk.errorText;
        existing.input = chunk.input;
      } else {
        parts.push({
          type: `tool-${chunk.toolName}`,
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          state: "output-error",
          input: chunk.input,
          errorText: chunk.errorText,
        });
      }
      return true;
    }

    case "tool-output-available": {
      const tool = findToolByCallId(parts, chunk.toolCallId);
      if (tool) {
        tool.state = "output-available";
        tool.output = chunk.output;
        if (chunk.preliminary !== undefined) tool.preliminary = chunk.preliminary;
      }
      return true;
    }

    case "tool-output-error": {
      const tool = findToolByCallId(parts, chunk.toolCallId);
      if (tool) {
        tool.state = "output-error";
        tool.errorText = chunk.errorText;
      }
      return true;
    }

    case "tool-approval-request": {
      const tool = findToolByCallId(parts, chunk.toolCallId);
      if (tool) {
        tool.state = "approval-requested";
        tool.approval = { id: chunk.approvalId };
      }
      return true;
    }

    case "tool-output-denied": {
      const tool = findToolByCallId(parts, chunk.toolCallId);
      if (tool) tool.state = "output-denied";
      return true;
    }

    case "file":
      parts.push({ type: "file", mediaType: chunk.mediaType, url: chunk.url });
      return true;

    case "source-url":
      parts.push({
        type: "source-url",
        sourceId: chunk.sourceId,
        url: chunk.url,
        title: chunk.title,
        providerMetadata: chunk.providerMetadata,
      });
      return true;

    case "step-start":
    case "start-step":
      parts.push({ type: "step-start" });
      return true;

    default:
      if (typeof chunk.type === "string" && chunk.type.startsWith("data-")) {
        if (chunk.transient) return true;
        if (chunk.id != null) {
          const existing = parts.find(
            (p: any) => p.type === chunk.type && "id" in p && p.id === chunk.id,
          );
          if (existing) {
            existing.data = chunk.data;
            return true;
          }
        }
        parts.push({
          type: chunk.type,
          ...(chunk.id != null && { id: chunk.id }),
          data: chunk.data,
        });
        return true;
      }
      return false;
  }
}

function findLastByType(parts: any[], type: string): any | undefined {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === type) return parts[i];
  }
}

function findToolByCallId(parts: any[], toolCallId: string): any | undefined {
  if (!toolCallId) return undefined;
  for (let i = parts.length - 1; i >= 0; i--) {
    if ("toolCallId" in parts[i] && parts[i].toolCallId === toolCallId) return parts[i];
  }
}
