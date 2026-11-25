import { useState, useRef, useEffect, useMemo } from 'react';
import { Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  FileText,
  ScanLine,
  FolderOpen,
  MessageCircle,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  Upload,
  Search,
  Filter,
  Send,
  Paperclip,
  ChevronRight,
  ChevronDown,
  FileImage,
  Star,
  Zap,
  Eye,
  Download,
  Trash2,
  ArrowUpRight,
  Bot,
  X,
  Database,
  RefreshCw,
  Check,
  Building2,
  HelpCircle,
  Sliders,
  Calendar,
  Lock,
  ExternalLink,
  ShieldCheck,
  CheckCheck,
  Copy,
  Layers,
  PenLine,
  Puzzle,
} from 'lucide-react';
import DashboardLayout from '../../../layouts/DashboardLayout';
import McaFormsHub from '../../../components/McaFormsHub';
import AiScanner from '../../../components/scanner/AiScanner';
import ExtensionSetup from '../../../components/ExtensionSetup';
import { MCA_FORMS } from '../../../data/mcaForms.js';
import { loadDrafts, draftProgress } from '../../../lib/drafts.js';
import clsx from 'clsx';

const NAV_ITEMS = [
  { label: 'Overview', icon: LayoutDashboard, path: '/dashboard/user/overview' },
  { label: 'MCA Forms Hub', icon: FileText, path: '/dashboard/user/forms' },
  { label: 'AI Scanner', icon: ScanLine, path: '/dashboard/user/scanner' },
  { label: 'Document Vault', icon: FolderOpen, path: '/dashboard/user/vault' },
  { label: 'Chrome Extension', icon: Puzzle, path: '/dashboard/user/extension' },
  { label: 'AI Support', icon: MessageCircle, path: '/dashboard/user/support' },
];

const START_FORMS = ['AOC-4', 'ADT-1', 'MGT-7', 'DIR-3-KYC'];

const INITIAL_MESSAGES = [
  {
    id: 1,
    role: 'ai',
    text: "Hello! I am Germin8's AI compliance assistant. How can I help with your MCA filings today?",
  },
];

const QUICK_QUESTIONS = [
  'AOC-4 due date & penalties?',
  'DIR-3 KYC deadline?',
  'Balance sheet balance check',
  'SRN challan generation',
];

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

// ─── OVERVIEW: start a filing + filings in progress ──────────────────────────
function Overview() {
  const navigate = useNavigate();
  const [formCode, setFormCode] = useState('AOC-4');
  const form = MCA_FORMS.find(f => f.code === formCode) || MCA_FORMS[0];

  const inProgress = useMemo(() => Object.entries(loadDrafts())
    .map(([code, d]) => {
      const f = MCA_FORMS.find(x => x.code === code);
      return f ? { form: f, updatedAt: d.updatedAt, ...draftProgress(f, d.values) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), []);

  const open = (code, mode) => navigate(`/dashboard/user/forms?form=${code}&mode=${mode}`);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-4xl">
      {/* Start a new filing */}
      <section className="bg-white border border-line rounded-xl p-6 shadow-sm space-y-5">
        <div>
          <h2 className="hero-headline text-base text-ink">Start a new filing</h2>
          <p className="text-xs text-ink-muted mt-1">Pick the form, then choose how you want to fill it.</p>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">1 · Which form?</p>
          <div className="flex flex-wrap gap-2">
            {START_FORMS.map(code => {
              const f = MCA_FORMS.find(x => x.code === code);
              if (!f) return null;
              return (
                <button key={code} onClick={() => setFormCode(code)}
                  className={clsx('px-4 py-2 rounded-xl border text-left cursor-pointer transition-all',
                    formCode === code ? 'bg-gold-50 text-gold-800 border-gold-400 ring-1 ring-gold-300' : 'bg-white text-ink border-line hover:border-gold-300 hover:bg-gold-50/40')}>
                  <span className="block text-xs font-bold font-mono">{f.shortLabel || f.code}</span>
                  <span className={clsx('block text-[11px]', formCode === code ? 'text-gold-700' : 'text-ink-muted')}>{f.name}</span>
                </button>
              );
            })}
            <button onClick={() => navigate('/dashboard/user/forms?mode=directory')}
              className="px-4 py-2 rounded-xl border border-dashed border-line-strong text-xs font-semibold text-ink-muted hover:border-gold-300 hover:text-gold-800 cursor-pointer flex items-center gap-1">
              All 58 forms <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-ink-muted mt-2">
            <span className="font-semibold text-ink">{form.code}</span> — {form.desc}
            {form.dueDate && <> · Due: {form.dueDate}</>}
            {form.penalty && <> · Late fee: {form.penalty}</>}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">2 · How do you want to fill it?</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <button onClick={() => open(formCode, 'extractor')}
              className="text-left p-4 rounded-xl border-2 border-gold-400 bg-gold-50 hover:bg-gold-100 cursor-pointer transition-colors">
              <ScanLine className="w-6 h-6 mb-2 text-gold-600" />
              <p className="text-sm font-bold text-ink">Scan a document</p>
              <p className="text-[11px] text-ink-muted mt-1">Upload the PDF or photo. Claude reads it and fills the fields; you review before filing.</p>
            </button>
            <button onClick={() => open(formCode, 'manual')}
              className="text-left p-4 rounded-xl border-2 border-line bg-white hover:border-gold-300 cursor-pointer transition-all">
              <PenLine className="w-6 h-6 mb-2 text-gold-600" />
              <p className="text-sm font-bold text-ink">Fill manually</p>
              <p className="text-[11px] text-ink-muted mt-1">Type the values section by section, with the required fields marked.</p>
            </button>
          </div>
        </div>
      </section>

      {/* Filings in progress */}
      <section className="bg-white border border-line rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-line">
          <h2 className="hero-headline text-sm text-ink">Your filings in progress</h2>
          <p className="text-[11px] text-ink-muted mt-0.5">Drafts are saved in this browser as you work.</p>
        </div>
        {inProgress.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <FileText className="w-6 h-6 text-ink-subtle mx-auto" />
            <p className="text-sm font-semibold text-ink mt-2">No filings yet</p>
            <p className="text-xs text-ink-muted mt-1">Start one above. It will show up here so you can continue later.</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {inProgress.map(item => (
              <div key={item.form.code} className="px-6 py-3.5 flex items-center gap-4">
                <span className="px-2 py-0.5 rounded-md bg-gold-50 border border-gold-200 text-[11px] font-mono font-bold text-gold-800 shrink-0">{item.form.code}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-ink truncate">{item.form.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-32 h-1.5 bg-gold-50 rounded-full overflow-hidden">
                      <div className="h-full bg-gold-600 rounded-full" style={{ width: `${item.pct}%` }} />
                    </div>
                    <span className="text-[11px] font-mono text-ink-muted">{item.pct}%</span>
                    <span className={clsx('text-[11px]', item.missingRequired ? 'text-amber-700' : 'text-emerald-700')}>
                      {item.missingRequired ? `${item.missingRequired} required missing` : 'Ready to push'}
                    </span>
                  </div>
                </div>
                <span className="text-[11px] text-ink-subtle shrink-0">{timeAgo(item.updatedAt)}</span>
                <button onClick={() => open(item.form.code, 'manual')}
                  className="px-3 py-1.5 rounded-full border border-line-strong text-xs font-semibold text-ink hover:bg-gold-50 cursor-pointer shrink-0">
                  Continue
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </motion.div>
  );
}

// ─── DOCUMENT VAULT ───────────────────────────────────────────────────────────
function DocumentVault() {
  const navigate = useNavigate();
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="bg-white border border-line rounded-xl p-10 text-center max-w-2xl shadow-sm">
      <FolderOpen className="w-8 h-8 text-ink-subtle mx-auto" />
      <p className="text-sm font-semibold text-ink mt-3">No documents yet</p>
      <p className="text-xs text-ink-muted mt-1 max-w-md mx-auto">
        Document storage isn't connected yet. To pull data out of a filing document, scan it and the extracted values go straight into the form.
      </p>
      <button onClick={() => navigate('/dashboard/user/scanner')}
        className="mt-4 px-5 py-2.5 rounded-full bg-gold-700 text-white hover:bg-gold-800 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer">
        <ScanLine className="w-4 h-4" /> Scan a document
      </button>
    </motion.div>
  );
}

// ─── AI SUPPORT CHAT TAB (Clean White Theme) ───────────────────────────────────
function AiSupportChat() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const bottomRef = useRef();

  const send = (text) => {
    if (!text.trim()) return;
    const userMsg = { id: Date.now(), role: 'user', text: text.trim() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: Date.now() + 1,
          role: 'ai',
          text: `Regarding "${text.trim()}": In MCA V3 regulations for Form AOC-4, this requirement is validated through authorized director DIN and auditor membership checks. You can use our integrated FileSure API auto-fill to resolve this without manual typing. Would you like me to pull the filing draft for you?`,
        },
      ]);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 800);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="bg-white border border-line rounded-xl flex flex-col shadow-sm"
      style={{ height: 'calc(100vh - 10rem)' }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-line flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gold-100 flex items-center justify-center text-gold-800 font-bold text-sm">G</div>
        <div>
          <p className="hero-headline text-sm text-ink">Germin8 AI Support Copilot</p>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <p className="text-xs text-ink-subtle font-google">MCA V3 Regulatory Engine · FileSure Gateway Verified</p>
          </div>
        </div>
        <Bot className="w-4 h-4 text-ink-subtle ml-auto" />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={clsx('flex gap-3 max-w-[80%]', msg.role === 'user' ? 'ml-auto flex-row-reverse' : '')}
          >
            {msg.role === 'ai' && (
              <div className="w-7 h-7 rounded-full bg-gold-100 flex items-center justify-center text-gold-800 text-xs font-bold shrink-0 mt-1">G</div>
            )}
            <div
              className={clsx(
                'px-4 py-3 rounded-xl text-xs sm:text-sm leading-relaxed font-google',
                msg.role === 'user'
                  ? 'bg-gold-700 text-white rounded-tr-xs'
                  : 'bg-page border border-line text-ink rounded-tl-xs'
              )}
            >
              {msg.text}
            </div>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick Questions */}
      <div className="px-5 pb-2 flex gap-2 overflow-x-auto no-scrollbar">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-full border border-line text-ink-muted hover:border-gold-300 hover:text-gold-800 transition-colors whitespace-nowrap cursor-pointer"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input Bar */}
      <div className="px-4 pb-4 pt-2 border-t border-line">
        <div className="flex items-center gap-2">
          <input
            className="input-field flex-1 py-2.5 text-xs"
            placeholder="Ask about AOC-4, filing due dates, FileSure API..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim()}
            className={clsx(
              'px-4 py-2.5 rounded-xl bg-gold-700 text-white hover:bg-gold-800 text-xs font-semibold cursor-pointer',
              !input.trim() && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── MAIN USER / STAFF DASHBOARD ROUTER ──────────────────────────────────────
export default function UserDashboard() {
  const [floatingChatOpen, setFloatingChatOpen] = useState(false);
  const [floatMsg, setFloatMsg] = useState('');
  const [floatHistory, setFloatHistory] = useState([
    {
      role: 'ai',
      text: 'Hi! I am your Germin8 AI compliance bot. Need help with AOC-4 fields or FileSure API submission?',
    },
  ]);

  const sendFloat = () => {
    if (!floatMsg.trim()) return;
    const text = floatMsg.trim();
    setFloatHistory((prev) => [...prev, { role: 'user', text }]);
    setFloatMsg('');
    setTimeout(() => {
      setFloatHistory((prev) => [
        ...prev,
        {
          role: 'ai',
          text: `Regarding "${text}": You can use the Form dropdown above to switch to AOC-4, run the AI Doc Extractor, or execute direct submission through our FileSure API.`,
        },
      ]);
    }, 700);
  };

  return (
    <DashboardLayout navItems={NAV_ITEMS} pageTitle="Staff Compliance Portal">
      <div className="relative min-h-full">
        <Routes>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="forms" element={<McaFormsHub />} />
          <Route path="scanner" element={<AiScanner />} />
          <Route path="vault" element={<DocumentVault />} />
          <Route path="extension" element={<ExtensionSetup />} />
          <Route path="support" element={<AiSupportChat />} />
        </Routes>

        {/* ── PERSISTENT FLOATING AI COPILOT (Clean Black & White) ── */}
        <div className="fixed bottom-6 right-6 z-40">
          <AnimatePresence>
            {floatingChatOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white rounded-xl w-80 sm:w-96 shadow-pop border border-line mb-3 flex flex-col overflow-hidden"
                style={{ height: '420px' }}
              >
                {/* Header */}
                <div className="bg-surface border-b border-line p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gold-100 text-gold-800 flex items-center justify-center font-bold text-xs">
                      G
                    </div>
                    <div>
                      <p className="hero-headline text-xs text-ink leading-none">Germin8 AI Copilot</p>
                      <p className="text-[10px] text-ink-subtle mt-0.5 font-google">Always-on Compliance Assistant</p>
                    </div>
                  </div>
                  <button onClick={() => setFloatingChatOpen(false)} className="text-ink-subtle hover:text-ink cursor-pointer" aria-label="Close chat">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Messages */}
                <div className="flex-1 p-3 overflow-y-auto space-y-2.5 text-xs font-google">
                  {floatHistory.map((m, idx) => (
                    <div
                      key={idx}
                      className={clsx(
                        'p-2.5 rounded-xl max-w-[85%] leading-relaxed',
                        m.role === 'user'
                          ? 'ml-auto bg-gold-700 text-white rounded-tr-none'
                          : 'bg-page text-ink rounded-tl-none border border-line'
                      )}
                    >
                      {m.text}
                    </div>
                  ))}
                </div>

                {/* Input */}
                <div className="p-2.5 border-t border-line flex gap-1.5 bg-page">
                  <input
                    className="input-field py-1.5 px-3 text-xs flex-1"
                    placeholder="Ask AI anything..."
                    value={floatMsg}
                    onChange={(e) => setFloatMsg(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendFloat()}
                  />
                  <button onClick={sendFloat} className="px-3 py-1.5 rounded-lg bg-gold-700 text-white hover:bg-gold-800 text-xs font-medium cursor-pointer shrink-0">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={() => setFloatingChatOpen(!floatingChatOpen)}
            className="w-12 h-12 rounded-full bg-gold-700 hover:bg-gold-800 text-white flex items-center justify-center shadow-pop hover:scale-105 active:scale-95 transition-all duration-200 border border-gold-700 cursor-pointer"
            title="Open AI Support"
          >
            {floatingChatOpen ? <X className="w-6 h-6" /> : <Bot className="w-6 h-6 text-white" />}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}