import { NextRequest, NextResponse } from "next/server";
import { applicationExists } from "@/lib/db/files";
import { storeUploadedFile, type StoredFile } from "@/lib/files/store";
import { isLocalHost, isSameOrigin } from "@/lib/local-request";
import { parseUploadFields } from "@/lib/upload-form";

// POST /api/applications/:id/files  multipart: files (one or more), label, uploadDate (YYYY-MM-DD, default today, server local time).
// 201 { files: [{ id, storedName, relativePath, sizeBytes, sha256 }] }; 400 { errors } for bad fields; 403 not local or not same-origin;
// 404 unknown application; 409 files folder unset or unusable (Settings); 413 over the size limit; 500 { error, files } if a file fails
// (files stored before it stay stored: each is complete). A Route Handler, not a server action: actions cap the body at 1 MB.
// Next.js route handlers have no body limit of their own, so the limit is enforced here: the whole request may be at most 50 MB
// (Content-Length checked first, then the bytes actually received, since the header can be missing or false). formData() holds the
// request in memory, which is fine at this size for a local single-user app.
// FR-5.7 (identical hash warning) is 5.9; for now an identical upload is stored as a new seq.
const MAX_BYTES = 50 * 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

class TooLarge extends Error {}

async function readForm(request: NextRequest): Promise<FormData | "too-large" | "bad"> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data") || !request.body) return "bad";
  let received = 0;
  const limited = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_BYTES) controller.error(new TooLarge());
      else controller.enqueue(chunk);
    },
  }));
  try {
    return await new Response(limited, { headers: { "content-type": type } }).formData();
  } catch {
    return received > MAX_BYTES ? "too-large" : "bad";
  }
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/applications/[id]/files">) {
  if (!isLocalHost(request.headers) || !isSameOrigin(request.headers)) return json({ error: "Local use only." }, 403);
  const { id: raw } = await ctx.params;
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || !(await applicationExists(id))) return json({ error: "Application not found." }, 404);
  const tooLarge = () => json({ error: "That upload is over the 50 MB limit. Nothing was saved." }, 413);
  if (Number(request.headers.get("content-length")) > MAX_BYTES) return tooLarge();

  const form = await readForm(request);
  if (form === "too-large") return tooLarge();
  if (form === "bad") return json({ error: "Send the files as multipart form data." }, 400);

  const parsed = parseUploadFields(form.get("label"), form.get("uploadDate"));
  // A file input left empty still sends a part with no name and no bytes: that is "nothing chosen", not a file.
  const uploads = form.getAll("files").filter((f) => !(f instanceof File && f.name === "" && f.size === 0));
  const errors: { label?: string; uploadDate?: string; files?: string } = parsed.ok ? {} : parsed.errors;
  if (uploads.length === 0 || !uploads.every((f) => f instanceof File)) errors.files = "Choose at least one file.";
  if (!parsed.ok || errors.files) return json({ errors }, 400);

  const stored: StoredFile[] = [];
  for (const file of uploads as File[]) {
    const r = await storeUploadedFile({ applicationId: id, file, ...parsed.fields });
    if (r.ok) { stored.push(r.file); continue; }
    const status = r.kind === "setup" ? 409 : r.kind === "not-found" ? 404 : 500;
    return json({ error: r.error, files: stored }, status);
  }
  return json({ files: stored }, 201);
}
