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

// Райони
const districtKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "Тячівський", callback_data: "dist_Tiachiv" },
        { text: "Рахівський", callback_data: "dist_Rakhiv" }
      ],
      [
        { text: "Мукачівський", callback_data: "dist_Mukachevo" },
        { text: "Берегівський", callback_data: "dist_Berehove" }
      ],
      [
        { text: "Хустський", callback_data: "dist_Khust" },
        { text: "Ужгородський", callback_data: "dist_Uzhhorod" }
      ],
      [
        { text: "🌍 ВСЕ ЗАКАРПАТТЯ", callback_data: "dist_all" }
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