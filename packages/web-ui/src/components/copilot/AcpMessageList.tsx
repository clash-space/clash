/**
 * Render a stream of ACP-derived messages. Pulled out of the old
 * ChatbotCopilot so the new GroupChatPanel's per-crew view reuses the
 * exact same look-and-feel for tool calls, streamed text, and unknown
 * events. Single source of truth keeps the two paths visually
 * identical and makes future polish (e.g. tool result rendering) land
 * in one place.
 */

import { motion } from 'framer-motion';
import type { ByoMessage } from '@clash/web-ui/lib/acpEvents';

export function AcpMessageList({
  messages,
  emptyHint,
}: {
  messages: ByoMessage[];
  emptyHint?: React.ReactNode;
}) {
  if (messages.length === 0) {
    return (
      <div className="text-center text-sm text-stone-400 py-12">
        {emptyHint ?? 'No messages yet.'}
      </div>
    );
  }
  return (
    <>
      {messages.map((m) => (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={m.role === 'user' ? 'flex justify-end' : ''}
        >
          {m.role === 'user' ? (
            <div className="max-w-[82%] px-4 py-3 rounded-matrix shadow-sm border bg-gradient-to-br from-red-50/90 to-pink-50/90 border-red-100/50 text-gray-900">
              {m.parts.map((p, i) =>
                p.type === 'text' ? (
                  <p key={i} className="text-sm leading-relaxed mb-1 last:mb-0">{p.text}</p>
                ) : null,
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {m.parts.map((p, i) => {
                if (p.type === 'text') {
                  return (
                    <div key={i} className="text-base text-slate-800 leading-relaxed px-1 whitespace-pre-wrap">
                      {p.text}
                    </div>
                  );
                }
                if (p.type === 'tool_call') {
                  return (
                    <div
                      key={i}
                      className="text-xs font-mono bg-warm-muted border border-warm-border rounded px-2.5 py-1.5 text-slate-600"
                    >
                      <span className="font-semibold">{p.name}</span>
                      {p.input !== undefined ? (
                        <span className="opacity-70"> {JSON.stringify(p.input)}</span>
                      ) : null}
                    </div>
                  );
                }
                // raw_event fallback — collapsed JSON for debugging
                // unrecognized ACP events without losing them.
                return (
                  <details key={i} className="text-[11px] font-mono text-stone-400">
                    <summary className="cursor-pointer">event</summary>
                    <pre className="mt-1 bg-warm-muted/60 p-2 rounded overflow-x-auto">
                      {JSON.stringify(p.event, null, 2)}
                    </pre>
                  </details>
                );
              })}
            </div>
          )}
        </motion.div>
      ))}
    </>
  );
}
