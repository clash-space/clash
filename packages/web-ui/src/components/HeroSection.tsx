
import { useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import { createProject } from '@clash/web-ui/lib/clientActions';
import { ChatInput } from './copilot/ChatInput';

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
        <section className="flex min-h-[64vh] w-full items-center px-5 pb-8 pt-8 sm:px-8 lg:px-10">
            <div className="clash-hero-stage mx-auto w-full max-w-[1120px]">
                <div className="w-full max-w-[980px]">
                    <motion.h1
                        className="clash-hero-heading mb-10 text-left font-display text-6xl font-bold tracking-tighter text-slate-950 md:text-7xl dark:text-slate-50"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                    >
                        Hey! <br />
                        Let&apos;s make some <span className="text-brand">CLASH</span>?
                    </motion.h1>

                    <div className="clash-hero-prompt">
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
                </div>
            </div>
        </section>
    );
}
