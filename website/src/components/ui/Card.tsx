import React from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'glass' | 'interactive' | 'navy' | 'flat';
}

export const Card: React.FC<CardProps> = ({
  className,
  variant = 'default',
  children,
  ...props
}) => {
  const variants = {
    default:
      'bg-white border border-slate-200/80 rounded-xl shadow-sm',
    glass:
      'bg-white/80 backdrop-blur-md border border-white/60 rounded-xl shadow-sm',
    interactive:
      'bg-white border border-slate-200/80 rounded-xl shadow-sm hover:shadow-md hover:border-blue-primary/40 transition-all duration-200 group',
    navy:
      'bg-navy text-white border border-slate-800 rounded-xl shadow-md',
    flat:
      'bg-slate-50 border border-slate-200/60 rounded-xl',
  };

  return (
    <div className={cn(variants[variant], className)} {...props}>
      {children}
    </div>
  );
};
