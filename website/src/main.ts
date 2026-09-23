import "./style.css";

// Points the download buttons at the matching files of the latest published release.
// Drafts aren't visible to the API; until one is published every button opens the releases page.

const REPO = "oguztozkoparan/trimbit";
const RELEASES = `https://github.com/${REPO}/releases`;

type Os = "mac" | "windows" | "linux";

interface Asset {
  name: string;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  html_url: string;
  assets: Asset[];
}

const LABELS: Record<Os, string> = { mac: "macOS", windows: "Windows", linux: "Linux" };

function detectOs(): Os | null {
  const ua = navigator.userAgent;
  if (/Mac OS X|Macintosh/.test(ua) && !/iPhone|iPad/.test(ua)) return "mac";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux|X11/.test(ua) && !/Android/.test(ua)) return "linux";
  return null;
}

/** Best single file per OS; macOS prefers Apple silicon, as most Macs sold since 2020 are. */
function pick(assets: Asset[], os: Os): Asset | undefined {
  const find = (re: RegExp) => assets.find((a) => re.test(a.name));
  switch (os) {
    case "mac":
      return find(/aarch64\.dmg$/) ?? find(/\.dmg$/);
    case "windows":
      return find(/setup\.exe$/) ?? find(/\.msi$/);
    case "linux":
      return find(/\.AppImage$/) ?? find(/\.deb$/);
  }
}

async function latest(): Promise<Release | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Release;
    return Array.isArray(data.assets) ? data : null;
  } catch {
    return null;
  }
}

function safeUrl(url: string): string {
  // Only ever link to GitHub; anything else in the API response is ignored.
  return /^https:\/\/github\.com\//.test(url) ? url : RELEASES;
}

async function main(): Promise<void> {
  const os = detectOs();
  const primary = document.getElementById("cta-primary") as HTMLAnchorElement | null;
  const note = document.getElementById("cta-note");
  const line = document.getElementById("release-line");
  const cards = Array.from(document.querySelectorAll<HTMLAnchorElement>(".download"));

  if (os) {
    const card = cards.find((c) => c.dataset.os === os);
    if (card) {
      card.classList.add("detected");
      // Text as well as colour, so the hint doesn't rely on colour alone.
      const badge = document.createElement("em");
      badge.className = "badge";
      badge.textContent = "Your system";
      card.prepend(badge);
    }
    if (primary) primary.textContent = `Download for ${LABELS[os]}`;
  }

  const release = await latest();
  if (!release) return;

  const version = release.tag_name.replace(/^v/, "");
  if (line) line.textContent = `Latest release: ${version}. Pick the installer for your system.`;
  if (note) note.textContent = `Version ${version} · Free and open source · Apache-2.0`;

  for (const card of cards) {
    const asset = pick(release.assets, card.dataset.os as Os);
    card.href = asset ? safeUrl(asset.browser_download_url) : safeUrl(release.html_url);
  }
  if (os && primary) {
    const asset = pick(release.assets, os);
    if (asset) primary.href = safeUrl(asset.browser_download_url);
  }
}

void main();
