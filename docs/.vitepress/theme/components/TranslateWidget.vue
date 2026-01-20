<script setup>
import { onMounted } from 'vue'

// Load Google Translate script following Google's best practices
function loadGoogleTranslate() {
  if (document.getElementById('google-translate-script')) return

  // Define the callback - this is Google's standard pattern
  window.googleTranslateElementInit = function() {
    new window.google.translate.TranslateElement(
      {
        pageLanguage: 'en',
        includedLanguages: 'fr,de,es,it,pt,nl,ca,gl,eu,sv,da,no,fi,is,pl,cs,sk,hu,ro,bg,hr,sl,sr,uk,ru,lt,lv,et,el,tr,zh-CN,zh-TW,ja,ko,hi,th,vi,id,ar,he',
        layout: google.translate.TranslateElement.InlineLayout.HORIZONTAL,
        autoDisplay: false
      },
      'google_translate_element'
    )
  }

  // Load the script
  const script = document.createElement('script')
  script.id = 'google-translate-script'
  script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
  document.head.appendChild(script)
}

onMounted(() => {
  loadGoogleTranslate()
})
</script>

<template>
  <div class="translate-widget-wrapper">
    <div id="google_translate_element"></div>
  </div>
</template>

<style scoped>
.translate-widget-wrapper {
  margin-left: 12px;
  display: flex;
  align-items: center;
}

@media (min-width: 1200px) {
  .translate-widget-wrapper {
    margin-left: 16px;
  }
}
</style>
