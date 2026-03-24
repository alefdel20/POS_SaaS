const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const UPLOADS_PUBLIC_PREFIX = "/uploads/products";
const uploadsRoot = path.resolve(__dirname, "../../uploads/products");

async function ensureUploadsDirectory() {
  await fs.promises.mkdir(uploadsRoot, { recursive: true });
}

function buildStoredImagePath(filename) {
  return `${UPLOADS_PUBLIC_PREFIX}/${filename}`;
}

function createProductImageFilename(originalname = "") {
  const extension = path.extname(String(originalname || "")).toLowerCase() || ".jpg";
  return `${Date.now()}-${crypto.randomUUID()}${extension}`;
}

function isManagedProductImagePath(imagePath) {
  return typeof imagePath === "string" && imagePath.startsWith(`${UPLOADS_PUBLIC_PREFIX}/`);
}

function resolveStoredImageAbsolutePath(imagePath) {
  if (!isManagedProductImagePath(imagePath)) {
    return null;
  }

  return path.join(uploadsRoot, path.basename(imagePath));
}

async function deleteStoredImage(imagePath) {
  const absolutePath = resolveStoredImageAbsolutePath(imagePath);
  if (!absolutePath) {
    return false;
  }

  try {
    await fs.promises.unlink(absolutePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

module.exports = {
  UPLOADS_PUBLIC_PREFIX,
  uploadsRoot,
  ensureUploadsDirectory,
  buildStoredImagePath,
  createProductImageFilename,
  deleteStoredImage
};
