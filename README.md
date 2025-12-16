# Leasely

**Point your phone at a page of a commercial lease and get its key terms back in plain English.**

Leasely is a **proof of concept** mobile app. It shows how a vision-capable LLM can turn a photo of dense lease language into structured, categorized terms: rent, escalations, operating expenses, renewal options, assignment rights and more. Each term links back to the exact text it came from.

> ⚠️ **Proof of concept.** Leasely is a prototype for exploring the idea. It isn't a production app. It has no accounts and stores nothing, and it isn't hardened for public deployment. Extracted terms are **not legal advice**. Always check them against the original document.

---

## What it does

1. **Scan** a lease page with the camera, or pick a photo from your library.
2. **Extract.** The page is sent to a vision model, which reads it and returns only the terms actually stated on that page. It doesn't guess and doesn't fill in "typical" market terms.
3. **Review** the results, grouped by category. Tap any term to see the verbatim source text it was drawn from.

Along with the terms, each scan returns:

- **Page summary:** one or two sentences on what the page covers.
- **Warnings:** blurry or cut-off text, illegible figures, or ambiguous language you should double-check.
- **Lease check:** a flag if the photo doesn't look like a lease page at all.

### Categories

| | | |
|---|---|---|
| Parties | Premises | Term & Dates |
| Rent | Escalations | Security Deposit |
| Operating Expenses / CAM | Permitted Use | Maintenance & Repairs |
| Insurance & Indemnity | Renewal & Options | Termination & Default |
| Assignment & Subletting | Other | |

### Example response

```json
{
  "is_lease_document": true,
  "page_summary": "Section 4 sets out base rent for the initial term and annual increases.",
  "terms": [
    {
      "category": "rent",
      "label": "Base Rent",
      "value": "$28.50 per rentable sq ft per year ($14,250/month), payable monthly in advance on the 1st.",
      "source_text": "Tenant shall pay Base Rent in the amount of Twenty-Eight and 50/100 Dollars ($28.50) per rentable square foot..."
    },
    {
      "category": "escalations",
      "label": "Annual Increase",
      "value": "Base Rent increases 3% on each anniversary of the Commencement Date.",
      "source_text": "...shall increase by three percent (3%) on each anniversary of the Commencement Date."
    }
  ],
  "warnings": ["The bottom two lines of the page are cut off."]
}
```

---

## How it works

```
┌──────────────────┐   resized JPEG (base64)   ┌──────────────────┐   image + schema   ┌──────────────┐
│   mobile/        │ ────────────────────────▶ │   server/        │ ─────────────────▶ │  Vision LLM  │
│   Expo app       │                           │   Node/Express   │                    │  (Anthropic  │
│                  │ ◀──────────────────────── │   POST /extract  │ ◀───────────────── │   API)       │
└──────────────────┘     structured terms      └──────────────────┘    validated JSON  └──────────────┘
```

- **The app** (`mobile/`) captures the photo, resizes it to at most 2000px on the long edge (small print stays legible and uploads stay quick), and shows the results.
- **The server** (`server/`) holds the API key so it never ships inside the app. It sends the image to the model with a structured-output schema, so the model always returns valid JSON in the shape above, which the server checks before replying.
- **Nothing is persisted.** Images and results exist only for the length of the request and in the app's memory until you tap *Start over*.

### Tech stack

| Layer | Tools |
|---|---|
| Mobile | Expo SDK 58, React Native, TypeScript, `expo-image-picker`, `expo-image-manipulator` |
| Server | Node 22+, Express 5, TypeScript (run with `tsx`), Zod |
| Model | Anthropic API via the official `@anthropic-ai/sdk`, with structured outputs |

---

## Getting started

### Prerequisites

- **Node.js 22+**
- An **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com))
- The **Expo Go** app on your phone (iOS or Android), or an iOS Simulator / Android emulator

### 1. Start the server

```bash
cd server
npm install
cp .env.example .env      # then add your ANTHROPIC_API_KEY
npm run dev
```

You should see `Leasely server listening on http://0.0.0.0:3001`.

### 2. Start the app

In a second terminal:

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS). Press `i` to open the iOS Simulator instead.

The app finds the server automatically by reusing the LAN address that Expo serves from, so **your phone must be on the same Wi-Fi network as your computer.** To point it at a different server:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:3001 npx expo start
```

### 3. Scan a page

Lay the page flat in good light and fill the frame. A scan usually takes several seconds.

---

## Configuration

All settings live in `server/.env`:

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** Your API key. |
| `MODEL` | `claude-opus-5-5` | Any vision-capable model. |
| `EFFORT` | `medium` | `low` is faster and cheaper; `high` is more thorough. |
| `ENABLE_FALLBACKS` | `true` | If the model declines a request, retry it on a fallback model. Set to `false` for models that don't support this. |
| `PORT` | `3001` | Port the server listens on. |

---

## Project structure

```
leasely/
├── mobile/                 Expo (React Native) app
│   ├── App.tsx             Scan screen and results UI
│   ├── src/api.ts          Server URL resolution + /extract client
│   └── app.json            Expo config (name, camera/photo permissions)
└── server/                 Extraction API
    ├── src/index.ts        Express server, prompt, output schema, error handling
    └── .env.example        Configuration template
```

### API

**`GET /health`**: returns `{ "ok": true, "model": "<model>" }`.

**`POST /extract`**

```json
{ "imageBase64": "<base64 JPEG/PNG/WebP>", "mediaType": "image/jpeg" }
```

Returns the extraction JSON shown above. On failure, it returns `{ "error": "<message>" }` with a 4xx or 5xx status.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Could not reach the server at …" | Phone and computer aren't on the same Wi-Fi, or the server isn't running. Open `http://<computer-ip>:3001/health` in your phone's browser to test. |
| Works on the simulator but not the phone | The macOS firewall may be blocking port 3001 (allow incoming connections for Node), or the network may block devices from talking to each other (common on office and guest Wi-Fi). Try a phone hotspot. |
| "Project is incompatible with this version of Expo Go" | Update Expo Go from the App Store or Play Store. |
| "Server is missing a valid API key" | Check `ANTHROPIC_API_KEY` in `server/.env` and restart the server. |
| 400 error mentioning fallbacks | Your chosen `MODEL` doesn't support server-side fallbacks. Set `ENABLE_FALLBACKS=false`. |
| Missing or garbled terms | Retake the photo: flatter, better lit, and with the whole page in frame. Check the warnings card. |

---

## Limitations

- **One page at a time.** No cross-page context, so a term defined on page 2 and used on page 9 won't be connected.
- **No persistence.** There's no history, export or saved leases.
- **Not production-ready.** The server has no authentication, rate limiting or HTTPS. Run it on a trusted local network only.
- **Model output can be wrong.** The verbatim `source_text` and the warnings are there to make checking easy. Use them.

## Ideas for next steps

- Multi-page scanning with a combined lease abstract
- Automatic page edge detection and perspective correction
- Export to PDF or CSV, or copy as a lease abstract
- Highlight the source region on the photo for each term
- Flag unusual or tenant-unfriendly clauses compared with typical market terms

---

## Disclaimer

Leasely is an experimental prototype provided as-is. It does not provide legal, financial or real estate advice. Have a qualified professional review any lease before relying on it.
