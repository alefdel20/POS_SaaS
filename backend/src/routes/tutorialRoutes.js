const express = require("express");
const { markTutorialSeen } = require("../controllers/tutorialController");

const router = express.Router();

router.patch("/tutorial-seen", markTutorialSeen);

module.exports = router;
