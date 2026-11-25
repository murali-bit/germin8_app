import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Play, Pause, SkipForward } from 'lucide-react';
import { SOLUTIONS, type DemoKey } from '@/data/solutions';
import {
  MappingScreen,
  ValidationScreen,
  TrialBalanceScreen,
  CinLookupScreen,
  ReviewScreen,
  FilingTrackerScreen,
} from '@/components/product/Screens';
import {
  TaskBoardScreen,
  ComplianceCalendarScreen,
  FsMappingScreen,
  FsPreviewScreen,
} from '@/components/product/MoreScreens';
import { cn } from '@/lib/utils';

/**
 * Real recordings: when you have a screen recording for a tool, add its path
 * here (for example migration: '/videos/tally-to-zoho.mp4') and the player
 * shows the video instead of the animated walkthrough.
 */
const VIDEO_SOURCES: Partial<Record<DemoKey, string>> = {};

const SCENE_MS = 4200;

const DEMOS: Record<DemoKey, { caption: string; node: React.ReactNode }[]> = {
  migration: [
    { caption: 'Tally groups are mapped to Zoho Books account types', node: <MappingScreen /> },
    { caption: 'Errors are listed before anything is imported', node: <ValidationScreen /> },
    { caption: 'The two trial balances are compared ledger by ledger', node: <TrialBalanceScreen /> },
  ],
  office: [
    { caption: 'Recurring tasks are created for every client', node: <TaskBoardScreen /> },
    { caption: 'Every due date sits on one calendar', node: <ComplianceCalendarScreen /> },
  ],
  roc: [
    { caption: 'Start with the CIN. Directors are checked first', node: <CinLookupScreen /> },
    { caption: 'Figures are shown next to the source document', node: <ReviewScreen /> },
    { caption: 'Track every filing for the season in one list', node: <FilingTrackerScreen /> },
  ],
  statements: [
    { caption: 'Each ledger is placed under a statement head', node: <FsMappingScreen /> },
    { caption: 'Statements and notes are drafted and stay linked', node: <FsPreviewScreen /> },
  ],
};

const TABS = SOLUTIONS.filter((s) => s.demo).map((s) => ({ key: s.demo as DemoKey, label: s.name, icon: s.icon }));

export const ToolDemo: React.FC<{ only?: DemoKey; className?: string }> = ({ only, className }) => {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<DemoKey>(only ?? 'migration');
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(!reduce);

  const scenes = DEMOS[tab];
  const video = VIDEO_SOURCES[tab];

  useEffect(() => {
    if (!playing || video) return;
    const t = setTimeout(() => setScene((s) => (s + 1) % scenes.length), SCENE_MS);
    return () => clearTimeout(t);
  }, [playing, scene, scenes.length, video]);

  const pick = (k: DemoKey) => {
    setTab(k);
    setScene(0);
  };

  return (
    <div className={className}>
      {!only && (
        <div className="mb-6 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Tool demos">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => pick(t.key)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[14px] font-semibold font-display transition-all',
                tab === t.key
                  ? 'bg-ink-950 text-white shadow-[0_12px_24px_-12px_rgba(23,23,22,0.6)]'
                  : 'bg-white text-ink-700 ring-1 ring-ink-200 hover:ring-ink-400'
              )}
            >
              <t.icon className={cn('w-4 h-4', tab === t.key ? 'text-mustard-400' : 'text-ink-500')} strokeWidth={1.75} />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Player */}
      <div className="rounded-[28px] bg-gradient-to-br from-white via-ink-50/60 to-ink-100/70 ring-1 ring-ink-100 p-3 sm:p-6 shadow-[0_40px_80px_-40px_rgba(23,23,22,0.35)]">
        {video ? (
          <video src={video} controls playsInline className="w-full rounded-2xl bg-ink-950" />
        ) : (
          <>
            <div className="relative min-h-[300px] sm:min-h-[400px] flex items-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${tab}-${scene}`}
                  initial={{ opacity: 0, y: 16, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.985 }}
                  transition={{ duration: 0.4 }}
                  className="w-full max-w-3xl mx-auto"
                >
                  {scenes[scene].node}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Controls */}
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white ring-1 ring-ink-200 px-3 py-2.5">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? 'Pause demo' : 'Play demo'}
                className="w-10 h-10 rounded-full bg-mustard-500 hover:bg-mustard-400 text-ink-950 flex items-center justify-center shrink-0"
              >
                {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
              </button>
              <div className="min-w-0 flex-1">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={`${tab}-${scene}-c`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="truncate text-[14px] font-medium text-ink-950"
                  >
                    {scenes[scene].caption}
                  </motion.p>
                </AnimatePresence>
                <div className="mt-2 flex gap-1.5">
                  {scenes.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={`Go to step ${i + 1}`}
                      onClick={() => setScene(i)}
                      className="h-1.5 flex-1 rounded-full bg-ink-100 overflow-hidden"
                    >
                      {i < scene && <span className="block h-full w-full bg-mustard-500" />}
                      {i === scene && (
                        <motion.span
                          key={`${tab}-${scene}-${playing}`}
                          className="block h-full bg-mustard-500"
                          initial={{ width: '0%' }}
                          animate={{ width: playing ? '100%' : '35%' }}
                          transition={{ duration: playing ? SCENE_MS / 1000 : 0.2, ease: 'linear' }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <span className="hidden sm:block text-[12px] tabular-nums text-ink-500">
                {scene + 1} / {scenes.length}
              </span>
              <button
                type="button"
                onClick={() => setScene((s) => (s + 1) % scenes.length)}
                aria-label="Next step"
                className="w-9 h-9 rounded-full ring-1 ring-ink-200 hover:ring-ink-400 text-ink-700 flex items-center justify-center shrink-0"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
