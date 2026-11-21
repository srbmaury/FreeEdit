/* File identity is independent of editor state, DOM and project storage. */
export async function fingerprintSource(file) {
  // Hash every byte in fixed chunks, then hash their digests. Memory stays bounded.
  const chunkSize = 4 * 1024 * 1024;
  const digests = [];
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const bytes = await file.slice(offset, offset + chunkSize).arrayBuffer();
    digests.push(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  }
  const combined = new Uint8Array(digests.length * 32);
  digests.forEach((digest, index) => combined.set(digest, index * 32));
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return {name: file.name, size: file.size, fingerprint: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""), algorithm: "sha256-chunks-4m-v1"};
}
