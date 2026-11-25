import React from 'react';
import { Link } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'navy' | 'white';
  size?: 'sm' | 'md' | 'lg';
  href?: string;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      href,
      icon: Icon,
      iconPosition = 'right',
      loading = false,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-primary/40 disabled:opacity-50 disabled:pointer-events-none rounded-lg select-none';

    const variants = {
      primary:
        'bg-blue-primary text-white hover:bg-[#292824] active:bg-[#292824] shadow-sm hover:shadow-md hover:shadow-blue-primary/20',
      secondary:
        'bg-blue-light text-blue-primary hover:bg-[#E7E6E3] active:bg-[#D4D3CF]',
      outline:
        'border border-slate-300 bg-white text-navy hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100',
      ghost:
        'text-text-primary hover:bg-slate-100 active:bg-slate-200',
      navy:
        'bg-navy text-white hover:bg-[#292824] active:bg-[#1A1917] shadow-sm',
      white:
        'bg-white text-navy hover:bg-slate-100 active:bg-slate-200 shadow-sm',
    };

    const sizes = {
      sm: 'text-xs px-3 py-1.5 gap-1.5 h-8',
      md: 'text-sm px-4 py-2 gap-2 h-10',
      lg: 'text-base px-6 py-3 gap-2.5 h-12',
    };

    const content = (
      <>
        {loading && (
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
        )}
        {!loading && Icon && iconPosition === 'left' && (
          <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} />
        )}
        <span>{children}</span>
        {!loading && Icon && iconPosition === 'right' && (
          <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} />
        )}
      </>
    );

    if (href) {
      if (href.startsWith('http')) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(baseStyles, variants[variant], sizes[size], className)}
          >
            {content}
          </a>
        );
      }
      return (
        <Link
          to={href}
          className={cn(baseStyles, variants[variant], sizes[size], className)}
        >
          {content}
        </Link>
      );
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {content}
      </button>
    );
  }
);

Button.displayName = 'Button';
