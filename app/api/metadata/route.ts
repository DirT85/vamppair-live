import { NextResponse } from "next/server";
import { protectRequest } from "@/lib/request-protection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5_000_000;

function textField(form: FormData, key: string, max: number) {
  const value = String(form.get(key) || "").trim();
  if (!value) throw new Error(`${key} is required.`);
  if (value.length > max) throw new Error(`${key} is too long.`);
  return value;
}

export async function POST(request: Request) {
  const blocked = await protectRequest(request, {
    bucket: "metadata-upload",
    limit: 4,
    windowMs: 10 * 60_000,
  });
  if (blocked) return blocked;

  try {
    const form = await request.formData();
    const name = textField(form, "name", 32);
    const symbol = textField(form, "symbol", 13).toUpperCase();
    const description = textField(form, "description", 500);
    const image = form.get("image");

    if (!(image instanceof File) || image.size === 0) {
      throw new Error("Choose an image for the vamp coin.");
    }
    if (!image.type.startsWith("image/")) throw new Error("The upload must be an image.");
    if (image.size > MAX_IMAGE_BYTES) throw new Error("The image must be 5 MB or smaller.");

    const upload = new FormData();
    upload.set("name", name);
    upload.set("symbol", symbol);
    upload.set("description", description);
    upload.set("showName", "true");
    upload.set("file", image, image.name || "vamp.png");

    const response = await fetch("https://pump.fun/api/ipfs", {
      method: "POST",
      body: upload,
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        typeof payload.error === "string" ? payload.error : "Pump metadata upload failed.",
      );
    }

    const metadataUri = String(payload.metadataUri || payload.uri || "");
    if (!/^https:\/\//.test(metadataUri)) throw new Error("Pump did not return a metadata URL.");

    return NextResponse.json({ metadataUri });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Metadata upload failed.";
    return NextResponse.json({ error: message.slice(0, 240) }, { status: 422 });
  }
}
