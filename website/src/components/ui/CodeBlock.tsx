import React, { useState } from 'react';
import { Copy, Check, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CodeBlockProps {
  code: string;
  language?: string;
  fileName?: string;
  className?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = 'json',
  fileName,
  className,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'rounded-xl overflow-hidden border border-slate-800 bg-[#1A1917] text-slate-200 font-mono text-xs sm:text-sm shadow-lg',
        className
      )}
    >
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#1A1917] border-b border-slate-800/80">
        <div className="flex items-center gap-2 text-slate-400">
          <Terminal className="w-3.5 h-3.5 text-blue-sky" />
          <span className="font-sans text-xs font-medium text-slate-300">
            {fileName || `${language.toUpperCase()} Schema / Preview`}
          </span>
        </div>
        <button
          onClick={handleCopy}
          type="button"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-slate-800/60 hover:bg-slate-700/80 text-slate-300 transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-4 overflow-x-auto text-slate-300 leading-relaxed font-mono">
        <pre className="selection:bg-blue-primary/40 selection:text-white">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
};
