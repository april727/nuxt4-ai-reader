// https://nuxt.com/docs/api/configuration/nuxt-config
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
        { name: 'theme-color', content: '#0a0a1a' },
        { property: 'og:image', content: '/icon+title.png' },
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
  },
})
