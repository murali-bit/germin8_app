import { Check } from 'lucide-react'
import BrandMark from '../components/common/BrandMark'

// Shared shell for sign-in / register: a soft gold info panel on the left and a
// white card on the warm page background on the right.
export default function AuthLayout({ title, subtitle, highlights = [], footer, topRight, children }) {
  return (
    <div className="min-h-screen w-full flex bg-page text-ink">
      {/* Left: product summary (desktop only) */}
      <aside className="relative hidden lg:flex flex-col justify-between w-[44%] max-w-[620px] p-12 xl:p-14 bg-gradient-to-br from-gold-50 via-white to-page border-r border-line overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute -right-24 -bottom-24 w-80 h-80 rounded-full bg-gold-100/60"
        />
        <div
          aria-hidden="true"
          className="absolute right-16 bottom-40 w-24 h-24 rounded-full border border-gold-200"
        />

        <div className="relative">
          <BrandMark size={36} subtitle="MCA compliance workspace" />
        </div>

        <div className="relative max-w-md py-10">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-gold-200 text-xs font-medium text-gold-800">
            <span className="w-1.5 h-1.5 rounded-full bg-gold-500" />
            Built for CA and CS firms
          </span>
          <h1 className="mt-5 text-3xl xl:text-4xl font-semibold tracking-tight leading-tight text-ink">
            File MCA forms faster, with fewer mistakes.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-muted">
            Scan the financial statements, review the extracted values, and let the Germin8 extension fill the MCA V3 forms for you.
          </p>

          {highlights.length > 0 && (
            <ul className="mt-8 space-y-3">
              {highlights.map((h) => (
                <li key={h} className="flex items-start gap-3 text-sm text-ink">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-gold-100 text-gold-700 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="relative text-xs text-ink-subtle">
          You review every value. Germin8 never submits a form on MCA for you.
        </p>
      </aside>

      {/* Right: form card */}
      <main className="flex-1 flex flex-col min-h-screen">
        <div className="flex items-center justify-between px-6 sm:px-10 h-16">
          <span className="lg:hidden"><BrandMark size={30} /></span>
          <span className="hidden lg:block" />
          {topRight}
        </div>

        <div className="flex-1 flex items-center justify-center px-4 sm:px-6 pb-10">
          <div className="w-full max-w-[440px]">
            <div className="bg-surface border border-line rounded-xl shadow-card p-6 sm:p-8">
              <h2 className="text-2xl font-semibold tracking-tight text-ink">{title}</h2>
              {subtitle && <p className="text-sm text-ink-muted mt-1.5">{subtitle}</p>}
              <div className="mt-6">{children}</div>
            </div>
            {footer && <div className="mt-5 text-center text-xs text-ink-muted">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  )
}
