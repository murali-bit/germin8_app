import React from 'react';
import { LucideIcon, ArrowUpRight } from 'lucide-react';
import { Card } from './Card';
import { cn } from '@/lib/utils';

export interface MetricCardProps {
  label: string;
  value: string;
  description: string;
  delta?: string;
  icon?: LucideIcon;
  variant?: 'default' | 'navy' | 'blue';
  className?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  description,
  delta,
  icon: Icon,
  variant = 'default',
  className,
}) => {
  return (
    <Card
      variant={variant === 'navy' ? 'navy' : 'default'}
      className={cn('p-6 relative overflow-hidden', className)}
    >
      <div className="flex items-center justify-between mb-4">
        <span
          className={cn(
            'text-xs font-semibold uppercase tracking-wider',
            variant === 'navy' ? 'text-blue-sky' : 'text-slate-500'
          )}
        >
          {label}
        </span>
        {Icon && (
          <span
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center',
              variant === 'navy' ? 'bg-blue-primary/20 text-blue-sky' : 'bg-blue-light text-blue-primary'
            )}
          >
            <Icon className="w-5 h-5" />
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <div
          className={cn(
            'text-3xl sm:text-4xl font-extrabold font-display tracking-tight',
            variant === 'navy' ? 'text-white' : 'text-navy'
          )}
        >
          {value}
        </div>
        {delta && (
          <span className="inline-flex items-center text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            <ArrowUpRight className="w-3 h-3 mr-0.5" />
            {delta}
          </span>
        )}
      </div>

      <p
        className={cn(
          'text-xs sm:text-sm leading-relaxed',
          variant === 'navy' ? 'text-slate-300' : 'text-text-secondary'
        )}
      >
        {description}
      </p>
    </Card>
  );
};
