
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
        <section className="flex min-h-[62vh] w-full items-center px-6 pb-0">
            <div className="mx-auto w-full max-w-[1600px]">
                <div className="w-full max-w-4xl lg:pl-12 xl:pl-16">
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
            </div>
        </section>
    );
}
