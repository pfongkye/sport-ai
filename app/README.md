# SportAI — Next.js App

This is the Next.js 16 frontend and API layer for SportAI.

For full setup instructions, Docker Compose, environment configuration, and running the project, see the [root README](../README.md).

---

## Quick start (app only)

Assumes the Supabase Docker stack is already running. See root README for that.

```bash
# Install dependencies (first time only)
npm install

# Start development server
npm run dev
```

App runs at [http://localhost:3000](http://localhost:3000).

---

## Key scripts

```bash
npm run dev      # development server with hot reload
npm run build    # production build (runs TypeScript check)
npm run lint     # ESLint
```

---

## Environment

Copy and configure before running:

```bash
cp .env.local.example .env.local
```

See [root README → Environment Setup](../README.md#1-environment-setup) for what each variable does and where to get the values.
