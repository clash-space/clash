
import { forwardRef, useImperativeHandle, useRef, useState, useTransition, type ForwardedRef } from 'react';
import { motion } from 'framer-motion';
import { createProject } from '@clash/web-ui/lib/clientActions';
import { ChatInput, type ChatInputHandle } from './copilot/ChatInput';

export interface HeroSectionHandle {
    focus: () => void;
}

function HeroSectionInner(_props: object, ref: ForwardedRef<HeroSectionHandle>) {
    const [inputValue, setInputValue] = useState('');
    const [isPending, startTransition] = useTransition();
    const chatInputRef = useRef<ChatInputHandle>(null);

    useImperativeHandle(ref, () => ({
        focus() {
            chatInputRef.current?.focus();
        },
    }), []);

    const handleSend = (text: string) => {
        if (text.trim()) {
            startTransition(async () => {
                await createProject(text);
            });
        }
    };

    return (
        <section className="clash-home-hero flex w-full items-center px-5 pb-8 pt-8 sm:px-8 lg:px-10">
            <div className="clash-hero-stage mx-auto w-full max-w-[1440px]">
                <div className="clash-home-hero-copy w-full max-w-[1120px]">
                    <motion.h1
                        className="clash-home-hero-heading mb-8 text-left font-display font-bold tracking-tighter text-slate-950 dark:text-slate-50"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                    >
                        Hey! <br />
                        Let&apos;s make some <span className="text-brand">CLASH</span>?
                    </motion.h1>
                </div>

                <div className="clash-hero-prompt">
                    <ChatInput
                        ref={chatInputRef}
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

const HeroSection = forwardRef<HeroSectionHandle, object>(HeroSectionInner);
HeroSection.displayName = 'HeroSection';

export default HeroSection;
