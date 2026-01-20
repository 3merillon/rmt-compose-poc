<script setup>
import { ref, computed, onMounted } from 'vue'

const isOpen = ref(false)
const isTranslated = ref(false)
const currentLang = ref(null)

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

onMounted(() => {
  // Check if we're inside Google Translate iframe
  checkIfTranslated()

  // Hide Google Translate UI elements
  hideGoogleTranslateUI()

  // Watch for Google Translate elements being added
  const observer = new MutationObserver(() => {
    hideGoogleTranslateUI()
  })
  observer.observe(document.body, { childList: true, subtree: true })
})

function checkIfTranslated() {
  if (typeof window === 'undefined') return

  // Check if we're in Google Translate frame (URL contains translate.goog)
  const isInTranslateFrame = window.location.hostname.includes('translate.goog')

  if (isInTranslateFrame) {
    isTranslated.value = true
    // Try to extract the target language from URL
    const urlParams = new URLSearchParams(window.location.search)
    const targetLang = urlParams.get('_x_tr_tl')
    if (targetLang) {
      currentLang.value = languages.find(l => l.code === targetLang) || { name: targetLang }
    }
  }
}

function hideGoogleTranslateUI() {
  if (typeof document === 'undefined') return

  // Hide Google Translate banner/bar
  const style = document.createElement('style')
  style.id = 'hide-google-translate-ui'
  if (!document.getElementById('hide-google-translate-ui')) {
    style.textContent = `
      /* Hide Google Translate top bar */
      .goog-te-banner-frame,
      .skiptranslate,
      #goog-gt-tt,
      .goog-te-balloon-frame,
      .goog-te-menu-frame,
      .goog-te-spinner-pos,
      div[id^="goog-gt-"],
      .VIpgJd-ZVi9od-ORHb-OEVmcd,
      .VIpgJd-ZVi9od-xl07Ob-OEVmcd,
      .VIpgJd-ZVi9od-SmfZ-OEVmcd,
      .VIpgJd-ZVi9od-aZ2wEe-OEVmcd,
      body > .skiptranslate,
      .goog-te-gadget {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        opacity: 0 !important;
      }

      /* Reset body position that Google Translate modifies */
      body {
        top: 0 !important;
        position: static !important;
      }

      /* Hide the floating Google Translate widget */
      .goog-te-gadget-simple,
      .goog-te-gadget-icon,
      #google_translate_element,
      .translated-ltr,
      .translated-rtl {
        display: none !important;
      }
    `
    document.head.appendChild(style)
  }

  // Remove body top offset that Google adds
  document.body.style.top = '0px'
}

function getOriginalUrl() {
  if (typeof window === 'undefined') return ''

  // Extract original URL from Google Translate URL
  // Format: https://docs-rmt-world.translate.goog/path?_x_tr_sl=en&_x_tr_tl=fr&_x_tr_hl=en&_x_tr_pto=wapp
  const hostname = window.location.hostname
  if (hostname.includes('translate.goog')) {
    // Convert docs-rmt-world.translate.goog back to docs.rmt.world
    const originalHost = hostname.replace('.translate.goog', '').replace(/-/g, '.')
    const path = window.location.pathname
    return `https://${originalHost}${path}`
  }
  return window.location.href
}

function backToOriginal() {
  const originalUrl = getOriginalUrl()
  if (originalUrl) {
    window.location.href = originalUrl
  }
}

function translateTo(lang) {
  if (typeof window === 'undefined') return

  // Get the current page URL (or original if already translated)
  let url = getOriginalUrl()

  // Use Google Translate URL redirect
  const translateUrl = `https://translate.google.com/translate?sl=en&tl=${lang.code}&u=${encodeURIComponent(url)}`
  window.location.href = translateUrl

  isOpen.value = false
}

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function closeDropdown(e) {
  if (!e.target.closest('.translate-container')) {
    isOpen.value = false
  }
}

// Close on click outside
if (typeof window !== 'undefined') {
  document.addEventListener('click', closeDropdown)
}
</script>

<template>
  <div class="translate-container">
    <!-- Back to English button (shown when translated) -->
    <button
      v-if="isTranslated"
      class="translate-button back-button"
      @click="backToOriginal"
      title="Back to English"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
      <span class="translate-label">English</span>
    </button>

    <!-- Translate dropdown (shown when not translated) -->
    <button
      v-else
      class="translate-button"
      @click.stop="toggleDropdown"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      title="Translate this page"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>
      <span class="translate-label">Translate</span>
      <svg class="chevron" :class="{ open: isOpen }" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>

    <div v-if="isOpen && !isTranslated" class="translate-dropdown" role="listbox">
      <button
        v-for="lang in languages"
        :key="lang.code"
        class="translate-option"
        role="option"
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
  transition: border-color 0.25s, color 0.25s;
}

.translate-button:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.back-button {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.back-button:hover {
  background: var(--vp-c-brand-soft);
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
</style>
