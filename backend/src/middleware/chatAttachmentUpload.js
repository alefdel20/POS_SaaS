const multer = require("multer");
const ApiError = require("../utils/ApiError");
const { detectImageMimeType } = require("../utils/imageSignature");
const { isPdfBuffer, isEncryptedPdf } = require("../utils/pdfSignature");

// AI chat attachment (read only): one image or PDF in the "attachment" field,
// kept in memory only (never written to disk) and discarded with the request.
// A request without a file (JSON, or multipart without "attachment") passes
// through untouched. Sets req.chatAttachment = { kind, media_type, name }; the
// bytes stay in req.file.buffer. Never logs the file or its name.
const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CHAT_PDF_BYTES = 3 * 1024 * 1024;
const MAX_ATTACHMENT_NAME_LENGTH = 80;

const ATTACHMENT_KINDS = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "application/pdf": "pdf"
};

const upload = multer({
  storage: multer.memoryStorage(),
  // Browsers send the raw UTF-8 file name; multer's default reads it as latin1.
  defParamCharset: "utf8",
  // busboy flags a file that reaches fileSize exactly as over the limit, so
  // one extra byte keeps "up to 5 MB" inclusive; the exact size per type is
  // checked below.
  limits: {
    fileSize: MAX_CHAT_IMAGE_BYTES + 1,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!ATTACHMENT_KINDS[file.mimetype]) {
      callback(new ApiError(400, "Solo se permiten imágenes jpeg, png o webp, o un PDF."));
      return;
    }
    callback(null, true);
  }
});

// Stored in ai_chat_messages as "[Adjunto: <name>]": last path segment only, no
// control or bidi-override characters, at most 80 characters.
function sanitizeAttachmentName(name) {
  const base = String(name || "").split(/[\\/]/).pop();
  const clean = base
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "")
    .trim();
  const limited = Array.from(clean).slice(0, MAX_ATTACHMENT_NAME_LENGTH).join("").trim();
  return limited || "archivo";
}

function realTypeMatches(buffer, declaredType) {
  if (declaredType === "application/pdf") return isPdfBuffer(buffer);
  return detectImageMimeType(buffer) === declaredType;
}

function uploadChatAttachment(req, res, next) {
  upload.single("attachment")(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        next(new ApiError(400, "La imagen debe pesar 5 MB o menos y el PDF 3 MB o menos."));
        return;
      }
      if (error instanceof multer.MulterError && (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE")) {
        next(new ApiError(400, "Solo se permite un archivo en el campo 'attachment'."));
        return;
      }
      next(error.statusCode ? error : new ApiError(400, "Archivo adjunto inválido."));
      return;
    }

    if (!req.file) {
      next();
      return;
    }

    const { buffer, mimetype } = req.file;
    if (!buffer || buffer.length === 0) {
      next(new ApiError(400, "El archivo adjunto está vacío."));
      return;
    }

    const kind = ATTACHMENT_KINDS[mimetype];
    if (buffer.length > (kind === "pdf" ? MAX_CHAT_PDF_BYTES : MAX_CHAT_IMAGE_BYTES)) {
      next(new ApiError(400, "La imagen debe pesar 5 MB o menos y el PDF 3 MB o menos."));
      return;
    }

    // The declared mimetype must match the real content (magic bytes).
    if (!realTypeMatches(buffer, mimetype)) {
      next(new ApiError(400, "El contenido del archivo no corresponde al tipo declarado (jpeg, png, webp o PDF)."));
      return;
    }

    if (kind === "pdf" && isEncryptedPdf(buffer)) {
      next(new ApiError(400, "El PDF está protegido o cifrado. Súbelo sin contraseña."));
      return;
    }

    req.chatAttachment = {
      kind,
      media_type: mimetype,
      name: sanitizeAttachmentName(req.file.originalname)
    };
    next();
  });
}

module.exports = {
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_PDF_BYTES,
  sanitizeAttachmentName,
  uploadChatAttachment
};
