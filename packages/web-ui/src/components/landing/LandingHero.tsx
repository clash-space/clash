
import { motion } from 'framer-motion';
import { createProject } from '@clash/web-ui/lib/clientActions';
import { useState, useTransition } from 'react';
import { useNavigate } from 'react-router';
import betterAuthClient from '@clash/web-ui/lib/betterAuthClient';
import { ChatInput } from '../copilot/ChatInput';
import { HeroCanvasPreview } from '../HeroSection';

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
    <section className="relative flex min-h-[calc(100vh-5rem)] items-center overflow-hidden px-6 pb-16 pt-28 lg:px-8">
      <div className="mx-auto grid w-full max-w-[1600px] items-center gap-10 lg:grid-cols-[minmax(0,0.98fr)_minmax(380px,0.72fr)]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto w-full max-w-4xl text-left lg:mx-0 lg:pl-12 xl:pl-16"
        >
          <h1 className="mb-10 max-w-4xl font-display text-5xl font-bold tracking-tighter text-slate-950 dark:text-slate-50 sm:text-6xl md:text-7xl">
            Hey! <br />
            Let&apos;s make some <span className="text-brand">CLASH</span>?
          </h1>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
            className="w-full max-w-4xl"
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

        <HeroCanvasPreview />
      </div>
    </section>
  );
}
