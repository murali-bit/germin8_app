import { Loader2 } from 'lucide-react'
import { GoldMark } from '../common/BrandMark'

export default function LoadingSpinner({ fullscreen = true, size = 24 }) {
  if (fullscreen) {
    return (
      <div className="fixed inset-0 bg-page flex items-center justify-center z-50">
        <div className="flex flex-col items-center gap-4">
          <GoldMark size={48} />
          <Loader2 className="animate-spin text-gold-600" size={20} />
        </div>
      </div>
    )
  }

  return <Loader2 className="animate-spin text-gold-600" size={size} />
}
