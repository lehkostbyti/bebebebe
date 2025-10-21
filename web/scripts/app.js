// Client‑side logic for the Instagram Reels exchange mini‑app

(() => {
  const i18nFiles = {
    en: 'i18n/en.json',
    es: 'i18n/es.json',
    fr: 'i18n/fr.json',
    pt: 'i18n/pt.json'
  };
  const translations = {};
  let currentLanguage = localStorage.getItem('language') || 'en';
  let currentUserId = localStorage.getItem('user_id') || null;
  let hasCompletedOnboarding = localStorage.getItem('onboarding_complete') === 'true';

  // Determine API base URL.  If the miniapp is served on port 8000 (e.g. via
  // a simple static server), assume the API server runs on localhost:3000.
  // Otherwise, calls are relative to the current origin.
  const API_BASE = window.location.port === '8000' ? 'http://localhost:3000' : '';

  /**
   * Fetch and cache all translation files.
   */
  async function loadTranslations() {
    const promises = Object.entries(i18nFiles).map(([lang, path]) => {
      return fetch(path)
        .then(r => r.json())
        .then(json => {
          translations[lang] = json;
        })
        .catch(err => console.error('Failed to load translation for', lang, err));
    });
    await Promise.all(promises);
  }

  /**
   * Translate an element’s text content based on its data‑i18n attribute.
   */
  function applyTranslations() {
    const langData = translations[currentLanguage] || {};
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const text = langData[key] || key;
      el.textContent = text;
    });
    // handle option elements separately
    document.querySelectorAll('[data-i18n-option]').forEach(opt => {
      const key = opt.getAttribute('data-i18n-option');
      const text = langData[key] || key;
      opt.textContent = text;
    });
    
    // Обновляем placeholder для пустых полей выбора
    const regionSelect = document.getElementById('region-select');
    const languageSelect = document.getElementById('language-select');
    const tzSelect = document.getElementById('timezone-select');
    
    if (regionSelect && regionSelect.selectedIndex === 0) {
      const placeholderText = langData['select_region'] || 'Select region';
      regionSelect.options[0].textContent = placeholderText;
    }
    
    if (languageSelect && languageSelect.selectedIndex === 0) {
      const placeholderText = langData['select_language'] || 'Select language';
      languageSelect.options[0].textContent = placeholderText;
    }

    if (tzSelect && tzSelect.selectedIndex == 0) {
      const placeholderText = langData['select_timezone'] || 'Select time zone';
      tzSelect.options[0].textContent = placeholderText;
    }

  }

  /**
   * Update progress bar by activating segments up to the given step (1‑3).
   */
  function updateProgress(step) {
    const segments = document.querySelectorAll('.progress-segment-ios26');
    segments.forEach((seg, index) => {
      // Сброс всех классов
      seg.classList.remove('active', 'pulse', 'fill');
      
      // Активация сегментов
      if (index < step) {
        seg.classList.add('fill');
        seg.classList.add('active');
        seg.classList.add('pulse');
      }
    });
  }

  /**
   * Show only the specified screen and hide others with fade animation.
   */
  function showScreen(id) {
    // Add fade out effect to current screen
    const currentScreen = document.querySelector('.screen:not(.hidden)');
    if (currentScreen) {
      currentScreen.style.opacity = '0';
      currentScreen.style.transform = 'translateY(10px)';
      setTimeout(() => {
        document.querySelectorAll('.screen').forEach(el => {
          el.classList.add('hidden');
        });
        const screen = document.getElementById(id);
        if (screen) {
          screen.classList.remove('hidden');
          // Reset and animate in new screen
          screen.style.opacity = '0';
          screen.style.transform = 'translateY(10px)';
          setTimeout(() => {
            screen.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            screen.style.opacity = '1';
            screen.style.transform = 'translateY(0)';
          }, 10);
        }
      }, 150);
    } else {
      document.querySelectorAll('.screen').forEach(el => {
        el.classList.add('hidden');
      });
      const screen = document.getElementById(id);
      if (screen) {
        screen.classList.remove('hidden');
        screen.style.opacity = '0';
        screen.style.transform = 'translateY(10px)';
        setTimeout(() => {
          screen.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
          screen.style.opacity = '1';
          screen.style.transform = 'translateY(0)';
        }, 10);
      }
    }
  }

  /**
   * Show tooltip overlay with a translated message key.
   */
  function showTooltip(key) {
    const overlay = document.getElementById('tooltip-overlay');
    const textEl = document.getElementById('tooltip-text');
    textEl.textContent = translations[currentLanguage][key] || '';
    overlay.classList.remove('hidden');
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.transition = 'opacity 0.3s ease';
      overlay.style.opacity = '1';
    }, 10);
    document.getElementById('tooltip-ok').onclick = () => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.classList.add('hidden');
      }, 300);
    };
  }

  /**
   * Generate a simple random user identifier if one does not exist.
   */
  function ensureUserId() {
    if (!currentUserId) {
      currentUserId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      localStorage.setItem('user_id', currentUserId);
    }
  }

  /**
  /**
   * Validate step 1 inputs: region and language must be selected.
   */
  function validateStep1() {
    const region = document.getElementById('region-select').value;
    const language = document.getElementById('language-select').value;
    const tz = document.getElementById('timezone-select').value;
    const timezone = document.getElementById('timezone-select').value;
    const errorEl = document.getElementById('step1-error');
    
    // Скрываем ошибку по умолчанию
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
    
    // Проверяем, заполнены ли оба поля
    if (!region || !language || !timezone) {
      // Показываем ошибку только если есть проблема
      errorEl.textContent = translations[currentLanguage]['error_region'] || 'Please select both region and language.';
      errorEl.classList.remove('hidden');
      errorEl.style.animation = 'shake 0.5s';
      setTimeout(() => {
        errorEl.style.animation = '';
      }, 500);
      return false;
    }
    return true;
  }

  /**
   * Validate step 3 inputs: reel link and code must be correct.
   */
  function validateStep3() {
    const reelLink = document.getElementById('reel-link').value.trim();
    const codeParts = Array.from(document.querySelectorAll('.code-digit'));
    const code = codeParts.map(i => i.value.trim()).join('');
    const errorEl = document.getElementById('step3-error');
    
    // Скрываем ошибку по умолчанию
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
    
    // Проверка на код администратора
    if (code === '123456789') {
      // Для администратора пропускаем валидацию ссылки и кода
      return true;
    }
    
    const linkPattern = /^https:\/\/www\.instagram\.com\/reel\//i;
    if (!linkPattern.test(reelLink)) {
      errorEl.textContent = translations[currentLanguage]['error_reel'];
      errorEl.classList.remove('hidden');
      // Add shake animation to error element
      errorEl.style.animation = 'shake 0.5s';
      setTimeout(() => {
        errorEl.style.animation = '';
      }, 500);
      return false;
    }
    if (!/^\d{9}$/.test(code)) {
      errorEl.textContent = translations[currentLanguage]['error_code'];
      errorEl.classList.remove('hidden');
      // Add shake animation to error element
      errorEl.style.animation = 'shake 0.5s';
      setTimeout(() => {
        errorEl.style.animation = '';
      }, 500);
      
      // Добавляем визуальную обратную связь для невалидных полей кода
      codeParts.forEach(part => {
        if (!/^\d$/.test(part.value)) {
          part.classList.add('invalid');
        } else {
          part.classList.remove('invalid');
        }
      });
      
      return false;
    }
    
    // Убираем классы ошибок, если код валиден
    codeParts.forEach(part => {
      part.classList.remove('invalid');
      part.classList.add('valid');
    });
    
    return true;
  }

  /**
   * Save user data to the backend via REST API.
   */
  async function saveUserData(data) {
    try {
      const res = await fetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        console.error('Failed to save user data', await res.text());
      }
      return res.ok;
    } catch (e) {
      console.error('Error saving user data', e);
      return false;
    }
  }

  /**
   * Populate profile view from stored data.
   */
  function populateProfile(user) {
    console.log('Populating profile with user data:', user);
    
    // Cache references to DOM elements once. Without redeclaring the same
    // variables multiple times, we avoid accidental re‑declaration errors.
    const avatarEl = document.getElementById('profile-avatar');
    const nicknameEl = document.getElementById('profile-nickname');
    const balanceTodayEl = document.getElementById('balance-today');
    const balancePointsEl = document.getElementById('balance-points');
    const linkEl = document.getElementById('profile-link');
    const statusEl = document.getElementById('profile-status');
    
    // Try to get Telegram user data first
    let telegramUser = null;
    if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
      telegramUser = Telegram.WebApp.initDataUnsafe.user;
      console.log('Telegram user data found:', telegramUser);
    } else {
      console.log('No Telegram user data available');
    }
    
    // Set avatar and nickname from Telegram data if available, otherwise from user data
    if (telegramUser && telegramUser.photo_url && telegramUser.username) {
      // Use Telegram user data directly
      console.log('Using Telegram user data for profile');
      avatarEl.src = telegramUser.photo_url;
      nicknameEl.textContent = '@' + (telegramUser.username || telegramUser.first_name || 'user');
    } else if (user && user.photo_url && user.username) {
      // Use stored user data - проверяем наличие Telegram данных в сохраненных данных
      console.log('Using stored user data for profile');
      avatarEl.src = user.photo_url;
      nicknameEl.textContent = '@' + (user.username || user.first_name || 'user');
    } else if (user && user.code === '222333444') {
      // Тестовые данные для пользователя с кодом 222333444
      console.log('Using test user data for profile');
      avatarEl.src = user.photo_url || 'assets/images/placeholder_avatar.png';
      nicknameEl.textContent = '@' + (user.username || user.first_name || 'testuser222333444');
    } else {
      // Fallback
      console.log('Using fallback data for profile');
      avatarEl.src = 'assets/images/placeholder_avatar.png';
      nicknameEl.textContent = '@user';
    }
    
    console.log('Profile avatar src:', avatarEl.src);
    console.log('Profile nickname text:', nicknameEl.textContent);
    
    // Balance: show daily points and total points
    const daily = user ? (user.daily_points || 0) : 0;
    const points = user ? (user.points || 0) : 0;
    const todayLabel = translations[currentLanguage]['balance_today'] || '+{0} today';
    balanceTodayEl.textContent = todayLabel.replace('{0}', daily);
    balancePointsEl.innerHTML = `${points} ⚡`;
    
    // Show reel link
    if (user && user.reels_link) {
      linkEl.textContent = user.reels_link;
    } else {
      const placeholder = translations[currentLanguage]['insert_reel_link'] || 'Insert the link to your reel';
      linkEl.textContent = placeholder;
    }
    
    // Show status
    const statusLabel = translations[currentLanguage]['profile_status'] || 'Status';
    const statusKey = 'status_' + (user && user.reels_status || 'pending');
    const statusText = translations[currentLanguage][statusKey] || (user && user.reels_status || 'pending');
    statusEl.textContent = `${statusLabel}: ${statusText}`;
  }

  /**
   * Populate leaderboard list from users array.
   */
  function populateLeaderboard(users) {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    // sort by points descending
    const sorted = users.slice().sort((a, b) => (b.points || 0) - (a.points || 0));
    sorted.forEach(u => {
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = u.username || u.first_name || u.user_id;
      const right = document.createElement('span');
      right.textContent = `${u.points || 0} ${translations[currentLanguage]['points']}`;
      li.appendChild(left);
      li.appendChild(right);
      list.appendChild(li);
    });
  }

  /**
   * Switch visible menu view with animation.
   */
  function showMenuView(viewId) {
    // Add fade transition to menu views
    const currentView = document.querySelector('.menu-view:not(.hidden)');
    if (currentView) {
      currentView.style.opacity = '0';
      currentView.style.transform = 'translateY(10px)';
      setTimeout(() => {
        document.querySelectorAll('.menu-view').forEach(el => {
          el.classList.add('hidden');
        });
        const view = document.getElementById(viewId + '-view');
        if (view) {
          view.classList.remove('hidden');
          view.style.opacity = '0';
          view.style.transform = 'translateY(10px)';
          setTimeout(() => {
            view.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            view.style.opacity = '1';
            view.style.transform = 'translateY(0)';
          }, 10);
        }
      }, 150);
    } else {
      document.querySelectorAll('.menu-view').forEach(el => {
        el.classList.add('hidden');
      });
      const view = document.getElementById(viewId + '-view');
      if (view) {
        view.classList.remove('hidden');
        view.style.opacity = '0';
        view.style.transform = 'translateY(10px)';
        setTimeout(() => {
          view.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
          view.style.opacity = '1';
          view.style.transform = 'translateY(0)';
        }, 10);
      }
    }
  }

  /**
   * Copy referral link to clipboard.
   */
  function copyReferral() {
    const input = document.getElementById('referral-link');
    input.select();
    input.setSelectionRange(0, 99999);
    try {
      navigator.clipboard.writeText(input.value);
      // Show visual feedback
      const copyBtn = document.getElementById('copy-referral');
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.style.backgroundColor = '#34C759';
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.backgroundColor = '';
      }, 2000);
    } catch (e) {
      alert('Unable to copy');
    }
  }

  /**
   * Close virtual keyboard when clicking outside input fields
   */
  function setupKeyboardHandling() {
    // Add blur to all input fields when clicking outside
    document.addEventListener('click', (e) => {
      // Check if the click is outside any input field
      if (!e.target.closest('input, select, textarea, button')) {
        // Blur all input fields to close the keyboard
        document.querySelectorAll('input, select, textarea').forEach(el => {
          el.blur();
        });
      }
    });

    // Also close keyboard when pressing Enter on input fields
    document.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          el.blur(); // Close keyboard
        }
      });
    });
  }

  /**
   * Setup enhanced code input interactions
   */
  function setupCodeInputInteractions() {
    const codeInputs = document.querySelectorAll('.code-digit');
    codeInputs.forEach((input, idx) => {
      // Input handling
      input.addEventListener('input', () => {
        // Allow only digits, trim to one digit
        input.value = input.value.replace(/\D/g, '').substring(0, 1);
        
        // Add visual feedback
        if (input.value) {
          input.classList.add('filled');
        } else {
          input.classList.remove('filled');
        }
        
        // Auto-focus next input
        if (input.value.length === 1 && idx < codeInputs.length - 1) {
          codeInputs[idx + 1].focus();
        }
      });
      
      // Keydown handling
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && idx > 0) {
          codeInputs[idx - 1].focus();
        }
      });
      
      // Focus styling with enhanced animation
      input.addEventListener('focus', () => {
        input.style.animation = 'codeFocus 0.2s ease forwards';
        // Remove animation property after it completes
        setTimeout(() => {
          input.style.animation = '';
        }, 200);
      });
      
      // Blur styling
      input.addEventListener('blur', () => {
        input.style.transform = 'scale(1)';
        input.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.02)';
      });
      
      // Paste handling
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text');
        const digits = paste.replace(/\D/g, '').substring(0, 9).split('');
        
        // Fill the code inputs with pasted digits
        digits.forEach((digit, i) => {
          if (codeInputs[i]) {
            codeInputs[i].value = digit;
            codeInputs[i].classList.add('filled');
          }
        });
        
        // Focus the next empty input or the last one
        const nextEmpty = Array.from(codeInputs).findIndex((inp, i) => i >= digits.length && !inp.value);
        if (nextEmpty !== -1) {
          codeInputs[nextEmpty].focus();
        } else {
          codeInputs[Math.min(digits.length, codeInputs.length - 1)].focus();
        }
      });
    });
  }

  /**
   * Setup theme switch functionality
   */
  function setupThemeSwitch() {
    const themeSwitch = document.getElementById('checkbox');
    const currentTheme = localStorage.getItem('theme') || 'light';
    
    // Check if theme switch element exists
    if (!themeSwitch) {
      console.error('Theme switch element not found!');
      return;
    }
    
    // Set initial theme
    if (currentTheme === 'dark') {
      themeSwitch.checked = true;
      document.body.classList.add('dark-theme');
    }
    
    // Add event listener for theme switch
    themeSwitch.addEventListener('change', function() {
      if (this.checked) {
        document.body.classList.add('dark-theme');
        localStorage.setItem('theme', 'dark');
      } else {
        document.body.classList.remove('dark-theme');
        localStorage.setItem('theme', 'light');
      }
    });
  }

  /**
   * Entry point on DOM ready.
   */
  document.addEventListener('DOMContentLoaded', async () => {
    // Show introduction screen
    const introScreen = document.getElementById('intro-screen');
    
    // Hide introduction screen after 2.5 seconds with animation
    if (introScreen) {
      setTimeout(() => {
        introScreen.classList.add('hidden');
        // Remove the intro screen from DOM after animation completes
        setTimeout(() => {
          if (introScreen.parentNode) {
            introScreen.parentNode.removeChild(introScreen);
          }
        }, 2500);
      }, 2500);
    }
    
    // Add CSS for shake animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
        20%, 40%, 60%, 80% { transform: translateX(5px); }
      }
    `;
    document.head.appendChild(style);
    
    await loadTranslations();
    ensureUserId();
    applyTranslations();
    setupKeyboardHandling();
    setupCodeInputInteractions();

    // Setup theme switch
    setupThemeSwitch();

    // Добавляем обработчики для кнопок помощи
    document.querySelectorAll('.help-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tooltipKey = btn.getAttribute('data-tooltip');
        if (tooltipKey) {
          showTooltip(tooltipKey);
        }
      });
    });

    // If onboarding completed previously show main menu immediately
    if (hasCompletedOnboarding) {
      // Hide all progress bars
      document.querySelectorAll('.progress-container-ios26, .progress-container').forEach(el => {
        el.classList.add('hidden');
      });
      document.getElementById('step1').classList.add('hidden');
      document.getElementById('step2').classList.add('hidden');
      document.getElementById('step3').classList.add('hidden');
      document.getElementById('bottom-menu').classList.remove('hidden');
      showMenuView('profile');
    } else {
      console.log('Showing step 1 and updating progress to step 1');
      showScreen('step1');
      updateProgress(1);
      // Удаляем автоматический показ подсказки
      // showTooltip('tooltip_step1');
    }

    // Step 1 next
    document.getElementById('step1-next').addEventListener('click', () => {
      console.log('Step 1 next button clicked');
      if (!validateStep1()) return;
      // Persist selected values in localStorage
      const region = document.getElementById('region-select').value;
      const language = document.getElementById('language-select').value;
      const timezone = document.getElementById('timezone-select').value;
      localStorage.setItem('region', region);
      localStorage.setItem('language', language);
      localStorage.setItem('utc_offset', timezone);
      currentLanguage = language;
      localStorage.setItem('language', language);
      applyTranslations();
      showScreen('step2');
      console.log('Updating progress to step 2');
      updateProgress(2);
      // Удаляем автоматический показ подсказки
      // showTooltip('tooltip_step2');
    });

    // Step 2 next
    document.getElementById('step2-next').addEventListener('click', () => {
      console.log('Step 2 next button clicked');
      showScreen('step3');
      console.log('Updating progress to step 3');
      updateProgress(3);
      // Удаляем автоматический показ подсказки
      // showTooltip('tooltip_step3');
    });

    // Step 3 submit
    document.getElementById('step3-submit').addEventListener('click', async () => {
      if (!validateStep3()) return;
      // Build user object
      // Gather user info from Telegram if available
      let telegramId = null;
      let username = '';
      let firstName = '';
      let photoUrl = '';
      let telegramUser = null;
      
      if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
        telegramUser = Telegram.WebApp.initDataUnsafe.user;
        telegramId = telegramUser.id;
        username = telegramUser.username || '';
        firstName = telegramUser.first_name || '';
        photoUrl = telegramUser.photo_url || '';
        console.log('Telegram user data collected:', telegramUser);
      } else {
        console.log('No Telegram user data available during submission');
      }
      
      const nowIso = new Date().toISOString();
      const reelLink = document.getElementById('reel-link').value.trim();
      const code = Array.from(document.querySelectorAll('.code-digit')).map(i => i.value.trim()).join('');
      
      // Если введен код администратора, используем тестовые данные
      const finalReelLink = code === '123456789' ? 'https://www.instagram.com/reel/C123456789/' : reelLink;
      const finalCode = code === '123456789' ? '987654321' : code; // Можно использовать другой код для администратора
      
      // Создаем объект userData с Telegram данными
      const userData = {
        user_id: currentUserId,
        telegram_id: telegramId || currentUserId,
        username: username,
        first_name: firstName,
        region: localStorage.getItem('region'),
        language: localStorage.getItem('language'),
        utc_offset: localStorage.getItem('utc_offset'),
        utc_offset: localStorage.getItem('utc_offset'),
        reels_link: finalReelLink,
        code: finalCode,
        reels_status: 'pending',
        updated_at: nowIso,
        moderated_at: null,
        points: 0,
        daily_points: 0,
        last_reset: new Date().toDateString(),
        photo_url: photoUrl,
        referrals: []
      };
      
      console.log('User data to be saved:', userData);
      
      // Save locally
      localStorage.setItem('onboarding_complete', 'true');
      hasCompletedOnboarding = true;
      
      // Save via API and check if successful
      const saveSuccess = await saveUserData(userData);
      if (!saveSuccess) {
        console.error('Failed to save user data to server');
        // Показываем сообщение об ошибке
        const errorEl = document.getElementById('step3-error');
        errorEl.textContent = 'Failed to save data. Please try again.';
        errorEl.classList.remove('hidden');
        errorEl.style.animation = 'shake 0.5s';
        setTimeout(() => {
          errorEl.style.animation = '';
        }, 500);
        return;
      }
      
      console.log('User data saved successfully');
      
      // Show success overlay instead of a separate screen.  The overlay
      // appears on top of the current view and hides itself when the
      // user presses OK.  After closing the overlay we reveal the
      // bottom menu and navigate to the profile view.
      const overlay = document.getElementById('success-overlay');
      overlay.classList.remove('hidden');
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.transition = 'opacity 0.3s ease';
        overlay.style.opacity = '1';
      }, 10);
      const okBtn = document.getElementById('success-ok');
      okBtn.onclick = () => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.classList.add('hidden');
          // Hide onboarding and progress completely
          // Hide all progress bars
          document.querySelectorAll('.progress-container-ios26, .progress-container').forEach(el => {
            el.classList.add('hidden');
          });
          document.getElementById('step1').classList.add('hidden');
          document.getElementById('step2').classList.add('hidden');
          document.getElementById('step3').classList.add('hidden');
          document.getElementById('bottom-menu').classList.remove('hidden');
          // Navigate to the profile view
          document.querySelector('#bottom-menu .menu-btn[data-view="profile"]').click();
        }, 300);
      };
    });

    // Add event listener for the "Back to Stories" button

    // Bottom menu navigation
    document.querySelectorAll('#bottom-menu .menu-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const view = btn.getAttribute('data-view');
        // Highlight active button (optional)
        document.querySelectorAll('#bottom-menu .menu-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (view === 'referral') {
        const referralLink = `https://t.me/testofcodebot?start=${currentUserId}`;
          document.getElementById('referral-link').value = referralLink;
          // Load user data to count referrals
          try {
            const res = await fetch(`${API_BASE}/api/users?user_id=${currentUserId}`);
            const user = res.ok ? await res.json() : {};
            const count = (user.referrals || []).length;
            const countLabel = translations[currentLanguage]['referral_count'] || 'Referrals: {0}';
            document.getElementById('referral-count').textContent = countLabel.replace('{0}', count);
          } catch (e) {
            console.error('Failed to load referral count', e);
            document.getElementById('referral-count').textContent = '';
          }
          showMenuView('referral');
        } else if (view === 'profile') {
          // fetch user data
          try {
            console.log('Fetching user data for user_id:', currentUserId);
            const res = await fetch(`${API_BASE}/api/users?user_id=${currentUserId}`);
            console.log('User data fetch response status:', res.status);
            const user = res.ok ? await res.json() : {};
            console.log('User data received:', user);
            populateProfile(user);
          } catch (e) {
            console.error('Failed to load profile', e);
          }
          showMenuView('profile');
        } else if (view === 'leaderboard') {
          try {
            const res = await fetch(`${API_BASE}/api/users`);
            const users = res.ok ? await res.json() : [];
            populateLeaderboard(users);
          } catch (e) {
            console.error('Failed to load leaderboard', e);
          }
          showMenuView('leaderboard');
        }
      });
    });

    // Copy referral link
    document.getElementById('copy-referral').addEventListener('click', copyReferral);
    // Send referral (placeholder – opens Telegram Web share if available)
    document.getElementById('send-referral').addEventListener('click', () => {
      const link = document.getElementById('referral-link').value;
      if (window.Telegram && Telegram.WebApp) {
        Telegram.WebApp.openTelegramLink(link);
      } else {
        alert('Telegram WebApp not available. Please copy the link manually.');
      }
    });
    
    // Logout functionality - привязана к кнопке в профиле
    document.getElementById('logout-btn').addEventListener('click', () => {
      // Show confirmation dialog
      if (confirm('Are you sure you want to logout?')) {
        // Clear all user data from localStorage
        localStorage.removeItem('user_id');
        localStorage.removeItem('region');
        localStorage.removeItem('language');
        localStorage.removeItem('onboarding_complete');
        
        // Reset user variables
        currentUserId = null;
        hasCompletedOnboarding = false;
        
        // Hide menu and show onboarding screens
        document.getElementById('bottom-menu').classList.add('hidden');
        document.getElementById('referral-view').classList.add('hidden');
        document.getElementById('profile-view').classList.add('hidden');
        document.getElementById('leaderboard-view').classList.add('hidden');
        
        // Show onboarding screens
        document.getElementById('step1').classList.remove('hidden');
        // Show all progress bars
        document.querySelectorAll('.progress-container-ios26, .progress-container').forEach(el => {
          el.classList.remove('hidden');
        });
        
        // Reset form fields
        document.getElementById('region-select').selectedIndex = 0;
        document.getElementById('language-select').selectedIndex = 0;
        document.getElementById('reel-link').value = '';
        document.querySelectorAll('.code-digit').forEach(input => {
          input.value = '';
          input.classList.remove('valid', 'invalid', 'filled');
        });
        
        // Reset error messages
        document.getElementById('step1-error').classList.add('hidden');
        document.getElementById('step2-error').classList.add('hidden');
        document.getElementById('step3-error').classList.add('hidden');
        
        // Show first step
        showScreen('step1');
        updateProgress(1);
        showTooltip('tooltip_step1');
      }
    });
  });
})();