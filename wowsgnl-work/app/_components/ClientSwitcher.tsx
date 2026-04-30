'use client';

import { useEffect, useState, useRef } from 'react';

type Client = {
  id: number;
  name: string;
  mode: 'drafting' | 'intelligence';
};

export default function ClientSwitcher() {
  const [clients, setClients] = useState<Client[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/clients', { cache: 'no-store' });
        if (!res.ok) return;
        const j = await res.json();
        setClients(j.clients);
        setCurrentId(j.current_id);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const switchTo = async (id: number) => {
    if (id === currentId || switching) return;
    setSwitching(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: id }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      // Hard reload so all server-rendered + cached client-side state refreshes
      // against the new cookie. router.refresh() alone misses some cases.
      window.location.reload();
    } catch (e) {
      setSwitching(false);
    }
  };

  const current = clients.find(c => c.id === currentId) || null;

  if (clients.length === 0) {
    return (
      <span className="text-xs opacity-40">Loading…</span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={switching}
        className="flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-50"
      >
        {current ? (
          <>
            <span className="font-medium">{current.name}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
                current.mode === 'intelligence'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  : 'bg-blue-500/15 text-blue-300 border border-blue-500/40'
              }`}
            >
              {current.mode}
            </span>
          </>
        ) : (
          <span className="opacity-60">— pick client —</span>
        )}
        <span className="opacity-50">▾</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 bg-neutral-950 border border-neutral-700 rounded-lg shadow-lg overflow-hidden min-w-[220px] z-50">
          {clients.map(c => (
            <button
              key={c.id}
              onClick={() => switchTo(c.id)}
              disabled={switching}
              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-neutral-900 transition ${
                c.id === currentId ? 'bg-neutral-900/60' : ''
              }`}
            >
              <span className="font-medium">{c.name}</span>
              <span className="flex items-center gap-2">
                {c.id === currentId && <span className="text-green-300">✓</span>}
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
                    c.mode === 'intelligence'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                      : 'bg-blue-500/15 text-blue-300 border border-blue-500/40'
                  }`}
                >
                  {c.mode}
                </span>
              </span>
            </button>
          ))}
          <div className="border-t border-neutral-800 px-3 py-2 text-[10px] opacity-50">
            Switching reloads the page.
          </div>
        </div>
      )}
    </div>
  );
}
