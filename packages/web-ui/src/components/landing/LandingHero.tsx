
import { motion } from 'framer-motion';
import { createProject } from '@clash/web-ui/lib/clientActions';
import { useState, useTransition } from 'react';
import { useNavigate } from 'react-router';
import betterAuthClient from '@clash/web-ui/lib/betterAuthClient';
import { ChatInput } from '../copilot/ChatInput';

export default function LandingHero() {
  const [inputValue, setInputValue] = useState('');
  const [isPending, startTransition] = useTransition();
  const navigate = useNavigate();
  const session = betterAuthClient.useSession();

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    if (!session.data?.user) {
      navigate('/login');
      return;
    }
    startTransition(async () => {
      await createProject(text);
    });
  };

  return (
    <section className="relative flex min-h-[calc(100vh-5rem)] items-center overflow-hidden px-5 pb-16 pt-28 sm:px-8 lg:px-10">
      <div className="clash-hero-stage mx-auto w-full max-w-[1120px]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[980px] text-left"
        >
          <h1 className="clash-hero-heading mb-10 max-w-[980px] font-display text-5xl font-bold tracking-tighter text-slate-950 dark:text-slate-50 sm:text-6xl md:text-7xl">
            Hey! <br />
            Let&apos;s make some <span className="text-brand">CLASH</span>?
          </h1>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
            className="clash-hero-prompt w-full"
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
