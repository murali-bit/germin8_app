import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeroProps {
  breadcrumbs?: BreadcrumbItem[];
  badge?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  align?: 'left' | 'center';
  className?: string;
}

/** Light page header used by the content pages. */
export const PageHero: React.FC<PageHeroProps> = ({
  breadcrumbs,
  badge,
  title,
  description,
  actions,
  children,
  align = 'left',
  className,
}) => {
  return (
    <div className={cn('bg-white pt-28 pb-14 md:pt-36 md:pb-20 border-b border-ink-200', className)}>
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-6">
            <ol className={cn('flex flex-wrap items-center gap-1.5 text-sm text-ink-500', align === 'center' && 'justify-center')}>
              <li>
                <Link to="/" className="hover:text-ink-950 transition-colors">
                  Home
                </Link>
              </li>
              {breadcrumbs.map((crumb, idx) => (
                <li key={idx} className="flex items-center gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5 text-ink-300" />
                  {crumb.href ? (
                    <Link to={crumb.href} className="hover:text-ink-950 transition-colors">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-ink-950 font-medium">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className={cn('max-w-3xl', align === 'center' ? 'mx-auto text-center' : 'text-left')}>
          {badge && <p className="text-sm font-semibold font-display text-mustard-700 mb-3">{badge}</p>}
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight font-display text-ink-950 leading-[1.1]">
            {title}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-500">{description}</p>
          {actions && (
            <div className={cn('mt-8 flex flex-wrap items-center gap-3', align === 'center' && 'justify-center')}>
              {actions}
            </div>
          )}
        </div>

        {children && <div className="mt-12">{children}</div>}
      </div>
    </div>
  );
};
