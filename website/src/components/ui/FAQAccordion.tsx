import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface FAQItem {
  question: string;
  answer: string | React.ReactNode;
  category?: string;
}

export interface FAQAccordionProps {
  items: FAQItem[];
  defaultOpenIndex?: number;
  className?: string;
}

export const FAQAccordion: React.FC<FAQAccordionProps> = ({ items, defaultOpenIndex = 0, className }) => {
  const [openIndexes, setOpenIndexes] = useState<number[]>(defaultOpenIndex >= 0 ? [defaultOpenIndex] : []);

  const toggle = (i: number) =>
    setOpenIndexes((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  return (
    <div className={cn('divide-y divide-ink-200 rounded-2xl bg-white ring-1 ring-ink-200', className)}>
      {items.map((item, index) => {
        const isOpen = openIndexes.includes(index);
        return (
          <div key={index}>
            <button
              type="button"
              onClick={() => toggle(index)}
              className="w-full text-left px-6 py-5 flex items-start justify-between gap-6 focus-visible:outline-none focus-visible:bg-ink-50"
              aria-expanded={isOpen}
            >
              <span className="text-[16px] font-semibold font-display text-ink-950">{item.question}</span>
              <Plus
                className={cn('w-5 h-5 mt-0.5 shrink-0 text-ink-500 transition-transform', isOpen && 'rotate-45')}
                aria-hidden
              />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-6 pb-6 -mt-1 text-[15px] leading-relaxed text-ink-500 max-w-3xl">
                    {item.answer}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};
