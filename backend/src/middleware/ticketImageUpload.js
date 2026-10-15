const crypto = require("crypto");
const multer = require("multer");
const ApiError = require("../utils/ApiError");
const { detectImageMimeType } = require("../utils/imageSignature");

// Purchase ticket photos: kept in memory only (never written to disk) and
// discarded with the request. One long ticket may come in up to
// MAX_TICKET_IMAGES photos (field "images", in ticket order); field "image"
// keeps accepting a single photo as before.
const MAX_TICKET_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TICKET_IMAGES = 5;
const MAX_TICKET_TOTAL_BYTES = 15 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_TICKET_IMAGE_BYTES,
    files: MAX_TICKET_IMAGES
  },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new ApiError(400, "Solo se permiten imágenes jpeg, png o webp."));
      return;
    }
    callback(null, true);
  }
});

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

// One photo: its own sha256 (same value as before multi-photo support).
// Several: sha256 of the per-photo hashes sorted and joined, so the same set
// of photos gives the same 64-char value in any order (fits CHAR(64)).
function ticketImagesHash(hashes) {
  if (hashes.length === 1) return hashes[0];
  return sha256([...hashes].sort().join(","));
}

function uploadTicketImage(req, res, next) {
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "images", maxCount: MAX_TICKET_IMAGES }
  ])(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        next(new ApiError(400, "Cada foto debe pesar 5 MB o menos."));
        return;
      }
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") {
        next(new ApiError(400, `Un ticket admite como máximo ${MAX_TICKET_IMAGES} fotos.`));
        return;
      }
      if (error instanceof multer.MulterError && error.code === "LIMIT_UNEXPECTED_FILE") {
        next(new ApiError(400, `Envía las fotos en el campo 'images' (máximo ${MAX_TICKET_IMAGES}) o una sola en 'image'.`));
        return;
      }
      next(error.statusCode ? error : new ApiError(400, "Archivo de imagen inválido."));
      return;
    }

    const single = req.files?.image || [];
    const several = req.files?.images || [];
    if (single.length && several.length) {
      next(new ApiError(400, "Usa el campo 'image' o el campo 'images', no los dos."));
      return;
    }
    const files = single.length ? single : several;

    if (files.length === 0 || files.some((file) => !file.buffer || file.buffer.length === 0)) {
      next(new ApiError(400, "Se requiere al menos una foto del ticket."));
      return;
    }

    if (files.reduce((sum, file) => sum + file.buffer.length, 0) > MAX_TICKET_TOTAL_BYTES) {
      next(new ApiError(400, "Las fotos del ticket deben pesar 15 MB o menos en total."));
      return;
    }

    // The declared mimetype must match the real content (magic bytes), per photo.
    for (const file of files) {
      if (detectImageMimeType(file.buffer) !== file.mimetype) {
        next(new ApiError(400, "El contenido del archivo no corresponde a una imagen jpeg, png o webp."));
        return;
      }
      file.sha256 = sha256(file.buffer);
    }

    // The same photo twice would make the model read its lines twice.
    if (new Set(files.map((file) => file.sha256)).size !== files.length) {
      next(new ApiError(400, "La misma foto se envió más de una vez."));
      return;
    }

    // Photos in ticket order, plus the hash the confirmation stores.
    req.ticketImages = files;
    req.ticketImagesSha256 = ticketImagesHash(files.map((file) => file.sha256));
    // Single-photo shape kept for callers of req.file.
    req.file = files.length === 1 ? files[0] : undefined;
    next();
  });
}

module.exports = {
  MAX_TICKET_IMAGE_BYTES,
  MAX_TICKET_IMAGES,
  MAX_TICKET_TOTAL_BYTES,
  ticketImagesHash,
  uploadTicketImage
};
