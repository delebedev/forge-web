import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  core: {
    allowedHosts: process.env['VITE_ALLOWED_HOSTS']
      ?.split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  },
  framework: '@storybook/react-vite',
  viteFinal(config) {
    config.plugins = config.plugins?.filter((plugin) => {
      const name = Array.isArray(plugin) ? plugin[0]?.name : plugin?.name
      return name !== 'forge-web-dev-transcripts' && name !== 'forge-web-seo'
    })
    const publicPort = process.env['STORYBOOK_PUBLIC_PORT']
    if (publicPort && config.server) {
      config.server.hmr = {
        ...(typeof config.server.hmr === 'object' ? config.server.hmr : {}),
        clientPort: Number(publicPort),
      }
    }
    return config
  },
}
export default config
