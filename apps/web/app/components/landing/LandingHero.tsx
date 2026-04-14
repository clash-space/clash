'use client';

import { motion } from 'framer-motion';
import { createProject } from '@/app/actions';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import betterAuthClient from '@/lib/betterAuthClient';
import { ChatInput } from '../copilot/ChatInput';

export default function LandingHero() {
  const [inputValue, setInputValue] = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const session = betterAuthClient.useSession();

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    if (!session.data?.user) {
      router.push('/login');
      return;
    }
    startTransition(async () => {
      await createProject(text);
    });
  };

  return (
    <section className="relative flex min-h-[calc(100vh-5rem)] items-center justify-center overflow-hidden px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center"
        >
          <h1 className="mb-10 text-6xl md:text-7xl font-bold tracking-tighter text-gray-900 text-center w-full font-display">
            Hey! <br />
            Let&apos;s make some <span className="text-brand">CLASH</span>?
          </h1>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mx-auto w-full"
          >
            <ChatInput
              input={inputValue}
              onInputChange={setInputValue}
              onSubmit={(text) => handleSend(text)}
              isProcessing={isPending}
              isCreatingSession={isPending}
              placeholder="Describe your video idea..."
              variant="hero"
            />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
