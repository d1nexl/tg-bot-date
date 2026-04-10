const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Логування запитів
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Функція для отримання моделей після підключення до БД
let User, Message, Report, Admin, isAdmin;

// Middleware для перевірки адміна
async function checkAdmin(req, res, next) {
  if (!User || !isAdmin) {
    return res.status(503).json({ error: 'Сервер ще не готовий, спробуйте пізніше' });
  }
  
  const telegramId = parseInt(req.headers['x-telegram-id']);
  
  if (!telegramId) {
    return res.status(403).json({ error: 'Необхідна авторизація' });
  }
  
  try {
    const isAdminUser = await isAdmin(telegramId);
    if (!isAdminUser) {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }
    req.telegramId = telegramId;
    next();
  } catch (error) {
    console.error('Помилка перевірки адміна:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
}

// API маршрути

// Перевірка авторизації
app.get('/api/check-auth', async (req, res) => {
  if (!User || !isAdmin) {
    return res.status(503).json({ error: 'Сервер ще не готовий' });
  }
  
  const telegramId = parseInt(req.headers['x-telegram-id']);
  console.log(`Перевірка авторизації для: ${telegramId}`);
  
  try {
    if (telegramId && await isAdmin(telegramId)) {
      const admin = await Admin.findOne({ telegramId });
      res.json({ isAdmin: true, admin });
    } else {
      res.json({ isAdmin: false });
    }
  } catch (error) {
    console.error('Помилка check-auth:', error);
    res.status(500).json({ error: error.message });
  }
});

// Отримати статистику
app.get('/api/stats', checkAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ lastActive: { $gt: new Date(Date.now() - 24*60*60*1000) } });
    const totalMessages = await Message.countDocuments();
    const totalReports = await Report.countDocuments({ status: 'pending' });
    const blockedUsers = await User.countDocuments({ isBlocked: true });
    
    res.json({ totalUsers, activeUsers, totalMessages, totalReports, blockedUsers });
  } catch (error) {
    console.error('Помилка stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Отримати всіх користувачів
app.get('/api/users', checkAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).limit(100);
    res.json(users);
  } catch (error) {
    console.error('Помилка users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Отримати всі повідомлення
app.get('/api/messages', checkAdmin, async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: -1 }).limit(200);
    res.json(messages);
  } catch (error) {
    console.error('Помилка messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// Отримати чати
app.get('/api/chats', checkAdmin, async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: -1 }).limit(500);
    
    const chats = new Map();
    
    for (const msg of messages) {
      const chatKey = [msg.fromUserId, msg.toUserId].sort().join('-');
      if (!chats.has(chatKey)) {
        chats.set(chatKey, {
          user1: msg.fromUserId,
          user1Name: msg.fromName,
          user2: msg.toUserId,
          user2Name: msg.toName,
          lastMessage: msg.text,
          lastTime: msg.timestamp,
          messages: []
        });
      }
      const chat = chats.get(chatKey);
      chat.messages.unshift(msg);
      if (msg.timestamp > chat.lastTime) {
        chat.lastTime = msg.timestamp;
        chat.lastMessage = msg.text;
      }
    }
    
    res.json(Array.from(chats.values()).sort((a, b) => b.lastTime - a.lastTime));
  } catch (error) {
    console.error('Помилка chats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Отримати повідомлення чату
app.get('/api/chat/:user1/:user2', checkAdmin, async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const messages = await Message.find({
      $or: [
        { fromUserId: parseInt(user1), toUserId: parseInt(user2) },
        { fromUserId: parseInt(user2), toUserId: parseInt(user1) }
      ]
    }).sort({ timestamp: 1 });
    
    res.json(messages);
  } catch (error) {
    console.error('Помилка chat:', error);
    res.status(500).json({ error: error.message });
  }
});

// Отримати скарги
app.get('/api/reports', checkAdmin, async (req, res) => {
  try {
    const reports = await Report.find().sort({ timestamp: -1 });
    res.json(reports);
  } catch (error) {
    console.error('Помилка reports:', error);
    res.status(500).json({ error: error.message });
  }
});

// Блокувати користувача
app.post('/api/block/:userId', checkAdmin, async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId);
    await User.updateOne({ telegramId: targetId }, { isBlocked: true });
    res.json({ success: true });
  } catch (error) {
    console.error('Помилка block:', error);
    res.status(500).json({ error: error.message });
  }
});

// Розблокувати користувача
app.post('/api/unblock/:userId', checkAdmin, async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId);
    await User.updateOne({ telegramId: targetId }, { isBlocked: false });
    res.json({ success: true });
  } catch (error) {
    console.error('Помилка unblock:', error);
    res.status(500).json({ error: error.message });
  }
});

// Закрити скаргу
app.post('/api/resolve-report/:reportId', checkAdmin, async (req, res) => {
  try {
    await Report.updateOne({ _id: req.params.reportId }, { status: 'resolved' });
    res.json({ success: true });
  } catch (error) {
    console.error('Помилка resolve-report:', error);
    res.status(500).json({ error: error.message });
  }
});

// Отримати список адмінів
app.get('/api/admins', checkAdmin, async (req, res) => {
  try {
    const admins = await Admin.find().sort({ addedAt: -1 });
    res.json(admins);
  } catch (error) {
    console.error('Помилка admins:', error);
    res.status(500).json({ error: error.message });
  }
});

// Додати адміна
app.post('/api/add-admin', checkAdmin, async (req, res) => {
  try {
    const { telegramId, username, firstName, lastName } = req.body;
    
    const existing = await Admin.findOne({ telegramId });
    if (existing) {
      return res.status(400).json({ error: 'Користувач вже є адміном' });
    }
    
    const newAdmin = new Admin({
      telegramId,
      username,
      firstName,
      lastName,
      addedBy: req.telegramId
    });
    await newAdmin.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Помилка add-admin:', error);
    res.status(500).json({ error: error.message });
  }
});

// Перевірка пароля адміна
app.post('/api/check-password', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  
  if (password === adminPassword) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Видалити адміна
app.delete('/api/remove-admin/:telegramId', checkAdmin, async (req, res) => {
  try {
    const targetId = parseInt(req.params.telegramId);
    if (targetId === req.telegramId) {
      return res.status(400).json({ error: 'Не можна видалити самого себе' });
    }
    await Admin.deleteOne({ telegramId: targetId });
    res.json({ success: true });
  } catch (error) {
    console.error('Помилка remove-admin:', error);
    res.status(500).json({ error: error.message });
  }
});

// Сторінки
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера після підключення до БД
async function startServer() {
  try {
    // Підключаємося до БД
    const { connectDB, User: UserModel, Message: MessageModel, Report: ReportModel, Admin: AdminModel, isAdmin: isAdminFn } = require('./database.js');
    
    await connectDB();
    
    // Зберігаємо моделі
    User = UserModel;
    Message = MessageModel;
    Report = ReportModel;
    Admin = AdminModel;
    isAdmin = isAdminFn;
    
    console.log('✅ Моделі БД завантажено');
    
    // Запускаємо сервер
    app.listen(PORT, () => {
      console.log(`🌐 Адмін-панель: http://localhost:${PORT}/admin`);
    });
  } catch (error) {
    console.error('❌ Помилка запуску сервера:', error);
    process.exit(1);
  }
}

startServer();