"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { acknowledgeAlert } from "@/lib/api/client";
import { rememberedName, rememberName } from "@/lib/alerts/operatorName";

/** Acknowledging records who saw the alert; it stays listed, but leaves the banner. */
export function AcknowledgeForm({ alertId, onDone, compact = false }: { alertId: string; onDone: () => void; compact?: boolean }) {
  const [name, setName] = useState(rememberedName);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await acknowledgeAlert(alertId, name.trim(), note.trim());
      rememberName(name.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 text-sm">
      <label className="sr-only" htmlFor={`ack-name-${alertId}`}>Your name</label>
      <input
        id={`ack-name-${alertId}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        required
        maxLength={80}
        className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900"
      />
      {!compact && (
        <>
          <label className="sr-only" htmlFor={`ack-note-${alertId}`}>Note</label>
          <input
            id={`ack-note-${alertId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            maxLength={500}
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900"
          />
        </>
      )}
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Check size={12} aria-hidden />} Confirm
      </button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </form>
  );
}
