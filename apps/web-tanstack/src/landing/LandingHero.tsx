import { motion } from 'framer-motion';
import { useState, useTransition } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { authClient } from '../lib/auth-client';
import { LandingChatInput } from './LandingChatInput';

export default function LandingHero() {
  const [inputValue, setInputValue] = useState('');
  const [isPending, startTransition] = useTransition();
  const navigate = useNavigate();
  const session = authClient.useSession();

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    if (!session.data?.user) {
      // Park the prompt so /login → /projects new-project flow can pick it up.
      try { sessionStorage.setItem("clash:pending-prompt", text); } catch {}
      void navigate({ to: '/login' });
      return;
    }
    startTransition(async () => {
      // /projects/new will create a project with this prompt and redirect.
      // Until /projects is ported, just take the user there.
      try { sessionStorage.setItem("clash:pending-prompt", text); } catch {}
      void navigate({ to: '/billing' });
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
            <LandingChatInput
              input={inputValue}
              onInputChange={setInputValue}
              onSubmit={(text) => handleSend(text)}
              isProcessing={isPending}
              placeholder="Describe your video idea..."
            />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
