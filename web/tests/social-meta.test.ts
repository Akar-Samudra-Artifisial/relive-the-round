import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import ogImage from "../public/og-image.png?inline";
import vercel from "../vercel.json";

// Link previews (Open Graph / Twitter card) for the home page and /#c=... challenge links.
const ORIGIN = "https://relive-the-round.vercel.app";

function meta(attr: "property" | "name", key: string): string | undefined {
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.:]/g, "\\$&")}"\\s+content="([^"]*)"\\s*/>`);
  return re.exec(html)?.[1];
}

function pngSize(dataUrl: string): { w: number; h: number; signature: string } {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const u32 = (o: number) =>
    ((bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16) | (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)) >>> 0;
  return { signature: bin.slice(1, 4) + bin.slice(12, 16), w: u32(16), h: u32(20) };
}

describe("social preview meta tags", () => {
  it("declares Open Graph and a large Twitter card with an absolute image URL", () => {
    expect(meta("property", "og:type")).toBe("website");
    expect(meta("property", "og:title")).toMatch(/Relive the Round/);
    expect(meta("property", "og:description")).toBeTruthy();
    expect(meta("property", "og:url")).toBe(`${ORIGIN}/`);
    expect(meta("property", "og:image")).toBe(`${ORIGIN}/og-image.png`);
    expect(meta("property", "og:image:type")).toBe("image/png");
    expect(meta("property", "og:image:width")).toBe("1200");
    expect(meta("property", "og:image:height")).toBe("630");
    expect(meta("property", "og:image:alt")).toBeTruthy();
    expect(meta("name", "twitter:card")).toBe("summary_large_image");
    expect(meta("name", "twitter:title")).toBe(meta("property", "og:title"));
    expect(meta("name", "twitter:description")).toBe(meta("property", "og:description"));
    expect(meta("name", "twitter:image")).toBe(meta("property", "og:image"));
    expect(meta("name", "description")).toBeTruthy();
  });

  it("ships a 1200x630 PNG in public/", () => {
    expect(ogImage.startsWith("data:image/png;base64,")).toBe(true);
    expect(pngSize(ogImage)).toEqual({ signature: "PNGIHDR", w: 1200, h: 630 });
  });

  it("keeps the CSP strict: same-origin images, no external hosts, no unsafe-eval", () => {
    const csp = vercel.headers.flatMap((h) => h.headers).find((x) => x.key === "Content-Security-Policy")?.value;
    expect(csp).toBeDefined();
    expect(csp).toMatch(/(^|; )img-src 'self'/);
    expect(csp).not.toMatch(/https?:|unsafe-eval/);
    // The page itself references the preview image only via meta tags, which the CSP does not govern.
    expect(html).not.toMatch(/<(img|script|link)[^>]+og-image/);
  });
});
