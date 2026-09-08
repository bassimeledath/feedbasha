import instrumentSans from '@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2'

const installed = new WeakSet<Document>()

/** Font faces must be registered on the document, not inside the shadow stylesheet. */
export function installFont(): void {
  if (typeof FontFace === 'undefined' || !document.fonts?.add || installed.has(document)) return
  installed.add(document)
  const face = new FontFace('Karen Instrument Sans', `url("${instrumentSans}")`, { weight: '400 700', display: 'swap' })
  document.fonts.add(face)
  void face.load().catch(() => {
    document.fonts.delete(face)
    installed.delete(document)
  })
}
