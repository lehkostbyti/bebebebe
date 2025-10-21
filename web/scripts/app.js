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
  let currentTheme = 'light';
  let hasCompletedOnboarding = localStorage.getItem('onboarding_complete') === 'true';
  let currentTelegramId = localStorage.getItem('telegram_id') || null;
  let currentReferralId = localStorage.getItem('referral_id') || null;
  let cachedProfile = null;
  let cachedTelegramUser = null;
  let cachedInitContext = null;
  let pendingReferrerCode = null;
  let pendingReferrerLoaded = false;
  let bootstrapAttempted = false;

  function getStoredTheme() {
    try {
      return localStorage.getItem('theme') || 'light';
    } catch (e) {
      console.warn('Theme storage unavailable', e);
      return 'light';
    }
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      console.warn('Unable to persist theme preference', e);
    }
  }

  function applyTheme(theme) {
    const targets = [document.documentElement, document.body];
    targets.forEach(target => {
      if (!target) return;
      if (theme === 'dark') {
        target.classList.add('dark-theme');
      } else {
        target.classList.remove('dark-theme');
      }
    });
  }

  currentTheme = getStoredTheme();
  applyTheme(currentTheme);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyTheme(currentTheme));
  }

  function resolveApiBase() {
    const globalOverride = typeof window !== 'undefined'
      ? (window.__API_BASE__ || window.__MINIAPP_API_BASE__)
      : '';
    if (typeof globalOverride === 'string' && globalOverride.trim() !== '') {
      return globalOverride.trim().replace(/\/$/, '');
    }

    try {
      const params = new URLSearchParams(window.location.search || '');
      const queryOverride = params.get('apiBase') || params.get('api_base');
      if (queryOverride && queryOverride.trim()) {
        return queryOverride.trim().replace(/\/$/, '');
      }
    } catch (e) {
      console.warn('Unable to inspect query parameters for API base', e);
    }

    const metaTag = document.querySelector('meta[name="api-base"]');
    if (metaTag && metaTag.content && metaTag.content.trim()) {
      return metaTag.content.trim().replace(/\/$/, '');
    }

    const { protocol, hostname, port } = window.location;
    const desiredPort = '3000';

    const codespacesMatch = hostname.match(/^(.*)-(\d+)\.app\.github\.dev$/);
    if (codespacesMatch) {
      const [, prefix, currentPort] = codespacesMatch;
      if (currentPort !== desiredPort) {
        return `${protocol}//${prefix}-${desiredPort}.app.github.dev`;
      }
      return '';
    }

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      if (port === desiredPort) return '';
      return `${protocol}//${hostname}:${desiredPort}`;
    }

    if (port && port !== desiredPort) {
      return `${protocol}//${hostname}:${desiredPort}`;
    }

    return '';
  }

  const API_BASE = resolveApiBase();
  console.log('[Miniapp] API base:', API_BASE || '(relative to origin)');

  function safeSetItem(key, value) {
    try {
      if (value == null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    } catch (e) {
      console.warn(`Unable to persist ${key}`, e);
    }
  }

  function safeGetItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn(`Unable to read ${key} from storage`, e);
      return null;
    }
  }

  function parseTelegramInitDataFromUrl() {
    const sources = [];
    try {
      if (typeof window !== 'undefined' && window.location) {
        if (typeof window.location.search === 'string' && window.location.search.length > 1) {
          sources.push(window.location.search.slice(1));
        }
        if (typeof window.location.hash === 'string' && window.location.hash.length > 1) {
          const hash = window.location.hash.startsWith('#')
            ? window.location.hash.slice(1)
            : window.location.hash;
          sources.push(hash);
        }
      }
    } catch (e) {
      console.warn('Failed to inspect window location for tgWebAppData', e);
    }

    for (const source of sources) {
      try {
        const outer = new URLSearchParams(source);
        const raw = outer.get('tgWebAppData') || outer.get('tg_web_app_data');
        if (!raw) continue;
        const inner = new URLSearchParams(raw);
        const userParam = inner.get('user');
        let user = null;
        if (userParam) {
          try {
            user = JSON.parse(userParam);
          } catch (err) {
            console.warn('Unable to parse Telegram user from tgWebAppData', err);
          }
        }
        const startParam = inner.get('start_param') || inner.get('startapp_param') || null;
        const authDate = inner.get('auth_date') || null;
        const hash = inner.get('hash') || null;
        const queryId = inner.get('query_id') || null;
        const canSendAfterRaw = inner.get('can_send_after');
        let canSendAfter = null;
        if (canSendAfterRaw != null && canSendAfterRaw !== '') {
          const parsed = Number(canSendAfterRaw);
          if (Number.isFinite(parsed)) canSendAfter = parsed;
        }
        return {
          user,
          startParam,
          authDate,
          hash,
          queryId,
          canSendAfter,
          rawData: raw
        };
      } catch (err) {
        console.warn('Failed to parse tgWebAppData payload', err);
      }
    }

    return null;
  }

  function getTelegramInitContext(forceRefresh = false) {
    if (!forceRefresh && cachedInitContext) return cachedInitContext;
    const context = {
      user: null,
      startParam: null,
      authDate: null,
      hash: null,
      queryId: null,
      canSendAfter: null,
      rawData: null
    };

    try {
      if (window.Telegram && Telegram.WebApp) {
        const unsafe = Telegram.WebApp.initDataUnsafe || {};
        context.rawData = unsafe;
        if (unsafe.user) context.user = unsafe.user;
        if (unsafe.start_param) context.startParam = unsafe.start_param;
        if (!context.startParam && unsafe.startapp_param) context.startParam = unsafe.startapp_param;
        if (unsafe.auth_date) context.authDate = unsafe.auth_date;
        if (unsafe.hash) context.hash = unsafe.hash;
        if (unsafe.query_id) context.queryId = unsafe.query_id;
        if (unsafe.can_send_after != null) context.canSendAfter = unsafe.can_send_after;
      }
    } catch (e) {
      console.warn('Failed to access Telegram init data', e);
    }

    if (!context.user || !context.startParam || context.hash == null) {
      const fallback = parseTelegramInitDataFromUrl();
      if (fallback) {
        if (!context.user && fallback.user) context.user = fallback.user;
        if (!context.startParam && fallback.startParam) context.startParam = fallback.startParam;
        if (!context.authDate && fallback.authDate) context.authDate = fallback.authDate;
        if (!context.hash && fallback.hash) context.hash = fallback.hash;
        if (!context.queryId && fallback.queryId) context.queryId = fallback.queryId;
        if (context.canSendAfter == null && fallback.canSendAfter != null) {
          context.canSendAfter = fallback.canSendAfter;
        }
        if (!context.rawData && fallback.rawData) context.rawData = fallback.rawData;
      }
    }

    cachedInitContext = context;
    return context;
  }

  function getPendingReferrerCode() {
    if (pendingReferrerLoaded) return pendingReferrerCode;
    pendingReferrerLoaded = true;
    try {
      const stored = localStorage.getItem('referrer_code');
      pendingReferrerCode = stored && stored.trim() !== '' ? stored.trim() : null;
    } catch (e) {
      pendingReferrerCode = null;
    }
    return pendingReferrerCode;
  }

  function persistPendingReferrer(code) {
    pendingReferrerLoaded = true;
    const sanitized = code != null && String(code).trim() !== '' ? String(code).trim() : null;
    pendingReferrerCode = sanitized;
    try {
      if (sanitized) {
        localStorage.setItem('referrer_code', sanitized);
      } else {
        localStorage.removeItem('referrer_code');
      }
    } catch (e) {
      console.warn('Unable to persist referrer code', e);
    }
    return pendingReferrerCode;
  }

  function buildTelegramMeta(user) {
    if (!user || typeof user !== 'object') return null;
    const meta = {};
    [
      'language_code',
      'is_premium',
      'is_bot',
      'is_scam',
      'is_fake',
      'is_support',
      'added_to_attachment_menu',
      'can_join_groups',
      'can_read_all_group_messages',
      'supports_inline_queries',
      'allows_write_to_pm'
    ].forEach(key => {
      if (user[key] !== undefined && user[key] !== null) {
        meta[key] = user[key];
      }
    });
    return Object.keys(meta).length ? meta : null;
  }

  function buildTelegramLaunchMeta(context) {
    const initContext = context || getTelegramInitContext();
    if (!initContext) return null;
    const meta = {};
    if (initContext.startParam) meta.start_param = initContext.startParam;
    if (initContext.authDate) meta.auth_date = initContext.authDate;
    if (initContext.hash) meta.hash = initContext.hash;
    if (initContext.queryId) meta.query_id = initContext.queryId;
    if (initContext.canSendAfter != null) meta.can_send_after = initContext.canSendAfter;
    if (initContext.rawData && typeof initContext.rawData === 'object') {
      const raw = initContext.rawData;
      if (raw.platform) meta.platform = raw.platform;
      if (raw.version) meta.version = raw.version;
      if (raw.chat_type) meta.chat_type = raw.chat_type;
      if (raw.chat_instance) meta.chat_instance = raw.chat_instance;
    }
    return Object.keys(meta).length ? meta : null;
  }

  function captureTelegramUser() {
    if (cachedTelegramUser) return cachedTelegramUser;
    const initContext = getTelegramInitContext();
    if (initContext.startParam) {
      persistPendingReferrer(initContext.startParam);
    }
    const user = initContext.user;
    if (user && user.id != null) {
      cachedTelegramUser = user;
      currentTelegramId = user.id;
      safeSetItem('telegram_id', String(currentTelegramId));
      if (user.language_code && (!currentLanguage || (currentLanguage === 'en' && !safeGetItem('language')))) {
        currentLanguage = user.language_code;
        safeSetItem('language', user.language_code);
      }
      return cachedTelegramUser;
    }
    try {
      if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
        cachedTelegramUser = Telegram.WebApp.initDataUnsafe.user;
        if (cachedTelegramUser && cachedTelegramUser.id != null) {
          currentTelegramId = cachedTelegramUser.id;
          safeSetItem('telegram_id', String(currentTelegramId));
        }
        if (cachedTelegramUser && cachedTelegramUser.language_code && (!currentLanguage || currentLanguage === 'en')) {
          currentLanguage = cachedTelegramUser.language_code;
          safeSetItem('language', cachedTelegramUser.language_code);
        }
      }
    } catch (e) {
      console.warn('Failed to capture Telegram user', e);
    }
    return cachedTelegramUser;
  }

  function getTelegramIdForRequest() {
    captureTelegramUser();
    if (currentTelegramId != null && currentTelegramId !== '') {
      return currentTelegramId;
    }
    const stored = localStorage.getItem('telegram_id');
    if (stored) {
      currentTelegramId = stored;
      return stored;
    }
    return null;
  }

  async function fetchUserProfile(telegramId) {
    if (telegramId == null || telegramId === '') return null;
    try {
      const response = await fetch(`${API_BASE}/api/users?telegram_id=${encodeURIComponent(telegramId)}`);
      if (!response.ok) return null;
      const payload = await response.json();
      if (payload && typeof payload === 'object') {
        return payload;
      }
    } catch (e) {
      console.error('Failed to fetch user profile', e);
    }
    return null;
  }

  function buildBootstrapPayload() {
    const initContext = getTelegramInitContext();
    const telegramUser = captureTelegramUser();
    let telegramId = telegramUser && telegramUser.id != null ? telegramUser.id : null;
    if (telegramId == null || telegramId === '') {
      const fallback = safeGetItem('telegram_id');
      if (fallback != null && fallback !== '') telegramId = fallback;
    }
    if (telegramId == null || telegramId === '') return null;

    currentTelegramId = telegramId;
    safeSetItem('telegram_id', String(telegramId));

    const payload = {
      telegram_id: telegramId,
      points_total: 0,
      points_current: 0,
      daily_points: 0,
      referrals: []
    };

    const identityFields = [
      ['username', telegramUser && telegramUser.username],
      ['first_name', telegramUser && telegramUser.first_name],
      ['last_name', telegramUser && telegramUser.last_name],
      ['photo_url', telegramUser && telegramUser.photo_url]
    ];
    identityFields.forEach(([key, value]) => {
      if (value != null && value !== '') payload[key] = value;
    });

    const storedLanguage = safeGetItem('language');
    if (storedLanguage) {
      payload.language = storedLanguage;
    } else if (telegramUser && telegramUser.language_code) {
      payload.language = telegramUser.language_code;
    }

    const storedRegion = safeGetItem('region');
    if (storedRegion) payload.region = storedRegion;

    const storedTz = safeGetItem('utc_offset');
    if (storedTz) payload.utc_offset = storedTz;

    const referrerCode = getPendingReferrerCode();
    if (referrerCode) payload.referrer_id = referrerCode;

    const telegramMeta = buildTelegramMeta(telegramUser);
    if (telegramMeta) payload.telegram_meta = telegramMeta;

    const launchMeta = buildTelegramLaunchMeta(initContext);
    if (launchMeta) payload.telegram_launch = launchMeta;

    return payload;
  }

  async function ensureProfileData(forceRefresh = false) {
    if (!forceRefresh && cachedProfile) return cachedProfile;
    const telegramId = getTelegramIdForRequest();
    if (!telegramId) return null;
    let profile = await fetchUserProfile(telegramId);

    if (!profile) {
      const shouldAttemptBootstrap = !bootstrapAttempted || forceRefresh;
      if (shouldAttemptBootstrap) {
        const bootstrapPayload = buildBootstrapPayload();
        if (bootstrapPayload) {
          bootstrapAttempted = true;
          const bootstrapResult = await saveUserData(bootstrapPayload);
          if (bootstrapResult.ok && bootstrapResult.data) {
            profile = bootstrapResult.data;
          } else {
            console.warn('Unable to bootstrap Telegram user', bootstrapResult.error);
            bootstrapAttempted = false;
          }
        }
      }
    }

    if (profile) {
      cachedProfile = profile;
      if (profile.user_id) {
        currentReferralId = profile.user_id;
        try {
          localStorage.setItem('referral_id', profile.user_id);
        } catch (e) {
          console.warn('Unable to persist referral_id', e);
        }
      }
      if (profile.language) {
        currentLanguage = profile.language;
        try {
          localStorage.setItem('language', profile.language);
        } catch (e) {
          console.warn('Unable to persist language', e);
        }
      }
      if (profile.telegram_id != null) {
        currentTelegramId = profile.telegram_id;
        safeSetItem('telegram_id', String(profile.telegram_id));
      }
      if (profile.region) {
        try {
          localStorage.setItem('region', profile.region);
        } catch (e) {
          console.warn('Unable to persist region', e);
        }
      }
      if (profile.utc_offset) {
        try {
          localStorage.setItem('utc_offset', profile.utc_offset);
        } catch (e) {
          console.warn('Unable to persist utc_offset', e);
        }
      }
      if (profile.referrer_id) {
        persistPendingReferrer(profile.referrer_id);
      }
    }
    return profile;
  }

  function applyProfileSelections(user) {
    const regionSelect = document.getElementById('region-select');
    const languageSelect = document.getElementById('language-select');
    const tzSelect = document.getElementById('timezone-select');
    const regionValue = (user && user.region) || localStorage.getItem('region');
    const languageValue = (user && user.language) || localStorage.getItem('language');
    const tzValue = (user && user.utc_offset) || localStorage.getItem('utc_offset');
    if (regionSelect && regionValue) regionSelect.value = regionValue;
    if (languageSelect && languageValue) languageSelect.value = languageValue;
    if (tzSelect && tzValue) tzSelect.value = tzValue;
  }

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
        let message = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body && typeof body === 'object' && body.error) {
            message = body.error;
          } else if (typeof body === 'string' && body) {
            message = body;
          }
        } catch (_) {
          try {
            const text = await res.text();
            if (text) message = text;
          } catch (err) {
            console.warn('Unable to read error response body', err);
          }
        }
        return { ok: false, error: message };
      }
      let payload = null;
      try {
        payload = await res.json();
      } catch (e) {
        console.warn('Response did not contain JSON payload', e);
      }
      return { ok: true, data: payload };
    } catch (e) {
      return { ok: false, error: e.message || 'Network error' };
    }
  }

  /**
   * Populate profile view from stored data.
   */
  function populateProfile(user) {
    const avatarEl = document.getElementById('profile-avatar');
    const nicknameEl = document.getElementById('profile-nickname');
    const balanceTodayEl = document.getElementById('balance-today');
    const balancePointsEl = document.getElementById('balance-points');
    const linkEl = document.getElementById('profile-link');
    const statusEl = document.getElementById('profile-status');

    if (!user && cachedProfile) {
      user = cachedProfile;
    }
    if (user && user.user_id) {
      currentReferralId = user.user_id;
      try {
        localStorage.setItem('referral_id', user.user_id);
      } catch (e) {
        console.warn('Unable to persist referral_id', e);
      }
    }

    const telegramUser = captureTelegramUser();
    const username = (user && user.username) || (telegramUser && telegramUser.username) || '';
    const firstName = (user && user.first_name) || (telegramUser && telegramUser.first_name) || '';
    const displayName = username ? `@${username}` : (firstName ? firstName : '@user');
    nicknameEl.textContent = displayName;

    const avatarSrc = (user && user.photo_url) || (telegramUser && telegramUser.photo_url) || 'assets/images/placeholder_avatar.png';
    avatarEl.src = avatarSrc;
    avatarEl.alt = username ? `@${username}` : (firstName || 'avatar');

    const daily = user && typeof user.daily_points === 'number' ? user.daily_points : 0;
    const pointsTotal = user && typeof user.points_total === 'number'
      ? user.points_total
      : (user && typeof user.points === 'number' ? user.points : 0);
    const todayLabel = translations[currentLanguage]['balance_today'] || '+{0} today';
    balanceTodayEl.textContent = todayLabel.replace('{0}', daily);
    balancePointsEl.textContent = `${pointsTotal} ⚡`;

    if (user && user.reels_link) {
      linkEl.textContent = user.reels_link;
      linkEl.classList.remove('placeholder');
    } else {
      const placeholder = translations[currentLanguage]['insert_reel_link'] || 'Insert the link to your reel';
      linkEl.textContent = placeholder;
      linkEl.classList.add('placeholder');
    }

    const statusLabel = translations[currentLanguage]['profile_status'] || 'Status';
    const statusKey = 'status_' + ((user && user.reels_status) || 'pending');
    const statusText = translations[currentLanguage][statusKey] || ((user && user.reels_status) || 'pending');
    statusEl.textContent = `${statusLabel}: ${statusText}`;
  }

  /**
   * Populate leaderboard list from users array.
   */
  function populateLeaderboard(users) {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    const sorted = users.slice().sort((a, b) => (b.points_total || 0) - (a.points_total || 0));
    sorted.forEach(u => {
      const li = document.createElement('li');
      li.classList.add('leaderboard-item');

      const userBlock = document.createElement('div');
      userBlock.classList.add('leaderboard-user');

      const avatar = document.createElement('img');
      avatar.classList.add('leaderboard-avatar');
      avatar.src = u.photo_url || 'assets/images/placeholder_avatar.png';
      avatar.alt = u.username ? `@${u.username}` : (u.first_name || 'avatar');
      avatar.loading = 'lazy';

      const meta = document.createElement('div');
      meta.classList.add('leaderboard-meta');

      const usernameEl = document.createElement('span');
      usernameEl.classList.add('leaderboard-username');
      const displayUsername = u.username ? `@${u.username}` : (u.first_name || u.user_id || 'user');
      usernameEl.textContent = displayUsername;
      meta.appendChild(usernameEl);

      if (u.first_name && u.username !== u.first_name) {
        const nameEl = document.createElement('span');
        nameEl.classList.add('leaderboard-name');
        nameEl.textContent = u.first_name;
        meta.appendChild(nameEl);
      }

      userBlock.appendChild(avatar);
      userBlock.appendChild(meta);

      const pointsEl = document.createElement('span');
      pointsEl.classList.add('leaderboard-points');
      const totalPoints = u.points_total || 0;
      pointsEl.textContent = `${totalPoints} ⚡`;

      li.appendChild(userBlock);
      li.appendChild(pointsEl);
      list.appendChild(li);
    });
  }

  async function openProfileView(forceRefresh = false) {
    const user = await ensureProfileData(forceRefresh);
    populateProfile(user);
    showMenuView('profile');
  }

  async function openReferralView() {
    const user = await ensureProfileData();
    const referralInput = document.getElementById('referral-link');
    const referralCode = (user && user.user_id) || currentReferralId || '';
    if (referralInput) {
      referralInput.value = referralCode ? `https://t.me/testofcodebot?start=${referralCode}` : '';
    }
    const countEl = document.getElementById('referral-count');
    const countLabel = translations[currentLanguage]['referral_count'] || 'Referrals: {0}';
    const count = user && Array.isArray(user.referrals) ? user.referrals.length : 0;
    if (countEl) {
      countEl.textContent = countLabel.replace('{0}', count);
    }
    showMenuView('referral');
  }

  async function openLeaderboardView() {
    try {
      const res = await fetch(`${API_BASE}/api/users`);
      const users = res.ok ? await res.json() : [];
      populateLeaderboard(Array.isArray(users) ? users : []);
    } catch (e) {
      console.error('Failed to load leaderboard', e);
      populateLeaderboard([]);
    }
    showMenuView('leaderboard');
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
    if (!themeSwitch) {
      console.error('Theme switch element not found!');
      return;
    }

    themeSwitch.checked = currentTheme === 'dark';
    applyTheme(currentTheme);

    themeSwitch.addEventListener('change', () => {
      currentTheme = themeSwitch.checked ? 'dark' : 'light';
      applyTheme(currentTheme);
      persistTheme(currentTheme);
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
    
    if (window.Telegram && Telegram.WebApp) {
      try {
        Telegram.WebApp.ready();
        if (typeof Telegram.WebApp.expand === 'function') {
          Telegram.WebApp.expand();
        }
      } catch (e) {
        console.warn('Unable to initialize Telegram WebApp environment', e);
      }
    }

    getPendingReferrerCode();
    getTelegramInitContext(true);

    await loadTranslations();
    captureTelegramUser();
    const existingProfile = await ensureProfileData();
    applyTranslations();
    applyProfileSelections(existingProfile || cachedProfile);
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

    if (existingProfile) {
      hasCompletedOnboarding = true;
      try {
        localStorage.setItem('onboarding_complete', 'true');
      } catch (e) {
        console.warn('Unable to persist onboarding flag', e);
      }
    }

    // If onboarding completed previously show main menu immediately
    if (hasCompletedOnboarding) {
      document.querySelectorAll('.progress-container-ios26, .progress-container').forEach(el => {
        el.classList.add('hidden');
      });
      document.getElementById('step1').classList.add('hidden');
      document.getElementById('step2').classList.add('hidden');
      document.getElementById('step3').classList.add('hidden');
      document.getElementById('bottom-menu').classList.remove('hidden');
      const profileBtn = document.querySelector('#bottom-menu .menu-btn[data-view="profile"]');
      if (profileBtn) {
        document.querySelectorAll('#bottom-menu .menu-btn').forEach(b => b.classList.remove('active'));
        profileBtn.classList.add('active');
      }
      await openProfileView();
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

      const telegramUser = captureTelegramUser();
      let telegramId = telegramUser && telegramUser.id != null ? telegramUser.id : null;
      if (telegramId == null) {
        const fallback = getTelegramIdForRequest();
        if (fallback != null && fallback !== '') telegramId = fallback;
      }

      const storedProfile = cachedProfile || existingProfile || null;
      const username = (telegramUser && telegramUser.username) || (storedProfile && storedProfile.username) || '';
      const firstName = (telegramUser && telegramUser.first_name) || (storedProfile && storedProfile.first_name) || '';
      const lastName = (telegramUser && telegramUser.last_name) || (storedProfile && storedProfile.last_name) || '';
      const photoUrl = (telegramUser && telegramUser.photo_url) || (storedProfile && storedProfile.photo_url) || '';

      const reelLink = document.getElementById('reel-link').value.trim();
      const code = Array.from(document.querySelectorAll('.code-digit')).map(i => i.value.trim()).join('');
      const finalReelLink = code === '123456789' ? 'https://www.instagram.com/reel/C123456789/' : reelLink;

      if (telegramId == null) {
        const errorEl = document.getElementById('step3-error');
        errorEl.textContent = 'Telegram ID is required to save your profile.';
        errorEl.classList.remove('hidden');
        return;
      }

      const userData = {
        telegram_id: telegramId,
        username,
        first_name: firstName,
        last_name: lastName,
        photo_url: photoUrl,
        region: localStorage.getItem('region'),
        language: localStorage.getItem('language'),
        utc_offset: localStorage.getItem('utc_offset'),
        reels_link: finalReelLink || null,
        reels_status: 'pending'
      };

      if (currentReferralId) {
        userData.user_id = currentReferralId;
      }
      if (!cachedProfile) {
        userData.points_total = 0;
        userData.points_current = 0;
        userData.daily_points = 0;
        userData.referrals = [];
      } else if (Array.isArray(cachedProfile.referrals)) {
        userData.referrals = cachedProfile.referrals;
      }
      const pendingReferrer = (cachedProfile && cachedProfile.referrer_id) || getPendingReferrerCode();
      if (pendingReferrer) {
        userData.referrer_id = pendingReferrer;
        persistPendingReferrer(pendingReferrer);
      }

      if (!userData.language && telegramUser && telegramUser.language_code) {
        userData.language = telegramUser.language_code;
      }

      const telegramMeta = buildTelegramMeta(telegramUser);
      if (telegramMeta) {
        userData.telegram_meta = telegramMeta;
      }

      const launchMeta = buildTelegramLaunchMeta();
      if (launchMeta) {
        userData.telegram_launch = launchMeta;
      }

      console.log('User data to be saved:', userData);

      // Save locally
      localStorage.setItem('onboarding_complete', 'true');
      hasCompletedOnboarding = true;
      
      // Save via API and check if successful
      const saveResult = await saveUserData(userData);
      if (!saveResult.ok) {
        console.error('Failed to save user data to server:', saveResult.error);
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
      
      console.log('User data saved successfully', saveResult.data || {});
      if (saveResult.data && typeof saveResult.data === 'object') {
        cachedProfile = saveResult.data;
        if (saveResult.data.user_id) {
          currentReferralId = saveResult.data.user_id;
          try {
            localStorage.setItem('referral_id', saveResult.data.user_id);
          } catch (e) {
            console.warn('Unable to persist referral_id after save', e);
          }
        }
        populateProfile(saveResult.data);
      } else {
        await ensureProfileData(true);
        populateProfile(cachedProfile);
      }

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
      okBtn.onclick = async () => {
        overlay.style.opacity = '0';
        setTimeout(async () => {
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
          document.querySelectorAll('#bottom-menu .menu-btn').forEach(b => b.classList.remove('active'));
          const profileBtn = document.querySelector('#bottom-menu .menu-btn[data-view="profile"]');
          if (profileBtn) profileBtn.classList.add('active');
          await openProfileView(true);
        }, 300);
      };
    });

    // Add event listener for the "Back to Stories" button

    // Bottom menu navigation
    document.querySelectorAll('#bottom-menu .menu-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const view = btn.getAttribute('data-view');
        document.querySelectorAll('#bottom-menu .menu-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (view === 'referral') {
          await openReferralView();
        } else if (view === 'profile') {
          await openProfileView();
        } else if (view === 'leaderboard') {
          await openLeaderboardView();
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
        localStorage.removeItem('region');
        localStorage.removeItem('language');
        localStorage.removeItem('utc_offset');
        localStorage.removeItem('referral_id');
        localStorage.removeItem('telegram_id');
        localStorage.removeItem('onboarding_complete');

        // Reset user variables
        currentReferralId = null;
        cachedProfile = null;
        cachedTelegramUser = null;
        currentTelegramId = null;
        hasCompletedOnboarding = false;
        
        // Hide menu and show onboarding screens
        document.getElementById('bottom-menu').classList.add('hidden');
        document.getElementById('referral-view').classList.add('hidden');
        document.getElementById('profile-view').classList.add('hidden');
        document.getElementById('leaderboard-view').classList.add('hidden');
        document.querySelectorAll('#bottom-menu .menu-btn').forEach(b => b.classList.remove('active'));
        
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