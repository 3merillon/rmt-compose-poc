<script setup>
import DefaultTheme from 'vitepress/theme'
import TranslateWidget from './components/TranslateWidget.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #nav-bar-content-after>
      <ClientOnly>
        <TranslateWidget />
      </ClientOnly>
    </template>
  </Layout>
</template>
