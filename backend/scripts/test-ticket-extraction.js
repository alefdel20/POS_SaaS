// Runs extractPurchaseTicket on every image in a folder and prints the JSON,
// tokens and time for each one. Manual check of the Claude vision prompt:
// no database, no server, no endpoints.
//
// Uses ANTHROPIC_API_KEY from the process environment (no .env is loaded).
// Usage (from backend/):
//   node scripts/test-ticket-extraction.js <carpeta-con-imagenes>
// Optional: ANTHROPIC_MODEL_VISION to try another model.
const fs = require("fs");
const path = require("path");

// This script exercises the Claude path; an explicit value is respected.
if (!process.env.AI_PROVIDER_VISION) process.env.AI_PROVIDER_VISION = "anthropic";

const { extractPurchaseTicket } = require("../src/services/purchaseTicketService");
const { detectImageMimeType } = require("../src/utils/imageSignature");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error("Uso: node scripts/test-ticket-extraction.js <carpeta-con-imagenes>");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Falta ANTHROPIC_API_KEY en el entorno del proceso.");
    process.exit(1);
  }

  const files = fs.readdirSync(folder)
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort();
  if (!files.length) {
    console.error(`No hay imágenes jpg, png o webp en ${folder}`);
    process.exit(1);
  }

  const totals = { ok: 0, failed: 0, input_tokens: 0, output_tokens: 0, ms: 0 };

  for (const name of files) {
    const buffer = fs.readFileSync(path.join(folder, name));
    const mimeType = detectImageMimeType(buffer);
    if (buffer.length > MAX_BYTES || !mimeType) {
      totals.failed += 1;
      console.log(JSON.stringify({
        file: name,
        error: buffer.length > MAX_BYTES ? "Imagen mayor a 5 MB" : "Firma de imagen no reconocida"
      }, null, 2));
      continue;
    }

    const startedAt = Date.now();
    try {
      const result = await extractPurchaseTicket(buffer, mimeType);
      const ms = Date.now() - startedAt;
      totals.ok += 1;
      totals.input_tokens += result.input_tokens;
      totals.output_tokens += result.output_tokens;
      totals.ms += ms;
      console.log(JSON.stringify({
        file: name,
        model: result.model,
        ms,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        ticket: result.ticket
      }, null, 2));
    } catch (error) {
      totals.failed += 1;
      console.log(JSON.stringify({
        file: name,
        ms: Date.now() - startedAt,
        error: error.message,
        code: error.code || null
      }, null, 2));
    }
  }

  console.log(JSON.stringify({ resumen: totals }, null, 2));
  if (totals.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
