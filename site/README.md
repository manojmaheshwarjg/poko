# Poko landing page

The marketing page for Poko. Next.js 16 (App Router), with GSAP and Lenis for motion, and
Geist, Geist Mono and Doto through `next/font`. Everything on the page is scripted: it never
calls a model, and the product in the demo is made up.

```bash
cd site
npm install
npm run dev          # http://127.0.0.1:4800
npm run build        # production build
npm run typecheck
```

## What is on the page

- **Hero** (`Hero.tsx`): the headline, the install command and Poko's cursor drawn in 3D
  outlines (`HeroArrow.tsx`). Below it, a live demo in a browser window (`BrowserFrame.tsx`,
  `HeroConsole.tsx`): Poko sets up a user in a made-up cloud console and stops twice for a yes.
- **Works with** (`LogoBand.tsx`): the stacks, docs tools and models Poko supports.
- **The problem** (`Problem.tsx`), **How it works** (`HowItWorks.tsx`), **For your team**
  (`TeamConsole.tsx`) and **Why Poko** (`WhyPoko.tsx`).
- **Pricing** (`Pricing.tsx`) and **FAQ** (`Faq.tsx`), where Ask Poko answers from
  `lib/faq.ts`.
- **Footer** (`Footer.tsx`) with the early-access form.
- On desktops Poko is your cursor (`Buddy.tsx`); the scroll motion is in `components/motion/`.

## Before going live

- **Names.** `lib/site.ts` holds the CLI name (`npx usepoko init`), the script host and the
  key format. The package and the domain aren't registered yet.
- **Early-access signups.** `app/api/early-access/route.ts` posts each signup as JSON to
  `EARLY_ACCESS_WEBHOOK_URL`. Without it, local development appends to
  `.data/early-access.jsonl` (git-ignored) and production refuses signups with a clear
  message, so nothing is silently lost.
- **Deploy.** On Vercel, import the repository with `site` as the root directory and the
  Next.js preset.
