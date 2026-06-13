
import { useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import { createProject } from '@clash/web-ui/lib/clientActions';
import { ChatInput } from './copilot/ChatInput';

function HeroCanvasPreview() {
    return (
        <motion.div
            className="clash-home-canvas-preview relative min-h-[390px] overflow-hidden"
            aria-hidden="true"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.56, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
        >
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 520 390" fill="none" role="presentation">
                <path className="clash-home-preview-edge" d="M146 116 C222 116 224 218 306 218" />
                <path className="clash-home-preview-edge clash-home-preview-edge--slow" d="M172 278 C246 278 266 224 344 224" />
            </svg>

            <motion.div
                className="clash-home-preview-node clash-home-preview-node--brief absolute left-[7%] top-[16%] w-[235px] rounded-2xl p-4"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: 0.24 }}
            >
                <div className="mb-3 flex items-center gap-2">
                    <span className="clash-home-preview-chip">Brief</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                </div>
                <p className="font-display text-lg font-semibold leading-snug text-slate-950">
                    Neon rain chase, two characters, one impossible cut.
                </p>
            </motion.div>

            <motion.div
                className="clash-home-preview-node clash-home-preview-node--shot absolute right-[4%] top-[38%] w-[240px] rounded-2xl p-4"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: 0.34 }}
            >
                <div className="clash-home-preview-frame mb-3 aspect-video rounded-xl" />
                <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-950">Shot pass</span>
                    <span className="clash-home-preview-chip">16:9</span>
                </div>
            </motion.div>

            <motion.div
                className="clash-home-preview-node clash-home-preview-node--timeline absolute bottom-[10%] left-[7%] w-[250px] rounded-2xl p-4"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: 0.44 }}
            >
                <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-950">Scene rhythm</span>
                    <span className="text-xs font-medium text-stone-500">00:12</span>
                </div>
                <div className="grid grid-cols-[1.1fr_0.65fr_0.9fr] gap-1.5">
                    <span className="h-9 rounded-lg bg-brand/18" />
                    <span className="h-9 rounded-lg bg-stone-300/45" />
                    <span className="h-9 rounded-lg bg-slate-900/10" />
                </div>
            </motion.div>

            <motion.div
                className="clash-home-preview-agent absolute right-[13%] top-[12%] flex items-center gap-2 rounded-2xl px-3 py-2"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1], delay: 0.58 }}
            >
                <img src="/brand/logo-mark-animated.svg" alt="" className="h-7 w-7 object-contain" draggable={false} />
                <span className="text-sm font-semibold text-slate-950">Agent drafting</span>
            </motion.div>
        </motion.div>
    );
}

export default function HeroSection() {
    const [inputValue, setInputValue] = useState('');
    const [isPending, startTransition] = useTransition();

    const handleSend = (text: string) => {
        if (text.trim()) {
            startTransition(async () => {
                await createProject(text);
            });
        }
    };

    return (
        <section className="flex min-h-[62vh] w-full items-center px-6 pb-0">
            <div className="mx-auto grid w-full max-w-[1600px] items-center gap-10 lg:grid-cols-[minmax(0,0.98fr)_minmax(380px,0.72fr)]">
                <div className="mx-auto w-full max-w-4xl lg:mx-0 lg:pl-12 xl:pl-16">
                    <motion.h1
                        className="mb-10 text-left font-display text-6xl font-bold tracking-tighter text-slate-950 md:text-7xl dark:text-slate-50"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                    >
                        Hey! <br />
                        Let&apos;s make some <span className="text-brand">CLASH</span>?
                    </motion.h1>

                    <ChatInput
                        input={inputValue}
                        onInputChange={setInputValue}
                        onSubmit={(text) => handleSend(text)}
                        isProcessing={isPending}
                        isCreatingSession={isPending}
                        placeholder="Describe your video idea..."
                        variant="hero"
                    />
                </div>

                <HeroCanvasPreview />
            </div>
        </section>
    );
}
