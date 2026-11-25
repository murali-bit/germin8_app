import React from 'react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
  className?: string;
  invert?: boolean;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  eyebrow,
  title,
  description,
  align = 'center',
  className,
  invert = false,
}) => {
  return (
    <div
      className={cn(
        'max-w-3xl mb-12 md:mb-16',
        align === 'center' ? 'mx-auto text-center' : 'text-left',
        className
      )}
    >
      {eyebrow && (
        <div
          className={cn(
            'inline-flex items-center gap-2 text-xs font-semibold tracking-wider uppercase mb-3 px-3 py-1 rounded-full border',
            invert
              ? 'text-blue-sky bg-blue-sky/10 border-blue-sky/20'
              : 'text-blue-primary bg-blue-light border-blue-sky/30'
          )}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-primary animate-pulse" />
          {eyebrow}
        </div>
      )}
      <h2
        className={cn(
          'text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight font-display mb-4',
          invert ? 'text-white' : 'text-navy'
        )}
      >
        {title}
      </h2>
      {description && (
        <p
          className={cn(
            'text-base md:text-lg leading-relaxed',
            invert ? 'text-slate-300' : 'text-text-secondary'
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
};
