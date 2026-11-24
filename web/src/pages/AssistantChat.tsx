import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, getToken } from '../api';

interface Msg { id: number; role: 'user' | 'assistant'; content: string; error?: string }
const SUGGESTIONS = ['chat.s1', 'chat.s2', 'chat.s3', 'chat.s4', 'chat.s5', 'chat.s6'];

/** Minimal, safe markdown: **bold**, `code`, "- " / "1. " lists, paragraphs. Everything is rendered as React text (no HTML injection). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong>
      : p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : <Fragment key={i}>{p}</Fragment>);
}
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []; let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => { if (list) { const L = list; blocks.push(L.ordered ? <ol key={blocks.length}>{L.items.map((x, i) => <li key={i}>{inline(x)}</li>)}</ol> : <ul key={blocks.length}>{L.items.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); list = null; } };
  for (const line of text.split('\n')) {
    const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) { const ordered = !!ol; if (list && list.ordered !== ordered) flush(); list ??= { ordered, items: [] }; list.items.push((ul ?? ol)![1]); continue; }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#{1,6}\s+/, ''))}</p>);
  }
  flush();
  return <>{blocks}</>;
}

export default function AssistantChat() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const abort = useRef<AbortController | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const nextId = useRef(1);

  useEffect(() => { if (open && enabled === null) api<{ enabled: boolean }>('/api/assistant/status').then((r) => setEnabled(r.enabled)).catch(() => setEnabled(true)); }, [open, enabled]);
  useEffect(() => { if (open) setTimeout(() => area.current?.focus(), 50); }, [open]);
  useEffect(() => { const k = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; if (open) { window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); } }, [open]);
  useEffect(() => { if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs, tool]);
  useEffect(() => { const a = area.current; if (a) { a.style.height = 'auto'; a.style.height = `${Math.min(a.scrollHeight, 160)}px`; } }, [input, open]);
  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(async (text: string) => {
    text = text.trim(); if (!text || busy) return;
    const history = [...msgs.filter((m) => !m.error), { id: nextId.current++, role: 'user' as const, content: text }];
    const reply: Msg = { id: nextId.current++, role: 'assistant', content: '' };
    setMsgs([...msgs, history[history.length - 1], reply]); setInput(''); setBusy(true); setTool(null); stick.current = true;
    const ac = new AbortController(); abort.current = ac;
    const patch = (fn: (m: Msg) => Msg) => setMsgs((cur) => cur.map((m) => (m.id === reply.id ? fn(m) : m)));
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ messages: history.slice(-20).map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!line.startsWith('data: ')) continue;
          const e = JSON.parse(line.slice(6));
          if (e.type === 'text') { setTool(null); patch((m) => ({ ...m, content: m.content + e.text })); }
          else if (e.type === 'tool') setTool(e.name);
          else if (e.type === 'error') patch((m) => ({ ...m, error: e.code === 'not_configured' ? t('chat.notSetup') : e.message || t('chat.failed') }));
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') patch((m) => ({ ...m, error: t('chat.failed') }));
    } finally { setBusy(false); setTool(null); abort.current = null; }
  }, [busy, msgs, t]);

  const stop = () => abort.current?.abort();
  const reset = () => { abort.current?.abort(); setMsgs([]); setInput(''); setBusy(false); setTool(null); };
  // Enter sends; Shift+Enter adds a line. Ignore Enter while an input method (Hindi, Tamil, ...) is composing text.
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } };

  return (
    <>
      {!open && (
        <button className="chat-bubble" onClick={() => setOpen(true)} aria-label={t('chat.open')} title={t('chat.open')}>
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.6A8 8 0 1 1 21 12z" /><path d="M9 11h.01M12 11h.01M15 11h.01" strokeWidth="2.6" /></svg>
        </button>
      )}
      {open && (
        <div className="chat" role="dialog" aria-label={t('chat.title')}>
          <div className="chat-head">
            <div className="chat-title"><span className="chat-logo" aria-hidden="true">▲</span>{t('chat.title')}</div>
            <div className="row">
              <button className="icon-btn" onClick={reset} disabled={msgs.length === 0} aria-label={t('chat.new')} title={t('chat.new')}>＋</button>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label={t('chat.close')} title={t('chat.close')}>✕</button>
            </div>
          </div>
          <div className="chat-body" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
            {enabled === false && <div className="chat-banner">{t('chat.notSetup')}</div>}
            {msgs.length === 0 ? (
              <div className="chat-empty">
                <div className="chat-hello">{t('chat.hello')}</div>
                <p className="muted">{t('chat.sub')}</p>
                <div className="chat-sugs">{SUGGESTIONS.map((k) => <button key={k} onClick={() => send(t(k))}>{t(k)}</button>)}</div>
              </div>
            ) : msgs.map((m, idx) => (
              <div key={m.id} className={`msg ${m.role}`}>
                {m.role === 'assistant' && <span className="avatar" aria-hidden="true">▲</span>}
                <div className="bubble" dir="auto">
                  {m.role === 'user' ? m.content : <>
                    {m.content ? <Markdown text={m.content} /> : (busy && idx === msgs.length - 1 && !m.error && <span className="typing" aria-label="…"><i /><i /><i /></span>)}
                    {busy && idx === msgs.length - 1 && tool && <div className="toolnote">{t(`chat.tool.${tool}`, { defaultValue: '…' })}</div>}
                    {m.error && <div className="chat-err">{m.error}</div>}
                  </>}
                </div>
              </div>
            ))}
          </div>
          <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <div className="composer">
              <textarea ref={area} rows={1} value={input} dir="auto" onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} placeholder={t('chat.placeholder')} aria-label={t('chat.placeholder')} maxLength={4000} />
              {busy
                ? <button type="button" className="send stop" onClick={stop} aria-label={t('chat.stop')} title={t('chat.stop')}>■</button>
                : <button type="submit" className="send" disabled={!input.trim()} aria-label={t('chat.send')} title={t('chat.send')}>↑</button>}
            </div>
            <div className="chat-foot muted">{t('chat.disclaimer')}</div>
          </form>
        </div>
      )}
    </>
  );
}
