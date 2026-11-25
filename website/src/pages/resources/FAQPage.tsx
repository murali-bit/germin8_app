import React, { useEffect, useState } from 'react';
import { HelpCircle, MessageCircle } from 'lucide-react';
import { PageIntro, Container, Btn } from '@/components/product/ProductBlocks';
import { Reveal } from '@/components/motion/Motion';
import { FAQAccordion } from '@/components/ui/FAQAccordion';
import { GENERAL_FAQS, TALLY_ZOHO_FAQS, MCA_FAQS } from '@/data/faqData';
import { cn } from '@/lib/utils';

const GROUPS = [
  { key: 'general', label: 'About Germin8', items: GENERAL_FAQS },
  { key: 'tally', label: 'Tally to Zoho', items: TALLY_ZOHO_FAQS },
  { key: 'mca', label: 'MCA and ROC forms', items: MCA_FAQS },
] as const;

type GroupKey = (typeof GROUPS)[number]['key'];

export const FAQPage: React.FC = () => {
  const [active, setActive] = useState<GroupKey>('general');
  const group = GROUPS.find((g) => g.key === active) ?? GROUPS[0];

  useEffect(() => {
    document.title = 'FAQ · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="FAQ"
        eyebrowIcon={HelpCircle}
        title="Questions people"
        accent="ask us"
        description="Short, straight answers about what Germin8 does and how the tools work."
      />

      <Container className="pb-20">
        <div className="max-w-3xl mx-auto">
          <div role="tablist" aria-label="Question groups" className="flex flex-wrap justify-center gap-2">
            {GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                role="tab"
                aria-selected={active === g.key}
                onClick={() => setActive(g.key)}
                className={cn(
                  'h-10 px-4 rounded-full text-[14px] font-semibold font-display transition-colors',
                  active === g.key
                    ? 'bg-ink-950 text-white'
                    : 'bg-white text-ink-700 ring-1 ring-ink-200 hover:ring-ink-400'
                )}
              >
                {g.label}
                <span className={cn('ml-2 text-[12px]', active === g.key ? 'text-ink-300' : 'text-ink-400')}>
                  {g.items.length}
                </span>
              </button>
            ))}
          </div>

          <Reveal key={group.key} className="mt-8" y={12}>
            <FAQAccordion items={group.items} />
          </Reveal>

          <Reveal>
            <div className="mt-12 flex flex-col sm:flex-row sm:items-center gap-5 rounded-2xl bg-ink-50 ring-1 ring-ink-200 p-6 sm:p-7">
              <span className="w-12 h-12 rounded-full bg-white ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center shrink-0">
                <MessageCircle className="w-5 h-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="flex-1">
                <h2 className="text-lg font-bold font-display text-ink-950">Still have a question?</h2>
                <p className="mt-1 text-[15px] leading-relaxed text-ink-700">
                  Write to us and a person on the team will reply.
                </p>
              </div>
              <Btn to="/contact" size="md" arrow>
                Ask us
              </Btn>
            </div>
          </Reveal>
        </div>
      </Container>
    </div>
  );
};
