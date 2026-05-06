# Lewden EV BOM Calculator

EV pillar quotation tool for sales reps — React + Vite + TypeScript + Supabase, hosted on GitHub Pages.

---

## Setup

### 1. Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project 
2. In the Supabase dashboard, open **SQL Editor**. 
3. Paste the contents of `supabase-schema.sql` and run it. This creates all tables, RLS policies, and seeds the 51 products.
4. Go to **Project Settings → API** and copy:
   - Project URL
   - `anon` public key

**Create your admin user:**
- Go to **Authentication → Users → Add user**
- Enter your email and a strong password. This is the account you'll use to log in to the Admin panel.

---

### 2. Environment variables

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

> **Never commit `.env` to Git** — it's already in `.gitignore`.

---

### 3. GitHub Pages

1. Create a new repository on GitHub (e.g. `lewden-ev-bom`).
2. Update `vite.config.ts` — change the `base` to match your repo name:
   ```ts
   base: '/lewden-ev-bom/',   // must match exactly
   ```
3. Install dependencies and deploy:
   ```bash
   npm install
   npm run deploy
   ```
   This builds the project and pushes the `dist` folder to the `gh-pages` branch.

4. In your GitHub repo, go to **Settings → Pages** and set the source to `gh-pages` branch, `/ (root)`.

Your app will be live at: `https://your-username.github.io/lewden-ev-bom/`

**For subsequent deployments**, just run `npm run deploy` again.

---

### 4. GitHub Actions (optional — auto-deploy on push)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

Then add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as secrets in your repo under **Settings → Secrets and variables → Actions**.

---

## Dev server

```bash
npm install
npm run dev
```

---

## Adding / updating prices

1. Open the app and click **Admin** in the nav.
2. Sign in with your Supabase admin credentials.
3. Click **Edit** on any product to update its factory cost, part number, or description.
4. Click **+ Add product** to add new items.

Changes are live immediately for all users — no redeployment needed.

---

## Project structure

```
src/
├── App.tsx               Main app + state management
├── index.css             Full design system (responsive)
├── main.tsx              Entry point
├── types.ts              TypeScript types
├── lib/
│   └── supabase.ts       Supabase client
└── components/
    ├── Header.tsx         Desktop header + nav
    ├── BottomNav.tsx      Mobile bottom tab bar
    ├── SearchBar.tsx      Reusable search input
    ├── Toast.tsx          Notification toasts
    ├── QuoteBuilder.tsx   Main BOM quote builder
    ├── SavedQuotes.tsx    Saved quotes list + search
    ├── AdminPanel.tsx     Product catalogue management
    └── AdminLogin.tsx     Admin authentication modal
```
