"use client";

import { Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";

import { rememberedName, rememberName } from "@/lib/alerts/operatorName";
import { fetchSendPreview, sendAlert, type SendPreview } from "@/lib/api/client";

const CHANNEL = { sms: "SMS", whatsapp: "WhatsApp" } as const;

/** Shows exactly who would get what before anything is sent. */
export function SendPanel({ alertId, onSent }: { alertId: string; onSent: () => void }) {
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [name, setName] = useState(rememberedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    fetchSendPreview(alertId).then(setPreview).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [alertId]);

  if (!preview) {
    return error ? <p role="alert" className="text-xs text-red-700">{error}</p> : <p className="text-xs text-slate-500">Loading recipients…</p>;
  }
  const going = preview.recipients.filter((r) => r.send);
  const configured = preview.configured.sms || preview.configured.whatsapp;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const { deliveries } = await sendAlert(alertId, name.trim());
      rememberName(name.trim());
      const failed = deliveries.filter((d) => d.status === "failed");
      setResult(`${deliveries.length - failed.length} sent${failed.length ? `, ${failed.length} failed: ${failed.map((f) => f.error).join("; ")}` : ""}`);
      setPreview(await fetchSendPreview(alertId));
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <pre className="whitespace-pre-wrap rounded bg-white p-2 font-sans text-xs text-slate-800">{preview.message}</pre>
      {preview.recipients.length === 0 ? (
        <p className="text-xs text-slate-500">No recipients yet: add them under Recipients below.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {preview.recipients.map((r) => (
            <li key={`${r.recipientId}-${r.channel}`} className="flex flex-wrap justify-between gap-2">
              <span className="text-slate-700">
                {r.name}{r.role && <span className="text-slate-500"> · {r.role}</span>} · {CHANNEL[r.channel]} {r.phone}
              </span>
              <span className={r.send ? "font-medium text-green-700" : "text-slate-500"}>{r.send ? "will be sent" : r.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {!configured ? (
        <p className="text-xs text-amber-800">Messaging is not configured: add the Twilio settings to backend/.env.local.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`send-name-${alertId}`}>Your name</label>
          <input
            id={`send-name-${alertId}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={80}
            className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || going.length === 0 || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Send size={12} aria-hidden />}
            Send to {going.length}
          </button>
        </div>
      )}
      {result && <p role="status" className="text-xs text-slate-700">{result}</p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
