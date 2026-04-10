const { whoToFindKeyboard } = require('../utils/keyboard');

module.exports = async (bot, msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Зберігаємо стан для нового користувача або скидаємо старий
  if (!global.userStates) global.userStates = new Map();
  global.userStates.set(userId, { step: 'who_to_find' });
  
  await bot.sendMessage(
    chatId,
    "👋 **Ласкаво просимо до бота знайомств Закарпаття!**\n\n" +
    "📝 **Заповніть вашу анкету:**\n\n" +
    "👇 **Кого ви хочете шукати?**",
    { parse_mode: "Markdown", ...whoToFindKeyboard }
  );
};