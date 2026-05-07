const pool = require("../db/pool");

async function markTutorialSeen(req, res, next) {
  try {
    const userId = req.user.userId;
    await pool.query(
      "UPDATE users SET tutorial_seen = TRUE, updated_at = NOW() WHERE id = $1",
      [userId]
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

module.exports = { markTutorialSeen };
