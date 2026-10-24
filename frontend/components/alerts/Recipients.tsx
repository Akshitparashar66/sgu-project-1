"use client";

import { Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/Card";
import { addRecipient, type AlertSeverity, fetchRecipients, type Recipient, removeRecipient } from "@/lib/api/client";

const SEVERITIES: AlertSeverity[] = ["info", "warning", "severe", "extreme"];
const input = "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm";

/** Who gets alerts by SMS or WhatsApp. Numbers stay on the server and are shown masked. */
export function Recipients() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [form, setForm] = useState({ name: "", role: "", phone: "", sms: false, whatsapp: true, minSeverity: "severe" as AlertSeverity });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecipients().then(setRecipients).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const channels = (["whatsapp", "sms"] as const).filter((c) => form[c]);
      await addRecipient({ name: form.name, role: form.role, phone: form.phone, channels, minSeverity: form.minSeverity });
      setRecipients(await fetchRecipients());
      setForm({ ...form, name: "", role: "", phone: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(id: string) {
    await removeRecipient(id);
    setRecipients(await fetchRecipients());
  }

  return (
    <Card title="Recipients">
      {recipients.length > 0 && (
        <ul className="mb-4 space-y-1.5 text-sm">
          {recipients.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1.5 first:border-0 first:pt-0">
              <span className="text-slate-800">
                {r.name}{r.role && <span className="text-slate-500"> · {r.role}</span>}
                <span className="ml-2 tabular-nums text-slate-500">{r.phone}</span>
              </span>
              <span className="flex items-center gap-3 text-xs text-slate-500">
                {r.channels.map((c) => (c === "sms" ? "SMS" : "WhatsApp")).join(" + ")} · {r.minSeverity} and above
                <button type="button" onClick={() => remove(r.id)} aria-label={`Remove ${r.name}`} className="text-slate-400 hover:text-red-700">
                  <Trash2 size={14} aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-0.5 text-xs text-slate-500">Name
          <input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-500">Role
          <input maxLength={80} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-500">Phone (with +91)
          <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+919876543210" className={`${input} w-36`} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-500">From severity
          <select value={form.minSeverity} onChange={(e) => setForm({ ...form, minSeverity: e.target.value as AlertSeverity })} className={input}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })} /> WhatsApp
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={form.sms} onChange={(e) => setForm({ ...form, sms: e.target.checked })} /> SMS
        </label>
        <button type="submit" disabled={!form.sms && !form.whatsapp} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
          <UserPlus size={13} aria-hidden /> Add
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">
        On a Twilio trial, WhatsApp only reaches phones that have joined the sandbox (by sending its join code to the sandbox
        number) and messaged it in the last 24 hours, and SMS only reaches numbers verified in Twilio.
      </p>
    </Card>
  );
}
