import { createApp } from 'vue';
import { createPinia } from 'pinia';
import VueTippy from 'vue-tippy';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/translucent.css';

import App from './App.vue';
import './index.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(VueTippy, {
  defaultProps: {
    theme: 'translucent',
    delay: [0, 0],
  },
});
app.mount('#app');
