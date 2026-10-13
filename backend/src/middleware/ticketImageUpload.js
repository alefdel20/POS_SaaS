const crypto = require("crypto");
const multer = require("multer");
const ApiError = require("../utils/ApiError");
const { detectImageMimeType } = require("../utils/imageSignature");

// Purchase ticket photo: kept in memory only (never written to disk) and
// discarded with the request. Not mounted on any route yet.
const MAX_TICKET_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_TICKET_IMAGE_BYTES,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new ApiError(400, "Solo se permiten imágenes jpeg, png o webp."));
      return;
    }
    callback(null, true);
  }
});

function uploadTicketImage(req, res, next) {
  upload.single("image")(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        next(new ApiError(400, "La imagen debe pesar 5 MB o menos."));
        return;
      }
      if (error instanceof multer.MulterError && (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE")) {
        next(new ApiError(400, "Solo se permite una imagen en el campo 'image'."));
        return;
      }
      next(error.statusCode ? error : new ApiError(400, "Archivo de imagen inválido."));
      return;
    }

    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      next(new ApiError(400, "Se requiere una imagen en el campo 'image'."));
      return;
    }

    // The declared mimetype must match the real content (magic bytes).
    if (detectImageMimeType(req.file.buffer) !== req.file.mimetype) {
      next(new ApiError(400, "El contenido del archivo no corresponde a una imagen jpeg, png o webp."));
      return;
    }

    req.file.sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    next();
  });
}

module.exports = {
  MAX_TICKET_IMAGE_BYTES,
  uploadTicketImage
};
