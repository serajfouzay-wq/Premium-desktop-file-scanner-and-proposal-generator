/*
 * Every call into the main process goes through here.
 *
 * The bridge returns { ok, data | error }; unwrap() turns a failure into a
 * thrown Error so views can use try/catch.
 *
 * When the bundle is served from the web there is no main process, so the same
 * surface is answered from the demo fixtures instead. Views are identical in
 * both modes — they never learn which one they are running in.
 */
import { demo } from './demo';

export const isDesktop = typeof window !== 'undefined' && !!window.cabinet;

async function unwrap(promise) {
  const result = await promise;
  if (!result || result.ok === false) throw new Error((result && result.error) || 'Something went wrong.');
  return result.data;
}

const bridge = () => window.cabinet;

/* Progress events arrive by IPC on the desktop. In the browser the demo drives
   them directly, so subscribers are kept here and handed to the demo call. */
const listeners = { scan: new Set(), stage: new Set() };
const subscribe = (set, fn) => { set.add(fn); return () => set.delete(fn); };
const emitTo = (set) => (payload) => set.forEach((fn) => fn(payload));

export const api = {
  info: () => (isDesktop ? unwrap(bridge().app.info()) : demo.info()),
  openPath: (p) => (isDesktop ? unwrap(bridge().app.openPath(p)) : demo.openPath()),
  revealPath: (p) => (isDesktop ? unwrap(bridge().app.revealPath(p)) : demo.revealPath()),

  settings: {
    get: () => (isDesktop ? unwrap(bridge().settings.get()) : demo.settings.get()),
    update: (patch) => (isDesktop ? unwrap(bridge().settings.update(patch)) : demo.settings.update(patch)),
    chooseLibraryRoot: () => (isDesktop ? unwrap(bridge().settings.chooseLibraryRoot()) : demo.settings.chooseLibraryRoot()),
    pickImage: () => (isDesktop ? unwrap(bridge().settings.pickImage()) : demo.settings.pickImage()),
  },

  scan: {
    chooseFolder: () => (isDesktop ? unwrap(bridge().scan.chooseFolder()) : demo.scan.chooseFolder()),
    chooseFiles: () => (isDesktop ? unwrap(bridge().scan.chooseFiles()) : demo.scan.chooseFiles()),
    start: (roots) => (isDesktop
      ? unwrap(bridge().scan.start(roots))
      : demo.scan.start(roots, emitTo(listeners.scan))),
    cancel: () => (isDesktop ? unwrap(bridge().scan.cancel()) : demo.scan.cancel()),
    fileOne: (file) => (isDesktop ? unwrap(bridge().scan.fileOne({ file })) : demo.scan.fileOne(file)),
    fileAll: (files) => (isDesktop ? unwrap(bridge().scan.fileAll({ files })) : demo.scan.fileAll(files)),
    onProgress: (fn) => (isDesktop ? bridge().scan.onProgress(fn) : subscribe(listeners.scan, fn)),
  },

  ocr: {
    status: () => (isDesktop ? unwrap(bridge().ocr.status()) : demo.ocr.status()),
    warmUp: () => (isDesktop ? unwrap(bridge().ocr.warmUp()) : demo.ocr.warmUp()),
  },
  library: {
    companies: () => (isDesktop ? unwrap(bridge().library.companies()) : demo.library.companies()),
    documents: (company) => (isDesktop ? unwrap(bridge().library.documents(company)) : demo.library.documents(company)),
    document: (id) => (isDesktop ? unwrap(bridge().library.document(id)) : demo.library.document(id)),
    tree: () => (isDesktop ? unwrap(bridge().library.tree()) : demo.library.tree()),
    stats: () => (isDesktop ? unwrap(bridge().library.stats()) : demo.library.stats()),
    setConfidentiality: (id, level) => (isDesktop
      ? unwrap(bridge().library.setConfidentiality(id, level))
      : demo.library.setConfidentiality(id, level)),
    remove: (id) => (isDesktop ? unwrap(bridge().library.remove(id)) : demo.library.remove(id)),
  },

  catalog: {
    templates: () => (isDesktop ? unwrap(bridge().catalog.templates()) : demo.catalog.templates()),
    locations: () => (isDesktop ? unwrap(bridge().catalog.locations()) : demo.catalog.locations()),
    hotels: (id) => (isDesktop ? unwrap(bridge().catalog.hotels(id)) : demo.catalog.hotels(id)),
    mcs: () => (isDesktop ? unwrap(bridge().catalog.mcs()) : demo.catalog.mcs()),
    activities: (c) => (isDesktop ? unwrap(bridge().catalog.activities(c)) : demo.catalog.activities(c)),
    logistics: () => (isDesktop ? unwrap(bridge().catalog.logistics()) : demo.catalog.logistics()),
    quote: (sel) => (isDesktop ? unwrap(bridge().catalog.quote(sel)) : demo.catalog.quote(sel)),
    preview: (sel) => (isDesktop ? unwrap(bridge().catalog.preview(sel)) : demo.catalog.preview(sel)),
    exportDeck: (sel) => (isDesktop ? unwrap(bridge().catalog.exportDeck(sel)) : demo.catalog.exportDeck(sel)),
  },
  studio: {
    generate: (prompt) => (isDesktop
      ? unwrap(bridge().studio.generate(prompt))
      : demo.studio.generate(prompt, emitTo(listeners.stage))),
    preview: (payload) => (isDesktop ? unwrap(bridge().studio.preview(payload)) : demo.studio.preview(payload)),
    exportAs: (format, payload) => (isDesktop
      ? unwrap(bridge().studio.exportAs({ format, payload }))
      : demo.studio.exportAs(format, payload)),
    saveToLibrary: (payload) => (isDesktop ? unwrap(bridge().studio.saveToLibrary(payload)) : demo.studio.saveToLibrary(payload)),
    onStage: (fn) => (isDesktop ? bridge().studio.onStage(fn) : subscribe(listeners.stage, fn)),
  },
};
