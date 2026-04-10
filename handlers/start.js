const { whoToFindKeyboard } = require('../utils/keyboard');

module.exports = (bot, msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "👋 Вітаю в боті знайомств Закарпаття!\n\n" +
    "Давай спочатку налаштуємо твій профіль.\n\n" +
    "👉 **Оберіть кого хочете шукати:**",
    { parse_mode: "Markdown", ...whoToFindKeyboard }
  );
};