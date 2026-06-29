export function textFromEvent(event) {
  if (!event || typeof event !== "object") return "";
  if (typeof event.text === "string") return event.text;
  if (event.content && typeof event.content === "object") {
    if (typeof event.content.text === "string") return event.content.text;
    if (Array.isArray(event.content)) {
      return event.content.map(textFromEvent).join("");
    }
  }
  if (Array.isArray(event.content)) return event.content.map(textFromEvent).join("");
  if (event.type === "promptComplete") return "";
  return "";
}

export function isTransportDiagnosticText(text) {
  const normalized = String(text).trim();
  return /^Falling back from WebSockets to HTTPS transport\./i.test(normalized);
}

export function assistantTextFromEvents(events) {
  return events
    .map(textFromEvent)
    .filter((text) => text && !isTransportDiagnosticText(text))
    .join("");
}

export function diagnosticTextFromEvents(events) {
  return events
    .map(textFromEvent)
    .filter((text) => text && isTransportDiagnosticText(text))
    .join("\n");
}
