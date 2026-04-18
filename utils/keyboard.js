// Кого шукати
const whoToFindKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "👨 Хлопців", callback_data: "find_boys" },
        { text: "👩 Дівчат", callback_data: "find_girls" }
      ],
      [
        { text: "👥 Всіх підряд", callback_data: "find_all" }
      ]
    ]
  }
};

// Хто ти
const whoAreYouKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "👨 Хлопець", callback_data: "iam_boy" },
        { text: "👩 Дівчина", callback_data: "iam_girl" }
      ]
    ]
  }
};

// Райони - оновлена версія з попередженням
const districtKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "✅ ВСЕ ЗАКАРПАТТЯ", callback_data: "dist_all" }
      ],
      [
        { text: "❌ Тячівський (недоступний)", callback_data: "dist_unavailable" },
        { text: "❌ Рахівський (недоступний)", callback_data: "dist_unavailable" }
      ],
      [
        { text: "❌ Мукачівський (недоступний)", callback_data: "dist_unavailable" },
        { text: "❌ Берегівський (недоступний)", callback_data: "dist_unavailable" }
      ],
      [
        { text: "❌ Хустський (недоступний)", callback_data: "dist_unavailable" },
        { text: "❌ Ужгородський (недоступний)", callback_data: "dist_unavailable" }
      ]
    ]
  }
};

// Клавіатура налаштувань
const settingsKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "👥 Кого шукаю", callback_data: "edit_find" }],
      [{ text: "👤 Хто я", callback_data: "edit_who" }],
      [{ text: "📍 Район пошуку", callback_data: "edit_district" }],
      [{ text: "🔙 Назад", callback_data: "cancel" }]
    ]
  }
};

module.exports = {
  whoToFindKeyboard,
  whoAreYouKeyboard,
  districtKeyboard,
  settingsKeyboard,
};