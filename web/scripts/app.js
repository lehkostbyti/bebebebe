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
  const GEOAPIFY_KEY = '470ed5f201444d7ab192a18d51438995';
  const DEFAULT_STORIES_URL = 'https://www.instagram.com/';
  let currentTelegramId = localStorage.getItem('telegram_id') || null;
  let currentReferralId = localStorage.getItem('referral_id') || null;
  let cachedProfile = null;
  let cachedTelegramUser = null;
  let cachedInitContext = null;
  let pendingReferrerCode = null;
  let pendingReferrerLoaded = false;
  let bootstrapAttempted = false;
  let currentCitySelection = null;
  let missionProgress = 0;
  let storiesModalDismissed = localStorage.getItem('stories_modal_hidden') === 'true';

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

  function coerceBoolean(value) {
    if (value === true) return true;
    if (value === false) return false;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return false;
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'n', 'off', ''].includes(normalized)) return false;
    }
    return false;
  }

  function isValidString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function isValidUtcOffset(value) {
    return typeof value === 'string' && /^UTC[+-]\d{2}:\d{2}$/.test(value);
  }

  function formatUtcOffset(seconds) {
    if (!Number.isFinite(seconds)) return null;
    const sign = seconds >= 0 ? '+' : '-';
    const abs = Math.abs(seconds);
    const hours = Math.floor(abs / 3600);
    const minutes = Math.floor((abs % 3600) / 60);
    return `UTC${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  function normalizeUtcOffset(value) {
    if (!value) return null;
    if (isValidUtcOffset(value)) return value;
    if (typeof value === 'string' && /^UTC[+-]\d{1,2}/.test(value)) {
      const match = value.match(/UTC([+-])(\d{1,2})(?::?(\d{2}))?/);
      if (match) {
        const sign = match[1];
        const hours = match[2].padStart(2, '0');
        const minutes = (match[3] || '00').padStart(2, '0');
        return `UTC${sign}${hours}:${minutes}`;
      }
    }
    return null;
  }

  function isValidReelLink(link) {
    return typeof link === 'string' && /^https:\/\/www\.instagram\.com\/reel\//i.test(link.trim());
  }

  function getReelPlaceholder() {
    const langData = translations[currentLanguage] || {};
    return langData['insert_reel_link'] || 'Insert the link to your reel';
  }

  function isProfileComplete(user) {
    if (!user || typeof user !== 'object') return false;
    const regionOk = isValidString(user.region);
    const languageOk = isValidString(user.language);
    const utcOk = isValidUtcOffset(user.utc_offset);
    const reelsOk = isValidReelLink(user.reels_link || '');
    const codeOk = coerceBoolean(user.nine_digit_code);
    return regionOk && languageOk && utcOk && reelsOk && codeOk;
  }

  function persistOnboardingCompletion(completed) {
    hasCompletedOnboarding = !!completed;
    safeSetItem('onboarding_complete', completed ? 'true' : null);
    return hasCompletedOnboarding;
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
      referrals: [],
      mission_progress: missionProgress || 0,
      stories_modal_hidden: storiesModalDismissed
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

  function buildProfileUpdatePayload(overrides = {}) {
    const profile = cachedProfile || {};
    let telegramId = overrides.telegram_id || profile.telegram_id || getTelegramIdForRequest();
    if (telegramId == null || telegramId === '') {
      const storedId = safeGetItem('telegram_id');
      if (storedId) telegramId = storedId;
    }
    if (telegramId == null || telegramId === '') return null;

    const payload = { telegram_id: telegramId };
    const fieldsToCopy = [
      'user_id',
      'username',
      'first_name',
      'last_name',
      'photo_url',
      'region',
      'language',
      'utc_offset',
      'reels_link',
      'reels_status',
      'nine_digit_code',
      'points_total',
      'points_current',
      'points',
      'daily_points',
      'referrals',
      'referrer_id'
    ];

    fieldsToCopy.forEach(key => {
      const value = profile[key];
      if (value === undefined || value === null) return;
      if (key === 'referrals') {
        if (Array.isArray(value)) {
          payload[key] = value;
        }
        return;
      }
      payload[key] = value;
    });

    if (!payload.language) {
      const storedLanguage = safeGetItem('language');
      if (storedLanguage) payload.language = storedLanguage;
    }
    if (!payload.region) {
      const storedRegion = safeGetItem('region');
      if (storedRegion) payload.region = storedRegion;
    }
    if (!payload.utc_offset) {
      const storedUtc = safeGetItem('utc_offset');
      if (storedUtc) payload.utc_offset = storedUtc;
    }

    if (profile.telegram_meta) payload.telegram_meta = profile.telegram_meta;
    if (profile.telegram_launch) payload.telegram_launch = profile.telegram_launch;

    const merged = { ...payload, ...overrides };
    if (merged.nine_digit_code != null) {
      merged.nine_digit_code = coerceBoolean(merged.nine_digit_code);
    }
    Object.keys(merged).forEach(key => {
      if (merged[key] === undefined) {
        delete merged[key];
      }
    });
    return merged;
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
      if (profile.city_label) {
        try {
          localStorage.setItem('city_label', profile.city_label);
        } catch (e) {
          console.warn('Unable to persist city label', e);
        }
      }
      if (profile.city || profile.region || profile.country) {
        currentCitySelection = {
          city: profile.city || '',
          region: profile.region || '',
          country: profile.country || '',
          utcOffset: profile.utc_offset || 'UTC+00:00',
          label: profile.city_label || buildCityLabel(profile.city, profile.region, profile.country),
          timezoneId: profile.timezone || null
        };
      }
      if (profile.referrer_id) {
        persistPendingReferrer(profile.referrer_id);
      }
      persistOnboardingCompletion(isProfileComplete(profile));
      missionProgress = Number(profile.mission_progress || 0);
      storiesModalDismissed = profile.stories_modal_hidden != null
        ? coerceBoolean(profile.stories_modal_hidden)
        : storiesModalDismissed;
      updateStatsBoard(profile);
      updateAdvice(profile);
    }
    if (!profile) {
      persistOnboardingCompletion(false);
    }
    return profile;
  }

  function applyProfileSelections(user) {
    const languageValue = (user && user.language) || localStorage.getItem('language') || currentLanguage;
    if (languageValue) {
      currentLanguage = languageValue;
      safeSetItem('language', languageValue);
    }
    document.querySelectorAll('.language-option').forEach(btn => {
      const lang = btn.getAttribute('data-language');
      if (!lang) return;
      if (lang === languageValue) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });
    updateCitySelectionFromProfile(user || cachedProfile || null);
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

    const profileLinkInput = document.getElementById('profile-link-input');
    if (profileLinkInput) {
      profileLinkInput.placeholder = langData['insert_reel_link'] || 'Insert the link to your reel';
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

  function updateMissionDots(step) {
    missionProgress = step;
    const container = document.getElementById('mission-progress');
    if (!container) return;
    container.classList.toggle('hidden', step <= 0);
    container.querySelectorAll('.mission-dot').forEach(dot => {
      const dotStep = Number(dot.getAttribute('data-step'));
      if (!Number.isFinite(dotStep)) return;
      if (step >= dotStep) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });
  }

  function showMissionScreen(id) {
    document.querySelectorAll('.mission-screen').forEach(section => {
      if (section.id === id) {
        section.classList.remove('hidden');
        section.style.opacity = '1';
      } else {
        section.classList.add('hidden');
      }
    });
  }

  function enableMenuAccess(enabled) {
    const menu = document.getElementById('bottom-menu');
    if (!menu) return;
    if (enabled) {
      menu.classList.remove('hidden');
      menu.classList.remove('locked');
    } else {
      menu.classList.add('locked');
      menu.classList.remove('hidden');
    }
  }

  function buildCityLabel(city, region, country) {
    const parts = [];
    if (isValidString(city)) parts.push(city);
    if (isValidString(region)) parts.push(region);
    if (isValidString(country)) parts.push(country);
    return parts.join(', ');
  }

  function renderCitySuggestions(suggestions) {
    const list = document.getElementById('city-suggestions');
    if (!list) return;
    list.innerHTML = '';
    if (!Array.isArray(suggestions) || !suggestions.length) {
      list.style.display = 'none';
      return;
    }
    suggestions.forEach(item => {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.textContent = item.label;
      li.addEventListener('click', () => applyCitySelection(item));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          applyCitySelection(item);
        }
      });
      list.appendChild(li);
    });
    list.style.display = 'block';
  }

  function applyCitySelection(selection) {
    if (!selection) return;
    currentCitySelection = selection;
    const input = document.getElementById('city-input');
    const list = document.getElementById('city-suggestions');
    const hint = document.getElementById('city-confirmed');
    const changeBtn = document.getElementById('change-city');
    if (input) {
      input.value = selection.label;
      input.classList.add('confirmed');
      input.setAttribute('data-selected', 'true');
    }
    if (list) {
      list.innerHTML = '';
      list.style.display = 'none';
    }
    if (hint) {
      hint.classList.remove('hidden');
      hint.textContent = `${selection.label} — ${selection.utcOffset}`;
    }
    if (changeBtn) {
      changeBtn.classList.remove('hidden');
    }
  }

  function clearCitySelection() {
    currentCitySelection = null;
    const input = document.getElementById('city-input');
    const hint = document.getElementById('city-confirmed');
    const list = document.getElementById('city-suggestions');
    if (input) {
      input.value = '';
      input.classList.remove('confirmed');
      input.removeAttribute('data-selected');
      input.focus();
    }
    if (hint) hint.classList.add('hidden');
    if (list) {
      list.innerHTML = '';
      list.style.display = 'none';
    }
  }

  async function fetchCitySuggestions(query) {
    if (!query || query.trim().length < 3) {
      renderCitySuggestions([]);
      return;
    }
    try {
      const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
      url.searchParams.set('text', query.trim());
      url.searchParams.set('limit', '6');
      url.searchParams.set('type', 'city');
      url.searchParams.set('format', 'json');
      url.searchParams.set('apiKey', GEOAPIFY_KEY);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const rows = Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.features)
          ? payload.features.map(entry => entry && (entry.properties || entry))
          : [];
      const suggestions = rows
        .map(props => {
            const city = props.city || props.name || props.address_line1 || '';
            const region = props.state || props.county || props.region || '';
            const country = props.country || props.country_code || '';
            const timezone = props.timezone || {};
            const utcFromSeconds = formatUtcOffset(Number(timezone.offset_STD_seconds));
            const utc = normalizeUtcOffset(timezone.offset_STD || utcFromSeconds || timezone.name);
            return {
              city: city || '',
              region: region || '',
              country: country || '',
              label: buildCityLabel(city, region, country),
              utcOffset: utc || 'UTC+00:00',
              timezoneId: timezone.name || null
            };
          })
        .filter(item => isValidString(item.label));
      renderCitySuggestions(suggestions);
    } catch (e) {
      console.warn('City lookup failed', e);
      renderCitySuggestions([]);
    }
  }

  function updateCitySelectionFromProfile(user) {
    const input = document.getElementById('city-input');
    if (!input) return;
    const changeBtn = document.getElementById('change-city');
    const hint = document.getElementById('city-confirmed');
    const city = user?.city || user?.region || null;
    const region = user?.region_name || user?.region || user?.state || null;
    const country = user?.country || null;
    const utc = user?.utc_offset || null;
    const label = user?.city_label || buildCityLabel(city, region, country);
    if (label) {
      currentCitySelection = {
        city: city || '',
        region: region || '',
        country: country || '',
        utcOffset: utc || 'UTC+00:00',
        label,
        timezoneId: user?.timezone || null
      };
      input.value = label;
      input.classList.add('confirmed');
      input.setAttribute('data-selected', 'true');
      if (hint && (utc || label)) {
        hint.classList.remove('hidden');
        hint.textContent = utc ? `${label} — ${utc}` : label;
      }
      if (changeBtn) {
        changeBtn.classList.remove('hidden');
      }
    }
  }

  function resolveStoriesUrl(profile) {
    const meta = document.querySelector('meta[name="stories-account-url"]');
    const fromMeta = meta && typeof meta.content === 'string' ? meta.content.trim() : '';
    if (profile && isValidString(profile.stories_account_url)) return profile.stories_account_url;
    if (isValidString(fromMeta)) return fromMeta;
    if (typeof window !== 'undefined' && isValidString(window.__STORIES_ACCOUNT_URL__)) {
      return window.__STORIES_ACCOUNT_URL__;
    }
    return DEFAULT_STORIES_URL;
  }

  function openStoriesLink(profile) {
    const url = resolveStoriesUrl(profile || cachedProfile);
    if (window.Telegram && Telegram.WebApp) {
      try {
        Telegram.WebApp.openLink(url, { try_instant_view: false });
      } catch (e) {
        window.open(url, '_blank', 'noopener');
      }
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  function updateStatsBoard(user) {
    const reels = Number(user?.reels_launched_total || 0);
    const premium = user?.telegram_meta?.is_premium ? 1 : 0;
    const boardReels = document.getElementById('board-reels-count');
    const boardSpots = document.getElementById('board-spots-count');
    const boardPremium = document.getElementById('board-premium-count');
    if (boardReels) boardReels.textContent = `${Math.min(1500, reels)} / 1500`;
    if (boardSpots) boardSpots.textContent = `${Math.min(500, 50 + reels * 5)} / 500`;
    if (boardPremium) boardPremium.textContent = `${premium ? 12 + reels : 6 + reels}`;
  }

  const adviceTips = [
    'Remember to keep your Reel under 15 seconds for the fastest moderation.',
    'Add trending audio to double your chances of making the explore page.',
    'Premium tip: upload two extra Reels to lock your slot in the priority queue.',
    'Share your Reel link with three friends to boost saves and reach.'
  ];

  function getAdviceText(reelsCount = 0) {
    if (reelsCount <= 0) return adviceTips[0];
    if (reelsCount === 1) return adviceTips[1];
    if (reelsCount === 2) return adviceTips[2];
    return adviceTips[3];
  }

  function updateAdvice(user) {
    const card = document.getElementById('advice-card');
    const text = document.getElementById('advice-text');
    if (!card || !text) return;
    const count = Number(user?.reels_launched_total || 0);
    text.textContent = getAdviceText(count);
  }

  function persistStoriesModalPreference(hidden) {
    storiesModalDismissed = !!hidden;
    try {
      localStorage.setItem('stories_modal_hidden', hidden ? 'true' : 'false');
    } catch (e) {
      console.warn('Unable to persist modal preference', e);
    }
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

  async function persistMissionState(update = {}) {
    const payload = { ...update };
    if (payload.mission_progress != null) {
      const numeric = Number(payload.mission_progress);
      if (Number.isFinite(numeric)) {
        payload.mission_progress = Math.max(numeric, missionProgress || 0);
      } else {
        delete payload.mission_progress;
      }
    }
    const result = await saveUserData(payload);
    if (result.ok && result.data) {
      cachedProfile = result.data;
      missionProgress = Number(result.data.mission_progress || missionProgress || 0);
      updateStatsBoard(result.data);
      updateAdvice(result.data);
    }
    return result;
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
    const editPanel = document.getElementById('reel-edit-panel');
    const editInput = document.getElementById('profile-link-input');
    const editErrorEl = document.getElementById('reel-edit-error');
    const locationEl = document.getElementById('profile-location');
    const languageEl = document.getElementById('profile-language');
    const premiumReel2 = document.getElementById('premium-reel-2');
    const premiumReel3 = document.getElementById('premium-reel-3');

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

    if (locationEl) {
      const cityLabel = user && (user.city_label || buildCityLabel(user.city, user.region, user.country));
      const utc = user && user.utc_offset;
      if (cityLabel || utc) {
        locationEl.textContent = utc ? `${cityLabel || '—'} · ${utc}` : cityLabel;
      } else if (currentCitySelection) {
        locationEl.textContent = `${currentCitySelection.label} · ${currentCitySelection.utcOffset}`;
      } else {
        locationEl.textContent = '';
      }
    }

    if (languageEl) {
      const lang = (user && user.language) || currentLanguage || 'en';
      languageEl.textContent = `Language: ${lang.toUpperCase()}`;
    }

    const daily = user && typeof user.daily_points === 'number' ? user.daily_points : 0;
    const pointsTotal = user && typeof user.points_total === 'number'
      ? user.points_total
      : (user && typeof user.points === 'number' ? user.points : 0);
    const todayLabel = translations[currentLanguage]['balance_today'] || '+{0} today';
    balanceTodayEl.textContent = todayLabel.replace('{0}', daily);
    balancePointsEl.textContent = `${pointsTotal} ⚡`;

    const placeholder = getReelPlaceholder();

    if (editPanel) {
      editPanel.classList.add('hidden');
    }
    if (editErrorEl) {
      editErrorEl.textContent = '';
      editErrorEl.classList.add('hidden');
    }
    if (editInput) {
      editInput.value = user && user.reels_link ? user.reels_link : '';
      editInput.placeholder = placeholder;
    }

    if (linkEl) {
      if (user && user.reels_link) {
        linkEl.textContent = user.reels_link;
        linkEl.href = user.reels_link;
        linkEl.classList.remove('placeholder');
        linkEl.setAttribute('target', '_blank');
        linkEl.setAttribute('rel', 'noopener noreferrer');
        linkEl.title = user.reels_link;
        linkEl.removeAttribute('aria-disabled');
        linkEl.removeAttribute('tabindex');
      } else {
        linkEl.textContent = placeholder;
        linkEl.classList.add('placeholder');
        linkEl.removeAttribute('href');
        linkEl.removeAttribute('target');
        linkEl.removeAttribute('rel');
        linkEl.removeAttribute('title');
        linkEl.setAttribute('aria-disabled', 'true');
        linkEl.setAttribute('tabindex', '-1');
      }
    }

    const statusLabel = translations[currentLanguage]['profile_status'] || 'Status';
    const statusKey = 'status_' + ((user && user.reels_status) || 'pending');
    const statusText = translations[currentLanguage][statusKey] || ((user && user.reels_status) || 'pending');
    statusEl.textContent = `${statusLabel}: ${statusText}`;

    const isPremium = !!(user && (user.is_premium || user.telegram_meta?.is_premium));
    if (premiumReel2) {
      premiumReel2.classList.toggle('hidden', !isPremium);
    }
    if (premiumReel3) {
      premiumReel3.classList.toggle('hidden', !isPremium);
    }
  }

  function showReelEditPanel() {
    const panel = document.getElementById('reel-edit-panel');
    if (!panel) return;
    const errorEl = document.getElementById('reel-edit-error');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
    const inputEl = document.getElementById('profile-link-input');
    if (inputEl) {
      const profile = cachedProfile || null;
      inputEl.value = profile && profile.reels_link ? profile.reels_link : '';
      inputEl.placeholder = getReelPlaceholder();
      requestAnimationFrame(() => {
        try {
          inputEl.focus({ preventScroll: false });
        } catch (_) {
          try { inputEl.focus(); } catch (err) { /* ignore */ }
        }
        try {
          const length = inputEl.value.length;
          inputEl.setSelectionRange(length, length);
        } catch (_) {
          /* selection not supported */
        }
      });
    }
    panel.classList.remove('hidden');
  }

  function hideReelEditPanel() {
    const panel = document.getElementById('reel-edit-panel');
    if (panel) {
      panel.classList.add('hidden');
    }
    const errorEl = document.getElementById('reel-edit-error');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
    const inputEl = document.getElementById('profile-link-input');
    if (inputEl) {
      const profile = cachedProfile || null;
      inputEl.value = profile && profile.reels_link ? profile.reels_link : '';
    }
  }

  async function handleReelEditSave() {
    const inputEl = document.getElementById('profile-link-input');
    const errorEl = document.getElementById('reel-edit-error');
    if (!inputEl) return;
    const langData = translations[currentLanguage] || {};
    const fallbackError = langData['error_reel_update'] || 'Unable to update your reel link right now. Please try again.';

    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }

    const newLink = inputEl.value.trim();
    if (!isValidReelLink(newLink)) {
      if (errorEl) {
        errorEl.textContent = langData['error_reel'] || fallbackError;
        errorEl.classList.remove('hidden');
      }
      return;
    }

    let profile = cachedProfile;
    if (!profile) {
      profile = await ensureProfileData();
    }
    const previousLink = profile && profile.reels_link ? profile.reels_link.trim() : '';
    const hasChanged = previousLink !== newLink;
    if (!hasChanged) {
      hideReelEditPanel();
      return;
    }

    if (profile && profile.reels_status === 'approved') {
      const alertMessage = langData['alert_reel_pending'] || 'Updating the reel link will move its status back to Pending for review.';
      window.alert(alertMessage);
    }

    const payload = buildProfileUpdatePayload({
      reels_link: newLink,
      reels_status: 'pending'
    });
    if (!payload) {
      if (errorEl) {
        errorEl.textContent = fallbackError;
        errorEl.classList.remove('hidden');
      }
      return;
    }

    const saveResult = await saveUserData(payload);
    if (!saveResult.ok) {
      const errorText = (typeof saveResult.error === 'string' && saveResult.error.trim())
        ? saveResult.error
        : fallbackError;
      if (errorEl) {
        errorEl.textContent = errorText;
        errorEl.classList.remove('hidden');
      }
      return;
    }

    const savedProfile = (saveResult.data && typeof saveResult.data === 'object')
      ? saveResult.data
      : { ...(profile || {}), ...payload };
    savedProfile.reels_link = newLink;
    savedProfile.reels_status = 'pending';
    cachedProfile = savedProfile;
    persistOnboardingCompletion(isProfileComplete(savedProfile));
    populateProfile(savedProfile);
    hideReelEditPanel();
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

  function openFaqView() {
    const menu = document.getElementById('bottom-menu');
    if (menu && menu.classList.contains('locked')) return;
    showMenuView('faq');
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
    const introScreen = document.getElementById('intro-screen');
    if (introScreen) {
      setTimeout(() => {
        introScreen.classList.add('hidden');
        setTimeout(() => {
          if (introScreen.parentNode) {
            introScreen.parentNode.removeChild(introScreen);
          }
        }, 2500);
      }, 2500);
    }

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

    let cityDebounceTimer = null;
    const cityInput = document.getElementById('city-input');
    if (cityInput) {
      cityInput.addEventListener('input', () => {
        const value = cityInput.value;
        if (cityInput.getAttribute('data-selected')) {
          cityInput.removeAttribute('data-selected');
        }
        if (cityDebounceTimer) clearTimeout(cityDebounceTimer);
        cityDebounceTimer = setTimeout(() => fetchCitySuggestions(value), 350);
      });
    }

    const changeCityBtn = document.getElementById('change-city');
    if (changeCityBtn) {
      changeCityBtn.addEventListener('click', () => {
        clearCitySelection();
      });
    }

    document.querySelectorAll('.language-option').forEach(option => {
      option.addEventListener('click', () => {
        document.querySelectorAll('.language-option').forEach(btn => btn.classList.remove('selected'));
        option.classList.add('selected');
        const lang = option.getAttribute('data-language') || 'en';
        currentLanguage = lang;
        safeSetItem('language', lang);
        applyTranslations();
        if (cachedProfile) {
          cachedProfile.language = lang;
        }
      });
    });

    setupThemeSwitch();

    await loadTranslations();
    captureTelegramUser();
    const existingProfile = await ensureProfileData();
    applyTranslations();
    applyProfileSelections(existingProfile || cachedProfile);
    setupKeyboardHandling();

    const editButton = document.getElementById('edit-reel-link');
    if (editButton) {
      editButton.addEventListener('click', () => {
        const panel = document.getElementById('reel-edit-panel');
        if (panel && !panel.classList.contains('hidden')) {
          hideReelEditPanel();
        } else {
          showReelEditPanel();
        }
      });
    }

    const cancelEditButton = document.getElementById('cancel-reel-edit');
    if (cancelEditButton) {
      cancelEditButton.addEventListener('click', () => {
        hideReelEditPanel();
      });
    }

    const saveEditButton = document.getElementById('save-reel-edit');
    if (saveEditButton) {
      saveEditButton.addEventListener('click', () => {
        handleReelEditSave();
      });
    }

    const profileEditInput = document.getElementById('profile-link-input');
    if (profileEditInput) {
      profileEditInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          handleReelEditSave();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          hideReelEditPanel();
        }
      });
    }

    if (currentCitySelection) {
      applyCitySelection(currentCitySelection);
    } else {
      const storedCity = localStorage.getItem('city_label');
      if (storedCity) {
        applyCitySelection({
          label: storedCity,
          city: '',
          region: '',
          country: '',
          utcOffset: localStorage.getItem('utc_offset') || 'UTC+00:00',
          timezoneId: null
        });
      }
    }

    const bottomMenu = document.getElementById('bottom-menu');
    const step1Btn = document.getElementById('step1-next');
    const openStoriesBtn = document.getElementById('open-stories-trigger');
    const modal = document.getElementById('stories-modal');
    const modalClose = document.getElementById('stories-modal-close');
    const modalOpen = document.getElementById('stories-modal-open');
    const modalHide = document.getElementById('stories-modal-hide');
    const missionSubmitBtn = document.getElementById('launch-reel-btn');
    const reopenStoriesBtn = document.getElementById('reopen-stories');
    const goToMenuBtn = document.getElementById('go-to-menu-btn');
    const adviceCard = document.getElementById('advice-card');

    if (modalHide) {
      modalHide.checked = storiesModalDismissed;
      modalHide.addEventListener('change', (event) => {
        persistStoriesModalPreference(event.target.checked);
      });
    }

    function setMenuActive(view) {
      document.querySelectorAll('#bottom-menu .menu-btn').forEach(btn => {
        const btnView = btn.getAttribute('data-view');
        if (btnView === view) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    async function handleStep1Next() {
      const errorEl = document.getElementById('step1-error');
      if (errorEl) {
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
      }
      if (!currentCitySelection) {
        if (errorEl) {
          errorEl.textContent = 'Please choose your city from the list.';
          errorEl.classList.remove('hidden');
        }
        return;
      }
      const languageOption = document.querySelector('.language-option.selected');
      const language = languageOption ? languageOption.getAttribute('data-language') : currentLanguage;
      if (!language) {
        if (errorEl) {
          errorEl.textContent = 'Please choose a language.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      currentLanguage = language;
      safeSetItem('language', language);
      safeSetItem('utc_offset', currentCitySelection.utcOffset);
      try {
        localStorage.setItem('city_label', currentCitySelection.label);
      } catch (e) {
        console.warn('Unable to persist city label', e);
      }

      const payload = {
        language,
        city: currentCitySelection.city || currentCitySelection.label,
        region: currentCitySelection.region || '',
        country: currentCitySelection.country || '',
        city_label: currentCitySelection.label,
        utc_offset: currentCitySelection.utcOffset,
        timezone: currentCitySelection.timezoneId || null,
        mission_progress: 0
      };

      const result = await saveUserData(payload);
      if (!result.ok) {
        if (errorEl) {
          errorEl.textContent = result.error || 'Failed to save data. Please try again.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      if (result.data) {
        cachedProfile = result.data;
        updateStatsBoard(result.data);
        updateAdvice(result.data);
      }
      applyProfileSelections(cachedProfile);
      showMissionScreen('mission-step2');
      updateMissionDots(1);
      enableMenuAccess(false);
    }

    async function proceedToStories() {
      await persistMissionState({ mission_progress: 1, stories_modal_hidden: storiesModalDismissed });
      showMissionScreen('mission-step4');
      updateMissionDots(2);
      enableMenuAccess(false);
      openStoriesLink();
    }

    if (step1Btn) {
      step1Btn.addEventListener('click', handleStep1Next);
    }

    if (openStoriesBtn) {
      openStoriesBtn.addEventListener('click', async () => {
        if (!storiesModalDismissed && modal) {
          modal.classList.remove('hidden');
        } else {
          await proceedToStories();
        }
      });
    }

    if (modalClose) {
      modalClose.addEventListener('click', () => {
        if (modal) modal.classList.add('hidden');
      });
    }

    if (modalOpen) {
      modalOpen.addEventListener('click', async () => {
        if (modalHide) {
          persistStoriesModalPreference(modalHide.checked);
        }
        if (modal) modal.classList.add('hidden');
        await proceedToStories();
      });
    }

    if (reopenStoriesBtn) {
      reopenStoriesBtn.addEventListener('click', () => {
        openStoriesLink();
      });
    }

    async function handleMissionSubmit() {
      const linkInput = document.getElementById('mission-reel-link');
      const codeInput = document.getElementById('mission-code');
      const errorEl = document.getElementById('mission-step4-error');
      if (errorEl) {
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
      }
      const link = linkInput ? linkInput.value.trim() : '';
      const code = codeInput ? codeInput.value.trim() : '';
      const adminBypass = code === '123456789';
      const linkValid = /^https:\/\/www\.instagram\.com\/reel\//i.test(link);
      const codeValid = adminBypass || /^\d{9}$/.test(code);

      if (!linkValid) {
        if (errorEl) {
          errorEl.textContent = 'Please paste a valid Instagram Reel link.';
          errorEl.classList.remove('hidden');
        }
        return;
      }
      if (!codeValid) {
        if (errorEl) {
          errorEl.textContent = 'Enter the nine digit code from the stories.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      const profile = cachedProfile || await ensureProfileData();
      const currentCount = Number(profile?.reels_launched_total || 0);
      const payload = {
        reels_link: link,
        reels_status: 'pending',
        nine_digit_code: true,
        mission_progress: 2,
        reels_launched_total: currentCount + 1,
        stories_modal_hidden: storiesModalDismissed
      };

      const result = await persistMissionState(payload);
      if (!result.ok) {
        if (errorEl) {
          errorEl.textContent = result.error || 'Failed to save data. Try again.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      const saved = result.data || cachedProfile;
      cachedProfile = saved;
      persistOnboardingCompletion(true);
      updateMissionDots(3);
      updateAdvice(saved);
      showMissionScreen('mission-step5');
      enableMenuAccess(true);
      await persistMissionState({ mission_progress: 3, stories_modal_hidden: storiesModalDismissed });
    }

    if (missionSubmitBtn) {
      missionSubmitBtn.addEventListener('click', handleMissionSubmit);
    }

    if (goToMenuBtn) {
      goToMenuBtn.addEventListener('click', async () => {
        enableMenuAccess(true);
        setMenuActive('profile');
        await openProfileView(true);
      });
    }

    if (adviceCard) {
      const openFaq = async () => {
        enableMenuAccess(true);
        setMenuActive('faq');
        openFaqView();
      };
      adviceCard.addEventListener('click', openFaq);
      adviceCard.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openFaq();
        }
      });
    }

    if (hasCompletedOnboarding) {
      enableMenuAccess(true);
      updateMissionDots(3);
      document.querySelectorAll('.mission-screen').forEach(section => section.classList.add('hidden'));
      setMenuActive('profile');
      await openProfileView(true);
    } else {
      showMissionScreen('onboarding-step1');
      updateMissionDots(0);
      if (bottomMenu) {
        bottomMenu.classList.add('hidden');
        bottomMenu.classList.add('locked');
      }
    }

    document.querySelectorAll('#bottom-menu .menu-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (bottomMenu && bottomMenu.classList.contains('locked')) return;
        const view = btn.getAttribute('data-view');
        document.querySelectorAll('#bottom-menu .menu-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (view === 'referral') {
          await openReferralView();
        } else if (view === 'profile') {
          await openProfileView();
        } else if (view === 'faq') {
          openFaqView();
        }
      });
    });

    const copyBtn = document.getElementById('copy-referral');
    if (copyBtn) {
      copyBtn.addEventListener('click', copyReferral);
    }

    const sendBtn = document.getElementById('send-referral');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => {
        const link = document.getElementById('referral-link')?.value || '';
        if (window.Telegram && Telegram.WebApp) {
          Telegram.WebApp.openTelegramLink(link);
        } else {
          window.open(link, '_blank', 'noopener');
        }
      });
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (!confirm('Are you sure you want to logout?')) return;
        localStorage.removeItem('region');
        localStorage.removeItem('language');
        localStorage.removeItem('utc_offset');
        localStorage.removeItem('referral_id');
        localStorage.removeItem('telegram_id');
        localStorage.removeItem('onboarding_complete');
        localStorage.removeItem('city_label');
        localStorage.removeItem('stories_modal_hidden');

        currentReferralId = null;
        cachedProfile = null;
        cachedTelegramUser = null;
        currentTelegramId = null;
        hasCompletedOnboarding = false;
        missionProgress = 0;
        storiesModalDismissed = false;

        if (bottomMenu) {
          bottomMenu.classList.add('hidden');
          bottomMenu.classList.add('locked');
        }
        showMissionScreen('onboarding-step1');
        updateMissionDots(0);
        clearCitySelection();
        document.querySelectorAll('.language-option').forEach(btn => btn.classList.remove('selected'));
        const linkInput = document.getElementById('mission-reel-link');
        if (linkInput) linkInput.value = '';
        const codeInput = document.getElementById('mission-code');
        if (codeInput) codeInput.value = '';
      });
    }

    const accordion = document.getElementById('faq-accordion');
    if (accordion) {
      accordion.querySelectorAll('.faq-item').forEach(item => {
        const question = item.querySelector('.faq-question');
        if (!question) return;
        question.addEventListener('click', () => {
          item.classList.toggle('active');
        });
      });
    }

    const contactSupport = document.getElementById('contact-support');
    if (contactSupport) {
      contactSupport.addEventListener('click', () => {
        const supportUrl = 'https://t.me/testofcodebot';
        if (window.Telegram && Telegram.WebApp) {
          Telegram.WebApp.openTelegramLink(supportUrl);
        } else {
          window.open(supportUrl, '_blank', 'noopener');
        }
      });
    }
  });
})();
