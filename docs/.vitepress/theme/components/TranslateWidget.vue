<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const isOpen = ref(false)
const selectedLang = ref(null)
const isTranslated = ref(false)

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
  gtDiv.style.display = 'none'
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
  }

  // Load the script
  const script = document.createElement('script')
  script.id = 'google-translate-script'
  script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
  script.async = true
  document.head.appendChild(script)
}

// Set translation language via cookie
function setTranslationCookie(langCode) {
  // Google Translate uses a cookie to track the selected language
  // Format: /en/langCode for translating from English to langCode
  const value = `/en/${langCode}`
  document.cookie = `googtrans=${value}; path=/`
  // Also set for the domain without leading dot (for some browsers)
  document.cookie = `googtrans=${value}; path=/; domain=${window.location.hostname}`
}

// Clear translation
function clearTranslation() {
  // Remove the googtrans cookie
  document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
  document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname}`

  // Reload to show original content
  window.location.reload()
}

function translateTo(lang) {
  // Set the cookie for the target language
  setTranslationCookie(lang.code)

  selectedLang.value = lang
  isOpen.value = false
  isTranslated.value = true

  // Reload the page to trigger translation
  window.location.reload()
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
  const cookies = document.cookie.split(';')
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=')
    if (name === 'googtrans' && value && value !== '/en/en') {
      isTranslated.value = true
      // Extract language code from cookie value like "/en/fr"
      const langCode = value.split('/')[2]
      if (langCode) {
        selectedLang.value = languages.find(l => l.code === langCode) || { code: langCode, name: langCode }
      }
      return
    }
  }
  isTranslated.value = false
  selectedLang.value = null
}

onMounted(() => {
  loadGoogleTranslate()
  checkTranslationStatus()
  document.addEventListener('click', closeDropdown)
})

onUnmounted(() => {
  document.removeEventListener('click', closeDropdown)
})
</script>

<template>
  <div class="translate-container">
    <!-- Show "Back to English" button when translated -->
    <button
      v-if="isTranslated"
      class="translate-button back-button"
      @click="clearTranslation"
      title="Back to English"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      <span class="translate-label">English</span>
    </button>

    <!-- Main translate button -->
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
  gap: 8px;
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

.translate-button.back-button {
  border-color: var(--vp-c-divider);
  background: transparent;
}

.translate-button.back-button:hover {
  border-color: var(--vp-c-text-2);
  color: var(--vp-c-text-1);
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
  min-width: 160px;
  max-height: 320px;
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
</style>
