// https://nuxt.com/docs/api/configuration/nuxt-config
import { readFileSync } from 'node:fs'

// 全局样式内联进每个页面的 <head>：即使外链 CSS 被边缘网关拦截/缓存污染，布局也不会崩
const mainCss = readFileSync('app/assets/styles/main.css', 'utf-8')

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  devtools: { enabled: true },

  dir: {
    public: 'app/public',
  },

  css: ['~/assets/styles/main.css'],

  app: {
    head: {
      title: 'yu reader',
      link: [
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/icon.png' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icon.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/icon.png' },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0a0a1a' },
        { property: 'og:image', content: '/icon+title.png' },
      ],
      style: [
        { innerHTML: mainCss },
      ],
    },
  },

  runtimeConfig: {
    public: {
      disableLocalUpload: false,
    },
  },

  nitro: {
    experimental: {
      openAPI: true,
    },
  },

  features: {
    inlineStyles: (id) => id?.includes('.vue') ?? false,
  },

  typescript: {
    strict: true,
  },

  vite: {
    optimizeDeps: {
      include: [
        'marked',
        '@vue/devtools-core',
        '@vue/devtools-kit',
      ],
    },
    ssr: {
      noExternal: ['@libsql/client'],
    },
  },
})
