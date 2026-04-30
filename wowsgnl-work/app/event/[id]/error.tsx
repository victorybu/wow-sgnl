'use client';

import Link from 'next/link';

export default function EventError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="max-w-3xl mx-auto p-8">
      <Link href="/" className="text-xs underline opacity-60">← back</Link>
      <div className="mt-4 border border-red-500/40 bg-red-500/10 rounded-lg p-4 text-sm">
        <p className="font-medium mb-1">Something went wrong on this page.</p>
        <p className="opacity-80 mb-2">
          The most common cause right now is the pending Anthropic billing — drafting calls are failing.
          The homepage and rating system work without Anthropic.
        </p>
        {error.digest && (
          <p className="text-xs opacity-60 font-mono">digest: {error.digest}</p>
        )}
      </div>
      <div className="mt-4 flex gap-3">
        <button onClick={reset} className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500">
          Try again
        </button>
        <Link href="/" className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500">
          Back to feed
        </Link>
      </div>
    </main>
  );
}
