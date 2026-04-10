require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Імпорт БД
const { connectDB, User, Message, Report } = require('./database.js');
const ADMINS = process.env.ADMINS ? process.env.ADMINS.split(',').map(Number) : [];

// Тимчасове сховище
const userStates = new Map();
const activeChats = new Map();
const waitingUsers = new Map(); // Черга користувачів, які чекають на співрозмовника

// Імпорт кнопок
const startHandler = require('./handlers/start.js');
const { whoToFindKeyboard, whoAreYouKeyboard, districtKeyboard, mainMenuKeyboard, settingsKeyboard } = require('./utils/keyboard.js');

// Підключення до БД
connectDB();

// Команда /start
bot.onText(/\/start/, (msg) => startHandler(bot, msg));

// Команда для припинення пошуку
bot.onText(/\/stopsearch/, async (msg) => {
  const userId = msg.from.id;
  if (waitingUsers.has(userId)) {
    waitingUsers.delete(userId);
    await bot.sendMessage(msg.chat.id, "🔍 Пошук припинено. Ви в головному меню:");
    await updateMainMenu(msg.chat.id, userId);
  }
});

// Функція для оновлення головного меню
async function updateMainMenu(chatId, userId) {
  const isInChat = activeChats.has(userId);
  const isWaiting = waitingUsers.has(userId);
  
  let menuKeyboard;
  if (isInChat) {
    menuKeyboard = [["🔍 Шукати іншого", "❌ Завершити чат"], ["📜 Правила", "📞 Підтримка"]];
  } else if (isWaiting) {
    menuKeyboard = [["⏹️ Припинити пошук"], ["⚙️ Налаштування", "📜 Правила", "📞 Підтримка"]];
  } else {
    menuKeyboard = [["🔍 Пошук користувача", "⚙️ Налаштування"], ["📜 Правила", "📞 Підтримка"]];
  }
  
  const menuKeyboardObj = {
    reply_markup: {
      keyboard: menuKeyboard,
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
  
  try {
    await bot.sendMessage(chatId, "📋 Головне меню:", menuKeyboardObj);
  } catch (error) {
    console.log('Помилка оновлення меню:', error.message);
  }
}

bot.onText(/\/admin/, async (msg) => {
  const userId = msg.from.id;
  
  if (!ADMINS.includes(userId)) {
    await bot.sendMessage(userId, "❌ У вас немає доступу до адмін-панелі.");
    return;
  }
  
  const adminKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📊 Статистика", callback_data: "admin_stats" }],
        [{ text: "💬 Останні повідомлення", callback_data: "admin_messages" }],
        [{ text: "👥 Список користувачів", callback_data: "admin_users" }],
        [{ text: "⚠️ Скарги", callback_data: "admin_reports" }],
        [{ text: "🔒 Заблокувати користувача", callback_data: "admin_block" }],
        [{ text: "🔓 Розблокувати", callback_data: "admin_unblock" }]
      ]
    }
  };
  
  await bot.sendMessage(userId, "🛡️ **Адмін-панель**\n\nОберіть дію:", { parse_mode: "Markdown", ...adminKeyboard });
});

// Команда для перевірки чи заблокований користувач
async function isBlocked(userId) {
  const user = await User.findOne({ telegramId: userId });
  return user ? user.isBlocked : false;
}

// Функція для безпечної відповіді на callback
async function answerCallback(callbackQuery, text = '', showAlert = false) {
  try {
    await bot.answerCallbackQuery(callbackQuery.id, { text, showAlert });
  } catch (error) {}
}

// Функція пошуку користувачів
async function findMatches(userId, userData) {
  try {
    let findCondition = {};
    
    if (userData.findGender === 'find_boys') {
      findCondition.userGender = 'iam_boy';
    } else if (userData.findGender === 'find_girls') {
      findCondition.userGender = 'iam_girl';
    }
    
    if (userData.district !== 'dist_all') {
      findCondition.district = userData.district;
    }
    
    const matches = await User.find({
      telegramId: { $ne: userId },
      isBlocked: false,
      ...findCondition
    }).limit(50);
    
    return matches;
  } catch (error) {
    console.error('Помилка пошуку:', error);
    return [];
  }
}

// Функція спроби знайти пару для користувача з черги
async function tryFindMatch(userId) {
  const waitingList = Array.from(waitingUsers.keys());
  
  for (const waitingId of waitingList) {
    if (waitingId !== userId && !activeChats.has(waitingId)) {
      // Знайшли пару
      waitingUsers.delete(waitingId);
      waitingUsers.delete(userId);
      await createChat(userId, waitingId);
      return true;
    }
  }
  return false;
}

// Функція створення чату
async function createChat(user1Id, user2Id) {
  const user1 = await User.findOne({ telegramId: user1Id });
  const user2 = await User.findOne({ telegramId: user2Id });
  
  if (!user1 || !user2) return false;
  
  activeChats.set(user1Id, user2Id);
  activeChats.set(user2Id, user1Id);
  
  const chatStartMsg = `💬 Чат розпочато!\n\n🔒 Ви спілкуєтесь АНОНІМНО\n❌ Імена та нікнейми приховані\n\n❗ Щоб завершити чат, натисніть кнопку "❌ Завершити чат"\n💡 Не діліться особистою інформацією!`;
  
  await bot.sendMessage(user1Id, chatStartMsg);
  await bot.sendMessage(user2Id, chatStartMsg);
  
  // Кнопка для скарг для обох користувачів
  const reportKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⚠️ Поскаржитись на співрозмовника", callback_data: `report` }]
      ]
    }
  };
  
  await bot.sendMessage(user1Id, "⚠️ Якщо співрозмовник порушує правила, натисніть кнопку нижче:", reportKeyboard);
  await bot.sendMessage(user2Id, "⚠️ Якщо співрозмовник порушує правила, натисніть кнопку нижче:", reportKeyboard);
  
  // Оновлюємо меню для обох
  await updateMainMenu(user1Id, user1Id);
  await updateMainMenu(user2Id, user2Id);
  
  return true;
}

// Функція завершення чату
async function endChat(userId, chatId) {
  if (activeChats.has(userId)) {
    const partnerId = activeChats.get(userId);
    activeChats.delete(userId);
    activeChats.delete(partnerId);
    
    await bot.sendMessage(chatId, "❌ Чат завершено.");
    if (partnerId) {
      await bot.sendMessage(partnerId, "❌ Співрозмовник завершив чат.");
      await updateMainMenu(partnerId, partnerId);
    }
    await updateMainMenu(chatId, userId);
  } else if (waitingUsers.has(userId)) {
    waitingUsers.delete(userId);
    await bot.sendMessage(chatId, "🔍 Пошук припинено.");
    await updateMainMenu(chatId, userId);
  } else {
    await bot.sendMessage(chatId, "❌ У вас немає активного чату.");
  }
}

// Функція оновлення анкети користувача
async function updateUserProfile(userId, field, value, chatId) {
  try {
    const updateData = {};
    let fieldName = '';
    
    if (field === 'findGender') {
      updateData.findGender = value;
      fieldName = 'кого шукаєте';
    } else if (field === 'userGender') {
      updateData.userGender = value;
      fieldName = 'хто ви';
    } else if (field === 'district') {
      updateData.district = value;
      fieldName = 'район пошуку';
    }
    
    await User.updateOne({ telegramId: userId }, updateData);
    
    let valueText = '';
    if (value === 'find_boys') valueText = 'хлопців';
    else if (value === 'find_girls') valueText = 'дівчат';
    else if (value === 'find_all') valueText = 'всіх';
    else if (value === 'iam_boy') valueText = 'хлопець';
    else if (value === 'iam_girl') valueText = 'дівчина';
    else if (value.startsWith('dist_')) {
      switch(value) {
        case 'dist_Tiachiv': valueText = 'Тячівський'; break;
        case 'dist_Rakhiv': valueText = 'Рахівський'; break;
        case 'dist_Mukachevo': valueText = 'Мукачівський'; break;
        case 'dist_Berehove': valueText = 'Берегівський'; break;
        case 'dist_Khust': valueText = 'Хустський'; break;
        case 'dist_Uzhhorod': valueText = 'Ужгородський'; break;
        case 'dist_all': valueText = 'ВСЕ ЗАКАРПАТТЯ'; break;
      }
    }
    
    await bot.sendMessage(chatId, `✅ ${fieldName} змінено на: ${valueText}`);
    console.log(`✅ Оновлено профіль користувача ${userId}: ${fieldName} -> ${valueText}`);
  } catch (error) {
    console.error('Помилка оновлення:', error);
    await bot.sendMessage(chatId, "❌ Помилка при оновленні профілю");
  }
}

// Обробка callback-запитів
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  
  // Якщо це скарга (без ID)
  if (data === 'report') {
    const partnerId = activeChats.get(userId);
    if (!partnerId) {
      await bot.sendMessage(chatId, "❌ Немає активного чату для скарги.");
      await answerCallback(callbackQuery);
      return;
    }
    
    const reportKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💬 Спам", callback_data: `report_reason_spam_${partnerId}` }],
          [{ text: "🔞 Неприйнятна поведінка", callback_data: `report_reason_behavior_${partnerId}` }],
          [{ text: "💰 Шахрайство", callback_data: `report_reason_scam_${partnerId}` }],
          [{ text: "❌ Інше", callback_data: `report_reason_other_${partnerId}` }]
        ]
      }
    };
    
    await bot.sendMessage(chatId, "Оберіть причину скарги:", reportKeyboard);
    await answerCallback(callbackQuery);
    return;
  }
  
  // Обробка скарг з причинами
  if (data.startsWith('report_reason_')) {
    const parts = data.split('_');
    const reason = parts[2];
    const reportedId = parseInt(parts[3]);
    
    const report = new Report({
      reporterId: userId,
      reportedId: reportedId,
      reason: reason,
      timestamp: new Date()
    });
    await report.save();
    
    await bot.sendMessage(chatId, "✅ Скаргу відправлено адміністратору. Дякуємо за допомогу!");
    
    // Повідомити адмінів
    for (const adminId of ADMINS) {
      await bot.sendMessage(adminId, `⚠️ Нова скарга!\nВід: ${userId}\nНа: ${reportedId}\nПричина: ${reason}`);
    }
    
    await answerCallback(callbackQuery);
    return;
  }
  
  // Якщо це налаштування
  if (data === 'settings') {
    try {
      await bot.editMessageText(
        "⚙️ **Налаштування анкети**\n\nОберіть що хочете змінити:",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...settingsKeyboard }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "⚙️ **Налаштування анкети**\n\nОберіть що хочете змінити:", { parse_mode: "Markdown", ...settingsKeyboard });
    }
    await answerCallback(callbackQuery);
    return;
  }
  
  // Зміна "кого шукає"
  if (data === 'edit_find') {
    try {
      await bot.editMessageText(
        "👥 **Кого хочете шукати?**",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...whoToFindKeyboard }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "👥 **Кого хочете шукати?**", { parse_mode: "Markdown", ...whoToFindKeyboard });
    }
    userStates.set(userId, { editing: 'findGender' });
    await answerCallback(callbackQuery);
    return;
  }
  
  // Зміна "хто ви"
  if (data === 'edit_who') {
    try {
      await bot.editMessageText(
        "👤 **Хто ви?**",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...whoAreYouKeyboard }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "👤 **Хто ви?**", { parse_mode: "Markdown", ...whoAreYouKeyboard });
    }
    userStates.set(userId, { editing: 'userGender' });
    await answerCallback(callbackQuery);
    return;
  }
  
  // Зміна району
  if (data === 'edit_district') {
    try {
      await bot.editMessageText(
        "📍 **Виберіть район для пошуку:**\n\n💡 *Порада: Виберіть «ВСЕ ЗАКАРПАТТЯ», щоб знаходити більше людей!*",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...districtKeyboard }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "📍 **Виберіть район для пошуку:**\n\n💡 *Порада: Виберіть «ВСЕ ЗАКАРПАТТЯ», щоб знаходити більше людей!*", { parse_mode: "Markdown", ...districtKeyboard });
    }
    userStates.set(userId, { editing: 'district' });
    await answerCallback(callbackQuery);
    return;
  }
  
  // Крок 1: Вибрали кого шукати
  if (data.startsWith('find_')) {
    const state = userStates.get(userId);
    if (state && state.editing === 'findGender') {
      await updateUserProfile(userId, 'findGender', data, chatId);
      userStates.delete(userId);
      await bot.sendMessage(chatId, "⚙️ Повернення в налаштування:", { ...settingsKeyboard });
      await answerCallback(callbackQuery);
      return;
    } else if (!state || !state.editing) {
      if (!userStates.has(userId)) {
        userStates.set(userId, { step: 'who_to_find' });
      }
      const newState = userStates.get(userId);
      newState.findGender = data;
      newState.step = 'who_are_you';
      
      try {
        await bot.editMessageText(
          "✅ Збережено!\n\n👉 **Оберіть хто ви:**",
          { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...whoAreYouKeyboard }
        );
      } catch (error) {
        await bot.sendMessage(chatId, "✅ Збережено!\n\n👉 **Оберіть хто ви:**", { parse_mode: "Markdown", ...whoAreYouKeyboard });
      }
    }
    await answerCallback(callbackQuery);
  }
  
  // Крок 2: Вибрали хто ти
  else if (data.startsWith('iam_')) {
    const state = userStates.get(userId);
    if (state && state.editing === 'userGender') {
      await updateUserProfile(userId, 'userGender', data, chatId);
      userStates.delete(userId);
      await bot.sendMessage(chatId, "⚙️ Повернення в налаштування:", { ...settingsKeyboard });
      await answerCallback(callbackQuery);
      return;
    } else if (!state || !state.editing) {
      if (!userStates.has(userId)) {
        userStates.set(userId, { step: 'who_to_find' });
      }
      const newState = userStates.get(userId);
      newState.userGender = data;
      newState.step = 'district';
      
      try {
        await bot.editMessageText(
          "✅ Збережено!\n\n📍 **З якого району хочете шукати людей?**\n\n💡 *Порада: Виберіть «ВСЕ ЗАКАРПАТТЯ», щоб знаходити більше людей!*",
          { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...districtKeyboard }
        );
      } catch (error) {
        await bot.sendMessage(chatId, "✅ Збережено!\n\n📍 **З якого району хочете шукати людей?**\n\n💡 *Порада: Виберіть «ВСЕ ЗАКАРПАТТЯ», щоб знаходити більше людей!*", { parse_mode: "Markdown", ...districtKeyboard });
      }
    }
    await answerCallback(callbackQuery);
  }
  
  // Крок 3: Вибрали район
  else if (data.startsWith('dist_')) {
    const state = userStates.get(userId);
    if (state && state.editing === 'district') {
      await updateUserProfile(userId, 'district', data, chatId);
      userStates.delete(userId);
      await bot.sendMessage(chatId, "⚙️ Повернення в налаштування:", { ...settingsKeyboard });
      await answerCallback(callbackQuery);
      return;
    } else if (!state || !state.editing) {
      if (!userStates.has(userId)) {
        userStates.set(userId, { step: 'who_to_find' });
      }
      const newState = userStates.get(userId);
      newState.district = data;
      newState.step = 'completed';
      
      let districtName = '';
      switch(data) {
        case 'dist_Tiachiv': districtName = 'Тячівський'; break;
        case 'dist_Rakhiv': districtName = 'Рахівський'; break;
        case 'dist_Mukachevo': districtName = 'Мукачівський'; break;
        case 'dist_Berehove': districtName = 'Берегівський'; break;
        case 'dist_Khust': districtName = 'Хустський'; break;
        case 'dist_Uzhhorod': districtName = 'Ужгородський'; break;
        case 'dist_all': districtName = 'ВСЕ ЗАКАРПАТТЯ'; break;
      }
      
      try {
        const existingUser = await User.findOne({ telegramId: userId });
        if (!existingUser) {
          const newUser = new User({
            telegramId: userId,
            username: callbackQuery.from.username,
            firstName: callbackQuery.from.first_name,
            lastName: callbackQuery.from.last_name,
            findGender: newState.findGender,
            userGender: newState.userGender,
            district: newState.district
          });
          await newUser.save();
          console.log(`✅ Користувача ${userId} збережено в БД`);
        } else {
          await User.updateOne(
            { telegramId: userId },
            { 
              findGender: newState.findGender,
              userGender: newState.userGender,
              district: newState.district,
              lastActive: new Date()
            }
          );
          console.log(`✅ Дані користувача ${userId} оновлено`);
        }
      } catch (dbError) {
        console.error('Помилка БД:', dbError.message);
      }
      
      try {
        await bot.editMessageText(
          `✅ Налаштування завершено!\n\n📊 Ваші параметри збережено!\n• Шукаєте: ${newState.findGender === 'find_boys' ? 'хлопців' : newState.findGender === 'find_girls' ? 'дівчат' : 'всіх'}\n• Ви: ${newState.userGender === 'iam_boy' ? 'хлопець' : 'дівчина'}\n• Район: ${districtName}\n\n👇 Головне меню:`,
          { chat_id: chatId, message_id: messageId }
        );
      } catch (error) {
        await bot.sendMessage(chatId, `✅ Налаштування завершено!\n\n📊 Ваші параметри збережено!\n• Шукаєте: ${newState.findGender === 'find_boys' ? 'хлопців' : newState.findGender === 'find_girls' ? 'дівчат' : 'всіх'}\n• Ви: ${newState.userGender === 'iam_boy' ? 'хлопець' : 'дівчина'}\n• Район: ${districtName}`);
      }
      
      await updateMainMenu(chatId, userId);
    }
    await answerCallback(callbackQuery);
  }
  
  // Обробка пошуку
  else if (data === 'search') {
    const user = await User.findOne({ telegramId: userId });
    
    if (!user) {
      await bot.sendMessage(chatId, "❌ Спочатку пройдіть реєстрацію через /start");
      await answerCallback(callbackQuery);
      return;
    }
    
    if (activeChats.has(userId)) {
      await bot.sendMessage(chatId, "❌ Ви вже в чаті! Натисніть '❌ Завершити чат'");
      await answerCallback(callbackQuery);
      return;
    }
    
    if (waitingUsers.has(userId)) {
      await bot.sendMessage(chatId, "🔍 Ви вже в черзі пошуку. Очікуйте...");
      await answerCallback(callbackQuery);
      return;
    }
    
    // Додаємо в чергу
    waitingUsers.set(userId, true);
    await bot.sendMessage(chatId, "🔍 Шукаємо співрозмовника... Очікуйте. Натисніть '⏹️ Припинити пошук' щоб скасувати.");
    await updateMainMenu(chatId, userId);
    
    // Спроба знайти пару
    const found = await tryFindMatch(userId);
    
    if (!found) {
      await bot.sendMessage(chatId, "⏳ Співрозмовників поки немає. Ви в черзі. Як тільки хтось з'явиться, чат розпочнеться автоматично!");
    }
    
    await answerCallback(callbackQuery);
  }
  
  else if (data === 'cancel') {
    await bot.sendMessage(chatId, "❌ Скасовано");
    await updateMainMenu(chatId, userId);
    await answerCallback(callbackQuery);
  }
  else if (data === 'rules') {
    await bot.sendMessage(chatId, "📜 Правила знайомств: http://localhost:3000/rules");
    await answerCallback(callbackQuery);
  }
  else if (data === 'support') {
    await bot.sendMessage(chatId, "📞 Підтримка: @тут_нік");
    await answerCallback(callbackQuery);
  }
  // Адмін-команди
  else if (data === 'admin_stats') {
    if (!ADMINS.includes(userId)) return;
    
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ lastActive: { $gt: new Date(Date.now() - 24*60*60*1000) } });
    const totalMessages = await Message.countDocuments();
    const totalReports = await Report.countDocuments({ status: 'pending' });
    const blockedUsers = await User.countDocuments({ isBlocked: true });
    const waitingCount = waitingUsers.size;
    
    const statsText = `📊 **Статистика бота**\n\n` +
      `👥 Всього користувачів: ${totalUsers}\n` +
      `🟢 Активні за 24 год: ${activeUsers}\n` +
      `💬 Всього повідомлень: ${totalMessages}\n` +
      `⚠️ Нові скарги: ${totalReports}\n` +
      `🔒 Заблоковано: ${blockedUsers}\n` +
      `⏳ В черзі пошуку: ${waitingCount}`;
    
    await bot.sendMessage(chatId, statsText, { parse_mode: "Markdown" });
    await answerCallback(callbackQuery);
  }
  // ... решта адмін-команд залишаються без змін
  else if (data === 'admin_messages') {
    if (!ADMINS.includes(userId)) return;
    
    const lastMessages = await Message.find().sort({ timestamp: -1 }).limit(20);
    
    if (lastMessages.length === 0) {
      await bot.sendMessage(chatId, "📭 Немає повідомлень.");
      await answerCallback(callbackQuery);
      return;
    }
    
    let messagesText = "💬 **Останні 20 повідомлень:**\n\n";
    for (const msg of lastMessages) {
      messagesText += `👤 ${msg.fromName} (${msg.fromUserId}) → ${msg.toName} (${msg.toUserId})\n`;
      messagesText += `📝 ${msg.text?.substring(0, 100)}${msg.text?.length > 100 ? '...' : ''}\n`;
      messagesText += `🕐 ${msg.timestamp.toLocaleString()}\n`;
      messagesText += `---\n`;
    }
    
    if (messagesText.length > 4000) {
      for (let i = 0; i < lastMessages.length; i += 10) {
        const chunk = lastMessages.slice(i, i + 10);
        let chunkText = "💬 **Повідомлення:**\n\n";
        for (const msg of chunk) {
          chunkText += `👤 ${msg.fromName} (${msg.fromUserId}) → ${msg.toName}\n📝 ${msg.text?.substring(0, 100)}\n🕐 ${msg.timestamp.toLocaleString()}\n---\n`;
        }
        await bot.sendMessage(chatId, chunkText, { parse_mode: "Markdown" });
      }
    } else {
      await bot.sendMessage(chatId, messagesText, { parse_mode: "Markdown" });
    }
    await answerCallback(callbackQuery);
  }
  else if (data === 'admin_users') {
    if (!ADMINS.includes(userId)) return;
    
    const users = await User.find().sort({ createdAt: -1 }).limit(30);
    
    let usersText = "👥 **Останні 30 користувачів:**\n\n";
    for (const user of users) {
      usersText += `🆔 ${user.telegramId}\n`;
      usersText += `📛 ${user.firstName || 'Немає'} ${user.lastName || ''}\n`;
      usersText += `@${user.username || 'немає'}\n`;
      usersText += `🎭 ${user.userGender === 'iam_boy' ? 'Хлопець' : 'Дівчина'} → шукає ${user.findGender === 'find_boys' ? 'хлопців' : user.findGender === 'find_girls' ? 'дівчат' : 'всіх'}\n`;
      usersText += `📍 Район: ${user.district?.replace('dist_', '') || 'не вибрано'}\n`;
      usersText += `🔒 ${user.isBlocked ? 'Заблокований' : 'Активний'}\n`;
      usersText += `📅 ${user.createdAt.toLocaleDateString()}\n`;
      usersText += `---\n`;
    }
    
    await bot.sendMessage(chatId, usersText, { parse_mode: "Markdown" });
    await answerCallback(callbackQuery);
  }
  else if (data === 'admin_reports') {
    if (!ADMINS.includes(userId)) return;
    
    const reports = await Report.find({ status: 'pending' }).sort({ timestamp: -1 });
    
    if (reports.length === 0) {
      await bot.sendMessage(chatId, "✅ Немає нових скарг.");
      await answerCallback(callbackQuery);
      return;
    }
    
    for (const report of reports.slice(0, 5)) {
      const reportText = `⚠️ **Скарга #${report._id}**\n\n` +
        `👤 Від: ${report.reporterId}\n` +
        `👤 На: ${report.reportedId}\n` +
        `📝 Причина: ${report.reason || 'Не вказана'}\n` +
        `🕐 ${report.timestamp.toLocaleString()}`;
      
      await bot.sendMessage(chatId, reportText, { parse_mode: "Markdown" });
    }
    await answerCallback(callbackQuery);
  }
  else if (data === 'admin_block') {
    if (!ADMINS.includes(userId)) return;
    
    await bot.sendMessage(chatId, "Введіть ID користувача для блокування:", { reply_markup: { force_reply: true } });
    userStates.set(userId, { adminAction: 'block' });
    await answerCallback(callbackQuery);
  }
  else if (data === 'admin_unblock') {
    if (!ADMINS.includes(userId)) return;
    
    await bot.sendMessage(chatId, "Введіть ID користувача для розблокування:", { reply_markup: { force_reply: true } });
    userStates.set(userId, { adminAction: 'unblock' });
    await answerCallback(callbackQuery);
  }
});

// Обробка текстових повідомлень
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  if (text && text.startsWith('/')) return;
  
  // Кнопки завершення чату/пошуку
  if (text === '❌ Завершити чат' || text === '⏹️ Припинити пошук') {
    await endChat(userId, chatId);
    return;
  }
  
  if (text === '🔍 Шукати іншого') {
    await endChat(userId, chatId);
    bot.emit('callback_query', {
      id: Date.now(),
      from: msg.from,
      message: { chat: { id: chatId } },
      data: 'search'
    });
    return;
  }
  
  // Перевіряємо чи в активному чаті
  if (activeChats.has(userId)) {
    const partnerId = activeChats.get(userId);
    
    // ЗБЕРІГАЄМО ПОВІДОМЛЕННЯ В БД
    try {
      const fromUser = await User.findOne({ telegramId: userId });
      const toUser = await User.findOne({ telegramId: partnerId });
      
      const messageDoc = new Message({
        messageId: msg.message_id,
        fromUserId: userId,
        fromName: fromUser?.firstName || msg.from.first_name,
        toUserId: partnerId,
        toName: toUser?.firstName || 'Користувач',
        text: text,
        chatId: chatId
      });
      await messageDoc.save();
      console.log(`💾 Повідомлення збережено: ${userId} -> ${partnerId}`);
    } catch (error) {
      console.error('Помилка збереження повідомлення:', error);
    }
    
    // Перевіряємо чи не заблокований користувач
    if (await isBlocked(userId)) {
      await bot.sendMessage(chatId, "❌ Ви заблоковані адміністратором.");
      await endChat(userId, chatId);
      return;
    }
    
    if (await isBlocked(partnerId)) {
      await bot.sendMessage(chatId, "❌ Співрозмовник заблокований адміністратором.");
      await endChat(userId, chatId);
      return;
    }
    
    // Відправляємо повідомлення
    try {
      await bot.sendMessage(partnerId, `${text}`);
    } catch (error) {
      console.error('Помилка пересилання:', error);
      await bot.sendMessage(chatId, "❌ Не вдалося відправити. Співрозмовник вийшов.");
      await endChat(userId, chatId);
    }
    return;
  }
  
  // Обробка кнопок меню (коли не в чаті)
  if (text === '🔍 Пошук користувача') {
    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      bot.sendMessage(chatId, "❌ Спочатку пройдіть реєстрацію через /start");
    } else if (waitingUsers.has(userId)) {
      bot.sendMessage(chatId, "🔍 Ви вже в черзі пошуку!");
    } else {
      bot.emit('callback_query', {
        id: Date.now(),
        from: msg.from,
        message: { chat: { id: chatId } },
        data: 'search'
      });
    }
  }
  else if (text === '⚙️ Налаштування') {
    await bot.sendMessage(chatId, "⚙️ **Налаштування анкети**\n\nОберіть що хочете змінити:", { parse_mode: "Markdown", ...settingsKeyboard });
  }
  else if (text === '📜 Правила') {
    bot.sendMessage(chatId, "📜 Правила: http://localhost:3000/rules");
  }
  else if (text === '📞 Підтримка') {
    bot.sendMessage(chatId, "📞 Підтримка: @тут_нік");
  }
  
  // АДМІН-ДІЇ
  const state = userStates.get(userId);
  if (state && state.adminAction === 'block') {
    const targetId = parseInt(text);
    if (targetId && !isNaN(targetId)) {
      await User.updateOne({ telegramId: targetId }, { isBlocked: true });
      await bot.sendMessage(chatId, `✅ Користувача ${targetId} заблоковано.`);
      // Видаляємо з черги якщо був
      if (waitingUsers.has(targetId)) waitingUsers.delete(targetId);
      // Завершуємо чат якщо був
      if (activeChats.has(targetId)) await endChat(targetId, targetId);
      try {
        await bot.sendMessage(targetId, "❌ Ваш акаунт заблоковано адміністратором.");
      } catch (e) {}
    } else {
      await bot.sendMessage(chatId, "❌ Невірний ID. Спробуйте ще раз.");
    }
    userStates.delete(userId);
    return;
  }

  if (state && state.adminAction === 'unblock') {
    const targetId = parseInt(text);
    if (targetId && !isNaN(targetId)) {
      await User.updateOne({ telegramId: targetId }, { isBlocked: false });
      await bot.sendMessage(chatId, `✅ Користувача ${targetId} розблоковано.`);
      try {
        await bot.sendMessage(targetId, "✅ Ваш акаунт розблоковано.");
      } catch (e) {}
    } else {
      await bot.sendMessage(chatId, "❌ Невірний ID. Спробуйте ще раз.");
    }
    userStates.delete(userId);
    return;
  }
});

console.log('🤖 Бот запущено!');