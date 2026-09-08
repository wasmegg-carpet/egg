import { createRouter, createWebHashHistory } from 'vue-router';

import Main from '@/views/Main.vue';
import Mission from '@/views/Mission.vue';
import Artifact from '@/views/Artifact.vue';

const router = createRouter({
  routes: [
    {
      name: 'home',
      path: '/',
      component: Main,
      props: true,
      children: [
        {
          name: 'mission',
          path: 'mission/:missionId/',
          components: {
            mission: Mission,
          },
          props: true,
        },
        {
          name: 'artifact',
          path: 'artifact/:artifactId/',
          components: {
            artifact: Artifact,
          },
          props: true,
        },
      ],
    },
    // Inbound only. The selection no longer lives in the URL, but `Share` still writes links in
    // this shape and every one already out there has to keep resolving, so Main reads the ids out
    // of the param into the store and replaces the address with `/`.
    {
      name: 'tank',
      path: '/tank/:tankPlannerArtifactId/',
      component: Main,
      props: true,
    },
    {
      path: '/:catchAll(.*)',
      redirect: '/',
    },
  ],
  history: createWebHashHistory(),
  scrollBehavior() {
    // always scroll to top
    return { top: 0 };
  },
});

export default router;
