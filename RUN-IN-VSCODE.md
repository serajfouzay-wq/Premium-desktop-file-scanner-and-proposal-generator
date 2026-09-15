# Running Cabinet in VS Code

For Windows. Takes about ten minutes the first time, then seconds after that.

> **You don't need this to use the app.** If you only want to *use* Cabinet,
> download the installer from the [Releases page](../../releases/latest) — it
> needs no setup at all. This guide is for opening the code and changing it.

---

## Step 1 — Install Node.js (once)

Cabinet is built with Node.js. Without it, VS Code won't understand the `npm`
commands below.

1. Go to **<https://nodejs.org>**
2. Download the big green **LTS** button
3. Run the installer, clicking Next through every screen
4. **Restart VS Code afterwards** — it only notices Node.js on a fresh start

You only ever do this once.

## Step 2 — Get the code into VS Code

You don't need the command line for this.

1. Open VS Code
2. Press **Ctrl + Shift + P** — a command box appears at the top
3. Type `git clone` and press Enter
4. Paste this address and press Enter:

   ```
   https://github.com/serajfouzay-wq/Premium-desktop-file-scanner-and-proposal-generator.git
   ```

5. Choose a folder to put it in (your Documents folder is fine)
6. When VS Code asks *"Would you like to open the cloned repository?"* — click
   **Open**

> If step 3 finds nothing, Git isn't installed. Get it from
> <https://git-scm.com/download/win>, accept every default, restart VS Code,
> and try again.

## Step 3 — Open the terminal inside VS Code

Press **Ctrl + `** (the key above Tab, left of the 1). A panel opens at the
bottom. This is where you type commands.

### ⚠️ If you see a red error about "running scripts is disabled"

This is a Windows setting, not a problem with the code, and it catches almost
everyone. The easy fix, which changes no security settings:

1. In that terminal panel, click the **∨** arrow next to the **+**
2. Choose **Command Prompt**
3. A new tab opens — use that one instead

## Step 4 — Install the building blocks (once)

Type this and press Enter:

```
npm install
```

This downloads everything the app needs, including its own copy of Chrome —
roughly 300 MB. Expect **3 to 5 minutes**. Lots of text scrolls past; that is
normal. Wait until you get a blinking cursor back.

> Some yellow `warn` lines are normal and can be ignored. Only red `ERR!` lines
> matter.

## Step 5 — Run it

Press **F5**.

The interface builds and the Cabinet window opens. That's it.

To stop it, close the Cabinet window, or press the red square in VS Code's
debug toolbar.

---

## After that first time

| What you want | How |
|---|---|
| Run the app | **F5** |
| Stop it | Close the window |
| See your changes | Stop, then F5 again |
| Run the tests | **Ctrl + Shift + P** → `Run Task` → **Run the tests** |
| Build an installer | **Ctrl + Shift + P** → `Run Task` → **Package a Windows installer** |

## Where to change things

| To change… | Open this file |
|---|---|
| Wording on a screen | `src/views/` — `Dashboard.jsx`, `Scanner.jsx`, `Library.jsx`, `Studio.jsx`, `Settings.jsx` |
| How the proposal PDF looks | `electron/lib/document-template.js` |
| How companies are detected | `electron/lib/classify.js` |
| Where files get filed | `electron/lib/organize.js` |
| Colours and fonts | `tailwind.config.js` |

After editing anything, stop the app and press **F5** again to see it.

---

## If something goes wrong

**`'npm' is not recognized`**
Node.js isn't installed, or VS Code was not restarted after installing it. Redo
Step 1 and restart VS Code completely.

**Red error about running scripts being disabled**
See the warning box in Step 3 — switch the terminal to Command Prompt.

**F5 does nothing, or an "Open with…" box appears**
VS Code doesn't have the folder open. Use **File → Open Folder** and pick the
`Premium-desktop-file-scanner-and-proposal-generator` folder itself, not the
folder above it.

**Red `ERR!` lines mentioning `better-sqlite3` during `npm install`**
Harmless. The app carries a second database engine for exactly this case and
switches to it automatically. Settings will say *SQLite (WebAssembly)*.
Everything works.

**A blank white window**
The interface didn't finish building. In the terminal run `npm run build`,
watch for errors, then press F5 again.
