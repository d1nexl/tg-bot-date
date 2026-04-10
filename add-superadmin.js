require('dotenv').config();
const mongoose = require('mongoose');

// Перевірка наявності змінних
console.log('🔍 Перевірка змінних середовища...');
console.log('MONGODB_URI:', process.env.MONGODB_URI ? '✅ Знайдено' : '❌ Не знайдено');
console.log('ADMIN_PASSWORD:', process.env.ADMIN_PASSWORD ? '✅ Знайдено' : '❌ Не знайдено');

if (!process.env.MONGODB_URI) {
  console.error('❌ Помилка: MONGODB_URI не знайдено в .env файлі!');
  process.exit(1);
}

// Схема адміна
const adminSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true, required: true },
  username: String,
  firstName: String,
  lastName: String,
  role: { type: String, default: 'admin', enum: ['admin', 'super_admin'] },
  addedAt: { type: Date, default: Date.now },
  addedBy: Number
});

const Admin = mongoose.model('Admin', adminSchema);

async function createSuperAdmin() {
  try {
    console.log('\n🔄 Підключення до MongoDB...');
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Підключено до MongoDB!');
    
    // Ваш Telegram ID з .env (або вкажіть тут)
    const SUPER_ADMIN_ID = parseInt(process.env.FIRST_ADMIN_ID) || 818447502;
    
    console.log(`\n📝 Створення супер-адміна з ID: ${SUPER_ADMIN_ID}`);
    
    // Перевіряємо чи вже існує
    const existing = await Admin.findOne({ telegramId: SUPER_ADMIN_ID });
    
    if (existing) {
      console.log(`⚠️ Користувач ${SUPER_ADMIN_ID} вже є адміном з роллю: ${existing.role}`);
      
      // Оновлюємо до super_admin якщо потрібно
      if (existing.role !== 'super_admin') {
        existing.role = 'super_admin';
        await existing.save();
        console.log('✅ Оновлено до супер-адміна!');
      } else {
        console.log('✅ Вже є супер-адміном!');
      }
    } else {
      // Створюємо нового супер-адміна
      const superAdmin = new Admin({
        telegramId: SUPER_ADMIN_ID,
        username: "admin",
        firstName: "Super Admin",
        role: "super_admin"
      });
      
      await superAdmin.save();
      console.log('✅ Супер-адміна успішно створено!');
    }
    
    // Додаємо інших адмінів з ADMINS списку
    const adminsList = process.env.ADMINS ? process.env.ADMINS.split(',').map(id => parseInt(id.trim())) : [];
    
    for (const adminId of adminsList) {
      if (adminId === SUPER_ADMIN_ID) continue; // Пропускаємо супер-адміна (вже додали)
      
      const existingAdmin = await Admin.findOne({ telegramId: adminId });
      if (!existingAdmin) {
        const newAdmin = new Admin({
          telegramId: adminId,
          firstName: "Admin",
          role: "admin",
          addedBy: SUPER_ADMIN_ID
        });
        await newAdmin.save();
        console.log(`✅ Додано адміна: ${adminId}`);
      } else {
        console.log(`⚠️ Адмін ${adminId} вже існує`);
      }
    }
    
    // Виводимо список всіх адмінів
    const allAdmins = await Admin.find().sort({ role: -1, addedAt: 1 });
    console.log('\n📋 Список всіх адмінів:');
    console.log('━'.repeat(50));
    allAdmins.forEach(admin => {
      const roleIcon = admin.role === 'super_admin' ? '👑' : '🛡️';
      console.log(`${roleIcon} ID: ${admin.telegramId} | Ім\'я: ${admin.firstName} | Роль: ${admin.role}`);
    });
    console.log('━'.repeat(50));
    
  } catch (error) {
    console.error('❌ Помилка:', error.message);
    if (error.message.includes('bad auth')) {
      console.log('\n💡 Перевірте правильність пароля в MONGODB_URI');
      console.log('💡 Переконайтесь, що користувач має доступ до бази даних');
    }
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 З\'єднання закрито');
    process.exit();
  }
}

// Запускаємо
createSuperAdmin();