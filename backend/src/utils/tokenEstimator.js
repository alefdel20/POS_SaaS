const CHARS_PER_TOKEN = 4;
const OVERHEAD_PER_MESSAGE = 4;

function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateChatTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, msg) => {
    return total + estimateTokens(msg.content || "") + OVERHEAD_PER_MESSAGE;
  }, 0);
}

module.exports = { estimateTokens, estimateChatTokens };
