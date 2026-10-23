# AEGIS frontend

Next.js (App Router) + React + TypeScript + Tailwind, with React-Leaflet for the map and
Recharts for charts. See the repository root `README.md` for the full setup.

```bash
npm install
npm run dev     # http://localhost:3000 — expects the backend on http://localhost:8000
npm test        # vitest
npx tsc --noEmit && npx eslint .
```

- `NEXT_PUBLIC_API_BASE_URL` overrides the backend URL.
- Leaflet only runs in the browser: map components load through `components/map/MapView.tsx`
  (`next/dynamic` with `ssr: false`).
- `lib/schemas/types.ts` mirrors `backend/app/models/schemas.py` by hand — change both together.
