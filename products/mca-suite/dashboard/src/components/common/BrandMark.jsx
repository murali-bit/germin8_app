import clsx from 'clsx'

// Germin8 wordmark: gold hexagon mark + ink wordmark.
export function GoldMark({ size = 32, className }) {
  return (
    <span
      className={clsx('inline-flex items-center justify-center rounded-lg bg-gold-50 border border-gold-200 shrink-0', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        <path d="M12 2.5 3.8 7.25v9.5L12 21.5l8.2-4.75v-9.5z" fill="#A67A24" />
        <path d="M12 8l3.5 2v4L12 16l-3.5-2v-4z" fill="#F6ECCF" />
      </svg>
    </span>
  )
}

export default function BrandMark({ size = 32, subtitle, className }) {
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      <GoldMark size={size} />
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-ink">
          Germin<span className="text-gold-600">8</span>
        </span>
        {subtitle && <span className="block text-[11px] text-ink-subtle">{subtitle}</span>}
      </span>
    </span>
  )
}
