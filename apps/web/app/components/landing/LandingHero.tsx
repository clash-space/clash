'use client';

import { motion } from 'framer-motion';
import { createProject } from '@/app/actions';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import betterAuthClient from '@/lib/betterAuthClient';
import {
  PaperPlaneRight,
  FilmSlate,
  Microphone,
  Sparkle
} from '@phosphor-icons/react';

export default function LandingHero() {
  const [inputValue, setInputValue] = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const session = betterAuthClient.useSession();

  const handleSend = () => {
    if (inputValue.trim()) {
      // If user is not authenticated, redirect to login
      if (!session.data?.user) {
        router.push('/login');
        return;
      }

      startTransition(async () => {
        await createProject(inputValue);
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <section className="relative flex min-h-[calc(100vh-5rem)] items-center justify-center overflow-hidden px-6 lg:px-8">
      {/* Background handled by global Background component */}

      <div className="mx-auto w-full max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center"
        >
          {/* Headline */}
          <h1 className="mb-10 text-6xl md:text-7xl font-bold tracking-tighter text-gray-900 text-center w-full font-display">
            Hey! <br />
            Let's make some <span className="text-brand">CLASH</span>?
          </h1>

          {/* Chat Input - Using original HeroSection style */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mx-auto w-full"
          >
            <div className="group relative rounded-[2rem] border border-gray-200 bg-white p-2 shadow-sm transition-all duration-300 hover:shadow-md focus-within:shadow-xl focus-within:border-gray-300">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Describe your video idea... e.g., 'Create a 60-second product demo video with subtitles'"
                className="w-full resize-none rounded-2xl bg-transparent px-6 py-4 text-xl text-gray-900 placeholder:text-gray-400 focus:outline-none"
                rows={3}
                disabled={isPending}
              />
              <div className="flex items-center justify-between px-4 pb-2">
                <div className="flex gap-2">
                  <motion.button
                    className="rounded-full p-3 transition-colors hover:bg-gray-100"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <FilmSlate
                      className="h-6 w-6 text-gray-500"
                      weight="regular"
                    />
                  </motion.button>
                  <motion.button
                    className="rounded-full p-3 transition-colors hover:bg-gray-100"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <Microphone
                      className="h-6 w-6 text-gray-500"
                      weight="regular"
                    />
                  </motion.button>
                </div>
                <motion.button
                  onClick={handleSend}
                  disabled={!inputValue.trim() || isPending}
                  className={`flex items-center gap-2 rounded-full px-6 py-3 transition-all ${inputValue.trim() && !isPending
                    ? 'bg-gray-900 text-white shadow-lg hover:bg-brand'
                    : 'cursor-not-allowed bg-gray-100 text-gray-400'
                    }`}
                  whileHover={inputValue.trim() && !isPending ? { scale: 1.05 } : {}}
                  whileTap={inputValue.trim() && !isPending ? { scale: 0.95 } : {}}
                >
                  {isPending ? (
                    <Sparkle className="h-5 w-5 animate-spin" weight="fill" />
                  ) : (
                    <PaperPlaneRight className="h-5 w-5" weight="fill" />
                  )}
                  <span className="text-base font-medium">
                    {isPending ? 'Creating...' : 'Generate'}
                  </span>
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
