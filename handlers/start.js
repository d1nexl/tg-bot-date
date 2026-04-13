const { whoToFindKeyboard } = require('../utils/keyboard');

module.exports = async (bot, msg, userStates) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (userStates) {
    userStates.set(userId, { step: 'who_to_find' });
  }

  await bot.sendMessage(
    chatId,
    "👋 **Ласкаво просимо до бота знайомств Закарпаття!**\n\n" +
    "📝 **Заповніть вашу анкету:**\n\n" +
    "👇 **Кого ви хочете шукати?**",
    { parse_mode: "Markdown", ...whoToFindKeyboard }
  );
};