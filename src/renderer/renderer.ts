/**
 * @file Entry point for the Vue renderer process.
 * Initializes the Vue application, sets up global error handling, and mounts the root component.
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './assets/main.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

// Add global error handler
app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue Error]', err, info);
};

app.mount('#app');
