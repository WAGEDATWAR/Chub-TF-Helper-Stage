# Testing on Chub before publishing

You can run a half-finished stage in a **real chat** without publishing it, using
Chub's **Staging URL**. Your local dev server is loaded inside the chat, so edits
hot-reload straight into it.

## 0. Why port 5173 (and http)

Chub's stage renderer hardcodes the fallback

```
http://localhost:5173/index.html
```

for a stage whose saved staging URL is empty, and its postMessage origin allowlist
contains `localhost:5173` (and `127.0.0.1:5173`). Serving on **5173 over plain
http** is therefore the most compatible choice: even if the typed URL is not
persisted, Chub's own fallback still resolves. (Port 5175 is *not* on Chub's
allowlist and is never used as a fallback.)

## 1. Run the dev server in staging mode

```
npm install
npm run restart      # kills stale node, then starts a fresh server on 5173
```

(`npm run dev:staging` works too, but `npm run restart` is preferred — see AGENTS.md.)

The server prints URLs like `http://localhost:5173/` and
`http://192.168.1.20:5173/`.

- The **development** build (`npm run dev`) uses the built-in test runner with sample
  data — no chat needed.
- The **staging** build uses the real iframe runner, so a live chat drives it (real
  character cards, real messages). That is what the Staging URL needs.

## 2. Point a chat at it

1. Open (or start) a chat on Chub.
2. **Chat Settings → Staging URL**.
3. Paste your local URL, e.g. `http://localhost:5173/`.
4. Click **Save Settings**, then refresh the page.

## 3. Allow the port through Windows Firewall (only needed for a phone)

Windows blocks inbound LAN connections by default, so `http://localhost:5173` works
but `http://<your-LAN-IP>:5173` hangs / refuses — even from the same PC. Add an
inbound rule **once**, from an **Administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "ViteStage5173" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Any
```

Or run the helper: `powershell -File tools/fw-rule.ps1` (as admin).

If `Get-NetFirewallRule` says "Access is denied", you're not elevated — open
PowerShell via **right-click → Run as administrator**, or accept the UAC prompt.

## Notes

- **Port 5173 is also the parent game's Vite default.** Don't run both at once, or
  the parent wins the port. This helper pins `strictPort: true`, so it will error
  rather than silently pick another port.
- **Use the LAN IP, never `localhost`,** if Chub is open on a phone — on the phone,
  `localhost` means *the phone*, which is why you'd see `ERR_CONNECTION_REFUSED`.
  Use the **Network:** URL Vite prints (e.g. `http://10.0.0.79:5173/`).
- Phone and PC must be on the **same Wi-Fi/network**.
- Keep the dev server running the whole time you are testing in the chat.
- If the pane is blank, open the browser console (F12) — a load error will show
  there; also confirm the URL ends in `/` and matches the port Vite printed.

## 4. Later: publish

When you are ready to publish, the GitHub Action (`.github/workflows/stage-deploy.yml`)
builds `dist/` and uploads it on a push, once you add a `CHUB_AUTH_TOKEN` repo secret
(get a write token at <https://chub.ai/my_stages?active=tokens>). The first push
creates the stage and writes its id back into `public/chub_meta.yaml`.
