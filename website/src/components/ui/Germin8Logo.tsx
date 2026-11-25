import React from 'react';

interface Germin8LogoProps {
  className?: string;
  iconOnly?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'dark' | 'light';
}

/** Wordmark: "Germin" followed by the mustard infinity mark used on germin8.in. */
export const Germin8Logo: React.FC<Germin8LogoProps> = ({
  className = '',
  iconOnly = false,
  size = 'md',
  variant = 'dark',
}) => {
  const h = { sm: 20, md: 24, lg: 32 }[size];
  const text = variant === 'light' ? '#FFFFFF' : '#101623';

  const Mark = (
    <svg height={h * 0.62} viewBox="0 0 40 20" fill="none" aria-hidden className="shrink-0">
      <path
        d="M10 3.5C5.9 3.5 3 6.4 3 10s2.9 6.5 7 6.5c3.6 0 6-2.6 10-6.5 4-3.9 6.4-6.5 10-6.5 4.1 0 7 2.9 7 6.5s-2.9 6.5-7 6.5c-3.6 0-6-2.6-10-6.5-4-3.9-6.4-6.5-10-6.5Z"
        stroke="#D4A216"
        strokeWidth="3.4"
        strokeLinejoin="round"
      />
    </svg>
  );

  if (iconOnly) return <span className={className}>{Mark}</span>;

  return (
    <span className={`inline-flex items-center gap-[2px] ${className}`} aria-label="Germin8">
      <span
        className="font-display font-extrabold tracking-[-0.03em] leading-none"
        style={{ color: text, fontSize: h }}
      >
        Germin
      </span>
      {Mark}
    </span>
  );
};
