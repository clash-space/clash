"use client";

import type { SessionTranscript } from "@openma/common/session";
import { BackchatSessionTimeline } from "@openma/common/session-ui";

import type { MentionableNode } from "../MilkdownEditor";
import {
  AcpAssistantTextInline,
  AcpToolInline,
  type ClashProjectEntity,
} from "./AcpInlineRenderers";
import { AgentMotion } from "./AgentMotion";
import { UserMessage } from "./UserMessage";

/** Clash's complete runtime-transcript adapter.
 *
 * Backchat owns turn boundaries, process/answer projection, event ordering,
 * and disclosure state. Clash supplies its avatar plus inline-only product
 * capabilities; those slots cannot create a second timeline or move events.
 */
export function RuntimeSessionTimeline({
  transcript,
  mentionableNodes,
  clashEntities,
  onOpenClashEntity,
}: {
  transcript: SessionTranscript;
  mentionableNodes: MentionableNode[];
  clashEntities: readonly ClashProjectEntity[];
  onOpenClashEntity?: (entity: ClashProjectEntity) => void;
}) {
  return (
    <div data-testid="runtime-session-timeline" data-renderer="backchat">
      <BackchatSessionTimeline
        transcript={transcript}
        avatar={
          <AgentMotion
            state="working"
            className="clash-agent-motion--compact h-5 w-5"
            gazeTarget={null}
          />
        }
        slots={{
          renderPrompt: ({ turn, defaultNode }) =>
            turn.promptText ? (
              <UserMessage
                content={turn.promptText}
                mentionNodes={mentionableNodes}
              />
            ) : (
              defaultNode
            ),
          renderAssistantText: ({ text, section }) => (
            <AcpAssistantTextInline text={text} section={section} />
          ),
          renderTool: ({ tool }) => (
            <AcpToolInline
              tool={tool}
              clashEntities={clashEntities}
              onOpenClashEntity={onOpenClashEntity}
            />
          ),
        }}
      />
    </div>
  );
}
