import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/utils'

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}

const styles = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  error: 'bg-rose-50 border-rose-200 text-rose-700',
  info: 'bg-sky-50 border-sky-200 text-sky-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-700',
}

const iconStyles = {
  success: 'text-emerald-600',
  error: 'text-rose-600',
  info: 'text-sky-600',
  warning: 'text-amber-600',
}

export function Alert({ type = 'info', title, message, onClose, className }) {
  const Icon = icons[type]

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn(
        'flex items-start gap-3 p-4 rounded-lg border text-sm',
        styles[type],
        className
      )}
    >
      <Icon size={16} className={cn('mt-0.5 shrink-0', iconStyles[type])} />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold mb-0.5">{title}</p>}
        {message && <p className="opacity-80">{message}</p>}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
        >
          <X size={14} />
        </button>
      )}
    </motion.div>
  )
}

export function Badge({ children, variant = 'gray', className }) {
  const variants = {
    gray: 'bg-page text-ink-muted border-line',
    gold: 'bg-gold-50 text-gold-800 border-gold-200',
    indigo: 'bg-gold-50 text-gold-800 border-gold-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    purple: 'bg-gold-100 text-gold-900 border-gold-200',
    blue: 'bg-sky-50 text-sky-700 border-sky-200',
  }

  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full border',
      variants[variant],
      className
    )}>
      {children}
    </span>
  )
}

export function Tooltip({ children, content, side = 'top' }) {
  return (
    <div className="relative group inline-flex">
      {children}
      <div className={cn(
        'absolute z-50 px-2.5 py-1.5 text-xs font-medium text-ink bg-white border border-line shadow-pop rounded-lg',
        'opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap',
        side === 'top' && 'bottom-full left-1/2 -translate-x-1/2 mb-2',
        side === 'bottom' && 'top-full left-1/2 -translate-x-1/2 mt-2',
        side === 'left' && 'right-full top-1/2 -translate-y-1/2 mr-2',
        side === 'right' && 'left-full top-1/2 -translate-y-1/2 ml-2',
      )}>
        {content}
      </div>
    </div>
  )
}

