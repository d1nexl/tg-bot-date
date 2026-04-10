const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Atlas підключено!');
    console.log('📊 База даних: bot_db');
  } catch (error) {
    console.error('❌ Помилка підключення:', error.message);
  }
};

// Схема користувача
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true, required: true },
  username: String,
  firstName: String,
  lastName: String,
  findGender: String,
  userGender: String,
  district: String,
  isBlocked: { type: Boolean, default: false },
  reportCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now }
});

// Схема для повідомлень
const messageSchema = new mongoose.Schema({
  messageId: { type: Number, required: true },
  fromUserId: { type: Number, required: true },
  fromName: String,
  toUserId: { type: Number, required: true },
  toName: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
  chatId: Number,
  isReported: { type: Boolean, default: false }
});

// Схема для скарг
const reportSchema = new mongoose.Schema({
  reporterId: { type: Number, required: true },
  reportedId: { type: Number, required: true },
  reason: String,
  messageId: Number,
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'pending' }
});

// Схема для адмінів
const adminSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true, required: true },
  username: String,
  firstName: String,
  lastName: String,
  role: { type: String, default: 'admin' }, // admin, super_admin
  addedAt: { type: Date, default: Date.now },
  addedBy: Number
});

const Admin = mongoose.model('Admin', adminSchema);

// Функція для перевірки чи є користувач адміном
async function isAdmin(telegramId) {
  const admin = await Admin.findOne({ telegramId });
  return admin !== null;
}

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Report = mongoose.model('Report', reportSchema);

module.exports = { connectDB, User, Message, Report, Admin, isAdmin };