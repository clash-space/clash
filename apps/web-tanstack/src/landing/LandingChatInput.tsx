/**
 * Slim landing-only chat input. The full ChatInput (449 lines, MilkdownEditor +
 * R2 signed uploads + voice + mentions) lives in @clash/web-ui and is overkill
 * for the marketing page — visitors just type a sentence and hit submit. The
 * full editor mounts after they sign in and create a project.
 *
 * Visual: large rounded text area, "send" button bottom-right, hero variant.
 */
import { useRef, useEffect } from "react";
import { ArrowUp } from "@phosphor-icons/react";

interface Props {
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: (text: string) => void;
  isProcessing?: boolean;
  placeholder?: string;
}

export function LandingChatInput({
  input,
  onInputChange,
  onSubmit,
  isProcessing,
  placeholder = "Describe your video idea…",
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [input]);

  function send() {
    const v = input.trim();
    if (!v || isProcessing) return;
    onSubmit(v);
  }

  return (
    <div className="relative w-full max-w-2xl mx-auto rounded-2xl border border-neutral-200 bg-white shadow-sm focus-within:border-neutral-400 focus-within:shadow-md transition-all">
      <textarea
        ref={ref}
        rows={2}
        value={input}
        disabled={isProcessing}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent px-5 py-4 pr-14 text-base text-neutral-900 placeholder-neutral-400 focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={send}
        disabled={!input.trim() || isProcessing}
        className="absolute right-3 bottom-3 grid h-9 w-9 place-items-center rounded-xl bg-neutral-900 text-white transition-opacity hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Send"
      >
        <ArrowUp size={18} weight="bold" />
      </button>
    </div>
  );
}
