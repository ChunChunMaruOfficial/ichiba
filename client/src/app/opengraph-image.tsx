import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The link preview for every page without one of its own (the home page, the sections, brand and category pages):
 * what Telegram, VK and messengers show when someone shares ichiba. Washi paper, sumi ink and the cinnabar 市 seal,
 * as on the site. The fonts are subsets of Spectral and Yuji Syuku (OFL) with just the letters below
 * (assets/fonts): change the text, fetch them again with Google Fonts' `text=` parameter.
 */

export const alt = "ichiba — вещи с историей. Маркетплейс одежды из открытых гардеробов Беларуси";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export default async function Image() {
  const [semibold, regular, brush] = await Promise.all([font("spectral-600.ttf"), font("spectral-400.ttf"), font("yuji-syuku.ttf")]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f4efe6", padding: "72px 80px", fontFamily: "Spectral", color: "#1c1a17" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 120, fontWeight: 600, letterSpacing: -4 }}>ichiba</span>
          <div style={{ width: 132, height: 132, borderRadius: 999, background: "#c8102e", display: "flex", alignItems: "center", justifyContent: "center", color: "#f4efe6", fontFamily: "Yuji Syuku", fontSize: 84 }}>
            市
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 76, fontWeight: 600, lineHeight: 1.05 }}>Вещи с историей</span>
          <span style={{ marginTop: 20, fontSize: 38, fontWeight: 400, color: "#6b6459", lineHeight: 1.3 }}>Маркетплейс одежды из открытых гардеробов Беларуси</span>
        </div>
        <div style={{ display: "flex", height: 6, background: "#1c1a17", borderRadius: 3, width: 220 }} />
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Spectral", data: semibold, weight: 600, style: "normal" },
        { name: "Spectral", data: regular, weight: 400, style: "normal" },
        { name: "Yuji Syuku", data: brush, weight: 400, style: "normal" },
      ],
    },
  );
}
