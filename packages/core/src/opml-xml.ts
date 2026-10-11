export function escapeXmlText(value: string): string {
  return normalizeLineEndings(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value);
}

export function decodeXmlText(value: string): string {
  return decodeXml(value);
}

export function decodeXmlAttribute(value: string): string {
  return decodeXml(value);
}

function decodeXml(value: string): string {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function unescapeLegacyAttributeEscapes(opml: string): string {
  return opml.replace(/\\"/g, '"').replace(/\\'/g, "'");
}
