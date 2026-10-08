// Public AI interface used by the controllers. The implementation, including
// provider selection per feature, lives in ./llm (index.js + one adapter per
// provider).
module.exports = require("./llm");
