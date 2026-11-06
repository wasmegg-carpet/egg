/**
 * Regular (non-virtue) vehicle and train car base prices, before any discount.
 *
 * Source: "The price of virtue" sheet, Vehicles tab
 * (docs.google.com/spreadsheets/d/1wE6ZEJsytkvvJzc39Yutzrbn1oNmW8FOeP_bsnSo1UM, gid 1191937644).
 * Each value is column F ("Normal cost"), or column E / 0.45 when E shows more digits.
 * E is F × 0.5 × 0.9: max Bust Unions plus max vehicle-cost colleggtible, no sale.
 *
 * VEHICLE_REGULAR_COSTS[vehicleId][n] is the price of the (n+1)th vehicle of that type,
 * the same indexing as virtueCost in lib/farm/shipping_capacity.ts.
 * HYPERLOOP_CAR_REGULAR_COSTS[n] is the price of car n (car 0 comes with the train).
 */

export const VEHICLE_REGULAR_COSTS: readonly (readonly number[])[] = [
  // vehicle_00 Trike
  [0, 22.42, 40.33, 65.51, 100.4, 147.711, 210.378, 293, 400, 536, 711, 929, 1198, 1533, 1940, 2438, 3031],
  // vehicle_01 Transit Van
  [544, 1062, 1931, 3318, 5453, 8636, 13249, 19804, 28898, 41227, 57760, 79642, 107931, 144569, 190824, 249351, 321947],
  // vehicle_02 Pickup
  [
    52869, 232658, 774342, 2.12881e6, 5.09325e6, 1.09892e7, 2.17847e7, 4.04502e7, 7.11256e7, 1.19425e8, 1.9281e8,
    3.00964e8, 4.56289e8, 6.74833e8, 9.75767e8, 1.38108e9, 1.92011e9,
  ],
  // vehicle_03 10 Foot
  [
    1.49624e7, 2.85688e7, 5.13588e7, 8.79236e7, 1.44366e8, 2.28722e8, 3.51478e8, 5.25573e8, 7.66749e8, 1.09475e9,
    1.53593e9, 2.11705e9, 2.871e9, 3.847e9, 5.078e9, 6.633e9, 8.567e9,
  ],
  // vehicle_04 24 Foot
  [
    4.358e9, 3.9578e10, 2.02667e11, 7.41131e11, 2.17364e12, 5.447e12, 1.2136e13, 2.4742e13, 4.6853e13, 8.3684e13,
    1.42387e14, 2.32424e14, 3.66151e14, 5.59462e14, 8.32804e14, 1.21052e15, 1.7215e15,
  ],
  // vehicle_05 Semi
  [
    5.8162e13, 4.99267e14, 2.469e15, 8.838e15, 2.5458e16, 6.3011e16, 1.39022e17, 2.80624e17, 5.27727e17, 9.37324e17,
    1.58613e18, 2.576e18, 4.04e18, 6.149e18, 9.111e18, 1.32e19, 1.8738e19,
  ],
  // vehicle_06 Double Semi
  [
    5.93971e17, 4.787e18, 2.2827e19, 7.972e19, 2.2576e20, 5.51162e20, 1.20246e21, 2.409e21, 4.493e21, 7.931e21,
    1.3349e22, 2.1582e22, 3.3711e22, 5.1111e22, 7.5542e22, 1.09151e23, 1.54364e23,
  ],
  // vehicle_07 Future Semi
  [
    5.082e21, 4.028e22, 1.90036e23, 6.57867e23, 1.8529e24, 4.5e24, 9.78e24, 1.9531e25, 3.6309e25, 6.3542e25, 1.06013e26,
    1.69918e26, 2.63224e26, 3.96113e26, 5.8106e26, 8.32791e26, 1.16944e27,
  ],
  // vehicle_08 Mega Semi
  [
    3.3473e25, 2.34249e26, 1.0188e27, 3.331e27, 8.991e27, 2.1113e28, 4.4664e28, 8.7127e28, 1.59187e29, 2.75411e29,
    4.555e29, 7.25347e29, 1.11805e30, 1.67481e30, 2.447e30, 3.493e30, 4.896e30,
  ],
  // vehicle_09 Hover Semi
  [
    1.61698e30, 2.5842e31, 1.73191e32, 7.38431e32, 2.382e33, 6.369e33, 1.4813e34, 3.0993e34, 5.9547e34, 1.07064e35,
    1.82189e35, 2.96027e35, 4.62591e35, 6.99102e35, 1.02636e36, 1.46941e36, 2.05892e36,
  ],
  // vehicle_10 Quantum Transporter
  [
    5.576e33, 1.1744e34, 2.2731e34, 4.1124e34, 7.0411e34, 1.15064e35, 1.80758e35, 2.74518e35, 4.049e35, 5.82296e35,
    8.19384e35, 1.12948e36, 1.5287e36, 2.0383e36, 2.678e36, 3.469e36, 4.447e36,
  ],
  // vehicle_11 Hyperloop Train
  [
    2.1124e37, 3.06009e38, 1.71962e39, 6.467e39, 1.944e40, 4.9129e40, 1.09129e41, 2.19662e41, 4.09964e41, 7.18744e41,
    1.19767e42, 1.91393e42, 2.951e42, 4.413e42, 6.427e42, 9.142e42, 1.2738e43,
  ],
];

export const HYPERLOOP_CAR_REGULAR_COSTS: readonly number[] = [
  0, 1.95907e36, 1.5202e37, 6.6136e37, 2.06793e38, 5.22482e38, 1.1381e39, 2.227e39, 4.109e39, 7.209e39,
];
