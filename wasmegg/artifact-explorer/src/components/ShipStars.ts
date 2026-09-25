// Star rating for a ship's level: a ban icon (level 0) followed by `max`
// stars. When interactive, clicking emits set(0..max). Render function
// rather than an SFC since it's almost entirely inline SVG.

import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'ShipStars',
  props: {
    level: { type: Number, required: true },
    max: { type: Number, required: true },
    interactive: { type: Boolean, default: false },
    label: { type: String, default: 'Ship' },
  },
  emits: ['set'],
  setup(props, { emit }) {
    return () => {
      const stars = [];
      stars.push(
        h(
          'svg',
          {
            viewBox: '0 0 512 512',
            class: [
              'h-3 w-3 text-gray-400 relative top-px mr-0.5 select-none',
              props.interactive ? 'cursor-pointer' : 'cursor-default opacity-50',
            ],
            'aria-hidden': 'true',
          },
          [
            h('path', {
              fill: 'currentColor',
              d: 'M256 8C119.034 8 8 119.033 8 256s111.034 248 248 248 248-111.034 248-248S392.967 8 256 8zm130.108 117.892c65.448 65.448 70 165.481 20.677 235.637L150.47 105.216c70.204-49.356 170.226-44.735 235.638 20.676zM125.892 386.108c-65.448-65.448-70-165.481-20.677-235.637L361.53 406.784c-70.203 49.356-170.226 44.736-235.638-20.676z',
            }),
          ]
        )
      );
      for (let i = 1; i <= props.max; i++) {
        const filled = i <= props.level;
        stars.push(
          h(
            'svg',
            {
              key: i,
              viewBox: '0 0 576 512',
              class: [
                'h-3.5 w-3.5 text-yellow-400 select-none',
                props.interactive ? 'cursor-pointer' : 'cursor-default',
              ],
              'aria-hidden': 'true',
            },
            [
              filled
                ? h('path', {
                    fill: 'currentColor',
                    d: 'M259.3 17.8L194 150.2 47.9 171.5c-26.2 3.8-36.7 36.1-17.7 54.6l105.7 103-25 145.5c-4.5 26.3 23.2 46 46.4 33.7L288 439.6l130.7 68.7c23.2 12.2 50.9-7.4 46.4-33.7l-25-145.5 105.7-103c19-18.5 8.5-50.8-17.7-54.6L382 150.2 316.7 17.8c-11.7-23.6-45.6-23.9-57.4 0z',
                  })
                : h('path', {
                    fill: 'currentColor',
                    d: 'M528.1 171.5L382 150.2 316.7 17.8c-11.7-23.6-45.6-23.9-57.4 0L194 150.2 47.9 171.5c-26.2 3.8-36.7 36.1-17.7 54.6l105.7 103-25 145.5c-4.5 26.3 23.2 46 46.4 33.7L288 439.6l130.7 68.7c23.2 12.2 50.9-7.4 46.4-33.7l-25-145.5 105.7-103c19-18.5 8.5-50.8-17.7-54.6zM388.6 312.3l23.7 138.4L288 385.4l-124.3 65.3 23.7-138.4-100.6-98 139-20.2 62.2-126 62.2 126 139 20.2-100.6 98z',
                  }),
            ]
          )
        );
      }
      return h(
        'div',
        { class: 'flex flex-wrap items-center', role: 'group', 'aria-label': `${props.label}: ${props.level} stars` },
        props.interactive
          ? stars.map((star, level) =>
              h(
                'button',
                {
                  type: 'button',
                  'aria-label': `${props.label}: set ${level} stars`,
                  'aria-pressed': props.level === level,
                  class:
                    'inline-flex items-center justify-center h-6 w-6 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:bg-gray-100',
                  onClick: () => emit('set', level),
                },
                [star]
              )
            )
          : stars
      );
    };
  },
});
