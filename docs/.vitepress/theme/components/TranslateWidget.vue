<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const isOpen = ref(false)
const selectedLang = ref(null)
const isTranslated = ref(false)
const isReady = ref(false)

const languages = [
  // Western Europe
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ca', name: 'Català' },
  { code: 'gl', name: 'Galego' },
  { code: 'eu', name: 'Euskara' },
  // Nordic
  { code: 'sv', name: 'Svenska' },
  { code: 'da', name: 'Dansk' },
  { code: 'no', name: 'Norsk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'is', name: 'Íslenska' },
  // Central/Eastern Europe
  { code: 'pl', name: 'Polski' },
  { code: 'cs', name: 'Čeština' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'hu', name: 'Magyar' },
  { code: 'ro', name: 'Română' },
  { code: 'bg', name: 'Български' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'sl', name: 'Slovenščina' },
  { code: 'sr', name: 'Srpski' },
  { code: 'uk', name: 'Українська' },
  { code: 'ru', name: 'Русский' },
  // Baltic
  { code: 'lt', name: 'Lietuvių' },
  { code: 'lv', name: 'Latviešu' },
  { code: 'et', name: 'Eesti' },
  // Other European
  { code: 'el', name: 'Ελληνικά' },
  { code: 'tr', name: 'Türkçe' },
  // Asia
  { code: 'zh-CN', name: '中文 (简体)' },
  { code: 'zh-TW', name: '中文 (繁體)' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'th', name: 'ไทย' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'id', name: 'Bahasa Indonesia' },
  // Other
  { code: 'ar', name: 'العربية' },
  { code: 'he', name: 'עברית' }
]

// Load Google Translate script
function loadGoogleTranslate() {
  if (document.getElementById('google-translate-script')) return

  // Create the google translate element container (hidden)
  const gtDiv = document.createElement('div')
  gtDiv.id = 'google_translate_element'
  gtDiv.style.position = 'absolute'
  gtDiv.style.top = '-9999px'
  gtDiv.style.left = '-9999px'
  document.body.appendChild(gtDiv)

  // Define the callback
  window.googleTranslateElementInit = () => {
    new window.google.translate.TranslateElement(
      {
        pageLanguage: 'en',
        autoDisplay: false,
        layout: window.google.translate.TranslateElement.InlineLayout.SIMPLE
      },
      'google_translate_element'
    )
    // Mark as ready once initialized
    setTimeout(() => {
      isReady.value = true
      checkTranslationStatus()
    }, 500)
  }

  // Load the script
  const script = document.createElement('script')
  script.id = 'google-translate-script'
  script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
  script.async = true
  document.head.appendChild(script)
}

// Clear all googtrans cookies thoroughly
function clearAllGoogTransCookies() {
  const hostname = window.location.hostname
  // Try all possible domain variations
  const domains = [
    '',
    hostname,
    '.' + hostname,
    // For subdomains like docs.example.com, also try .example.com
    hostname.split('.').slice(-2).join('.'),
    '.' + hostname.split('.').slice(-2).join('.')
  ]

  domains.forEach(domain => {
    const domainPart = domain ? `; domain=${domain}` : ''
    // Clear with various path combinations
    document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domainPart}`
    document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${domainPart}`
    document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 GMT${domainPart}`
  })
}

// Trigger translation using Google's combo selector
function triggerGoogleTranslate(langCode) {
  // Always clear cookies first to prevent stale state
  clearAllGoogTransCookies()

  const select = document.querySelector('.goog-te-combo')
  if (select) {
    select.value = langCode
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  return false
}

// Restore to original English
function restoreToEnglish() {
  isOpen.value = false

  // Clear cookies first - this is critical
  clearAllGoogTransCookies()

  // Method 1: Try the combo selector with empty value
  const select = document.querySelector('.goog-te-combo')
  if (select) {
    select.value = ''
    select.dispatchEvent(new Event('change', { bubbles: true }))

    // Google Translate sometimes needs a moment, then check if it worked
    setTimeout(() => {
      const html = document.documentElement
      if (html.classList.contains('translated-ltr') || html.classList.contains('translated-rtl')) {
        // Still translated, force reload
        window.location.reload()
      } else {
        updateUIState(false, null)
      }
    }, 300)
    return
  }

  // Method 2: Force reload as fallback
  window.location.reload()
}

function updateUIState(translated, lang) {
  isTranslated.value = translated
  selectedLang.value = lang
}

function translateTo(lang) {
  isOpen.value = false

  // If already translated to a different language, we need to restore first then translate
  const html = document.documentElement
  const currentlyTranslated = html.classList.contains('translated-ltr') || html.classList.contains('translated-rtl')

  if (currentlyTranslated) {
    // Clear cookies and restore first
    clearAllGoogTransCookies()

    const select = document.querySelector('.goog-te-combo')
    if (select) {
      // Restore to original
      select.value = ''
      select.dispatchEvent(new Event('change', { bubbles: true }))

      // Wait for restore, then translate to new language
      setTimeout(() => {
        triggerGoogleTranslate(lang.code)
        updateUIState(true, lang)
      }, 500)
      return
    }
  }

  // Not currently translated, just translate directly
  const success = triggerGoogleTranslate(lang.code)
  if (success) {
    updateUIState(true, lang)
  } else {
    // Retry if Google Translate isn't ready yet
    setTimeout(() => {
      if (triggerGoogleTranslate(lang.code)) {
        updateUIState(true, lang)
      }
    }, 1000)
  }
}

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function closeDropdown(e) {
  if (!e.target.closest('.translate-container')) {
    isOpen.value = false
  }
}

// Check if page is currently translated
function checkTranslationStatus() {
  const html = document.documentElement
  const hasTranslatedClass = html.classList.contains('translated-ltr') ||
                              html.classList.contains('translated-rtl')

  if (hasTranslatedClass) {
    isTranslated.value = true
    // Try to determine the language from the combo
    const select = document.querySelector('.goog-te-combo')
    if (select && select.value) {
      const lang = languages.find(l => l.code === select.value)
      selectedLang.value = lang || { code: select.value, name: select.value }
    }
  } else {
    isTranslated.value = false
    selectedLang.value = null
  }
}

// Watch for translation state changes
let observer = null

function setupObserver() {
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'class') {
        checkTranslationStatus()
        break
      }
    }
  })

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })
}

onMounted(() => {
  loadGoogleTranslate()
  setupObserver()
  document.addEventListener('click', closeDropdown)
})

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
  }
  document.removeEventListener('click', closeDropdown)
})
</script>

<template>
  <div class="translate-container">
    <!-- Main translate button with integrated back option -->
    <button
      class="translate-button"
      :class="{ active: isTranslated }"
      @click.stop="toggleDropdown"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      :title="isTranslated ? `Translated to ${selectedLang?.name}` : 'Translate this page'"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>
      <span class="translate-label">{{ isTranslated ? selectedLang?.name : 'Translate' }}</span>
      <svg class="chevron" :class="{ open: isOpen }" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>

    <div v-if="isOpen" class="translate-dropdown" role="listbox">
      <!-- Back to English option when translated -->
      <button
        v-if="isTranslated"
        class="translate-option restore-option"
        role="option"
        @click="restoreToEnglish"
      >
        ← English (Original)
      </button>
      <div v-if="isTranslated" class="dropdown-divider"></div>

      <button
        v-for="lang in languages"
        :key="lang.code"
        class="translate-option"
        :class="{ selected: selectedLang?.code === lang.code }"
        role="option"
        :aria-selected="selectedLang?.code === lang.code"
        @click="translateTo(lang)"
      >
        {{ lang.name }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.translate-container {
  position: relative;
  margin-left: 12px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.translate-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.25s, color 0.25s, background-color 0.25s;
  white-space: nowrap;
}

.translate-button:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.translate-button.active {
  border-color: var(--vp-c-brand-1);
  background-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

/* Hide "Translate" text and chevron by default, show only globe icon */
.translate-label,
.chevron {
  display: none;
}

/* On larger screens, show full button with text and chevron */
@media (min-width: 1200px) {
  .translate-container {
    margin-left: 16px;
  }

  .translate-button {
    gap: 6px;
    padding: 4px 10px;
  }

  .translate-label,
  .chevron {
    display: inline;
  }
}

.chevron {
  transition: transform 0.25s;
}

.chevron.open {
  transform: rotate(180deg);
}

.translate-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 180px;
  max-height: 360px;
  overflow-y: auto;
  padding: 8px 0;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-shadow: var(--vp-shadow-3);
  z-index: 100;
}

.translate-option {
  display: block;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-1);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.translate-option:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-brand-1);
}

.translate-option.selected {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.translate-option.restore-option {
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.translate-option.restore-option:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
}

.dropdown-divider {
  height: 1px;
  margin: 8px 0;
  background: var(--vp-c-divider);
}
</style>
