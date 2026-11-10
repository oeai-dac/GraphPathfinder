/**
 * Bytes → text for delimited and JSON files.
 *
 * Excel on a German Windows writes CSV in Windows-1252 unless told otherwise, and with a BOM
 * when told UTF-8. Read as UTF-8 regardless, "Grubenverfüllung" turns into "Grubenverf�llung".
 * So: a BOM decides; otherwise UTF-8 if the bytes are valid UTF-8, else Windows-1252.
 */
export function decodeText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

export const baseName = (file) => file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
