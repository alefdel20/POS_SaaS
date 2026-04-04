const multer = require("multer");
const ApiError = require("../utils/ApiError");

const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    const extension = String(file.originalname || "").toLowerCase();
    const isAllowedExtension = extension.endsWith(".csv") || extension.endsWith(".xlsx");
    if (!isAllowedExtension || (!ALLOWED_MIME_TYPES.has(file.mimetype) && file.mimetype !== "application/octet-stream")) {
      callback(new ApiError(400, "Only CSV and XLSX files are allowed"));
      return;
    }
    callback(null, true);
  }
});

function uploadProductImportFile(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new ApiError(400, "Import file must be 5MB or smaller"));
      return;
    }

    next(error.statusCode ? error : new ApiError(400, error.message || "Invalid import file"));
  });
}

module.exports = {
  uploadProductImportFile
};
