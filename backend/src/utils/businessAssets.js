const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const UPLOADS_PUBLIC_PREFIX = "/uploads/profile-assets";
const uploadsRoot = path.resolve(__dirname, "../../uploads/profile-assets");

async function ensureBusinessAssetsDirectory() {
  await fs.promises.mkdir(uploadsRoot, { recursive: true });
}

function buildStoredBusinessAssetPath(filename) {
  return `${UPLOADS_PUBLIC_PREFIX}/${filename}`;
}

function createBusinessAssetFilename(originalname = "", assetType = "asset") {
  const extension = path.extname(String(originalname || "")).toLowerCase() || ".jpg";
  return `${assetType}-${Date.now()}-${crypto.randomUUID()}${extension}`;
}

function isManagedBusinessAssetPath(assetPath) {
  return typeof assetPath === "string" && assetPath.startsWith(`${UPLOADS_PUBLIC_PREFIX}/`);
}

function resolveStoredBusinessAssetAbsolutePath(assetPath) {
  if (!isManagedBusinessAssetPath(assetPath)) {
    return null;
  }

  return path.join(uploadsRoot, path.basename(assetPath));
}

async function deleteStoredBusinessAsset(assetPath) {
  const absolutePath = resolveStoredBusinessAssetAbsolutePath(assetPath);
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
  ensureBusinessAssetsDirectory,
  buildStoredBusinessAssetPath,
  createBusinessAssetFilename,
  resolveStoredBusinessAssetAbsolutePath,
  deleteStoredBusinessAsset
};
