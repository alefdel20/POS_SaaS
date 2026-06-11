const express = require("express");
const { getPublicMenu } = require("../controllers/publicMenuController");

const router = express.Router();

// Público (montado con auth: false en app.js). GET /menu/:slug
router.get("/:slug", getPublicMenu);

module.exports = router;
