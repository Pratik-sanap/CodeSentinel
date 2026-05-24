# Demo Recording Checklist

Follow this checklist when recording a demo of CodeSentinel.

- Prepare environment
  - Start the dashboard dev server: `corepack pnpm --filter @reviewai/dashboard dev`
  - Run the demo helper to start ngrok and seed reviews: `bash scripts/demo-setup.sh`
  - Confirm the public ngrok URL printed by the script.

- Recording basics
  - Use OBS or Windows Game Bar (Win+G).
  - Record at 1920x1080, 30–60 FPS.
  - Narrate clearly and pause after each action for viewers to read streaming text.

- Demo flow (suggested order)
  1. Landing page and metrics overview.
  2. Show live feed updating (wait for seeded reviews).
 3. Click a review row to open the detail panel.
 4. Click an issue's "Explain" button and show the SSE stream.
  5. Show merge readiness guidance and advice.

- Troubleshooting
  - If the UI is stale, append `?fresh=1` to the URL or clear site data in DevTools.
  - For programmatic API calls to ngrok include header `ngrok-skip-browser-warning: 1`.

Good luck with the hackathon — keep recordings short and focused.
