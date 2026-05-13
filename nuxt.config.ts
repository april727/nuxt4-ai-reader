// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  devtools: { enabled: true },

  css: ['~/assets/styles/main.css'],

  nitro: {
    experimental: {
      openAPI: true,
    },
  },

  features: {
    inlineStyles: (id) => id.includes('.vue'),
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
