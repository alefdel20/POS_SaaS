const pool = require("../db/pool");

async function markTutorialSeen(req, res, next) {
  try {
    const userId = req.user.id;
    console.log("[TUTORIAL] userId from req.user:", req.user);
    const result = await pool.query(
      "UPDATE users SET tutorial_seen = TRUE, updated_at = NOW() WHERE id = $1",
      [userId]
    );
    console.log("[TUTORIAL] rows affected:", result.rowCount);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

module.exports = { markTutorialSeen };
