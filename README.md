# Cabinet

**A desktop application that reads the documents already scattered across your
computer, files them by company, and then writes new proposals from what it
found.**

Everything happens on your own machine. Documents are read in the app's main
process and never leave it.

---

## Get the app

**[⬇ Download the latest Windows installer](../../releases/latest)**

Run it. Windows will show a blue *"Windows protected your PC"* screen because
the installer is not code-signed — click **More info**, then **Run anyway**.
That is a signing warning, not a virus warning, and it appears once.

[`START-HERE.txt`](START-HERE.txt) walks through the first five minutes.

## Try it in a browser first

A web preview of the interface deploys to any static host. It is loaded with
sample data so every screen is clickable, **but it is not the app** — a web
page cannot read your hard drive, so scanning, filing and PDF export are
desktop-only. See [Deploying the preview](#deploying-the-preview) below.

---

## What it does

### Feature A — scan and organise

1. Pick a folder (Desktop, Downloads, an old project archive) or single files.
2. **Discovery** reads metadata only, so a folder with thousands of documents
   shows progress in about a second. `node_modules`, system folders, Office
   lock files, empty and oversized files are skipped and counted.
3. **Reading** opens each PDF, Word, Excel and text file and extracts the text.
   A classifier works out the **company** — from a "Bill to" label, a trading
   name suffix such as *Sdn Bhd* / *Ltd* / *LLC*, or the file name — and the
   **document type**, with a confidence score. Name variants are merged, so
   "Meridian Logistics" and "Meridian Logistics Sdn Bhd" don't become two
   folders.
4. **Review.** Anything below the confidence threshold waits in a review queue
   with the reason and a best guess. Nothing is filed on a guess alone.
5. **Filing** places approved documents at:

   ```
   <Library folder>/<Company Name>/<Document Type>/<Cleaned_Name.ext>
   ```

   Files are **copied by default**, so originals stay where they are, and a
   name collision never overwrites — it gets a numeric suffix.

### Feature B — write a proposal

1. Describe what you need in plain words: *"a fixed-price proposal for Meridian
   Logistics covering a 12 week warehouse automation rollout"*.
2. Cabinet parses the request, matches the client against companies it holds,
   and retrieves the relevant past work itself. Nothing to look up or attach.
3. The draft renders as a designed document — cover page carrying both logos,
   photograph plates, numbered sections, a schedule band, an investment table,
   assumptions and a signature block.
4. Export to **PDF** or **Word**, or save it back into the library so the next
   proposal can draw on it.

---

## Two rules the app will not break

**The numeric firewall.** No monetary amount is ever generated — not by the
model, not by the offline fallback. Every draft is scanned on the way out and
any figure that slipped through is replaced with `[amount to be confirmed]`.
You type every price, and the export buttons stay locked until every line has
one. A price that a language model invented and nobody checked is a commercial
liability.

**Tenancy is a filter, not a hope.** Retrieval runs three passes: this client's
own history (everything, including their pricing — it is their file);
comparable work for *other* clients (only documents you explicitly marked
reusable, and never a pricing passage); and a keyword sweep under the same
rules. The filter lives inside the query, so material that must not be reused
cannot reach the drafter even when it scores highest. The app shows you what it
excluded and why.

---

## Running from source

```bash
npm install
npm run dev        # Vite + Electron, hot reload
npm start          # production build, then launch
npm run test:e2e   # 38 checks across the whole pipeline
npm run dist:win   # package a Windows installer
```

Needs [Node.js 22+](https://nodejs.org). If `npm install` cannot build
`better-sqlite3`, nothing breaks — the WebAssembly SQLite engine takes over and
Settings tells you so. To switch to the faster native build later:

```bash
npx electron-rebuild -f -w better-sqlite3
```

### Deploying the preview

The web preview is a plain Vite build — `npm run build` produces static files in
`dist/`. [`vercel.json`](vercel.json) is already configured, so importing this
repository into Vercel needs no settings changes.

**What deploys:** every screen, navigable, with sample data.
**What cannot:** reading your files, filing, and PDF/Word export. Those need the
desktop app, because a browser has no access to your file system. This is a
limitation of the web, not of the app.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron 33** | Real file-system access, native dialogs, Chromium's print engine for PDF |
| Interface | **React 18 + Vite 6** | Hot reload in development, a plain static bundle in production |
| Styling | **Tailwind CSS 3** | The design system lives in one config file |
| Database | **SQLite** | `better-sqlite3` when its native binding matches Electron's ABI, `node-sqlite3-wasm` otherwise — same file, same SQL, installs cannot fail |
| PDF text | **pdfjs-dist** | Pure JS; its positioned fragments are reassembled into lines so headings survive for chunking |
| Word / Excel | **mammoth**, **SheetJS** | Text extraction without Office installed |
| Drafting | **@anthropic-ai/sdk** | Optional. Without a key, drafts are assembled from the retrieved passages |

### Security posture

`nodeIntegration` is off, `contextIsolation` is on, and the interface reaches
the machine only through the explicit channel list in `electron/preload.js`.
Document text stays in the main process; the interface receives previews. The
document preview runs in a fully sandboxed iframe. Retrieved passages are fenced
in the prompt and the system prompt states plainly that they are reference
material, never instruction.

---

## Layout

```
electron/
  main.js                 window, IPC surface, lifecycle
  preload.js              the only bridge to the interface
  lib/
    db.js                 SQLite schema and queries (engine-agnostic)
    settings.js           brand identity and storage location
    scan.js               recursive discovery
    extract.js            PDF / DOCX / XLSX / text
    classify.js           company and document-type detection
    organize.js           physical filing, safe names, no overwrites
    chunk.js              passage splitting with section labels
    retrieve.js           intent parsing, entity resolution, retrieval
    generate.js           drafting and the numeric firewall
    document-template.js  the designed document — preview, PDF and Word
    exporters.js          PDF / Word / HTML output
src/
  App.jsx                 shell and navigation
  views/                  Dashboard · Scanner · Library · Studio · Settings
  components/ui.jsx       buttons, cards, toasts, icons
  lib/demo.js             sample data for the browser preview only
test/
  e2e.js                  end-to-end run inside a real Electron process
  fixtures.js             sample documents built on the fly
```

## Where things are kept

| What | Where |
|---|---|
| Filed documents | The library folder you choose (default `Documents/Cabinet Library`) |
| Index and settings | Your per-user app data directory — shown in Settings |

The library is plain folders and files. Nothing is locked inside the app.
