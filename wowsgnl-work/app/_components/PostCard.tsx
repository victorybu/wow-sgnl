'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import RatingForm from './RatingForm';

type Post = {
  id: number;
  position: number | null;
  content: string;
  shipped: boolean;
  shipped_at: string | null;
  feedback: 'signal' | 'noise' | null;
  feedback_reason: string | null;
  feedback_note: string | null;
};

export default function PostCard({ post }: { post: Post }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shippingOpen, setShippingOpen] = useState(false);
  const [tweetUrl, setTweetUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(post.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers / file:// — fall back to a hidden textarea select+exec
      const ta = document.createElement('textarea');
      ta.value = post.content;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const saveEdit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setEditing(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmShip = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shipped: true, shipped_tweet_url: tweetUrl.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setShippingOpen(false);
      setTweetUrl('');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const unship = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shipped: false }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const variantLabel = `Variant ${typeof post.position === 'number' ? post.position + 1 : '?'}`;
  const charCount = post.content.length;

  return (
    <div className={`border rounded p-3 space-y-2 ${
      post.shipped
        ? 'border-green-500/50 bg-green-500/5'
        : post.feedback === 'signal'
          ? 'border-green-500/30'
          : post.feedback === 'noise'
            ? 'border-red-500/30 bg-red-500/5 opacity-70'
            : 'border-neutral-800'
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium opacity-70">{variantLabel}</span>
        <div className="flex items-center gap-2 text-xs">
          <span className="opacity-40">{charCount} chars</span>
          {post.shipped && (
            <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/40">
              ✓ shipped
            </span>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={Math.max(3, draft.split('\n').length + 1)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm font-mono"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={saveEdit}
              disabled={saving || draft.trim() === post.content.trim()}
              className="text-xs px-3 py-1.5 rounded bg-white text-black font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save edit'}
            </button>
            <button
              onClick={() => { setDraft(post.content); setEditing(false); setError(null); }}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500"
            >
              Cancel
            </button>
            <span className="text-xs opacity-40 ml-auto">{draft.length} chars</span>
          </div>
        </div>
      ) : (
        <pre className="text-sm whitespace-pre-wrap font-mono bg-neutral-950 border border-neutral-900 rounded px-3 py-2">
{post.content}
        </pre>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500"
          >
            Edit
          </button>
        )}
        <button
          onClick={() => post.shipped ? unship() : setShippingOpen(true)}
          disabled={saving}
          className={`text-xs px-2 py-1 rounded border ${
            post.shipped
              ? 'border-green-500/60 text-green-200 bg-green-500/10'
              : 'border-neutral-700 hover:border-green-500/50'
          }`}
        >
          {post.shipped ? '✓ shipped — click to unship' : 'Mark shipped'}
        </button>
        <button
          onClick={copyContent}
          className={`text-xs px-2 py-1 rounded border transition ${
            copied
              ? 'border-green-500/60 text-green-200 bg-green-500/10'
              : 'border-neutral-700 hover:border-neutral-500'
          }`}
        >
          {copied ? '✓ copied' : 'Copy'}
        </button>
      </div>

      {shippingOpen && !post.shipped && (
        <div className="border border-green-500/40 bg-green-500/5 rounded p-3 space-y-2 text-xs">
          <div className="font-medium">Mark this variant as shipped</div>
          <div className="opacity-70">
            Paste the URL of the tweet you actually posted (or leave blank to skip).
            With the URL, engagement (likes, RTs, replies) auto-imports at +24h and
            +7d so the voice loop knows what landed.
          </div>
          <input
            value={tweetUrl}
            onChange={e => setTweetUrl(e.target.value)}
            placeholder="https://x.com/RepRoKhanna/status/12345…"
            disabled={saving}
            autoFocus
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 font-mono"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={confirmShip}
              disabled={saving}
              className="px-3 py-1.5 rounded bg-green-500/20 border border-green-500/60 text-green-100 font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Confirm shipped'}
            </button>
            <button
              onClick={() => { setShippingOpen(false); setTweetUrl(''); }}
              disabled={saving}
              className="px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <RatingForm
        kind="post"
        targetId={post.id}
        size="sm"
        current={{
          feedback: post.feedback,
          feedback_reason: post.feedback_reason,
          feedback_note: post.feedback_note,
        }}
      />

      {error && <div className="text-xs text-red-300">error: {error}</div>}
    </div>
  );
}
