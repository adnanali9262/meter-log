# Meter Log — PWA

A two-meter electricity usage tracker. Logs readings with automatic timestamps and
shows usage normalized to a 24-hour rate, even with irregular entry times (multi-day
gaps or multiple same-day entries).

## What's in this folder

- `index.html` — app shell
- `app.js` — all app logic (React, no build step)
- `manifest.json` — PWA manifest (name, icons, theme)
- `service-worker.js` — offline caching
- `icons/` — app icons (192px, 512px, regular + maskable)

## How the 24h usage rate works

Each bar on the "24h usage" graph represents the rate between two **consecutive
readings**, normalized to kWh per day:

```
rate = (reading2.value - reading1.value) / hours_between * 24
```

This means:
- A 3-day gap with 12 kWh used shows as **4 kWh/24h** (12 ÷ 3 days)
- Two readings on the same day, 12 hours apart, with 2 kWh used, also shows as
  **4 kWh/24h** (2 kWh ÷ 12h × 24h)

Both get compared on the same scale, regardless of how irregularly you log.
Tap a bar to see the exact kWh used and the real time span it covers.

## Hosting it (required for Android install)

PWAs need to be served over HTTPS to be installable. Pick any free static host:

**GitHub Pages** (recommended, free, easy):
1. Create a new GitHub repo, upload all files in this folder to it
2. Go to repo Settings → Pages → set source to your main branch
3. Your app will be live at `https://<username>.github.io/<repo-name>/`

**Netlify / Vercel** (drag-and-drop):
1. Go to netlify.com (or vercel.com) → sign in → drag this folder onto the deploy area
2. You'll get a live HTTPS URL immediately

## Installing on Android

1. Open your hosted URL in **Chrome** on your Android phone
2. Tap the **⋮** menu (top right) → **"Add to Home screen"** or **"Install app"**
   (Chrome may also show an automatic install banner — tap **Install** there)
3. The app icon appears on your home screen and opens full-screen, like a native app

## Data storage

All readings are saved in the browser's **localStorage**, scoped to the device and
browser you're using. This means:
- Data persists across app restarts and reboots on that device
- Data does **not** sync to other phones, browsers, or computers
- Clearing Chrome's site data/cache for this app will erase your readings
- There's no cloud backup — if you want one later, that's a future addition

## Offline behavior

The service worker caches the app shell after the first successful load, so the
interface and your saved data work offline afterward. The charting library is
loaded from a CDN on first load — if you want guaranteed offline access on a
brand-new install with zero signal, let me know and I can bundle it locally too.
