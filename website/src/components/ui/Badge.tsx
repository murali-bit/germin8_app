import React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'blue' | 'navy' | 'green' | 'amber' | 'slate' | 'outline';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'blue',
  size = 'sm',
  children,
  ...props
}) => {
  const variants = {
    blue: 'bg-blue-light text-blue-primary border-blue-sky/30',
    navy: 'bg-navy/10 text-navy border-navy/20',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    outline: 'bg-transparent text-text-secondary border-slate-300',
  };

  const sizes = {
    sm: 'text-xs px-2.5 py-0.5 rounded-full font-medium border',
    md: 'text-sm px-3 py-1 rounded-full font-medium border',
  };

  return (
    <span className={cn('inline-flex items-center gap-1.5', variants[variant], sizes[size], className)} {...props}>
      {children}
    </span>
  );
};
