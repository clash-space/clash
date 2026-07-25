import {
  AgentAnnotationPromptPayloadSchema,
  type AgentAnnotationDraft,
} from "@clash/shared-types";
import { visibleUserPromptText } from "@clash/shared-runtime";

const ANNOTATION_COMMENT = /<!--\s*clash-agent-annotations\s+([\s\S]*?)-->/g;

/**
 * Agent protocol comments travel with the submitted prompt, but must never be
 * rendered as user-facing markdown. Annotations are retained separately so
 * the message can show the structured annotation UI instead.
 */
export function parseUserMessageContent(content: string): {
  text: string;
  annotations: AgentAnnotationDraft[];
} {
  const annotations: AgentAnnotationDraft[] = [];
  const withoutAnnotations = content.replace(
    ANNOTATION_COMMENT,
    (_comment, payload: string) => {
      try {
        const parsed = AgentAnnotationPromptPayloadSchema.safeParse(
          JSON.parse(payload),
        );
        if (parsed.success) annotations.push(...parsed.data.annotations);
      } catch {
        // Protocol comments are always invisible, even if an older or corrupt
        // payload can no longer be parsed into a renderable annotation card.
      }
      return "";
    },
  );

  return {
    text: visibleUserPromptText(withoutAnnotations),
    annotations,
  };
}
