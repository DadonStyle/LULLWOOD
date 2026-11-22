import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { SITE_URL } from "@/lib/site";

const MAX_TITLE = 80;
const FALLBACK_TITLE = "Lullwood";

function cleanTitle(raw: string | null): string {
  const t = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return FALLBACK_TITLE;
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1).trimEnd()}…` : t;
}

async function background(): Promise<string> {
  const buf = await readFile(path.join(process.cwd(), "app", "opengraph-image.png"));
  return `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
}

export const runtime = "nodejs";

export async function GET(req: Request) {
  const title = cleanTitle(new URL(req.url).searchParams.get("title"));
  const bg = await background();
  const host = SITE_URL.replace(/^https?:\/\//, "");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#05070a" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={bg} width={1200} height={630} alt="" style={{ position: "absolute", top: 0, left: 0 }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 330,
            display: "flex",
            background: "linear-gradient(to top, rgba(2,4,6,0.94) 0%, rgba(2,4,6,0.82) 55%, rgba(2,4,6,0) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 64,
            right: 64,
            bottom: 48,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ fontSize: 26, letterSpacing: 8, color: "#9fd6a4", textTransform: "uppercase", display: "flex" }}>
            Lullwood
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: title.length > 52 ? 50 : 62,
              lineHeight: 1.12,
              fontWeight: 700,
              color: "#f2f5f0",
              display: "flex",
            }}
          >
            {title}
          </div>
          <div style={{ marginTop: 18, fontSize: 26, color: "#aab4aa", display: "flex" }}>{host}</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
  );
}
