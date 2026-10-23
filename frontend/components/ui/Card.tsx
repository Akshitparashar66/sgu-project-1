import type { ReactNode } from "react";

export function Card({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-slate-500">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Page frame for the non-map views: scrollable, centred, consistent header. */
export function Page({ title, intro, actions, children }: { title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
            {intro && <p className="mt-1 max-w-2xl text-sm text-slate-400">{intro}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}

export const tableClass = "w-full text-left text-sm";
export const theadClass = "text-xs uppercase tracking-wide text-slate-500";
export const rowClass = "border-t border-slate-800";
