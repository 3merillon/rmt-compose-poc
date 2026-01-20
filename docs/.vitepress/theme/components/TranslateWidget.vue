<script setup>
import { ref, computed } from 'vue'
import { useData } from 'vitepress'

const { page } = useData()
const isOpen = ref(false)
const selectedLang = ref(null)

const languages = [
  { code: 'es', name: 'Español' },
  { code: 'zh-CN', name: '中文 (简体)' },
  { code: 'zh-TW', name: '中文 (繁體)' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'it', name: 'Italiano' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
  { code: 'id', name: 'Bahasa Indonesia' }
]

const currentUrl = computed(() => {
  if (typeof window !== 'undefined') {
    return window.location.href
  }
  return ''
})

function translateTo(lang) {
  const url = currentUrl.value
  if (!url) return

  // Use Google Translate URL redirect
  const translateUrl = `https://translate.google.com/translate?sl=en&tl=${lang.code}&u=${encodeURIComponent(url)}`
  window.open(translateUrl, '_blank')

  selectedLang.value = lang
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
    <button
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

    <div v-if="isOpen" class="translate-dropdown" role="listbox">
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
