export function getURL(base: string, url: string): string {
  if (!base?.startsWith('http://') && !base?.startsWith('https://')) {
    base = 'http://' + base;
  }
  try {
    return new URL(url, base).href;
  } catch (e) {
    console.debug(e);
    return '';
  }
}
