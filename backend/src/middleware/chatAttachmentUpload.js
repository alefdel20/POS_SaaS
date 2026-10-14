const path = require("path");
const multer = require("multer");
const ApiError = require("../utils/ApiError");
const { detectImageMimeType } = require("../utils/imageSignature");
const { isPdfBuffer, isEncryptedPdf } = require("../utils/pdfSignature");
const { decodeTextAttachment } = require("../utils/textSignature");

// AI chat attachment (read only): one image, PDF or text file in the
// "attachment" field, kept in memory only (never written to disk) and
// discarded with the request. A request without a file (JSON, or multipart
// without "attachment") passes through untouched. Sets
// req.chatAttachment = { kind, media_type, name }; image/PDF bytes stay in
// req.file.buffer and a text file's decoded content in req.chatAttachmentText.
// Never logs the file, its content or its name.
const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CHAT_PDF_BYTES = 3 * 1024 * 1024;
const MAX_CHAT_TEXT_BYTES = 300 * 1024;
const MAX_ATTACHMENT_NAME_LENGTH = 80;

const ATTACHMENT_KINDS = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "application/pdf": "pdf"
};

// Text files are accepted by extension and content, never by the declared
// mimetype (Windows browsers report .csv as application/vnd.ms-excel, etc.).
// .xml is plain text too: it is never parsed (no entities, no DTD).
const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".md", ".xml"]);

const TEXT_REJECTED_MESSAGES = {
  empty: "El archivo de texto está vacío.",
  nul: "El archivo no es de texto. Solo se aceptan .txt, .csv, .md o .xml con texto plano (no Word, Excel, PDF ni imágenes).",
  binary: "El archivo no es de texto. Solo se aceptan .txt, .csv, .md o .xml con texto plano (no Word, Excel, PDF ni imágenes).",
  encoding: "El archivo de texto debe estar guardado en UTF-8. Guárdalo como UTF-8 e intenta de nuevo."
};

function isTextAttachmentName(name) {
  const base = String(name || "").split(/[\\/]/).pop();
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase());
}

// Requests whose file was accepted as text, so a size error names the right limit.
const textUploads = new WeakSet();

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
    if (isTextAttachmentName(file.originalname)) {
      textUploads.add(req);
      callback(null, true);
      return;
    }
    if (!ATTACHMENT_KINDS[file.mimetype]) {
      callback(new ApiError(400, "Solo se permiten imágenes jpeg, png o webp, o un PDF; también archivos de texto .txt, .csv, .md o .xml."));
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
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
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
        next(new ApiError(400, textUploads.has(req)
          ? "El archivo de texto debe pesar 300 KB o menos."
          : "La imagen debe pesar 5 MB o menos y el PDF 3 MB o menos."));
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

    // Text: extension + content decide; the declared mimetype is ignored.
    if (isTextAttachmentName(req.file.originalname)) {
      if (buffer.length > MAX_CHAT_TEXT_BYTES) {
        next(new ApiError(400, "El archivo de texto debe pesar 300 KB o menos."));
        return;
      }
      const decoded = decodeTextAttachment(buffer);
      if (decoded.text === undefined) {
        next(new ApiError(400, TEXT_REJECTED_MESSAGES[decoded.reason] || TEXT_REJECTED_MESSAGES.binary));
        return;
      }
      req.chatAttachment = {
        kind: "text",
        media_type: "text/plain",
        name: sanitizeAttachmentName(req.file.originalname)
      };
      req.chatAttachmentText = decoded.text;
      next();
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
  MAX_CHAT_TEXT_BYTES,
  sanitizeAttachmentName,
  uploadChatAttachment
};
