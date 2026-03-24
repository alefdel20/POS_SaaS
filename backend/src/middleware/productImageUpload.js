const multer = require("multer");
const ApiError = require("../utils/ApiError");
const {
  uploadsRoot,
  ensureUploadsDirectory,
  createProductImageFilename
} = require("../utils/productImages");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, callback) => {
      try {
        await ensureUploadsDirectory();
        callback(null, uploadsRoot);
      } catch (error) {
        callback(error);
      }
    },
    filename: (req, file, callback) => {
      callback(null, createProductImageFilename(file.originalname));
    }
  }),
  limits: {
    fileSize: 2 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new ApiError(400, "Only jpg, jpeg, png and webp images are allowed"));
      return;
    }

    callback(null, true);
  }
});

function uploadProductImage(req, res, next) {
  upload.single("image")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new ApiError(400, "Image must be 2MB or smaller"));
      return;
    }

    next(error.statusCode ? error : new ApiError(400, error.message || "Invalid product image upload"));
  });
}

module.exports = {
  uploadProductImage
};
