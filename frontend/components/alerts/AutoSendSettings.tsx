"use client";

import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { rememberedName, rememberName } from "@/lib/alerts/operatorName";
import { type AlertsOverview, updateAlertSettings } from "@/lib/api/client";

const LEVELS = ["warning", "severe", "extreme"] as const;

/** Off by default: a person decides what goes to phones. Who changed it, and when, is logged. */
export function AutoSendSettings({ settings, onSaved }: { settings: AlertsOverview["settings"]; onSaved: () => void }) {
  const [draft, setDraft] = useState(settings.autoSend);
  const [name, setName] = useState(rememberedName);
  const [error, setError] = useState<string | null>(null);
  const changed = LEVELS.some((l) => draft[l] !== settings.autoSend[l]);

  async function save() {
    try {
      await updateAlertSettings(draft, name.trim());
      rememberName(name.trim());
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card title="Send automatically">
      <p className="mb-3 text-sm text-slate-600">
        New real alerts of these severities go to recipients without anyone pressing Send. Demo alerts never do.
      </p>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {LEVELS.map((level) => (
          <label key={level} className="flex items-center gap-1.5 text-slate-700">
            <input type="checkbox" checked={draft[level]} onChange={(e) => setDraft({ ...draft, [level]: e.target.checked })} /> {level}
          </label>
        ))}
        <label className="sr-only" htmlFor="auto-send-name">Your name</label>
        <input id="auto-send-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={80}
          className="w-40 rounded-md border border-slate-300 px-2 py-1" />
        <button type="button" onClick={save} disabled={!changed || !name.trim()}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
          Save
        </button>
      </div>
      {settings.changedBy && <p className="mt-2 text-xs text-slate-500">Last changed by {settings.changedBy}{settings.changedAt && ` at ${new Date(settings.changedAt).toLocaleString()}`}.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </Card>
  );
}
