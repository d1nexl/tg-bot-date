let currentAdminId = null;
let currentAdmin = null;
let currentChatUsers = {};
let isLoadingMessages = false; // Запобігаємо дублюванню

// Перевірка авторизації
async function checkAuth() {
  const telegramId = localStorage.getItem('adminTelegramId');
  if (!telegramId) {
    window.location.href = '/login';
    return false;
  }
  
  // Перевіряємо чи є пароль в sessionStorage (додатковий захист)
  const hasPassword = sessionStorage.getItem('adminPassword');
  if (!hasPassword) {
    localStorage.removeItem('adminTelegramId');
    window.location.href = '/login';
    return false;
  }
  
  try {
    const response = await fetch('/api/check-auth', {
      headers: { 'X-Telegram-Id': telegramId }
    });
    const data = await response.json();
    
    if (!data.isAdmin) {
      localStorage.removeItem('adminTelegramId');
      sessionStorage.removeItem('adminPassword');
      window.location.href = '/login';
      return false;
    }
    
    currentAdminId = telegramId;
    currentAdmin = data.admin;
    const adminInfoDiv = document.getElementById('adminInfo');
    if (adminInfoDiv) {
      const roleText = currentAdmin?.role === 'super_admin' ? '👑 Супер-адмін' : '🛡️ Адмін';
      adminInfoDiv.innerHTML = `👋 ${currentAdmin?.firstName || 'Admin'}<br><small>${roleText}<br>ID: ${currentAdminId}</small>`;
    }
    
    // Показуємо/ховаємо кнопку додавання адміна в залежності від ролі
    const addAdminSection = document.querySelector('.add-admin');
    if (addAdminSection) {
      if (currentAdmin?.role !== 'super_admin') {
        addAdminSection.style.display = 'none';
      } else {
        addAdminSection.style.display = 'block';
      }
    }
    
    return true;
  } catch (error) {
    console.error('Auth error:', error);
    return false;
  }
}

// Функція для отримання кольору аватарки
function getAvatarColor(id) {
  const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe', '#43e97b', '#fa709a', '#fee140', '#30cfd0', '#a8edea'];
  return colors[Math.abs(id) % colors.length];
}

// Функція для отримання ініціалів
function getInitials(name, id) {
  if (name && name !== 'Користувач' && name !== 'Admin' && name !== 'null') {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name[0]?.toUpperCase() || id.toString().slice(-2);
  }
  return id.toString().slice(-2);
}

// Функція створення аватарки з кліком
function createAvatar(name, id, isOnline = false, onClick = true) {
  const color = getAvatarColor(id);
  const initials = getInitials(name, id);
  const clickAttr = onClick ? `onclick="showUserInfo(${id}, '${escapeHtml(name)}')"` : '';
  return `
    <div class="avatar" style="background: ${color}" ${clickAttr}>
      <span class="avatar-initials">${initials}</span>
      ${isOnline ? '<span class="avatar-online"></span>' : ''}
    </div>
  `;
}

// Показати інформацію про користувача
async function showUserInfo(userId, userName) {
  try {
    const response = await fetch('/api/users', {
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    const users = await response.json();
    const user = users.find(u => u.telegramId === userId);
    
    if (!user) {
      alert('Користувача не знайдено');
      return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'user-modal';
    modal.innerHTML = `
      <div class="user-modal-content">
        <div class="user-modal-header">
          ${createAvatar(user.firstName || user.telegramId, user.telegramId, false, false)}
          <div>
            <h3>${escapeHtml(user.firstName || 'Користувач')} ${escapeHtml(user.lastName || '')}</h3>
            <p>@${escapeHtml(user.username || 'немає')}</p>
          </div>
          <button class="modal-close" onclick="this.closest('.user-modal').remove()">✕</button>
        </div>
        <div class="user-modal-body">
          <div class="user-info-row">
            <span class="user-info-label">🆔 Telegram ID:</span>
            <span class="user-info-value">${user.telegramId}</span>
          </div>
          <div class="user-info-row">
            <span class="user-info-label">🎭 Стать:</span>
            <span class="user-info-value">${user.userGender === 'iam_boy' ? 'Хлопець' : 'Дівчина'}</span>
          </div>
          <div class="user-info-row">
            <span class="user-info-label">🔍 Шукає:</span>
            <span class="user-info-value">${user.findGender === 'find_boys' ? 'Хлопців' : user.findGender === 'find_girls' ? 'Дівчат' : 'Всіх'}</span>
          </div>
          <div class="user-info-row">
            <span class="user-info-label">📍 Район:</span>
            <span class="user-info-value">${user.district?.replace('dist_', '') || 'Не вибрано'}</span>
          </div>
          <div class="user-info-row">
            <span class="user-info-label">📅 Дата реєстрації:</span>
            <span class="user-info-value">${new Date(user.createdAt).toLocaleDateString('uk-UA')}</span>
          </div>
          <div class="user-info-row">
            <span class="user-info-label">🟢 Остання активність:</span>
            <span class="user-info-value">${formatTime(user.lastActive)}</span>
          </div>
          <div class="user-info-row">
            <span class="user-info-label">🔒 Статус:</span>
            <span class="user-info-value ${user.isBlocked ? 'blocked-text' : 'active-text'}">${user.isBlocked ? 'Заблокований' : 'Активний'}</span>
          </div>
        </div>
        <div class="user-modal-footer">
          ${!user.isBlocked ? 
            `<button class="block-user-btn" onclick="blockUser(${user.telegramId}); this.closest('.user-modal').remove()">🔒 Блокувати користувача</button>` : 
            `<button class="unblock-user-btn" onclick="unblockUser(${user.telegramId}); this.closest('.user-modal').remove()">🔓 Розблокувати користувача</button>`
          }
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Закриття по кліку поза модалкою
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  } catch (error) {
    console.error('Error showing user info:', error);
  }
}

// Завантаження статистики
async function loadStats() {
  try {
    const response = await fetch('/api/stats', {
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    const stats = await response.json();
    
    document.getElementById('totalUsers').textContent = stats.totalUsers;
    document.getElementById('activeUsers').textContent = stats.activeUsers;
    document.getElementById('totalMessages').textContent = stats.totalMessages;
    document.getElementById('pendingReports').textContent = stats.totalReports;
    document.getElementById('blockedUsers').textContent = stats.blockedUsers;
    document.getElementById('reportsBadge').textContent = stats.totalReports;
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Завантаження чатів
async function loadChats() {
  try {
    const response = await fetch('/api/chats', {
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    const chats = await response.json();
    
    const container = document.getElementById('chatsList');
    document.getElementById('chatsBadge').textContent = chats.length;
    
    if (chats.length === 0) {
      container.innerHTML = '<div class="loading"><div class="spinner"></div><span>Немає чатів</span></div>';
      return;
    }
    
    container.innerHTML = chats.map((chat) => {
      const user1Name = chat.user1Name || chat.user1;
      const user2Name = chat.user2Name || chat.user2;
      const avatar1 = createAvatar(user1Name, chat.user1);
      const avatar2 = createAvatar(user2Name, chat.user2);
      
      return `
        <div class="chat-item" data-user1="${chat.user1}" data-user2="${chat.user2}">
          <div class="chat-avatars">
            ${avatar1}
            ${avatar2}
          </div>
          <div class="chat-item-content">
            <div class="chat-item-header">
              <h4>${escapeHtml(user1Name)} ↔ ${escapeHtml(user2Name)}</h4>
              <div class="chat-time">${formatTime(chat.lastTime)}</div>
            </div>
            <div class="chat-preview">
              <span class="chat-preview-sender">${escapeHtml(chat.lastMessage?.substring(0, 50) || '...')}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    // Додаємо обробники кліків
    document.querySelectorAll('.chat-item').forEach(item => {
      item.addEventListener('click', () => {
        const user1 = parseInt(item.dataset.user1);
        const user2 = parseInt(item.dataset.user2);
        loadChatMessages(user1, user2, item);
      });
    });
  } catch (error) {
    console.error('Error loading chats:', error);
  }
}

// Завантаження повідомлень чату (без дублювання)
async function loadChatMessages(user1, user2, element) {
  if (isLoadingMessages) return;
  isLoadingMessages = true;
  
  // Візуальний фідбек - активний чат
  document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
  if (element) element.classList.add('active');
  
  try {
    const response = await fetch(`/api/chat/${user1}/${user2}`, {
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    const messages = await response.json();
    
    const container = document.getElementById('chatMessages');
    
    if (messages.length === 0) {
      container.innerHTML = '<div class="empty-chat"><div class="empty-chat-icon">💬</div><p>Немає повідомлень</p></div>';
      isLoadingMessages = false;
      return;
    }
    
    // Отримуємо інформацію про користувачів
    const users = await fetch('/api/users', { headers: { 'X-Telegram-Id': currentAdminId } }).then(r => r.json());
    const user1Info = users.find(u => u.telegramId === user1);
    const user2Info = users.find(u => u.telegramId === user2);
    
    // Зберігаємо інформацію про поточний чат
    currentChatUsers = {
      user1: { id: user1, name: user1Info?.firstName || user1, info: user1Info },
      user2: { id: user2, name: user2Info?.firstName || user2, info: user2Info }
    };
    
    // Оновлюємо заголовок чату
    updateChatHeader();
    
    // Очищаємо контейнер перед додаванням нових повідомлень
    container.innerHTML = '';
    
    let lastSender = null;
    let messageGroup = [];
    
    messages.forEach((msg, index) => {
      const currentSender = msg.fromUserId;
      const nextSender = messages[index + 1]?.fromUserId;
      
      messageGroup.push(msg);
      
      if (currentSender !== nextSender || index === messages.length - 1) {
        const isOutgoing = currentSender === user1;
        const senderId = isOutgoing ? user1 : user2;
        const senderName = isOutgoing ? (user1Info?.firstName || user1) : (user2Info?.firstName || user2);
        const avatar = createAvatar(senderName, senderId);
        
        const messagesHtml = messageGroup.map(m => `
          <div class="message-item">
            <div class="message-bubble">${escapeHtml(m.text || '')}</div>
            <div class="message-time">${formatTime(m.timestamp)}</div>
          </div>
        `).join('');
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-wrapper ${isOutgoing ? 'outgoing' : 'incoming'}`;
        messageDiv.innerHTML = `
          <div class="message-avatar">
            ${avatar}
          </div>
          <div class="message-content">
            <div class="message-sender">${escapeHtml(senderName)}</div>
            <div class="message-group">
              ${messagesHtml}
            </div>
          </div>
        `;
        container.appendChild(messageDiv);
        
        messageGroup = [];
      }
    });
    
    container.scrollTop = container.scrollHeight;
  } catch (error) {
    console.error('Error loading messages:', error);
    document.getElementById('chatMessages').innerHTML = '<div class="empty-chat"><div class="empty-chat-icon">⚠️</div><p>Помилка завантаження повідомлень</p></div>';
  } finally {
    isLoadingMessages = false;
  }
}

// Оновлення заголовка чату (зменшений)
function updateChatHeader() {
  // Заголовок прибрано для економії місця
  // Інформація про користувачів доступна при натисканні на аватарку
  return;
}

// Завантаження користувачів
async function loadUsers() {
  try {
    const response = await fetch('/api/users', {
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    const users = await response.json();
    
    const container = document.getElementById('usersList');
    
    if (users.length === 0) {
      container.innerHTML = '<div class="loading"><div class="spinner"></div><span>Немає користувачів</span></div>';
      return;
    }
    
    container.innerHTML = `
      <table class="users-table">
        <thead>
          <tr><th>Аватар</th><th>ID</th><th>Ім'я</th><th>Username</th><th>Шукає</th><th>Стать</th><th>Район</th><th>Статус</th><th>Дії</th></tr>
        </thead>
        <tbody>
          ${users.map(user => `
            <tr>
              <td class="user-avatar-cell">${createAvatar(user.firstName || user.telegramId, user.telegramId)}</td>
              <td>${user.telegramId}</td>
              <td>${escapeHtml(user.firstName || '-')} ${escapeHtml(user.lastName || '')}</td>
              <td>@${escapeHtml(user.username || '-')}</td>
              <td>${user.findGender === 'find_boys' ? 'Хлопців' : user.findGender === 'find_girls' ? 'Дівчат' : 'Всіх'}</td>
              <td>${user.userGender === 'iam_boy' ? 'Хлопець' : 'Дівчина'}</td>
              <td>${user.district?.replace('dist_', '') || '-'}</td>
              <td><span class="user-status ${user.isBlocked ? 'blocked' : 'active'}">${user.isBlocked ? 'Заблокований' : 'Активний'}</span></td>
              <td>
                ${!user.isBlocked ? 
                  `<button class="block-btn" onclick="blockUser(${user.telegramId})">🔒 Блокувати</button>` : 
                  `<button class="unblock-btn" onclick="unblockUser(${user.telegramId})">🔓 Розблокувати</button>`
                }
              </td>
            </tr>
          `).join('')}
        </tbody>
       </table>
    `;
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

// Блокування користувача
async function blockUser(userId) {
  if (!confirm(`Блокувати користувача ${userId}?`)) return;
  
  try {
    await fetch(`/api/block/${userId}`, {
      method: 'POST',
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    loadUsers();
    // Якщо цей користувач в поточному чаті, оновлюємо чат
    if (currentChatUsers.user1?.id === userId || currentChatUsers.user2?.id === userId) {
      const user1 = currentChatUsers.user1.id;
      const user2 = currentChatUsers.user2.id;
      loadChatMessages(user1, user2);
    }
  } catch (error) {
    console.error('Error blocking user:', error);
  }
}

// Розблокування користувача
async function unblockUser(userId) {
  if (!confirm(`Розблокувати користувача ${userId}?`)) return;
  
  try {
    await fetch(`/api/unblock/${userId}`, {
      method: 'POST',
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    loadUsers();
    if (currentChatUsers.user1?.id === userId || currentChatUsers.user2?.id === userId) {
      const user1 = currentChatUsers.user1.id;
      const user2 = currentChatUsers.user2.id;
      loadChatMessages(user1, user2);
    }
  } catch (error) {
    console.error('Error unblocking user:', error);
  }
}

// Завантаження скарг
async function loadReports() {
  try {
    const response = await fetch('/api/reports', {
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    const reports = await response.json();
    const pendingReports = reports.filter(r => r.status === 'pending');
    
    const container = document.getElementById('reportsList');
    document.getElementById('reportsBadge').textContent = pendingReports.length;
    
    if (reports.length === 0) {
      container.innerHTML = '<div class="loading"><div class="spinner"></div><span>Немає скарг</span></div>';
      return;
    }
    
    container.innerHTML = reports.map(report => `
      <div class="report-card">
        <div class="report-header">
          <div class="report-users">
            <span>👤 Від: ${report.reporterId}</span>
            <span>→</span>
            <span>👤 На: ${report.reportedId}</span>
          </div>
          <span class="report-reason">${report.reason || 'Не вказана'}</span>
        </div>
        <div class="report-footer">
          <span>🕐 ${new Date(report.timestamp).toLocaleString()}</span>
          <span>Статус: ${report.status === 'pending' ? '⏳ Очікує' : '✅ Розглянуто'}</span>
          ${report.status === 'pending' ? `<button class="resolve-btn" onclick="resolveReport('${report._id}')">✅ Відмітити вирішеним</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading reports:', error);
  }
}

// Відмітити скаргу як вирішену
async function resolveReport(reportId) {
  try {
    await fetch(`/api/resolve-report/${reportId}`, {
      method: 'POST',
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    loadReports();
  } catch (error) {
    console.error('Error resolving report:', error);
  }
}

// Завантаження адмінів
async function loadAdmins() {
  try {
    const response = await fetch('/api/admins', {
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    const admins = await response.json();
    
    const container = document.getElementById('adminsList');
    
    if (admins.length === 0) {
      container.innerHTML = '<div class="loading"><div class="spinner"></div><span>Немає адмінів</span></div>';
      return;
    }
    
    container.innerHTML = admins.map(admin => {
      const isSuper = admin.role === 'super_admin';
      const isCurrent = admin.telegramId == currentAdminId;
      return `
        <div class="admin-card">
          <div class="admin-card-info">
            ${createAvatar(admin.firstName || admin.telegramId, admin.telegramId)}
            <div>
              <strong>${escapeHtml(admin.firstName || 'Admin')} ${escapeHtml(admin.lastName || '')}</strong>
              ${isSuper ? '<span class="super-admin-badge">👑 Супер-адмін</span>' : '<span class="admin-badge">🛡️ Адмін</span>'}
              <br>
              <small>ID: ${admin.telegramId} | @${escapeHtml(admin.username || 'немає')}</small><br>
              <small>Доданий: ${new Date(admin.addedAt).toLocaleString()}</small>
            </div>
          </div>
          ${!isCurrent && currentAdmin?.role === 'super_admin' ? 
            `<button class="remove-admin" onclick="removeAdmin(${admin.telegramId})">❌ Видалити</button>` : 
            isCurrent ? '<span class="admin-badge">👑 Ви</span>' : ''
          }
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading admins:', error);
    const container = document.getElementById('adminsList');
    if (error.message.includes('403')) {
      container.innerHTML = '<div class="loading"><span>⚠️ Тільки супер-адмін може переглядати список адмінів</span></div>';
    } else {
      container.innerHTML = '<div class="loading"><span>❌ Помилка завантаження адмінів</span></div>';
    }
  }
}

// Додати адміна (оновлена функція)
async function addAdmin() {
  const targetTelegramId = parseInt(document.getElementById('newAdminId').value);
  const firstName = document.getElementById('newAdminName').value || 'Admin';
  const username = document.getElementById('newAdminUsername')?.value || '';
  const role = document.getElementById('newAdminRole')?.value || 'admin';
  
  if (!targetTelegramId) {
    alert('Введіть Telegram ID');
    return;
  }
  
  if (isNaN(targetTelegramId)) {
    alert('Telegram ID має бути числом');
    return;
  }
  
  const addBtn = document.querySelector('.add-admin-form button');
  const originalText = addBtn.textContent;
  addBtn.textContent = '⏳ Додаємо...';
  addBtn.disabled = true;
  
  try {
    const response = await fetch('/api/add-admin', {
      method: 'POST',
      headers: {
        'X-Telegram-Id': currentAdminId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        targetTelegramId, 
        firstName, 
        username,
        role 
      })
    });
    
    const result = await response.json();
    if (result.success) {
      document.getElementById('newAdminId').value = '';
      document.getElementById('newAdminName').value = '';
      if (document.getElementById('newAdminUsername')) {
        document.getElementById('newAdminUsername').value = '';
      }
      alert(`✅ Адміна ${targetTelegramId} успішно додано!`);
      loadAdmins();
    } else {
      alert(result.error || 'Помилка при додаванні адміна');
    }
  } catch (error) {
    console.error('Error adding admin:', error);
    alert('Помилка при додаванні адміна');
  } finally {
    addBtn.textContent = originalText;
    addBtn.disabled = false;
  }
}

// Видалити адміна
async function removeAdmin(telegramId) {
  if (!confirm(`Видалити адміна ${telegramId}?`)) return;
  
  try {
    const response = await fetch(`/api/remove-admin/${telegramId}`, {
      method: 'DELETE',
      headers: { 'X-Telegram-Id': currentAdminId }
    });
    
    const result = await response.json();
    if (result.success) {
      alert(`✅ Адміна ${telegramId} видалено`);
      loadAdmins();
    } else {
      alert(result.error || 'Помилка при видаленні адміна');
    }
  } catch (error) {
    console.error('Error removing admin:', error);
    alert('Помилка при видаленні адміна');
  }
}

// Пошук користувачів
function searchUsers() {
  const searchTerm = document.getElementById('userSearch').value.toLowerCase();
  const rows = document.querySelectorAll('.users-table tbody tr');
  
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(searchTerm) ? '' : 'none';
  });
}

// Навігація
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');
  
  // Очищаємо поточний чат при переході
  if (page !== 'chats') {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      chatMessages.innerHTML = '<div class="empty-chat"><div class="empty-chat-icon">💬</div><p>Оберіть чат для перегляду</p><span>Натисніть на діалог зліва</span></div>';
    }
  }
  
  // Завантажуємо дані
  if (page === 'dashboard') loadStats();
  else if (page === 'chats') loadChats();
  else if (page === 'users') loadUsers();
  else if (page === 'reports') loadReports();
  else if (page === 'admins') loadAdmins();
}

// Форматування часу
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'щойно';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} хв тому`;
  if (diff < 86400000) return date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

// Toggle sidebar
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// Вихід
function logout() {
  localStorage.removeItem('adminTelegramId');
  sessionStorage.removeItem('adminPassword');
  window.location.href = '/login';
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Ініціалізація
document.addEventListener('DOMContentLoaded', async () => {
  const isAuth = await checkAuth();
  if (!isAuth) return;
  
  // Налаштовуємо навігацію
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.page);
      if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
      }
    });
  });
  
  // Пошук користувачів
  const searchInput = document.getElementById('userSearch');
  if (searchInput) {
    searchInput.addEventListener('input', searchUsers);
  }
  
  // Завантажуємо дашборд
  navigateTo('dashboard');
  
  // Автооновлення
  setInterval(() => {
    const activePage = document.querySelector('.page.active').id;
    if (activePage === 'page-dashboard') loadStats();
    else if (activePage === 'page-chats' && !isLoadingMessages) loadChats();
    else if (activePage === 'page-reports') loadReports();
  }, 10000);
});