// Encodes a FormData as raw multipart bytes for a test Request body. Node 24's built-in undici streams a FormData body
// with a race (a late enqueue after the reader closed the stream), which surfaces as an unhandled "ReadableStream is
// already closed" rejection and fails the run. Real uploads arrive as bytes from the socket, so tests send bytes too.
export async function multipart(form: FormData): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string }> {
  const boundary = "----dossierTestBoundary";
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [name, value] of form) {
    if (typeof value === "string") {
      chunks.push(
        enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value.replace(/\r?\n|\r/g, "\r\n")}\r\n`,
        ),
      );
    } else {
      chunks.push(
        enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.name}"\r\nContent-Type: ${value.type || "application/octet-stream"}\r\n\r\n`,
        ),
      );
      chunks.push(new Uint8Array(await value.arrayBuffer()), enc.encode("\r\n"));
    }
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  return { body: new Uint8Array(Buffer.concat(chunks)), contentType: `multipart/form-data; boundary=${boundary}` };
}
