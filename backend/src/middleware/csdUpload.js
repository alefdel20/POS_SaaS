const multer = require("multer");
const ApiError = require("../utils/ApiError");

const MAX_FILE_SIZE = 50 * 1024; // 50KB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, callback) => {
    const ext = (file.originalname || "").toLowerCase();
    if (!ext.endsWith(".cer") && !ext.endsWith(".key")) {
      callback(new ApiError(400, "Solo se permiten archivos .cer y .key"));
      return;
    }
    callback(null, true);
  }
});

function uploadCsd(req, res, next) {
  upload.fields([
    { name: "cer", maxCount: 1 },
    { name: "key", maxCount: 1 }
  ])(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new ApiError(400, "Cada archivo CSD debe ser menor a 50KB"));
      return;
    }

    next(error.statusCode ? error : new ApiError(400, error.message || "Error al subir archivos CSD"));
  });
}

module.exports = { uploadCsd };
