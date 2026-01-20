<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const isOpen = ref(false)
const currentLang = ref('EN')
const isTranslated = ref(false)

// All languages from your original configuration with native names
const languages = [
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ca', name: 'Català' },
  { code: 'gl', name: 'Galego' },
  { code: 'eu', name: 'Euskara' },
  { code: 'sv', name: 'Svenska' },
  { code: 'da', name: 'Dansk' },
  { code: 'no', name: 'Norsk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'is', name: 'Íslenska' },
  { code: 'pl', name: 'Polski' },
  { code: 'cs', name: 'Čeština' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'hu', name: 'Magyar' },
  { code: 'ro', name: 'Română' },
  { code: 'bg', name: 'Български' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'sl', name: 'Slovenščina' },
  { code: 'sr', name: 'Српски' },
  { code: 'uk', name: 'Українська' },
  { code: 'ru', name: 'Русский' },
  { code: 'lt', name: 'Lietuvių' },
  { code: 'lv', name: 'Latviešu' },
  { code: 'et', name: 'Eesti' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'th', name: 'ไทย' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ar', name: 'العربية' },
  { code: 'he', name: 'עברית' }
]

let observer = null

function loadGoogleTranslate() {
  if (document.getElementById('google-translate-script')) return

  window.googleTranslateElementInit = function() {
    new window.google.translate.TranslateElement({
      pageLanguage: 'en',
      includedLanguages: languages.map(l => l.code).join(','),
      autoDisplay: false
    }, 'google_translate_element')
  }

  const script = document.createElement('script')
  script.id = 'google-translate-script'
  script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
  document.head.appendChild(script)
}

function selectLanguage(langCode) {
  isOpen.value = false

  // Method 1: Try to use Google's select element directly
  const googleSelect = document.querySelector('.goog-te-combo')
  if (googleSelect) {
    googleSelect.value = langCode
    googleSelect.dispatchEvent(new Event('change', { bubbles: true }))

    // Update our display after a short delay to let Google process
    setTimeout(() => {
      detectCurrentLanguage()
    }, 500)
    return
  }

  // Method 2: Fallback to cookie + reload approach
  const domain = window.location.hostname
  document.cookie = `googtrans=/en/${langCode}; path=/; domain=${domain}`
  document.cookie = `googtrans=/en/${langCode}; path=/`
  window.location.reload()
}

function resetToEnglish() {
  isOpen.value = false

  // Always clear cookies first to ensure clean state
  clearTranslateCookies()

  // Try to use Google's select to trigger the restore
  const googleSelect = document.querySelector('.goog-te-combo')
  if (googleSelect) {
    // Set to the page's original language (English)
    // The first option with empty value means "Select Language" / restore original
    googleSelect.value = 'en'
    googleSelect.dispatchEvent(new Event('change', { bubbles: true }))

    // Give it a moment, then check if we need to reload
    setTimeout(() => {
      const stillTranslated = document.documentElement.classList.contains('translated-ltr') ||
                              document.documentElement.classList.contains('translated-rtl')
      if (stillTranslated) {
        // If still showing translated, force reload
        window.location.reload()
      } else {
        detectCurrentLanguage()
      }
    }, 300)
    return
  }

  // If no Google select available, just reload
  window.location.reload()
}

function clearTranslateCookies() {
  // Get all possible domain variations
  const hostname = window.location.hostname
  const domainParts = hostname.split('.')

  // Build list of possible domains to clear
  const domains = ['', hostname]
  if (domainParts.length > 1) {
    domains.push('.' + hostname)
    // For subdomains, also try parent domain
    domains.push('.' + domainParts.slice(-2).join('.'))
  }

  const paths = ['/', '']

  // Clear all possible cookie combinations
  for (const domain of domains) {
    for (const path of paths) {
      const domainPart = domain ? `; domain=${domain}` : ''
      const pathPart = path ? `; path=${path}` : '; path=/'
      document.cookie = `googtrans=${pathPart}${domainPart}; expires=Thu, 01 Jan 1970 00:00:00 UTC`
    }
  }
}

function detectCurrentLanguage() {
  // Check if page is currently translated by looking at HTML class
  const htmlEl = document.documentElement
  const isCurrentlyTranslated = htmlEl.classList.contains('translated-ltr') ||
                                 htmlEl.classList.contains('translated-rtl')

  isTranslated.value = isCurrentlyTranslated

  if (!isCurrentlyTranslated) {
    currentLang.value = 'EN'
    return
  }

  // Try to get language from Google's select element
  const googleSelect = document.querySelector('.goog-te-combo')
  if (googleSelect && googleSelect.value) {
    const langCode = googleSelect.value.toUpperCase().split('-')[0]
    currentLang.value = langCode
    return
  }

  // Fallback: check cookie
  const match = document.cookie.match(/googtrans=\/en\/([^;]+)/)
  if (match) {
    currentLang.value = match[1].toUpperCase().split('-')[0]
  }
}

// Watch for Google Translate state changes (like "Show Original" clicks)
function setupObserver() {
  // Observe changes to the html element's class (translated-ltr/rtl)
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        detectCurrentLanguage()
      }
    }
  })

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })
}

// Close dropdown when clicking outside
function handleClickOutside(e) {
  if (!e.target.closest('.translate-widget')) {
    isOpen.value = false
  }
}

onMounted(() => {
  loadGoogleTranslate()
  document.addEventListener('click', handleClickOutside)

  // Initial detection
  detectCurrentLanguage()

  // Setup observer for Google Translate state changes
  setupObserver()

  // Also poll periodically in case Google's widget loads slowly
  const pollInterval = setInterval(() => {
    detectCurrentLanguage()
    // Stop polling once we detect the Google select is available
    if (document.querySelector('.goog-te-combo')) {
      clearInterval(pollInterval)
    }
  }, 1000)

  // Clear interval after 10 seconds regardless
  setTimeout(() => clearInterval(pollInterval), 10000)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  if (observer) {
    observer.disconnect()
  }
})
</script>

<template>
  <div class="translate-widget">
    <button @click="isOpen = !isOpen" class="translate-trigger" aria-label="Select language">
      <svg class="globe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke-width="1.5"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke-width="1.5"/>
      </svg>
      <span class="current-lang">{{ currentLang }}</span>
      <svg class="chevron" :class="{ open: isOpen }" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
      </svg>
    </button>

    <div v-if="isOpen" class="dropdown" role="menu">
      <div class="dropdown-notice">
        Powered by Google Translate.<br>Translations may contain errors.
      </div>
      <button
        @click="resetToEnglish"
        class="dropdown-item"
        :class="{ active: currentLang === 'EN' }"
        role="menuitem"
      >
        English
      </button>
      <button
        v-for="lang in languages"
        :key="lang.code"
        @click="selectLanguage(lang.code)"
        class="dropdown-item"
        :class="{ active: currentLang === lang.code.toUpperCase().split('-')[0] }"
        role="menuitem"
      >
        {{ lang.name }}
      </button>
    </div>

    <!-- Hidden Google Translate element - needed for the API -->
    <div id="google_translate_element" class="google-translate-hidden"></div>
  </div>
</template>

<style scoped>
.translate-widget {
  position: relative;
  margin-left: 12px;
}

.translate-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 14px;
  font-family: var(--vp-font-family-base);
  transition: all 0.2s;
}

.translate-trigger:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.globe-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.current-lang {
  font-weight: 500;
}

.chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  transition: transform 0.2s;
}

.chevron.open {
  transform: rotate(180deg);
}

.dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 220px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-shadow: var(--vp-shadow-3);
  z-index: 100;
  padding: 4px 0;
}

.dropdown-notice {
  padding: 8px 12px;
  font-size: 11px;
  color: var(--vp-c-text-3);
  border-bottom: 1px solid var(--vp-c-divider);
  margin-bottom: 4px;
  line-height: 1.4;
}

.dropdown-item {
  display: block;
  width: 100%;
  padding: 10px 16px;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 14px;
  font-family: var(--vp-font-family-base);
  transition: background 0.15s;
}

.dropdown-item:hover {
  background: var(--vp-c-bg-soft);
}

.dropdown-item.active {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

/* Hide Google's element but keep it functional */
.google-translate-hidden {
  position: absolute;
  left: -9999px;
  top: -9999px;
  visibility: hidden;
  height: 0;
  overflow: hidden;
}

@media (min-width: 1200px) {
  .translate-widget {
    margin-left: 16px;
  }
}
</style>

<style>
/* Global styles to hide Google Translate's default UI elements */
.goog-te-gadget {
  font-size: 0 !important;
}

.goog-te-gadget > span {
  display: none !important;
}

/* Keep the select functional but hidden */
.goog-te-combo {
  position: absolute !important;
  left: -9999px !important;
  visibility: hidden !important;
}

/* Ensure the skiptranslate div doesn't take space */
.skiptranslate {
  display: none !important;
}

body > .skiptranslate {
  display: none !important;
}

/* But keep the banner frame visible when translating */
.goog-te-banner-frame.skiptranslate {
  display: block !important;
}
</style>
