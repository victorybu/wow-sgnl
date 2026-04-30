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

  const toggleShip = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shipped: !post.shipped }),
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
          onClick={toggleShip}
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
          onClick={() => navigator.clipboard.writeText(post.content)}
          className="text-xs px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500"
        >
          Copy
        </button>
      </div>

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
