require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Імпорт БД
const { connectDB, User, Message, Report, Admin, Channel } = require('./database.js');

// Тимчасове сховище
const userStates = new Map();
const activeChats = new Map();
const waitingUsers = new Map();

const RULES_URL = process.env.RULES_URL || 'http://localhost:3000/rules';
const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || '@тут_нік';

// Імпорт кнопок
const startHandler = require('./handlers/start.js');
const { whoToFindKeyboard, whoAreYouKeyboard, districtKeyboard, settingsKeyboard } = require('./utils/keyboard.js');

// Підключення до БД
async function initApp() {
  try {
    await connectDB();

    await User.updateMany(
      {},
      {
        $set: {
          isSearching: false,
          isInChat: false,
          searchStartedAt: null
        }
      }
    );

    console.log('✅ Статуси пошуку та чатів скинуто після запуску');
  } catch (error) {
    console.error('❌ Помилка ініціалізації:', error.message);
  }
}

initApp();

async function touchUserActivity(userId, extra = {}) {
  try {
    await User.updateOne(
      { telegramId: userId },
      {
        $set: {
          lastActive: new Date(),
          ...extra
        }
      }
    );
  } catch (error) {
    console.error('Помилка оновлення lastActive:', error.message);
  }
}

// Функції перевірки прав (ТІЛЬКИ через БД)
async function isAdminCheck(userId) {
  const admin = await Admin.findOne({ telegramId: userId });
  return admin !== null;
}

async function isSuperAdminCheck(userId) {
  const admin = await Admin.findOne({ telegramId: userId, role: 'super_admin' });
  return admin !== null;
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  await touchUserActivity(userId);

  startHandler(bot, msg);
});

bot.onText(/\/check/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  await touchUserActivity(userId);

  const isSubscribed = await requireSubscriptionWithButtons(userId, chatId, true, true);

  if (isSubscribed) {
    await bot.sendMessage(chatId, "✅ Ви підписані на всі необхідні канали!");
  }
});

bot.onText(/\/stopsearch/, async (msg) => {
  const userId = msg.from.id;

  await touchUserActivity(userId, {
    isSearching: false,
    searchStartedAt: null
  });

  if (waitingUsers.has(userId)) {
    waitingUsers.delete(userId);
    await bot.sendMessage(msg.chat.id, "🔍 Пошук припинено. Ви в головному меню:");
    await updateMainMenu(msg.chat.id, userId);
  }
});

// Функція для оновлення головного меню
async function updateMainMenu(chatId, userId) {
  const user = await User.findOne({ telegramId: userId });

  if (!user || !user.findGender || !user.userGender || !user.district) {
    await bot.sendMessage(chatId, "📝 Спочатку заповніть анкету!");
    startHandler(bot, { from: { id: userId }, chat: { id: chatId } });
    return;
  }

  const isSubscribed = await requireSubscriptionWithButtons(userId, chatId, false);
  if (!isSubscribed) {
    await requireSubscriptionWithButtons(userId, chatId, true);
    return;
  }

  const isInChat = activeChats.has(userId);
  const isWaiting = waitingUsers.has(userId);
  const isAdmin = await isAdminCheck(userId);

  let menuKeyboard;
  let message;

  if (isInChat) {
    menuKeyboard = [
      ["❌ Завершити чат"],
      ["🔍 Новий співрозмовник"],
      ["⚠️ Скарга", "📞 Підтримка"]
    ];
    message = "💬 *Ви в чаті*\n\nОберіть дію:";
  } else if (isWaiting) {
    menuKeyboard = [
      ["⏹️ Зупинити пошук"],
      ["⚙️ Анкета", "✅ Підписка"],
      ["📜 Правила", "📞 Підтримка"]
    ];
    message = "🔍 *Пошук співрозмовника...*\n\nОчікуйте або зупиніть пошук:";
  } else {
    menuKeyboard = [
      ["🔍 Знайти співрозмовника"],
      ["⚙️ Анкета", "✅ Підписка"],
      ["📜 Правила", "📞 Підтримка"]
    ];

    if (isAdmin) {
      menuKeyboard.push(["🛡️ Адмінка"]);
    }

    message = "📋 *Головне меню*\n\nОберіть дію:";
  }

  await bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: {
      keyboard: menuKeyboard,
      resize_keyboard: true,
      one_time_keyboard: false
    }
  });
}

bot.onText(/\/admin_panel/, async (msg) => {
  await showAdminPanel(msg.chat.id, msg.from.id);
});

// Функція для відкриття адмін-панелі
async function showAdminPanel(chatId, userId) {
  const isUserAdmin = await isAdminCheck(userId);
  if (!isUserAdmin) {
    await bot.sendMessage(chatId, "❌ У вас немає доступу до адмін-панелі.");
    return false;
  }
  
  const isSuper = await isSuperAdminCheck(userId);
  
  const adminPanelKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📊 Статистика", callback_data: "admin_stats" },
          { text: "📢 Розсилка", callback_data: "admin_broadcast" }
        ],
        [
          { text: "👥 Користувачі", callback_data: "admin_users_menu" },
          { text: "📺 Канали", callback_data: "admin_channels_menu" }
        ],
        [
          { text: "⚠️ Скарги", callback_data: "admin_reports" },
          { text: "🔒 Блокування", callback_data: "admin_blocks_menu" }
        ]
      ]
    }
  };
  
  if (isSuper) {
    adminPanelKeyboard.reply_markup.inline_keyboard.push([
      { text: "👑 Управління адмінами", callback_data: "admin_admins_menu" }
    ]);
  }
  
  adminPanelKeyboard.reply_markup.inline_keyboard.push([
    { text: "🌐 Веб-адмінка", callback_data: "admin_website" },
    { text: "❌ Закрити", callback_data: "cancel" }
  ]);
  
  await bot.sendMessage(chatId, "🛡️ **Адмін-панель бота**\n\nОберіть дію:", { parse_mode: "Markdown", ...adminPanelKeyboard });
  return true;
}

// Функція для перевірки чи заблокований користувач
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

// Функція спроби знайти пару для користувача з черги
async function tryFindMatch(userId) {
  const waitingList = Array.from(waitingUsers.keys());
  
  for (const waitingId of waitingList) {
    if (waitingId !== userId && !activeChats.has(waitingId)) {
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

  await touchUserActivity(user1Id, {
  isSearching: false,
  searchStartedAt: null,
  isInChat: true
});

await touchUserActivity(user2Id, {
  isSearching: false,
  searchStartedAt: null,
  isInChat: true
});
  
  const chatStartMsg = `💬 Чат розпочато!\n\n🔒 Ви спілкуєтесь АНОНІМНО\n❌ Імена та нікнейми приховані\n\n❗ Щоб завершити чат, натисніть кнопку "❌ Завершити чат"\n💡 Не діліться особистою інформацією!`;
  
  await bot.sendMessage(user1Id, chatStartMsg);
  await bot.sendMessage(user2Id, chatStartMsg);
  
  const reportKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⚠️ Поскаржитись на співрозмовника", callback_data: `report` }]
      ]
    }
  };
  
  await bot.sendMessage(user1Id, "⚠️ Якщо співрозмовник порушує правила, натисніть кнопку нижче:", reportKeyboard);
  await bot.sendMessage(user2Id, "⚠️ Якщо співрозмовник порушує правила, натисніть кнопку нижче:", reportKeyboard);
  
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

    await touchUserActivity(userId, { isInChat: false });

if (partnerId) {
  await touchUserActivity(partnerId, { isInChat: false });
}
    
    await bot.sendMessage(chatId, "❌ Чат завершено.");
    if (partnerId) {
      await bot.sendMessage(partnerId, "❌ Співрозмовник завершив чат.");
      await updateMainMenu(partnerId, partnerId);
    }
    await updateMainMenu(chatId, userId);
  } else if (waitingUsers.has(userId)) {
  waitingUsers.delete(userId);

  await touchUserActivity(userId, {
    isSearching: false,
    searchStartedAt: null
  });

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

// Функція для перевірки підписки та відправки кнопок
async function requireSubscriptionWithButtons(userId, chatId, showMessage = true) {
  const channels = await Channel.find({ isActive: true });
  
  if (channels.length === 0) return true;
  
  // Для адмінів завжди повертаємо true
  const isUserAdmin = await isAdminCheck(userId);
  if (isUserAdmin) return true;
  
  let isSubscribed = true;
  const notSubscribedChannels = [];
  
  for (const channel of channels) {
    try {
      const chatMember = await bot.getChatMember(channel.channelId, userId);
      if (chatMember.status === 'left' || chatMember.status === 'kicked') {
        isSubscribed = false;
        notSubscribedChannels.push(channel);
      }
    } catch (error) {
      console.log(`⚠️ Не вдалося перевірити канал ${channel.channelId}:`, error.message);
    }
  }
  
  if (!isSubscribed && showMessage && notSubscribedChannels.length > 0) {
    await sendSubscriptionMessage(chatId, notSubscribedChannels);
    return false;
  }
  
  return isSubscribed;
}

// Допоміжна функція для відправки повідомлення про підписку
async function sendSubscriptionMessage(chatId, notSubscribedChannels) {
  const subscribeButtons = [];
  for (const channel of notSubscribedChannels) {
    subscribeButtons.push([
      { text: `📢 Підписатись на ${channel.channelName || 'канал'}`, url: channel.channelUrl }
    ]);
  }
  subscribeButtons.push([{ text: "✅ Я підписався", callback_data: "check_subscription" }]);
  
  const subscribeKeyboard = { reply_markup: { inline_keyboard: subscribeButtons } };
  
  let message = "❌ **Для використання бота необхідно підписатися на наші канали:**\n\n";
  for (const channel of notSubscribedChannels) {
    message += `📢 ${channel.channelName || 'Канал'}: ${channel.channelUrl}\n`;
  }
  message += "\n👇 Натисніть на кнопки нижче, щоб підписатися, а потім натисніть **'Я підписався'**";
  
  await bot.sendMessage(chatId, message, { parse_mode: "Markdown", ...subscribeKeyboard });
}

// Обробка callback-запитів
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  await touchUserActivity(userId);
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  
  // Перевірка чи є адміном (для адмін-команд)
  const isUserAdmin = await isAdminCheck(userId);
  const isUserSuper = await isSuperAdminCheck(userId);
  
  // ========== 1. ПІДПИСКА ==========
  if (data === 'check_subscription') {
    const isSubscribed = await requireSubscriptionWithButtons(userId, chatId, false);
    if (isSubscribed) {
      await bot.sendMessage(chatId, "✅ Дякуємо за підписку! Тепер ви можете користуватися ботом.");
      await updateMainMenu(chatId, userId);
    } else {
      await requireSubscriptionWithButtons(userId, chatId, true);
    }
    await answerCallback(callbackQuery);
    return;
  }
  
  // ========== 2. ПЕРЕВІРКА ПІДПИСКИ ДЛЯ ВСІХ ІНШИХ ==========
  if (!isUserAdmin) {
    const isSubscribed = await requireSubscriptionWithButtons(userId, chatId, false);
    if (!isSubscribed) {
      await requireSubscriptionWithButtons(userId, chatId, true);
      await answerCallback(callbackQuery);
      return;
    }
  }
  
  // ========== 3. СКАРГИ ==========
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
    
    // Відправляємо повідомлення всім адмінам з БД
    const allAdmins = await Admin.find();
    for (const admin of allAdmins) {
      try {
        await bot.sendMessage(admin.telegramId, `⚠️ Нова скарга!\nВід: ${userId}\nНа: ${reportedId}\nПричина: ${reason}`);
      } catch (e) {}
    }
    
    await answerCallback(callbackQuery);
    return;
  }
  
  // ========== 4. НАЛАШТУВАННЯ ==========
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
  
  // ========== 5. РЕЄСТРАЦІЯ ==========
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
        
        const userData = {
          username: callbackQuery.from.username,
          firstName: callbackQuery.from.first_name,
          lastName: callbackQuery.from.last_name,
          findGender: newState.findGender,
          userGender: newState.userGender,
          district: newState.district,
          lastActive: new Date()
        };
        
        if (!existingUser) {
          const newUser = new User({
            telegramId: userId,
            ...userData
          });
          await newUser.save();
          console.log(`✅ Нового користувача ${userId} збережено в БД`);
        } else {
          await User.updateOne(
            { telegramId: userId },
            { ...userData }
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
  
  // ========== 6. ПОШУК ==========
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
    
    waitingUsers.set(userId, true);

await touchUserActivity(userId, {
  isSearching: true,
  searchStartedAt: new Date(),
  isInChat: false
});
    await bot.sendMessage(chatId, "🔍 Шукаємо співрозмовника... Очікуйте. Натисніть '⏹️ Припинити пошук' щоб скасувати.");
    await updateMainMenu(chatId, userId);
    
    const found = await tryFindMatch(userId);
    
    if (!found) {
      await bot.sendMessage(chatId, "⏳ Співрозмовників поки немає. Ви в черзі. Як тільки хтось з'явиться, чат розпочнеться автоматично!");
    }
    
    await answerCallback(callbackQuery);
  }
  
  // ========== 7. ІНШЕ ==========
  else if (data === 'cancel') {
    await bot.sendMessage(chatId, "❌ Скасовано");
    await updateMainMenu(chatId, userId);
    await answerCallback(callbackQuery);
  }
  
  else if (data === 'rules') {
    await bot.sendMessage(chatId, `📜 Правила знайомств: ${RULES_URL}`);
    await answerCallback(callbackQuery);
  }
  
  else if (data === 'support') {
    await bot.sendMessage(chatId, `📞 Підтримка: ${SUPPORT_CONTACT}`);
    await answerCallback(callbackQuery);
  }
  
  // ========== 8. АДМІН-КОМАНДИ ==========
  
  // Статистика
  else if (data === 'admin_stats') {
    if (!isUserAdmin) return;
    
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ lastActive: { $gt: new Date(Date.now() - 24*60*60*1000) } });
    const totalMessages = await Message.countDocuments();
    const totalReports = await Report.countDocuments({ status: 'pending' });
    const blockedUsers = await User.countDocuments({ isBlocked: true });
    const waitingCount = waitingUsers.size;
    const activeChatsCount = activeChats.size / 2;
    
    const statsText = `📊 **Статистика бота**\n\n` +
      `👥 Всього користувачів: ${totalUsers}\n` +
      `🟢 Активні за 24 год: ${activeUsers}\n` +
      `💬 Всього повідомлень: ${totalMessages}\n` +
      `⚠️ Нові скарги: ${totalReports}\n` +
      `🔒 Заблоковано: ${blockedUsers}\n` +
      `⏳ В черзі пошуку: ${waitingCount}\n` +
      `💬 Активних чатів: ${activeChatsCount}`;
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Назад", callback_data: "admin_panel" }]
        ]
      }
    };
    
    try {
      await bot.editMessageText(
        statsText,
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...keyboard }
      );
    } catch (error) {
      await bot.sendMessage(chatId, statsText, { parse_mode: "Markdown", ...keyboard });
    }
    await answerCallback(callbackQuery);
  }
  
  // МЕНЮ БЛОКУВАННЯ
  else if (data === 'admin_blocks_menu') {
    if (!isUserAdmin) return;
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔒 Заблокувати користувача", callback_data: "admin_block" }],
          [{ text: "🔓 Розблокувати користувача", callback_data: "admin_unblock" }],
          [{ text: "📋 Список заблокованих", callback_data: "admin_blocked_list" }],
          [{ text: "🔙 Назад", callback_data: "admin_panel" }]
        ]
      }
    };
    
    try {
      await bot.editMessageText(
        "🔒 **Управління блокуваннями**\n\nОберіть дію:",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...keyboard }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "🔒 **Управління блокуваннями**\n\nОберіть дію:", { parse_mode: "Markdown", ...keyboard });
    }
    await answerCallback(callbackQuery);
  }
  
  // МЕНЮ КОРИСТУВАЧІВ
  else if (data === 'admin_users_menu') {
    if (!isUserAdmin) return;
    
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ lastActive: { $gt: new Date(Date.now() - 24*60*60*1000) } });
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Список всіх користувачів", callback_data: "admin_users_list" }],
          [{ text: "🟢 Активні користувачі", callback_data: "admin_active_users" }],
          [{ text: "📊 Статистика", callback_data: "admin_stats" }],
          [{ text: "🔙 Назад", callback_data: "admin_panel" }]
        ]
      }
    };
    
    try {
      await bot.editMessageText(
        `👥 **Управління користувачами**\n\n` +
        `📊 Всього користувачів: ${totalUsers}\n` +
        `🟢 Активних за 24 год: ${activeUsers}\n\n` +
        `Оберіть дію:`,
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...keyboard }
      );
    } catch (error) {
      await bot.sendMessage(chatId, `👥 **Управління користувачами**\n\n📊 Всього користувачів: ${totalUsers}\n🟢 Активних за 24 год: ${activeUsers}\n\nОберіть дію:`, { parse_mode: "Markdown", ...keyboard });
    }
    await answerCallback(callbackQuery);
  }
  
  // СПИСОК ВСІХ КОРИСТУВАЧІВ
  else if (data === 'admin_users_list') {
    if (!isUserAdmin) return;
    
    const users = await User.find({}).limit(50).sort({ createdAt: -1 });
    
    if (users.length === 0) {
      try {
        await bot.editMessageText(
          "📭 Немає користувачів.",
          { chat_id: chatId, message_id: messageId }
        );
      } catch (error) {
        await bot.sendMessage(chatId, "📭 Немає користувачів.");
      }
    } else {
      let list = "📋 Список користувачів (останні 50):\n\n";
      users.forEach((user, index) => {
        list += `${index + 1}. ID: ${user.telegramId} | ${user.firstName || 'Без імені'} ${user.isBlocked ? '🔒' : '✅'}\n`;
      });
      
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Назад", callback_data: "admin_users_menu" }]
          ]
        }
      };
      
     try {
  await bot.editMessageText(
    list,
    { chat_id: chatId, message_id: messageId, ...keyboard }
  );
} catch (error) {
  await bot.sendMessage(chatId, list, keyboard);
}
    }
    await answerCallback(callbackQuery);
  }
  
  // АКТИВНІ КОРИСТУВАЧІ
  else if (data === 'admin_active_users') {
    if (!isUserAdmin) return;
    
    const users = await User.find({ 
      lastActive: { $gt: new Date(Date.now() - 24*60*60*1000) },
      isBlocked: false
    }).limit(50);
    
    if (users.length === 0) {
      try {
        await bot.editMessageText(
          "📭 Немає активних користувачів за останню добу.",
          { chat_id: chatId, message_id: messageId }
        );
      } catch (error) {
        await bot.sendMessage(chatId, "📭 Немає активних користувачів за останню добу.");
      }
    } else {
      let list = "🟢 Активні користувачі (останні 24 год):\n\n";
      users.forEach((user, index) => {
        list += `${index + 1}. ID: ${user.telegramId} | ${user.firstName || 'Без імені'}\n`;
      });
      
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Назад", callback_data: "admin_users_menu" }]
          ]
        }
      };
      
      try {
  await bot.editMessageText(
    list,
    { chat_id: chatId, message_id: messageId, ...keyboard }
  );
} catch (error) {
  await bot.sendMessage(chatId, list, keyboard);
}
    }
    await answerCallback(callbackQuery);
  }
  
  // БЛОКУВАННЯ КОРИСТУВАЧА
  else if (data === 'admin_block') {
    if (!isUserAdmin) return;
    
    try {
      await bot.editMessageText(
        "🔒 **Блокування користувача**\n\nВведіть Telegram ID користувача, якого потрібно заблокувати:",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "🔒 **Блокування користувача**\n\nВведіть Telegram ID користувача, якого потрібно заблокувати:", { parse_mode: "Markdown" });
    }
    userStates.set(userId, { adminAction: 'block' });
    await answerCallback(callbackQuery);
  }
  
  // РОЗБЛОКУВАННЯ КОРИСТУВАЧА
  else if (data === 'admin_unblock') {
    if (!isUserAdmin) return;
    
    try {
      await bot.editMessageText(
        "🔓 **Розблокування користувача**\n\nВведіть Telegram ID користувача, якого потрібно розблокувати:",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "🔓 **Розблокування користувача**\n\nВведіть Telegram ID користувача, якого потрібно розблокувати:", { parse_mode: "Markdown" });
    }
    userStates.set(userId, { adminAction: 'unblock' });
    await answerCallback(callbackQuery);
  }
  
  // СПИСОК ЗАБЛОКОВАНИХ
  else if (data === 'admin_blocked_list') {
    if (!isUserAdmin) return;
    
    const blockedUsers = await User.find({ isBlocked: true }).limit(50);
    
    if (blockedUsers.length === 0) {
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Назад", callback_data: "admin_blocks_menu" }]
          ]
        }
      };
      try {
        await bot.editMessageText(
          "🔓 Немає заблокованих користувачів.",
          { chat_id: chatId, message_id: messageId, ...keyboard }
        );
      } catch (error) {
        await bot.sendMessage(chatId, "🔓 Немає заблокованих користувачів.", keyboard);
      }
    } else {
      let list = "🔒 **Список заблокованих користувачів:**\n\n";
      const blockButtons = [];
      
      blockedUsers.forEach((user, index) => {
        list += `${index + 1}. ID: ${user.telegramId} | ${user.firstName || 'Без імені'}\n`;
        blockButtons.push([{ text: `🔓 Розблокувати ${user.telegramId}`, callback_data: `admin_unblock_user_${user.telegramId}` }]);
      });
      
      blockButtons.push([{ text: "🔙 Назад", callback_data: "admin_blocks_menu" }]);
      
      const keyboard = { reply_markup: { inline_keyboard: blockButtons } };
      
      try {
        await bot.editMessageText(
          list,
          { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...keyboard }
        );
      } catch (error) {
        await bot.sendMessage(chatId, list, { parse_mode: "Markdown", ...keyboard });
      }
    }
    await answerCallback(callbackQuery);
  }
  
  // РОЗБЛОКУВАННЯ ЗІ СПИСКУ
  else if (data.startsWith('admin_unblock_user_')) {
    if (!isUserAdmin) return;
    
    const targetId = parseInt(data.replace('admin_unblock_user_', ''));
    await User.updateOne({ telegramId: targetId }, { isBlocked: false });
    await bot.sendMessage(chatId, `✅ Користувача ${targetId} розблоковано.`);
    try {
      await bot.sendMessage(targetId, "✅ Ваш акаунт розблоковано.");
    } catch (e) {}
    await answerCallback(callbackQuery, "Користувача розблоковано");
  }
  
  // СКАРГИ
  else if (data === 'admin_reports') {
    if (!isUserAdmin) return;
    
    const reports = await Report.find({ status: 'pending' }).sort({ timestamp: -1 }).limit(20);
    
    if (reports.length === 0) {
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Назад", callback_data: "admin_panel" }]
          ]
        }
      };
      try {
        await bot.editMessageText(
          "✅ Немає нових скарг.",
          { chat_id: chatId, message_id: messageId, ...keyboard }
        );
      } catch (error) {
        await bot.sendMessage(chatId, "✅ Немає нових скарг.", keyboard);
      }
    } else {
      let reportsText = "⚠️ **Нові скарги:**\n\n";
      const reportButtons = [];
      
      for (const report of reports) {
        reportsText += `📌 Скарга #${report._id.toString().slice(-6)}\n`;
        reportsText += `👤 Від: ${report.reporterId}\n`;
        reportsText += `👤 На: ${report.reportedId}\n`;
        reportsText += `📝 Причина: ${report.reason}\n`;
        reportsText += `🕒 ${new Date(report.timestamp).toLocaleString()}\n\n`;
        
        reportButtons.push([
          { text: `✅ Прийняти #${report._id.toString().slice(-6)}`, callback_data: `admin_accept_report_${report._id}` },
          { text: `❌ Відхилити #${report._id.toString().slice(-6)}`, callback_data: `admin_reject_report_${report._id}` }
        ]);
      }
      
      reportButtons.push([{ text: "🔙 Назад", callback_data: "admin_panel" }]);
      
      const keyboard = { reply_markup: { inline_keyboard: reportButtons } };
      
      try {
        await bot.editMessageText(
          reportsText,
          { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...keyboard }
        );
      } catch (error) {
        await bot.sendMessage(chatId, reportsText, { parse_mode: "Markdown", ...keyboard });
      }
    }
    await answerCallback(callbackQuery);
  }
  
  // ПРИЙНЯТТЯ СКАРГИ
  else if (data.startsWith('admin_accept_report_')) {
    if (!isUserAdmin) return;
    
    const reportId = data.replace('admin_accept_report_', '');
    const report = await Report.findById(reportId);
    
    if (report) {
      await User.updateOne({ telegramId: report.reportedId }, { isBlocked: true });
      report.status = 'resolved';
      report.resolvedBy = userId;
      report.resolvedAt = new Date();
      await report.save();
      
      await bot.sendMessage(chatId, `✅ Скаргу прийнято. Користувача ${report.reportedId} заблоковано.`);
      
      try {
        await bot.sendMessage(report.reportedId, "❌ Ваш акаунт заблоковано адміністратором за скаргу.");
      } catch (e) {}
    }
    
    await answerCallback(callbackQuery, "Скаргу оброблено");
  }
  
  // ВІДХИЛЕННЯ СКАРГИ
  else if (data.startsWith('admin_reject_report_')) {
    if (!isUserAdmin) return;
    
    const reportId = data.replace('admin_reject_report_', '');
    const report = await Report.findById(reportId);
    
    if (report) {
      report.status = 'rejected';
      report.resolvedBy = userId;
      report.resolvedAt = new Date();
      await report.save();
      
      await bot.sendMessage(chatId, `❌ Скаргу відхилено.`);
    }
    
    await answerCallback(callbackQuery, "Скаргу відхилено");
  }
  
  // РОЗСИЛКА
  else if (data === 'admin_broadcast') {
    if (!isUserAdmin) return;
    
    try {
      await bot.editMessageText(
        "📢 **Розсилка повідомлень**\n\nВведіть текст для розсилки всім користувачам:",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "📢 **Розсилка повідомлень**\n\nВведіть текст для розсилки всім користувачам:", { parse_mode: "Markdown" });
    }
    userStates.set(userId, { adminAction: 'broadcast' });
    await answerCallback(callbackQuery);
  }
  
  // ПІДТВЕРДЖЕННЯ РОЗСИЛКИ
  else if (data === 'admin_broadcast_confirm') {
    if (!isUserAdmin) return;
    
    const state = userStates.get(userId);
    if (!state || !state.broadcastMessage) {
      await bot.sendMessage(chatId, "❌ Немає тексту для розсилки.");
      return;
    }
    
    const message = state.broadcastMessage;
    const users = await User.find({ isBlocked: false });
    let sent = 0;
    let failed = 0;
    
    await bot.sendMessage(chatId, `📢 Починаю розсилку для ${users.length} користувачів...`);
    
    for (const user of users) {
      try {
        await bot.sendMessage(user.telegramId, message);
        sent++;
      } catch (error) {
        failed++;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    await bot.sendMessage(chatId, `✅ Розсилку завершено!\n📨 Відправлено: ${sent}\n❌ Помилок: ${failed}`);
    userStates.delete(userId);
    await answerCallback(callbackQuery);
  }
  
  // УПРАВЛІННЯ КАНАЛАМИ
  else if (data === 'admin_channels_menu') {
    if (!isUserAdmin) return;
    
    const channels = await Channel.find({});
    
    let channelsText = "📺 **Управління каналами**\n\n";
    if (channels.length === 0) {
      channelsText += "📭 Немає доданих каналів.\n\n";
    } else {
      channelsText += "**Додані канали:**\n";
      channels.forEach((ch, i) => {
        channelsText += `${i + 1}. ${ch.channelName || ch.channelId}\n`;
      });
      channelsText += "\n";
    }
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Додати канал", callback_data: "admin_add_channel" }],
          [{ text: "➖ Видалити канал", callback_data: "admin_remove_channel" }],
          [{ text: "🔙 Назад", callback_data: "admin_panel" }]
        ]
      }
    };
    
    try {
      await bot.editMessageText(
        channelsText,
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...keyboard }
      );
    } catch (error) {
      await bot.sendMessage(chatId, channelsText, { parse_mode: "Markdown", ...keyboard });
    }
    await answerCallback(callbackQuery);
  }
  
  // ДОДАВАННЯ КАНАЛУ
  else if (data === 'admin_add_channel') {
    if (!isUserAdmin) return;
    
    try {
      await bot.editMessageText(
        "➕ **Додавання каналу**\n\n" +
        "Введіть username або посилання на канал:\n" +
        "Наприклад: `@channel_name` або `https://t.me/channel_name`\n\n" +
        "⚠️ **Важливо:** Бот повинен бути адміністратором каналу!",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "➕ **Додавання каналу**\n\nВведіть username або посилання на канал:\nНаприклад: `@channel_name` або `https://t.me/channel_name`\n\n⚠️ **Важливо:** Бот повинен бути адміністратором каналу!", { parse_mode: "Markdown" });
    }
    userStates.set(userId, { adminAction: 'add_channel' });
    await answerCallback(callbackQuery);
  }
  
  // ВИДАЛЕННЯ КАНАЛУ (меню)
  else if (data === 'admin_remove_channel') {
    if (!isUserAdmin) return;
    
    const channels = await Channel.find({});
    
    if (channels.length === 0) {
      try {
        await bot.editMessageText(
          "❌ Немає каналів для видалення.",
          { chat_id: chatId, message_id: messageId }
        );
      } catch (error) {
        await bot.sendMessage(chatId, "❌ Немає каналів для видалення.");
      }
    } else {
      let message = "➖ **Виберіть канал для видалення:**\n\n";
      const buttons = [];
      
      channels.forEach((ch, i) => {
        message += `${i + 1}. ${ch.channelName || ch.channelId}\n`;
        buttons.push([{ text: `❌ ${ch.channelName || ch.channelId}`, callback_data: `admin_delete_channel_${ch._id}` }]);
      });
      
      buttons.push([{ text: "🔙 Назад", callback_data: "admin_channels_menu" }]);
      
      const keyboard = { reply_markup: { inline_keyboard: buttons } };
      
      try {
        await bot.editMessageText(
          message,
          { chat_id: chatId, message_id: messageId, ...keyboard }
        );
      } catch (error) {
        await bot.sendMessage(chatId, message, keyboard);
      }
    }
    await answerCallback(callbackQuery);
  }
  
  // ВИДАЛЕННЯ КАНАЛУ (конкретний)
  else if (data.startsWith('admin_delete_channel_')) {
    if (!isUserAdmin) return;
    
    const channelId = data.replace('admin_delete_channel_', '');
    await Channel.deleteOne({ _id: channelId });
    await bot.sendMessage(chatId, "✅ Канал видалено!");
    await answerCallback(callbackQuery);
  }
  
  // ========== УПРАВЛІННЯ АДМІНАМИ (ДЛЯ СУПЕР-АДМІНА) ==========
  else if (data === 'admin_admins_menu') {
    if (!isUserSuper) {
      await bot.sendMessage(chatId, "❌ Доступ заборонено. Тільки супер-адмін може керувати адмінами.");
      await answerCallback(callbackQuery);
      return;
    }
    
    const allAdmins = await Admin.find().sort({ role: -1, addedAt: 1 });
    
    let adminsText = "👑 **Управління адмінами**\n\n";
    
    if (allAdmins.length === 0) {
      adminsText += "📭 Немає адмінів.\n";
    } else {
      adminsText += "**Список адмінів:**\n\n";
      for (const admin of allAdmins) {
        const roleIcon = admin.role === 'super_admin' ? '👑' : '🛡️';
        const currentUserMark = admin.telegramId === userId ? ' (ви)' : '';
        adminsText += `${roleIcon} **${admin.firstName || 'Admin'}**${currentUserMark}\n`;
        adminsText += `   ID: \`${admin.telegramId}\`\n`;
        adminsText += `   Роль: ${admin.role === 'super_admin' ? 'Супер-адмін' : 'Адмін'}\n`;
        adminsText += `   Доданий: ${new Date(admin.addedAt).toLocaleDateString()}\n\n`;
      }
    }
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Додати адміна", callback_data: "admin_add_admin" }],
          [{ text: "➖ Видалити адміна", callback_data: "admin_remove_admin" }],
          [{ text: "🔙 Назад", callback_data: "admin_panel" }]
        ]
      }
    };
    
    try {
      await bot.editMessageText(
        adminsText,
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...keyboard }
      );
    } catch (error) {
      await bot.sendMessage(chatId, adminsText, { parse_mode: "Markdown", ...keyboard });
    }
    await answerCallback(callbackQuery);
  }
  
  // ДОДАТИ АДМІНА (ЧЕРЕЗ ТГ БОТА)
  else if (data === 'admin_add_admin') {
    if (!isUserSuper) {
      await bot.sendMessage(chatId, "❌ Доступ заборонено.");
      await answerCallback(callbackQuery);
      return;
    }
    
    try {
      await bot.editMessageText(
        "➕ **Додавання адміна**\n\n" +
        "Введіть Telegram ID користувача, якого хочете зробити адміном:\n\n" +
        "Наприклад: `818447502`\n\n" +
        "Також ви можете вказати роль через пробіл:\n" +
        "`818447502 admin` - звичайний адмін\n" +
        "`818447502 super_admin` - супер-адмін",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "➕ **Додавання адміна**\n\nВведіть Telegram ID користувача, якого хочете зробити адміном:\n\nНаприклад: `818447502`\n\nТакож ви можете вказати роль через пробіл:\n`818447502 admin` - звичайний адмін\n`818447502 super_admin` - супер-адмін", { parse_mode: "Markdown" });
    }
    userStates.set(userId, { adminAction: 'add_admin_via_bot' });
    await answerCallback(callbackQuery);
  }
  
  // ВИДАЛИТИ АДМІНА (ЧЕРЕЗ ТГ БОТА)
  else if (data === 'admin_remove_admin') {
    if (!isUserSuper) {
      await bot.sendMessage(chatId, "❌ Доступ заборонено.");
      await answerCallback(callbackQuery);
      return;
    }
    
    const admins = await Admin.find({ telegramId: { $ne: userId } });
    
    if (admins.length === 0) {
      try {
        await bot.editMessageText(
          "❌ Немає інших адмінів для видалення.",
          { chat_id: chatId, message_id: messageId }
        );
      } catch (error) {
        await bot.sendMessage(chatId, "❌ Немає інших адмінів для видалення.");
      }
    } else {
      let message = "➖ **Виберіть адміна для видалення:**\n\n";
      const buttons = [];
      
      for (const admin of admins) {
        message += `• ${admin.firstName || 'Admin'} - ID: \`${admin.telegramId}\` (${admin.role === 'super_admin' ? 'Супер-адмін' : 'Адмін'})\n`;
        buttons.push([{ 
          text: `❌ Видалити ${admin.firstName || admin.telegramId}`, 
          callback_data: `admin_delete_admin_${admin.telegramId}` 
        }]);
      }
      
      buttons.push([{ text: "🔙 Назад", callback_data: "admin_admins_menu" }]);
      
      const keyboard = { reply_markup: { inline_keyboard: buttons } };
      
      try {
        await bot.editMessageText(
          message,
          { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...keyboard }
        );
      } catch (error) {
        await bot.sendMessage(chatId, message, { parse_mode: "Markdown", ...keyboard });
      }
    }
    await answerCallback(callbackQuery);
  }
  
  // ВИДАЛИТИ КОНКРЕТНОГО АДМІНА
  else if (data.startsWith('admin_delete_admin_')) {
    if (!isUserSuper) {
      await bot.sendMessage(chatId, "❌ Доступ заборонено.");
      await answerCallback(callbackQuery);
      return;
    }
    
    const targetId = parseInt(data.replace('admin_delete_admin_', ''));
    
    if (targetId === userId) {
      await bot.sendMessage(chatId, "❌ Не можна видалити самого себе!");
      await answerCallback(callbackQuery);
      return;
    }
    
    const targetAdmin = await Admin.findOne({ telegramId: targetId });
    if (!targetAdmin) {
      await bot.sendMessage(chatId, "❌ Адміна не знайдено!");
      await answerCallback(callbackQuery);
      return;
    }
    
    if (targetAdmin.role === 'super_admin') {
      const superAdminCount = await Admin.countDocuments({ role: 'super_admin' });
      if (superAdminCount <= 1) {
        await bot.sendMessage(chatId, "❌ Не можна видалити єдиного супер-адміна!");
        await answerCallback(callbackQuery);
        return;
      }
    }
    
    const result = await Admin.deleteOne({ telegramId: targetId });
    
    if (result.deletedCount > 0) {
      await bot.sendMessage(chatId, `✅ Адміна ${targetId} видалено!`);
      
      // Оновлюємо меню адмінів
      await bot.emit('callback_query', {
        id: Date.now(),
        from: { id: userId },
        message: { chat: { id: chatId }, message_id: messageId },
        data: 'admin_admins_menu'
      });
    } else {
      await bot.sendMessage(chatId, `❌ Не вдалося видалити адміна ${targetId}`);
    }
    
    await answerCallback(callbackQuery, "Адміна видалено");
  }
  
  // ВЕБ-АДМІНКА
  else if (data === 'admin_website') {
    if (!isUserAdmin) return;
    
    let webUrl = process.env.WEBAPP_URL || 'http://localhost:3000/admin';
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🌐 Відкрити веб-адмінку", url: webUrl }],
          [{ text: "🔙 Назад", callback_data: "admin_panel" }]
        ]
      }
    };
    
    try {
      await bot.editMessageText(
        "🌐 **Веб-адмінка**\n\nНатисніть кнопку нижче, щоб відкрити веб-інтерфейс адміністратора:",
        { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...keyboard }
      );
    } catch (error) {
      await bot.sendMessage(chatId, "🌐 **Веб-адмінка**\n\nНатисніть кнопку нижче, щоб відкрити веб-інтерфейс адміністратора:", { parse_mode: "Markdown", ...keyboard });
    }
    await answerCallback(callbackQuery);
  }
  
  // ПОВЕРНЕННЯ В АДМІН-ПАНЕЛЬ
  else if (data === 'admin_panel') {
    if (!isUserAdmin) return;
    await showAdminPanel(chatId, userId);
    await answerCallback(callbackQuery);
  }
});

// Обробка текстових повідомлень
bot.on('message', async (msg) => {
  await touchUserActivity(msg.from.id);

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || '';

  const isUserAdmin = await isAdminCheck(userId);
  
  // Перевірка підписки для всіх текстових повідомлень (крім /start)
  const isSubscribed = await requireSubscriptionWithButtons(userId, chatId, false);
  if (!isSubscribed && text !== '/start') {
    await requireSubscriptionWithButtons(userId, chatId, true);
    return;
  }
  
  if (text && text.startsWith('/')) return;
  
  // КНОПКИ ДЛЯ ВСІХ СТАНІВ
  
  // Кнопка перевірки підписки
  if (text === '✅ Перевірити підписку') {
    const isSubscribed = await requireSubscriptionWithButtons(userId, chatId, true, true);
    if (isSubscribed) {
      await bot.sendMessage(chatId, "✅ Ви підписані на всі необхідні канали!");
    }
    return;
  }
  
  // КНОПКИ ДЛЯ СТАНУ "В ЧАТІ"
  if (text === '❌ Завершити чат') {
    await endChat(userId, chatId);
    return;
  }
  
  if (text === '🔍 Новий співрозмовник') {
    await endChat(userId, chatId);
    bot.emit('callback_query', {
      id: Date.now(),
      from: msg.from,
      message: { chat: { id: chatId } },
      data: 'search'
    });
    return;
  }
  
  if (text === '⚠️ Скарга') {
    const partnerId = activeChats.get(userId);
    if (!partnerId) {
      await bot.sendMessage(chatId, "❌ Немає активного чату для скарги.");
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
    
    await bot.sendMessage(chatId, "⚠️ **Поскаржитись на співрозмовника**\n\nОберіть причину скарги:", { parse_mode: "Markdown", ...reportKeyboard });
    return;
  }
  
  // КНОПКИ ДЛЯ СТАНУ "ПОШУК"
  if (text === '⏹️ Зупинити пошук') {
    await endChat(userId, chatId);
    return;
  }
  
  // КНОПКИ ГОЛОВНОГО МЕНЮ
  if (text === '🔍 Знайти співрозмовника') {
    const isSubscribed = await requireSubscriptionWithButtons(userId, chatId, true, true);
    if (!isSubscribed) return;
    
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
    return;
  }
  
  if (text === '⚙️ Анкета') {
    await bot.sendMessage(chatId, "⚙️ **Налаштування анкети**\n\nОберіть що хочете змінити:", { parse_mode: "Markdown", ...settingsKeyboard });
    return;
  }
  
  if (text === '✅ Підписка') {
    const isSubscribed = await requireSubscriptionWithButtons(userId, chatId, true, true);
    if (isSubscribed) {
      await bot.sendMessage(chatId, "✅ Ви підписані на всі необхідні канали!");
    }
    return;
  }
  
 if (text === '📜 Правила') {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📖 Читати правила", url: RULES_URL }
        ]
      ]
    }
  };

  bot.sendMessage(chatId, "📜 Правила знайомств\n\nНатисни кнопку нижче 👇", keyboard);
  return;
}
  
  if (text === '📞 Підтримка') {
    bot.sendMessage(chatId, `📞 Підтримка\n\nЗв'язатись з адміністратором: ${SUPPORT_CONTACT}`);
    return;
  }
  
  if (text === '🛡️ Адмінка') {
    await showAdminPanel(chatId, userId);
    return;
  }
  
  // ПЕРЕВІРКА ЧИ В АКТИВНОМУ ЧАТІ
  if (activeChats.has(userId)) {
    await touchUserActivity(userId, { isInChat: true });
  const partnerId = activeChats.get(userId);

  try {
    const fromUser = await User.findOne({ telegramId: userId });
    const toUser = await User.findOne({ telegramId: partnerId });

    let messageType = 'text';
    let text = msg.text || null;
    let fileId = null;
    let caption = msg.caption || null;
    let fileName = null;
    let mimeType = null;

    if (msg.photo && msg.photo.length > 0) {
      messageType = 'photo';
      fileId = msg.photo[msg.photo.length - 1].file_id;
    } else if (msg.video) {
      messageType = 'video';
      fileId = msg.video.file_id;
      mimeType = msg.video.mime_type || null;
    } else if (msg.voice) {
      messageType = 'voice';
      fileId = msg.voice.file_id;
      mimeType = msg.voice.mime_type || null;
    } else if (msg.document) {
      messageType = 'document';
      fileId = msg.document.file_id;
      fileName = msg.document.file_name || null;
      mimeType = msg.document.mime_type || null;
    } else if (msg.sticker) {
      messageType = 'sticker';
      fileId = msg.sticker.file_id;
    } else if (!msg.text) {
      messageType = 'unsupported';
      text = '[Непідтримуваний тип повідомлення]';
    }

    const messageDoc = new Message({
      messageId: msg.message_id,
      fromUserId: userId,
      fromName: fromUser?.firstName || msg.from.first_name,
      toUserId: partnerId,
      toName: toUser?.firstName || 'Користувач',
      text,
      messageType,
      fileId,
      caption,
      fileName,
      mimeType,
      chatId: chatId
    });

    await messageDoc.save();
    console.log(`💾 Повідомлення збережено: ${userId} -> ${partnerId} [${messageType}]`);
  } catch (error) {
    console.error('Помилка збереження повідомлення:', error);
  }

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

  try {
    if (msg.photo && msg.photo.length > 0) {
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      await bot.sendPhoto(partnerId, photoId, {
        caption: msg.caption || ''
      });
    } else if (msg.video) {
      await bot.sendVideo(partnerId, msg.video.file_id, {
        caption: msg.caption || ''
      });
    } else if (msg.voice) {
      await bot.sendVoice(partnerId, msg.voice.file_id);
    } else if (msg.document) {
      await bot.sendDocument(partnerId, msg.document.file_id, {
        caption: msg.caption || ''
      });
    } else if (msg.sticker) {
      await bot.sendSticker(partnerId, msg.sticker.file_id);
    } else if (msg.text) {
      await bot.sendMessage(partnerId, msg.text);
    } else {
      await bot.sendMessage(chatId, "❌ Цей тип повідомлення поки не підтримується.");
    }
  } catch (error) {
    console.error('Помилка пересилання:', error);
    await bot.sendMessage(chatId, "❌ Не вдалося відправити. Співрозмовник вийшов.");
    await endChat(userId, chatId);
  }

  return;
}
  
  // АДМІН-ДІЇ
  const state = userStates.get(userId);
  
  if (state && state.adminAction === 'block') {
    const targetId = parseInt(text);
    if (targetId && !isNaN(targetId)) {
      await User.updateOne({ telegramId: targetId }, { isBlocked: true });
      await bot.sendMessage(chatId, `✅ Користувача ${targetId} заблоковано.`);
      if (waitingUsers.has(targetId)) waitingUsers.delete(targetId);
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
  
  if (state && state.adminAction === 'broadcast') {
    const confirmKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Підтвердити", callback_data: "admin_broadcast_confirm" }],
          [{ text: "❌ Скасувати", callback_data: "cancel" }]
        ]
      }
    };
    userStates.set(userId, { adminAction: null, broadcastMessage: text });
    await bot.sendMessage(chatId, `📢 Текст розсилки:\n\n${text}\n\nНадіслати?`, confirmKeyboard);
    return;
  }
  
  if (state && state.adminAction === 'add_channel') {
    let username = text.trim();
    
    if (username.includes('t.me/')) {
      const match = username.match(/t\.me\/([a-zA-Z0-9_]+)/);
      if (match) {
        username = '@' + match[1];
      } else {
        await bot.sendMessage(chatId, "❌ Невірний формат посилання. Використовуйте: `@username` або `https://t.me/username`", { parse_mode: "Markdown" });
        userStates.delete(userId);
        return;
      }
    }
    
    if (!username.startsWith('@')) {
      username = '@' + username;
    }
    
    try {
      const chat = await bot.getChat(username);
      
      if (chat.type !== 'channel') {
        await bot.sendMessage(chatId, "❌ Це не канал. Бот працює тільки з публічними каналами.");
        userStates.delete(userId);
        return;
      }
      
      const botInfo = await bot.getMe();
      let isAdmin = false;
      
      try {
        const chatMember = await bot.getChatMember(username, botInfo.id);
        if (chatMember.status === 'administrator' || chatMember.status === 'creator') {
          isAdmin = true;
        }
      } catch (error) {
        console.log('Помилка перевірки прав бота:', error.message);
      }
      
      if (!isAdmin) {
        await bot.sendMessage(chatId, 
          `❌ **Помилка!**\n\n` +
          `Бот не є адміністратором каналу **${chat.title}**.\n\n` +
          `❗ **Щоб бот міг перевіряти підписки, він повинен бути адміністратором каналу.**`,
          { parse_mode: "Markdown" }
        );
        userStates.delete(userId);
        return;
      }
      
      const existingChannel = await Channel.findOne({ channelId: username });
      if (existingChannel) {
        await bot.sendMessage(chatId, `❌ Канал **${chat.title}** вже додано!`, { parse_mode: "Markdown" });
        userStates.delete(userId);
        return;
      }
      
      const channel = new Channel({
        channelId: username,
        channelUrl: `https://t.me/${username.replace('@', '')}`,
        channelUsername: username,
        channelName: chat.title,
        addedBy: userId
      });
      await channel.save();
      
      await bot.sendMessage(chatId, 
        `✅ **Канал додано!**\n\n` +
        `📢 Назва: ${chat.title}\n` +
        `🔗 Посилання: https://t.me/${username.replace('@', '')}`,
        { parse_mode: "Markdown" }
      );
      
    } catch (error) {
      console.error('Помилка додавання каналу:', error);
      
      if (error.response?.body?.description?.includes('chat not found')) {
        await bot.sendMessage(chatId,
          `❌ **Канал не знайдено!**\n\n` +
          `Канал з username "${username}" не існує або є приватним.`,
          { parse_mode: "Markdown" }
        );
      } else {
        await bot.sendMessage(chatId,
          `❌ **Помилка при додаванні каналу!**\n\n` +
          `Помилка: ${error.message}`,
          { parse_mode: "Markdown" }
        );
      }
      userStates.delete(userId);
      return;
    }
    userStates.delete(userId);
    return;
  }
  
  if (state && state.adminAction === 'remove_channel') {
    const index = parseInt(text) - 1;
    if (state.channels && state.channels[index]) {
      await Channel.deleteOne({ _id: state.channels[index]._id });
      await bot.sendMessage(chatId, "✅ Канал видалено!");
    } else {
      await bot.sendMessage(chatId, "❌ Невірний номер каналу.");
    }
    userStates.delete(userId);
    return;
  }
  
  // Додавання адміна через ТГ бота
  if (state && state.adminAction === 'add_admin_via_bot') {
    const parts = text.trim().split(' ');
    const targetId = parseInt(parts[0]);
    const role = parts[1] === 'super_admin' ? 'super_admin' : 'admin';
    
    if (!targetId || isNaN(targetId)) {
      await bot.sendMessage(chatId, "❌ Невірний ID. Спробуйте ще раз.");
      userStates.delete(userId);
      return;
    }
    
    const existing = await Admin.findOne({ telegramId: targetId });
    if (existing) {
      if (existing.role !== role) {
        existing.role = role;
        await existing.save();
        await bot.sendMessage(chatId, `✅ Роль адміна ${targetId} оновлено до ${role === 'super_admin' ? 'супер-адміна' : 'адміна'}!`);
      } else {
        await bot.sendMessage(chatId, `❌ Користувач ${targetId} вже є адміном (роль: ${existing.role})`);
      }
      userStates.delete(userId);
      return;
    }
    
    let userInfo = null;
    try {
      const chatMember = await bot.getChatMember(targetId, targetId);
      userInfo = chatMember.user;
    } catch (error) {
      console.log('Не вдалося отримати інформацію про користувача');
    }
    
    const newAdmin = new Admin({
      telegramId: targetId,
      username: userInfo?.username,
      firstName: userInfo?.first_name || 'Admin',
      lastName: userInfo?.last_name,
      role: role,
      addedBy: userId
    });
    
    await newAdmin.save();
    
    const roleText = role === 'super_admin' ? 'супер-адміна' : 'адміна';
    await bot.sendMessage(chatId, `✅ Користувача ${targetId} додано як ${roleText}!`);
    
    try {
      await bot.sendMessage(targetId, `🎉 Вас зроблено ${roleText} бота! Тепер вам доступна адмін-панель.`);
    } catch (e) {}
    
    userStates.delete(userId);
    return;
  }
});

console.log('🤖 Бот запущено!');