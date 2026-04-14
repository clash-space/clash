'use client';

import { useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import { createProject } from '../actions';
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
        <div className="flex flex-col items-center justify-center min-h-[60vh] w-full max-w-[1600px] mx-auto px-6 pb-0">
            <motion.h1
                className="mb-10 text-6xl md:text-7xl font-bold tracking-tighter text-gray-900 text-left w-full max-w-4xl"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                Hey! <br />
                Let&apos;s make some <span className="text-brand">CLASH</span>?
            </motion.h1>

            <div className="w-full max-w-4xl">
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
    );
}
