import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.trenchsports.demo',
  appName: 'Trench Demo',
  webDir: 'dist',
  server: {
    url: 'https://trench-sports-front-end.vercel.app',
    cleartext: false
  }
};

export default config;
