import React, { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

const EASE = [0.21, 0.47, 0.32, 0.98] as const;

/** Fades and slides content in the first time it scrolls into view. */
export const Reveal: React.FC<{
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}> = ({ children, delay = 0, y = 28, className }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.65, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
};

/**
 * Card that tilts in 3D towards the pointer. Children can sit on raised
 * layers by adding `style={{ transform: 'translateZ(40px)' }}`.
 */
export const TiltCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  max?: number;
}> = ({ children, className, max = 9 }) => {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [max, -max]), { stiffness: 220, damping: 22 });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-max, max]), { stiffness: 220, damping: 22 });

  const onMove = (e: React.MouseEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => {
    px.set(0);
    py.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d', transformPerspective: 1000 }}
      className={cn('will-change-transform', className)}
    >
      {children}
    </motion.div>
  );
};

/**
 * Soft gold light that slowly drifts behind a section. Replaces the old grid
 * backgrounds. Purely decorative; still for people who prefer reduced motion.
 */
export const AuroraGlow: React.FC<{ variant?: 'light' | 'dark'; fade?: boolean; className?: string }> = ({
  variant = 'light',
  fade = true,
  className,
}) => {
  const reduce = useReducedMotion();
  const blobs =
    variant === 'light'
      ? [
          { c: 'bg-ink-100', s: 'w-[620px] h-[620px]', pos: 'right-[-10%] top-[-20%]', x: [0, -60, 20, 0], y: [0, 40, -20, 0], d: 18 },
          { c: 'bg-mustard-400/10', s: 'w-[520px] h-[520px]', pos: 'left-[-12%] top-[10%]', x: [0, 50, -30, 0], y: [0, -30, 30, 0], d: 22 },
          { c: 'bg-[#EEF0F3]', s: 'w-[460px] h-[460px]', pos: 'right-[20%] bottom-[-30%]', x: [0, 40, -40, 0], y: [0, -40, 10, 0], d: 26 },
        ]
      : [
          { c: 'bg-white/10', s: 'w-[520px] h-[520px]', pos: 'right-[-10%] top-[-40%]', x: [0, -50, 20, 0], y: [0, 40, -10, 0], d: 16 },
          { c: 'bg-mustard-500/15', s: 'w-[440px] h-[440px]', pos: 'left-[-10%] bottom-[-50%]', x: [0, 40, -20, 0], y: [0, -30, 20, 0], d: 20 },
        ];

  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {blobs.map((b, i) => (
        <motion.div
          key={i}
          className={cn('absolute rounded-full blur-3xl', b.c, b.s, b.pos)}
          animate={reduce ? undefined : { x: b.x, y: b.y, scale: [1, 1.08, 0.96, 1] }}
          transition={{ duration: b.d, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      {/* Fade to white at the bottom so sections join cleanly */}
      {variant === 'light' && fade && <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-white" />}
    </div>
  );
};

/** Endless horizontal scroller. Pauses for people who prefer reduced motion. */
export const Marquee: React.FC<{ children: React.ReactNode; duration?: number; className?: string }> = ({
  children,
  duration = 28,
  className,
}) => {
  const reduce = useReducedMotion();
  return (
    <div
      className={cn(
        'overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]',
        className
      )}
    >
      <motion.div
        className="flex w-max gap-12 pr-12"
        animate={reduce ? undefined : { x: ['0%', '-50%'] }}
        transition={{ duration, ease: 'linear', repeat: Infinity }}
      >
        {children}
        {children}
      </motion.div>
    </div>
  );
};
