require('dotenv').config();
const { connectDB, Admin } = require('./database.js');

async function addFirstAdmin() {
  const adminId = process.env.FIRST_ADMIN_ID;
  
  if (!adminId) {
    console.log('❌ Встановіть FIRST_ADMIN_ID в .env файлі');
    process.exit();
    return;
  }
  
  await connectDB();
  
  try {
    const existing = await Admin.findOne({ telegramId: parseInt(adminId) });
    if (existing) {
      console.log('✅ Адмін вже існує');
      process.exit();
      return;
    }
    
    const admin = new Admin({
      telegramId: parseInt(adminId),
      username: 'admin',
      firstName: 'Admin',
      role: 'super_admin'
    });
    
    await admin.save();
    console.log('✅ Адміна додано!');
  } catch (error) {
    console.error('❌ Помилка:', error.message);
  }
  
  process.exit();
}

addFirstAdmin();