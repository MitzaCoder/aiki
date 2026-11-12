# PDF text fallback (T140)

## Dependency choice

Pinned `unpdf` **2.1.0**, maintained in `unjs/unpdf`. It explicitly supports Bun
and ships a serverless PDF.js 6.4.299 bundle with its worker inlined. Registry
metadata reports **3,237,128 bytes unpacked**, including types and image decoders;
it has no required runtime dependencies. The optional canvas peer is not installed
or used for text extraction. We disable WASM, font-face loading and offscreen
rendering; this is text extraction, not OCR or page rendering.

Licences: the wrapper is MIT; bundled PDF.js is Apache-2.0. Upstream notices for
PDF.js and optional bundled image decoders are copied without modification into
`packages/server/PDF-LICENSES.txt`. Source archives contain it; `build-binary.ts`
and release CI keep a `.licenses.txt` sidecar with each executable. Installer work
must retain that notice with the installed executable; `install.sh` is unchanged
by this task.

Sources checked:
- <https://github.com/unjs/unpdf>
- <https://registry.npmjs.org/unpdf/2.1.0>
- The pinned package's README, `LICENSE` and `dist/licenses/`.

## Bounds and fallback

The original PDF is always stored under the conversation's private attachment
folder. Extraction walks pages sequentially, stopping at 200 pages or 100 KiB of
UTF-8 output. It cleans each page and destroys the document's loading task. The
message includes the total page count, a fenced text excerpt, an explicit
truncation notice when needed, and “text extracted; the original is at <path>”.

Scanned image-only PDFs, encrypted PDFs without a password and unreadable PDFs
retain the original path without a fake text excerpt. No external renderer,
subprocess, provider API, OCR service or archive expansion is used. The page/output
limits bound normal extraction work, not an OS-level CPU/memory sandbox.

## Standalone executable

The literal dynamic import is lazy at runtime but bundled by Bun `--compile`.
A source helper extracted the synthetic one-page PDF. Its minified compiled
executable also did so from an empty working directory under an empty PATH,
with no Bun or dependency directory available.
The real binary smoke now additionally uploads a synthetic PDF, submits its ID and
checks the transcript for the extracted marker and original-path notice. Existing
owner/auth/web/coordinator/codemode/worker/Photon smokes remain enabled. Full gate
results and executable size are recorded in T140 and `docs/CONTINUE.md`.
The Linux x64 production executable is 130,443,440 bytes (124.40 MiB), about
1.59 MiB above the qttywtxo reference build; the wrapper's published unpacked
package size includes types and optional decoders, not just shipped text code.

## Upstream native-document work

Installed pi-ai 1.5.1 only has text/image user content and catalog modalities.
Native PDFs need all of the following, not a model-name guess or image capability:

1. A typed `DocumentContent`/`FileContent` user block (MIME, name and bytes/base64
   or provider file reference), preserved by message transforms and serialization.
2. Catalog document/PDF capabilities and per-model byte/count/page limits.
3. Anthropic Messages conversion to a native `document` block with an
   `application/pdf` base64 source.
4. OpenAI Responses conversion to `input_file` (`filename` plus `file_data`/ID).
   Codex Responses must implement and advertise it only if its endpoint accepts
   that shape; otherwise it must retain a text fallback.
5. Tests for cross-model history, unsupported-model fallback, limits and replay.

No pi-ai files or provider payload hooks were patched here.
