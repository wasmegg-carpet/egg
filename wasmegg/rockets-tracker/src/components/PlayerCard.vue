<template>
  <div class="mx-4 xl:mx-0 my-4">
    <div class="relative max-w-xs mx-auto px-3 sm:px-4 py-1 text-center bg-gray-50 rounded-xl shadow">
      <button
        type="button"
        class="absolute p-1 top-2 right-2 sm:right-3 select-none focus:outline-none"
        @click="toggleCollapse"
      >
        <!-- fa: solid/compress-arrows-alt -->
        <svg v-if="!collapsed" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="h-3 w-3 text-gray-500">
          <path
            fill="currentColor"
            d="M200 288H88c-21.4 0-32.1 25.8-17 41l32.9 31-99.2 99.3c-6.2 6.2-6.2 16.4 0 22.6l25.4 25.4c6.2 6.2 16.4 6.2 22.6 0L152 408l31.1 33c15.1 15.1 40.9 4.4 40.9-17V312c0-13.3-10.7-24-24-24zm112-64h112c21.4 0 32.1-25.9 17-41l-33-31 99.3-99.3c6.2-6.2 6.2-16.4 0-22.6L481.9 4.7c-6.2-6.2-16.4-6.2-22.6 0L360 104l-31.1-33C313.8 55.9 288 66.6 288 88v112c0 13.3 10.7 24 24 24zm96 136l33-31.1c15.1-15.1 4.4-40.9-17-40.9H312c-13.3 0-24 10.7-24 24v112c0 21.4 25.9 32.1 41 17l31-32.9 99.3 99.3c6.2 6.2 16.4 6.2 22.6 0l25.4-25.4c6.2-6.2 6.2-16.4 0-22.6L408 360zM183 71.1L152 104 52.7 4.7c-6.2-6.2-16.4-6.2-22.6 0L4.7 30.1c-6.2 6.2-6.2 16.4 0 22.6L104 152l-33 31.1C55.9 198.2 66.6 224 88 224h112c13.3 0 24-10.7 24-24V88c0-21.3-25.9-32-41-16.9z"
          />
        </svg>
        <!-- fa: solid/expand-arrows-alt -->
        <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="h-3 w-3 text-gray-500">
          <path
            fill="currentColor"
            d="M448 344v112a23.94 23.94 0 0 1-24 24H312c-21.39 0-32.09-25.9-17-41l36.2-36.2L224 295.6 116.77 402.9 153 439c15.09 15.1 4.39 41-17 41H24a23.94 23.94 0 0 1-24-24V344c0-21.4 25.89-32.1 41-17l36.19 36.2L184.46 256 77.18 148.7 41 185c-15.1 15.1-41 4.4-41-17V56a23.94 23.94 0 0 1 24-24h112c21.39 0 32.09 25.9 17 41l-36.2 36.2L224 216.4l107.23-107.3L295 73c-15.09-15.1-4.39-41 17-41h112a23.94 23.94 0 0 1 24 24v112c0 21.4-25.89 32.1-41 17l-36.19-36.2L263.54 256l107.28 107.3L407 327.1c15.1-15.2 41-4.5 41 16.9z"
          />
        </svg>
      </button>

      <div class="divide-y divide-gray-200">
        <div class="py-2">
          <div class="flex items-center justify-center space-x-1 mx-6">
            <img
              :src="iconURL(hasProPermit ? 'egginc/pro_permit.png' : 'egginc/free_permit.png', 128)"
              class="h-4 flex-shrink-0"
            />
            <span class="font-serif truncate">{{ nickname }}</span>
            <img
              v-if="hasEnlightenmentDiamondTrophy"
              v-tippy="{ content: 'Proud owner of the enlightenment diamond trophy.' }"
              :src="iconURL('egginc/icon_trophy_diamond.png', 128)"
              class="h-4 w-4 flex-shrink-0"
            />
            <img
              v-if="hasNAH"
              v-tippy="{ content: 'Proud owner of the Nobel Prize in Animal Husbandry®' }"
              :src="badgeNAH"
              class="h-4"
            />
            <img
              v-else-if="hasLegacyNAH"
              v-tippy="{
                content: 'Proud owner of the Nobel Prize in Animal Husbandry® (Legacy Edition)',
              }"
              :src="badgeNAHLegacy"
              class="h-4"
            />
            <img v-if="hasFED" v-tippy="{ content: 'Full Egg Dedication' }" :src="badgeFED" class="h-4" />

            <img
              v-if="artifactClub === ArtifactClub.ZERO_LEGENDARY_CLUB"
              v-tippy="{ content: 'Zero Legendary Club' }"
              class="h-4"
              :src="badgeZLC"
            />
            <img
              v-if="artifactClub === ArtifactClub.ZERO_LEGENDARY_CLUB_100"
              v-tippy="{
                content: `Zero Legendary Club <span class='brightness-0 invert'>&#x1f4af;</span>`,
                allowHTML: true,
              }"
              class="h-4"
              :src="badgeZLC100"
            />
            <img
              v-if="artifactClub === ArtifactClub.ZERO_LEGENDARY_CLUB_7STAR"
              v-tippy="{
                content: `Zero Legendary Club 7&#x2605;<br/>(you have been put on a performance improvement plan)`,
                allowHTML: true,
              }"
              class="h-4"
              :src="badgeZLC7star"
            />
            <img
              v-else-if="artifactClub === ArtifactClub.ALL_LEGENDARIES_CLUB"
              v-tippy="{ content: 'All Legendaries Club' }"
              class="h-4"
              :src="badgeALC"
            />
            <img
              v-else-if="artifactClub === ArtifactClub.STAFF_LEGENDARIES_CLUB"
              v-tippy="{ content: 'Staff Legendaries Club' }"
              class="h-4"
              :src="badgeSLC"
            />

            <img
              v-if="shipClub === ShipClub.ALL_STAR_CLUB"
              v-tippy="{ content: 'All Star Club' }"
              class="h-4"
              :src="badgeASC"
            />

            <img
              v-if="isZLCRecordHolder"
              v-tippy="{
                content: `
                <div class='flex items-center space-x-2'>
                <img src='${encodeURI(
                  medalZLCRecord
                )}' class='inline h-8 w-8 p-0.5 bg-gray-100 rounded flex-shrink-0' />
                <span>ZLC World Record (${zlcExthenRecord}) holder.</span>
                </div>`,
                allowHTML: true,
              }"
              class="h-4"
              :src="medalZLCRecord"
            />
            <img
              v-if="isZLCRecordCloseFollower"
              v-tippy="{
                content: `
                <div class='flex items-center space-x-2'>
                <img src='${encodeURI(
                  medalZLCRecordGrayscale
                )}' class='inline h-8 w-8 p-0.5 bg-gray-100 rounded flex-shrink-0' />
                <span>ZLC World Record (${zlcExthenRecord}) close follower.
                Your medal will light up when you hold the record.</span>
                </div>`,
                allowHTML: true,
              }"
              class="h-4"
              :src="medalZLCRecordGrayscale"
            />
            <img v-if="didGoodJob" v-tippy="{ content: 'Good Job.' }" :src="badgeGoodJob" class="h-4" />
          </div>

          <div class="mt-1">
            <div class="text-xs">
              Last synced to server:
              <span
                v-tippy="{ content: `${lastRefreshed.format('LLL')}, client version ${version}` }"
                class="whitespace-nowrap"
              >
                {{ lastRefreshedRelative }}
              </span>
            </div>
            <div
              v-tippy="{
                content: `
                <p>The game, while active, saves to Egg, Inc.&rsquo;s server every couple of minutes if network condition allows.
                Other than soon after a fresh launch of the game, such server syncs are unpredictable from the user&rsquo;s point of view.
                <span class='text-blue-300'>You can force close then reopen the app to reasonably reliably trigger a sync</span>
                (search for &ldquo;iOS force close app&rdquo; or &ldquo;Android force close app&rdquo; if you need help).</p>

                <p>However, even after an app-initiated sync, it may take an unpredicatible amount of time
                (usually within a minute or so) for the game&rsquo;s server to serve the updated save through its API,
                which is then picked up by this tool. There is no solution other than clicking &ldquo;Load Player Data&rdquo;
                periodically until the fresh save shows up. Please do not refresh too fast, which is not helpful.</p>`,
                allowHTML: true,
              }"
              class="flex items-center justify-center space-x-1"
            >
              <span class="text-xs text-gray-500">Why is my save out of date?</span>
              <base-info />
            </div>
          </div>
        </div>

        <div v-if="!collapsed" class="py-2">
          <div class="flex flex-wrap items-center justify-center">
            <span class="flex whitespace-nowrap mr-1">
              <img :src="iconURL('egginc/egg_truth.png', 64)" class="inline h-5 w-5" />
              <span class="text-sm text-yellow-500">{{ truthEggs }}</span>
            </span>
            <span class="flex whitespace-nowrap mr-1">
              <img :src="iconURL('egginc/egg_of_prophecy.png', 64)" class="inline h-5 w-5" />
              <span class="text-sm text-yellow-500">{{ prophecyEggs }}</span>
            </span>
            <span class="flex whitespace-nowrap">
              <img :src="iconURL('egginc/egg_soul.png', 64)" class="inline h-5 w-5" />
              <span class="text-sm text-purple-500">{{ formatEIValue(soulEggs) }}</span>
            </span>
          </div>

          <div class="mt-1 mb-1">
            <dt class="text-sm font-medium">Earning Bonus</dt>
            <dd class="flex items-center justify-center text-sm space-x-0.5 -my-px">
              <span :style="{ color: role.color }">{{ formatEIValue(earningBonus * 100) }}%,</span>
              <span :style="{ color: role.color }">{{ role.name }}</span>
              <base-info
                v-tippy="{
                  content:
                    'This is the ‘naked’ earning bonus without artifacts. The label after the EB is the corresponding role used in the Egg, Inc. Discord server.',
                }"
              />
            </dd>
          </div>

          <div v-if="!collapsed" class="grid gap-x-2 justify-center" :style="{ gridTemplateColumns: '50% 50%' }">
            <dt class="text-right text-sm font-medium whitespace-nowrap">Trophies</dt>
            <dd class="flex items-center text-left text-sm text-gray-900">
              {{ trophies }}/95,
              <img :src="iconURL('egginc/egg_of_prophecy.png', 64)" class="h-4 w-4" />
              <span class="text-yellow-500">
                {{ prophecyEggsProgress.fromTrophies.completed }}/{{ prophecyEggsProgress.fromTrophies.available }}
              </span>
            </dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Daily gifts</dt>
            <dd class="flex items-center text-left text-sm text-gray-900">
              M{{ dailyGifts.onMonth }}D{{ dailyGifts.onDay }},
              <img :src="iconURL('egginc/egg_of_prophecy.png', 64)" class="h-4 w-4" />
              <span class="text-yellow-500">
                {{ prophecyEggsProgress.fromDailyGifts.completed }}/{{ prophecyEggsProgress.fromDailyGifts.available }}
              </span>
            </dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Contracts</dt>
            <dd class="flex items-center text-left text-sm text-gray-900">
              <a
                :href="`https://wasmegg-carpet.netlify.app/past-contracts/?playerId=${userId}`"
                target="_blank"
                class="flex items-center"
              >
                <img :src="iconURL('egginc/egg_of_prophecy.png', 64)" class="h-4 w-4 -ml-0.5" />
                <span class="text-yellow-500 underline">
                  {{ prophecyEggsProgress.fromContracts.completed }}
                </span>
                <svg class="h-3.5 w-3.5 text-gray-500 hover:text-gray-600 ml-1" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"
                  />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </a>
            </dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Seasons</dt>
            <dd class="flex items-center text-left text-sm text-gray-900">
              <a
                :href="`https://wasmegg-carpet.netlify.app/past-contracts/?playerId=${userId}`"
                target="_blank"
                class="flex items-center"
              >
                <img :src="iconURL('egginc/egg_of_prophecy.png', 64)" class="h-4 w-4 -ml-0.5" />
                <span class="text-yellow-500 underline">
                  {{ prophecyEggsProgress.fromContractSeasons.completed }}
                </span>
                <svg class="h-3.5 w-3.5 text-gray-500 hover:text-gray-600 ml-1" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"
                  />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </a>
            </dd>
          </div>
        </div>

        <div v-if="!collapsed" class="py-2">
          <div class="grid gap-x-2 justify-center" :style="{ gridTemplateColumns: '50% 50%' }">
            <dt class="text-right text-sm font-medium whitespace-nowrap">Lifetime resets</dt>
            <dd class="text-left text-sm text-gray-900">{{ fmt(numResets) }}</dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Current shifts</dt>
            <dd class="text-left text-sm text-gray-900">{{ fmt(numShifts) }}</dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Next shift cost</dt>
            <dd class="text-left text-sm text-purple-500">
              {{ fmtApprox(nextShiftCost) }}
              <img :src="iconURL('egginc/egg_soul.png', 64)" class="inline h-4 w-4" />
            </dd>
          </div>
          <a
            :href="`https://wasmegg-carpet.netlify.app/virtue-companion/?playerId=${userId}`"
            target="_blank"
            class="flex items-center justify-center space-x-0.5 text-xs"
            :class="true ? 'text-green-500 hover:text-green-600' : 'text-gray-500 hover:text-gray-600'"
          >
            <span class="underline">Your virtue companion</span>
            <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"
              />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
          </a>
        </div>

        <div v-if="!collapsed" class="py-2 grid gap-x-2 justify-center" :style="{ gridTemplateColumns: '50% 50%' }">
          <div class="text-right text-sm font-medium whitespace-nowrap">Lifetime earned</div>
          <div class="flex items-center text-left text-sm text-gray-900">
            <img :src="iconURL('egginc-extras/icon_golden_egg.png', 128)" class="flex-shrink-0 h-4 w-4 -ml-0.5" />
            <span v-tippy="{ content: formatEIValue(lifetimeGoldenEggsEarned) }" class="truncate">
              {{ fmt(lifetimeGoldenEggsEarned) }}
            </span>
          </div>

          <div class="text-right text-sm font-medium whitespace-nowrap">Lifetime spent</div>
          <div class="flex items-center text-left text-sm text-gray-900">
            <img :src="iconURL('egginc-extras/icon_golden_egg.png', 128)" class="flex-shrink-0 h-4 w-4 -ml-0.5" />
            <span v-tippy="{ content: formatEIValue(lifetimeGoldenEggsSpent) }" class="truncate">
              {{ fmt(lifetimeGoldenEggsSpent) }}
            </span>
          </div>

          <div class="text-right text-sm font-medium whitespace-nowrap">Crafting expenses</div>
          <div class="flex items-center text-left text-sm text-gray-900">
            <img :src="iconURL('egginc-extras/icon_golden_egg.png', 128)" class="flex-shrink-0 h-4 w-4 -ml-0.5" />
            <span v-tippy="{ content: formatEIValue(goldenEggsSpentOnCrafting) }" class="truncate">
              ~{{ fmt(goldenEggsSpentOnCrafting) }}
            </span>
            <base-info
              v-tippy="{
                content: `This estimate <span class='text-blue-300'>does not take into discounts from crafting sales</span> (as the save file simply does not have that level of granularity). It may also be inaccurate if crafting cost parameters were ever changed server-side.<br>Note that <span class='text-blue-300'>stone-setting expenses are not included</span>, again because the history is not available.`,
                allowHTML: true,
              }"
              class="flex-shrink-0 ml-0.5"
            />
          </div>

          <div class="text-right text-sm font-medium whitespace-nowrap">Current balance</div>
          <div class="flex items-center text-left text-sm text-gray-900">
            <img :src="iconURL('egginc-extras/icon_golden_egg.png', 128)" class="flex-shrink-0 h-4 w-4 -ml-0.5" />
            <span v-tippy="{ content: formatEIValue(currentGoldenEggsBalance) }" class="truncate">
              {{ fmt(currentGoldenEggsBalance) }}
            </span>
          </div>

          <div class="text-right text-sm font-medium whitespace-nowrap">
            Piggy, <span class="text-purple-500">Level {{ piggyLevel }}</span>
          </div>
          <div class="flex items-center text-left text-sm text-gray-900">
            <img :src="iconURL('egginc-extras/icon_golden_egg.png', 128)" class="flex-shrink-0 h-4 w-4 -ml-0.5" />
            <span v-tippy="{ content: formatEIValue(piggyGoldenEggs) }" class="truncate">
              {{ fmt(piggyGoldenEggs) }}
            </span>
          </div>

          <div class="text-right text-sm font-medium whitespace-nowrap">Lost Piggy Increments</div>
          <div class="flex items-center text-left text-sm text-gray-900">
            <img :src="iconURL('egginc-extras/icon_golden_egg.png', 128)" class="flex-shrink-0 h-4 w-4 -ml-0.5" />
            <span v-tippy="{ content: formatEIValue(piggyLostIncrements) }" class="truncate">
              {{ fmt(piggyLostIncrements) }}
            </span>
          </div>
          <div class="text-right text-sm font-medium whitespace-nowrap">Date Piggy filled</div>
          <div class="flex items-center text-left text-sm text-gray-900">
            <span v-if="piggyFullDate > 0" v-tippy="{ content: dayjs.unix(piggyFullDate).fromNow() }">
              {{ dayjs.unix(piggyFullDate).utc().format('YYYY-MM-DD HH:MM') }}
            </span>
            <span v-else> Not Full </span>
          </div>
        </div>

        <div v-if="!collapsed" class="py-2">
          <div class="grid gap-x-2 justify-center" :style="{ gridTemplateColumns: '50% 50%' }">
            <dt class="text-right text-sm font-medium whitespace-nowrap">Lifetime prestiges</dt>
            <dd class="text-left text-sm text-gray-900">{{ fmt(numPrestiges) }}</dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Rockets launched</dt>
            <dd class="text-left text-sm text-gray-900">{{ fmt(numMissions) }}</dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Virtue rockets launched</dt>
            <dd class="text-left text-sm text-gray-900">{{ fmt(numVirtueMissions) }}</dd>

            <template v-if="daysSinceFirstMission >= 0">
              <dt class="text-right text-sm font-medium whitespace-nowrap">Days since 1st ship</dt>
              <dd class="text-left text-sm text-gray-900">{{ fmt(daysSinceFirstMission) }}</dd>
            </template>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Inventory score</dt>
            <dd class="flex items-center text-sm text-gray-900">
              {{ fmt(inventoryScore) }}
              <base-info
                v-tippy="{
                  content: `The inventory score is an internal value used to determine the outer appearance of the hall of artifacts. The hall expands from two to four segments once the score reaches 2,000, and the segments become colored once the score reaches 10,000. <span class='text-blue-300'>The effect of this score is entirely cosmetic.</span>`,
                  allowHTML: true,
                }"
                class="inline ml-0.5"
              />
            </dd>

            <dt
              v-tippy="{ content: 'Inventory consumption value' }"
              class="text-right text-sm font-medium whitespace-nowrap"
            >
              Inv. consume value
            </dt>
            <div class="flex items-center text-left text-sm text-gray-900">
              <img :src="iconURL('egginc-extras/icon_golden_egg.png', 128)" class="flex-shrink-0 h-4 w-4 -ml-0.5" />
              <dd class="flex items-center text-sm text-gray-900">
                {{ fmtApprox(inventoryConsumptionValue[0]) }}
                <img
                  :src="iconURL('egginc-extras/icon_piggy_golden_egg.png', 128)"
                  class="flex-shrink-0 h-4 w-4 ml-1.5"
                />
                {{ fmtApprox(inventoryConsumptionValue[1]) }}
                <base-info
                  v-tippy="{
                    content: `The inventory consumption value is an approximation of the expected number of GE and Piggy Fill that can be earned from fully (recursively) consuming everything in the inventory.
                  <span class='text-blue-300'>You can view detailed consumption outcomes in “Consumption sheet” on this site.</span>
                  Due to difficulty sampling consumption data of uncommon items, the calculation assumes you <span class='text-green-300'>demote them first</span>, with <span class='text-green-300'>demotion gold counting towards the total</span>.
                  This also does not include any uncapped piggy fill due to difficulty calculating that. As such this will be a vast underestimate during Unlimited Piggy Events.`,
                    allowHTML: true,
                  }"
                  class="inline ml-0.5"
                />
              </dd>
            </div>
            <dt
              v-tippy="{ content: fmtCraftingXpRarityMultiplier(craftingLevel) }"
              class="text-right text-sm font-medium whitespace-nowrap"
            >
              Crafting XP, <span class="text-yellow-500">Level {{ craftingLevel.level }}</span>
            </dt>
            <dd
              v-tippy="{
                content: craftingLevel.level === 30 ? 'Crafting Legend' : fmt(nextLevelXP - craftingXp),
              }"
              class="text-left text-sm text-gray-900"
            >
              {{ fmt(craftingXp) }}
            </dd>
          </div>
        </div>

        <div v-if="!collapsed" class="py-2">
          <div class="text-sm font-medium">Inventory items</div>

          <a
            :href="`https://wasmegg-carpet.netlify.app/inventory-visualizer/?playerId=${userId}`"
            target="_blank"
            class="flex items-center justify-center space-x-0.5 text-xs"
            :class="true ? 'text-green-500 hover:text-green-600' : 'text-gray-500 hover:text-gray-600'"
          >
            <span class="underline">Visualize and share your inventory</span>
            <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"
              />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
          </a>

          <!-- Standard Inventory -->
          <div class="text-xs font-medium text-gray-600 mt-2">Standard</div>
          <dl class="grid gap-x-4 justify-center mt-1" :style="{ gridTemplateColumns: 'repeat(4, min-content)' }">
            <div>
              <dt class="text-xs font-medium text-gray-900">Total</dt>
              <dd class="text-sm text-gray-900">{{ fmt(inventory.totalCount) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium text-blue-500">Rare</dt>
              <dd class="text-sm text-blue-500">{{ fmt(inventory.rareCount) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium text-purple-500">Epic</dt>
              <dd class="text-sm text-purple-500">{{ fmt(inventory.epicCount) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium text-yellow-500">Legendary</dt>
              <dd class="text-sm text-yellow-500">{{ fmt(inventory.legendaryCount) }}</dd>
            </div>
          </dl>
          <div v-if="inventory.epicCount > 0" class="mt-1 flex flex-wrap justify-center space-y-0.5">
            <template v-for="family in inventory.catalog" :key="family.afxId">
              <template v-for="tier in family.tiers" :key="tier.id">
                <div
                  v-if="tier.haveEpic > 0"
                  v-tippy="{ content: `Epic ${tier.name} \u00d7 ${tier.haveEpic}` }"
                  class="h-6 w-6 mx-0.5 my-0.5 relative"
                >
                  <img :src="iconURL(tier.iconPath, 128)" class="h-6 w-6 p-0.5 rounded-full bg-epic" />
                  <div v-if="tier.haveEpic > 1" :class="'artifact-count ' + numToDigClass(tier.haveEpic)">
                    {{ tier.haveEpic }}
                  </div>
                </div>
              </template>
            </template>
          </div>
          <div v-if="inventory.legendaryCount > 0" class="mt-1 flex flex-wrap justify-center space-y-0.5">
            <template v-for="family in inventory.catalog" :key="family.afxId">
              <template v-for="tier in family.tiers" :key="tier.id">
                <div
                  v-if="tier.haveLegendary > 0"
                  v-tippy="{ content: `Legendary ${tier.name} \u00d7 ${tier.haveLegendary}` }"
                  class="h-6 w-6 mx-0.5 my-0.5 relative"
                >
                  <img :src="iconURL(tier.iconPath, 128)" class="h-6 w-6 p-0.5 rounded-full bg-legendary" />
                  <div v-if="tier.haveLegendary > 1" :class="'artifact-count ' + numToDigClass(tier.haveLegendary)">
                    {{ tier.haveLegendary }}
                  </div>
                </div>
              </template>
            </template>
          </div>

          <div v-if="hasTooManyLegendaries" class="mt-2 text-xs text-yellow-500">
            <template v-if="randIndex % 5 === 0">
              You have been personally named in a class action lawsuit brought by major trade union
              <span class="whitespace-nowrap">Farmers Without Legendaries</span>.
            </template>
            <template v-else-if="randIndex % 5 === 1">
              The Secretary of Legendaries has launched an investigation into the unusual number of legendaries you
              possess.
            </template>
            <template v-else-if="randIndex % 5 === 2">
              The Holy Order of Zero Legendaries has sacrificed three high-legendary-count individuals in dark rituals
              over the past week. Watch your back!
            </template>
            <template v-else-if="randIndex % 5 === 3">
              The Gini coefficient of legendaries inequality has reached an all time high of 95%. You are part of the
              problem, and the poor have taken note!
            </template>
            <template v-else>
              You have too many legendaries.<br />Hide them well, or you may soon find jealous players with pitchforks
              at your doorstep.
            </template>
          </div>
          <template v-else-if="zeroLegendaryShaming && !zeroLegendaryUnconditionallyUnworthyNickname">
            <div class="mt-2 text-xs text-yellow-800 truncate">
              {{ completedExtendedHenerpriseCount }} extended Henerprises,
              {{ completedExtendedHenerpriseTotalDropCount }} drops,
            </div>
            <div class="flex items-center justify-center text-yellow-800">
              <span class="text-xs mr-0.5">\</span>
              <svg
                aria-hidden="true"
                focusable="false"
                data-prefix="fas"
                data-icon="poo"
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 512 512"
                class="h-4 w-4"
              >
                <path
                  fill="currentColor"
                  d="M451.4 369.1C468.7 356 480 335.4 480 312c0-39.8-32.2-72-72-72h-14.1c13.4-11.7 22.1-28.8 22.1-48 0-35.3-28.7-64-64-64h-5.9c3.6-10.1 5.9-20.7 5.9-32 0-53-43-96-96-96-5.2 0-10.2.7-15.1 1.5C250.3 14.6 256 30.6 256 48c0 44.2-35.8 80-80 80h-16c-35.3 0-64 28.7-64 64 0 19.2 8.7 36.3 22.1 48H104c-39.8 0-72 32.2-72 72 0 23.4 11.3 44 28.6 57.1C26.3 374.6 0 404.1 0 440c0 39.8 32.2 72 72 72h368c39.8 0 72-32.2 72-72 0-35.9-26.3-65.4-60.6-70.9zM192 256c17.7 0 32 14.3 32 32s-14.3 32-32 32-32-14.3-32-32 14.3-32 32-32zm159.5 139C341 422.9 293 448 256 448s-85-25.1-95.5-53c-2-5.3 2-11 7.8-11h175.4c5.8 0 9.8 5.7 7.8 11zM320 320c-17.7 0-32-14.3-32-32s14.3-32 32-32 32 14.3 32 32-14.3 32-32 32z"
                />
              </svg>
              <span class="text-xs mx-1.5">zero legendary</span>
              <svg
                aria-hidden="true"
                focusable="false"
                data-prefix="fas"
                data-icon="poo"
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 512 512"
                class="h-4 w-4"
              >
                <path
                  fill="currentColor"
                  d="M451.4 369.1C468.7 356 480 335.4 480 312c0-39.8-32.2-72-72-72h-14.1c13.4-11.7 22.1-28.8 22.1-48 0-35.3-28.7-64-64-64h-5.9c3.6-10.1 5.9-20.7 5.9-32 0-53-43-96-96-96-5.2 0-10.2.7-15.1 1.5C250.3 14.6 256 30.6 256 48c0 44.2-35.8 80-80 80h-16c-35.3 0-64 28.7-64 64 0 19.2 8.7 36.3 22.1 48H104c-39.8 0-72 32.2-72 72 0 23.4 11.3 44 28.6 57.1C26.3 374.6 0 404.1 0 440c0 39.8 32.2 72 72 72h368c39.8 0 72-32.2 72-72 0-35.9-26.3-65.4-60.6-70.9zM192 256c17.7 0 32 14.3 32 32s-14.3 32-32 32-32-14.3-32-32 14.3-32 32-32zm159.5 139C341 422.9 293 448 256 448s-85-25.1-95.5-53c-2-5.3 2-11 7.8-11h175.4c5.8 0 9.8 5.7 7.8 11zM320 320c-17.7 0-32-14.3-32-32s14.3-32 32-32 32 14.3 32 32-14.3 32-32 32z"
                />
              </svg>
              <span class="text-xs ml-0.5">/</span>
            </div>
            <div
              v-if="isZLCRecordHolder"
              class="mt-1 flex items-center justify-center text-xs text-yellow-800 truncate"
            >
              Congrats on setting the world record!
              <img :src="medalZLCRecord" class="inline h-4 w-4 ml-0.5" />
            </div>
            <div
              v-if="isZLCRecordCloseFollower"
              class="mt-1 flex items-center justify-center text-xs text-yellow-800 truncate"
            >
              {{ zlcExthenRecord - completedExtendedHenerpriseCount }} short of the current record&nbsp;
              <img :src="medalZLCRecord" class="inline h-4 w-4 mr-0.5" />
              <a
                href="https://wasmegg-carpet.netlify.app/legendary-study"
                target="_blank"
                class="hover:text-yellow-900"
              >
                {{ zlcExthenRecord }}
              </a>
            </div>
          </template>
          <div v-else-if="zeroLegendaryUnconditionallyUnworthyNickname" class="mt-2 text-xs text-gray-500">
            Howdy {{ zeroLegendaryUnconditionallyUnworthyNickname }}, I heard you prefer not being poop-worthy. So I'm
            happy to inform you that you're not.<br />
            Keep <s>defecating</s> launching.
          </div>
          <div v-else-if="zeroLegendaryUnworthyNickname" class="mt-2 text-xs text-gray-500">
            No {{ zeroLegendaryUnworthyNickname }}, you haven't sent enough exthens.<br />
            You aren't poop-worthy.<br />
            Keep <s>defecating</s> launching.
          </div>
          <a
            href="https://wasmegg-carpet.netlify.app/legendary-study"
            target="_blank"
            class="flex items-center justify-center space-x-0.5 text-xs text-gray-500 hover:text-gray-600 mt-1"
          >
            <span class="underline">How you fare against other players</span>
            <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"
              />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
          </a>
        </div>

        <div v-if="!collapsed" class="py-2">
          <div class="text-sm font-medium">Virtue inventory items</div>
          <dl class="grid gap-x-4 justify-center mt-1" :style="{ gridTemplateColumns: 'repeat(4, min-content)' }">
            <div>
              <dt class="text-xs font-medium text-gray-900">Total</dt>
              <dd class="text-sm text-gray-900">{{ fmt(virtueInventory.totalCount) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium text-blue-500">Rare</dt>
              <dd class="text-sm text-blue-500">{{ fmt(virtueInventory.rareCount) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium text-purple-500">Epic</dt>
              <dd class="text-sm text-purple-500">{{ fmt(virtueInventory.epicCount) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium text-yellow-500">Legendary</dt>
              <dd class="text-sm text-yellow-500">{{ fmt(virtueInventory.legendaryCount) }}</dd>
            </div>
          </dl>
          <div v-if="virtueInventory.epicCount > 0" class="mt-1 flex flex-wrap justify-center space-y-0.5">
            <template v-for="family in virtueInventory.catalog" :key="family.afxId">
              <template v-for="tier in family.tiers" :key="tier.id">
                <div
                  v-if="tier.haveEpic > 0"
                  v-tippy="{ content: `Epic ${tier.name} \u00d7 ${tier.haveEpic}` }"
                  class="h-6 w-6 mx-0.5 my-0.5 relative"
                >
                  <img :src="iconURL(tier.iconPath, 128)" class="h-6 w-6 p-0.5 rounded-full bg-epic" />
                  <div v-if="tier.haveEpic > 1" :class="'artifact-count ' + numToDigClass(tier.haveEpic)">
                    {{ tier.haveEpic }}
                  </div>
                </div>
              </template>
            </template>
          </div>
          <div v-if="virtueInventory.legendaryCount > 0" class="mt-1 flex flex-wrap justify-center space-y-0.5">
            <template v-for="family in virtueInventory.catalog" :key="family.afxId">
              <template v-for="tier in family.tiers" :key="tier.id">
                <div
                  v-if="tier.haveLegendary > 0"
                  v-tippy="{ content: `Legendary ${tier.name} \u00d7 ${tier.haveLegendary}` }"
                  class="h-6 w-6 mx-0.5 my-0.5 relative"
                >
                  <img :src="iconURL(tier.iconPath, 128)" class="h-6 w-6 p-0.5 rounded-full bg-legendary" />
                  <div v-if="tier.haveLegendary > 1" :class="'artifact-count ' + numToDigClass(tier.haveLegendary)">
                    {{ tier.haveLegendary }}
                  </div>
                </div>
              </template>
            </template>
          </div>
        </div>

        <div v-if="!collapsed" class="py-2">
          <div class="grid gap-x-2 justify-center" :style="{ gridTemplateColumns: '50% 50%' }">
            <div class="text-right text-sm font-medium whitespace-nowrap">Total Contract Score</div>
            <div class="flex items-center text-left text-sm text-gray-900">
              <span class="truncate">
                {{ fmt(totalCxp) }}
              </span>
            </div>

            <div class="text-right text-sm font-medium whitespace-nowrap">Season Contract Score</div>
            <div class="flex items-center text-left text-sm text-gray-900">
              <span class="truncate">
                {{ fmt(seasonCxp) }}
              </span>
            </div>
            <div class="text-right text-sm font-medium whitespace-nowrap">Current Grade</div>
            <div class="flex items-center text-left text-sm text-gray-900">
              <span class="truncate">
                {{ playerGrade }}
              </span>
            </div>
            <div style="display: none">
              <div class="text-right text-sm font-medium whitespace-nowrap">Next Grade Progress</div>
              <div class="flex items-center text-left text-sm text-gray-900">
                <span class="truncate"> {{ Math.round(gradeProgress) }}% </span>
              </div>
              <div class="text-right text-sm font-medium whitespace-nowrap">GradeEval Time</div>
              <div class="flex items-center text-left text-sm text-gray-900">
                <span class="truncate">
                  {{ lastEvalTime }}
                </span>
              </div>
              <div class="text-right text-sm font-medium whitespace-nowrap">GradeEval Version</div>
              <div class="flex items-center text-left text-sm text-gray-900">
                <span class="truncate">
                  {{ lastEvalVersion }}
                </span>
              </div>
            </div>
          </div>

          <a
            :href="`https://eicoop-carpet.netlify.app/u/${userId}`"
            target="_blank"
            class="flex items-center justify-center space-x-0.5 text-xs text-gray-500 hover:text-gray-600 mt-1"
          >
            <span class="underline">Your contract dashboard</span>
            <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"
              />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
          </a>
        </div>

        <div v-if="!collapsed" class="py-2">
          <div class="grid gap-x-2 justify-center" :style="{ gridTemplateColumns: '50% 50%' }">
            <div class="text-right text-sm font-medium whitespace-nowrap">Lifetime earned</div>
            <div class="flex items-center text-left text-sm text-gray-900">
              <img :src="iconURL('egginc/icon_shell_script_colored.png', 64)" class="flex-shrink-0 h-4 w-4 -ml-0.5" />
              <span class="truncate">
                {{ fmt(lifetimeTicketsEarned) }}
              </span>
            </div>

            <div class="text-right text-sm font-medium whitespace-nowrap">Lifetime spent</div>
            <div class="flex items-center text-left text-sm text-gray-900">
              <img :src="iconURL('egginc/icon_shell_script_colored.png', 64)" class="flex-shrink-0 h-4 w-4 -ml-0.5" />
              <span class="truncate">
                {{ fmt(lifetimeTicketsSpent) }}
              </span>
            </div>

            <div class="text-right text-sm font-medium whitespace-nowrap">Current balance</div>
            <div class="flex items-center text-left text-sm text-gray-900">
              <img :src="iconURL('egginc/icon_shell_script_colored.png', 64)" class="flex-shrink-0 h-4 w-4 -ml-0.5" />
              <span class="truncate">
                {{ fmt(currentTicketsBalance) }}
              </span>
            </div>
          </div>

          <a
            :href="`https://wasmegg-carpet.netlify.app/shell-company/?playerId=${userId}`"
            target="_blank"
            class="flex items-center justify-center space-x-0.5 text-xs text-gray-500 hover:text-gray-600 mt-1"
          >
            <span class="underline">Your shells and available shells</span>
            <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"
              />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
          </a>
        </div>

        <div v-if="!collapsed" class="py-2">
          <div class="grid gap-x-2 justify-center" :style="{ gridTemplateColumns: '50% 50%' }">
            <dt class="text-right text-sm font-medium whitespace-nowrap">Lifetime drones</dt>
            <dd class="text-left text-sm text-gray-900">{{ fmt(lifetimeDrones) }}</dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Elite drones</dt>
            <dd class="text-left text-sm text-gray-900">{{ fmt(lifetimeEliteDrones) }}</dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Lifetime boosts</dt>
            <dd class="text-left text-sm text-gray-900">{{ fmt(lifetimeBoosts) }}</dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Video doublers</dt>
            <dd class="text-left text-sm text-gray-900">{{ fmt(lifetimeVidDoubler) }}</dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Airtime of Spaceships</dt>
            <dd class="text-left text-sm text-gray-900">
              {{ formatDuration(getMissionAirTime(artifactsDB.missionArchive), true) }}
            </dd>
          </div>
        </div>

        <div v-if="!collapsed" class="py-2">
          <div class="grid gap-x-2 justify-center" :style="{ gridTemplateColumns: '50% 50%' }">
            <dt class="text-right text-sm font-medium whitespace-nowrap">Mission Data Opt In:</dt>
            <dd class="text-left text-sm text-gray-900">{{ contributor }}</dd>

            <dt class="text-right text-sm font-medium whitespace-nowrap">Last Contributed:</dt>
            <dd class="text-left text-sm text-gray-900">
              {{ contributionTime > 0 ? dayjs(contributionTime).fromNow() : 'Never' }}
              <base-info
                v-if="contributionTime > 0"
                v-tippy="{
                  content: `Rockets tracker only submits your data once every 24 hours`,
                }"
                class="inline ml-0.5"
              />
            </dd>
          </div>
          <button
            class="items-center justify-center space-x-0.5 text-sm text-gray-500 hover:text-gray-600 mt-1 underline"
            @click="toggleContribution()"
          >
            Toggle Mission Data Opt-In
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRefs } from 'vue';
import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { sha256 } from 'js-sha256';

import {
  earningBonusToFarmerRole,
  ei,
  formatEIValue,
  getLocalStorage,
  getNakedEarningBonus,
  getNumSoulEggs,
  getProphecyEggsProgress,
  iconURL,
  Inventory,
  inventoryExpectedFullConsumption,
  setLocalStorage,
  TrophyLevel,
  getArtifactTierProps,
  getCraftingLevelFromXp,
  PlayerCraftingLevel,
  getXPFromCraftingLevel,
  formatDuration,
  getNumTruthEggs,
  maxModifierFromColleggtibles,
} from 'lib';
import BaseInfo from 'ui/components/BaseInfo.vue';
import { getMissionDataPreference, getMissionDataSubmitTime, recordMissionDataPreference } from '../lib/missiondata';
import { Emitter } from 'mitt';
import { REPORT_LEGENDARIES, REPORT_MISSIONDATA } from '../events';
import {
  getCompletedExtendedHenerprises,
  getMissionAirTime,
  getLaunchedMissions,
  getLegendariesStudyPreference,
  getMissionStatistics,
  LEGENDARIES_JEALOUSY_THRESHOLD,
  ZLC_EXTHEN_RECORD,
} from '@/lib';
import {
  numToDigClass,
  badgeNAH,
  badgeNAHLegacy,
  badgeGoodJob,
  badgeALC,
  badgeSLC,
  badgeZLC,
  badgeZLC100,
  badgeZLC7star,
  badgeASC,
  badgeFED,
  medalZLCRecord,
  medalZLCRecordGrayscale,
} from '@/badges';

import Spaceship = ei.MissionInfo.Spaceship;

dayjs.extend(advancedFormat);
dayjs.extend(localizedFormat);
dayjs.extend(relativeTime);
dayjs.extend(utc);

const COLLAPSE_PLAYER_CARD_LOCALSTORAGE_KEY = 'collpasePlayerCard';

enum ArtifactClub {
  ZERO_LEGENDARY_CLUB,
  ZERO_LEGENDARY_CLUB_100,
  ZERO_LEGENDARY_CLUB_7STAR,
  ALL_LEGENDARIES_CLUB,
  STAFF_LEGENDARIES_CLUB,
}

const STAFF_USER_ID_HASHES = [
  '07237b7d19ee048b6a027aaa9500aa6facfb72c02effb9a426081aa2873b12e4',
  '-1c8cf5a1650fb3a9db70771bc838e086a078676e96b51d53445c2ede365a6fc6',
  '-1d8a0cf5a97a22bbef1ec189e0aeec07ca0e8fd4cfacf8f40c46cf92f3898f12',
  '13e92258737282222f6bb81fd26f3b92b10633589746dff7c7efc39eaa2f28fd',
  '1647a580e534239f252c4bd5e802db336154efa0a0ea78b9188f15d39af41efc',
  '16b0d26958d351c15086a8b5a8cad83d12af89c1f99c287f31bf630edc3de0d4',
  '326117cdebe0e22870389a70ff99e746a55e3ad52bf9f2a3d8ea888fc354e7f0',
  '375a3acbdee3c9474c97ca21a341bce4424669f65ea08bdbf8504f886eb83278',
  '2b947e3425cf372ac0b2c6963776338c110bd63c7edcda3a7cf3aa5f72f2e913',
  '40dffdd80439e6e00433e0eb1592ae7a539d8b74cefde51b14bd45428f042cfb',
  '464d0ffcc5a6c98ec57cf69a7c8a6d1e8af40c6fa6cac3ef83ea9cee5cf516f4',
  '50011e9316ddc4c24c8e7795c91fb05ed1552a42e13b2a183b5261aaccd7f0e7',
  '5415c47fb4bad9315d64a11c6311d899d639b68b59de64b3ed1fdff3fd9033ec',
  '6659469d04891898a5fbdb1e35ea39aed41707eeec4e8ecefd9ac11756a420e9',
  '5f8392cde965c66ad2347941cee4430500cafbad9e64501ba571db02a4111702',
  '5fd149f054b097366d63e7e5d322ffa30359d00c0991d04afd4a04fa0cca12b3',
  '754a2eceb8015df87a43b1ba6a9c82ccfdf4e73d6432e89c16a428070f9bf367',
  '8155e8594fead2abd58a6a607be0fdcb8428699b8161fe726f3d38e6f84f9fce',
  '96cfbe3148ad6d7e5e411e72aa58be85b2c91ac05419fef47b46a9a028c8c6e9',
  'b6858e1760594584a27652e413cc1de271ed151b3e9b19261b4d8b763296bcea',
  'b7dc041be7ea07faf6ccc2fd893fe5b93c54449deea5b657830eec00a460a7c3',
  'bbd6cbbbc5a4e0a652478e25fe554630b1807d90cebd1661ba4fb0b6d9b972c6',
  'daddf0baaf841640de70e9b11f98ad253bce8f01f5addbc08e71d96deb0451e8',
  'f26a030bcbbd017afb5429e7bff341f3589c5bf035d41ad82063b8edac481d50',
  'f361dc823605c69029688fe63899cd383239f68f39042675e332d1af992ab89e',
  'f449380b27e3e313bd3e9df461b0260f48fd2594658cfee096008bdc9bdaa613',
  'fdd9712dc2b10bc9956debcedec31da76e7474970ae020a676fa2855df7daba6',
];

enum ShipClub {
  ALL_STAR_CLUB,
}

// Prior to 1.21, 381 legendaries dropped from 40920 exthens each with 56
// capacity, averaging to every 1 in ~6000. The 50 has no particular reason,
// just don't want to show this too soon for late comers who only know
// 157-capacity exthens.
const ZERO_LEGENDARY_EXTHEN_COUNT_SHAME_TRESHOLD = 50;
const ZERO_LEGENDARY_EXTHEN_TOTAL_DROP_SHAME_TRESHOLD = 6000;
const ZERO_LEGENDARY_UNWORTHY_USER_NICKNAMES = new Map<string, string>([]);
const ZERO_LEGENDARY_UNCONDITIONALLY_UNWORTHY_USER_NICKNAMES = new Map<string, string>([
  ['6fd149f054b097366d63e7e5d322ffa30359d00c0991d04afd4a04fa0cca12b3', 'Kirby'],
]);

const props = defineProps<{
  backup: ei.IBackup;
  inventory: Inventory;
  eventBus: Emitter<Record<typeof REPORT_LEGENDARIES | typeof REPORT_MISSIONDATA, unknown>>;
}>();

const { backup, inventory, eventBus } = toRefs(props);
const virtueInventory = computed(() => new Inventory(backup.value.artifactsDb!, { virtue: true }));

const collapsed = ref(getLocalStorage(COLLAPSE_PLAYER_CARD_LOCALSTORAGE_KEY) === 'true');
const toggleCollapse = () => {
  collapsed.value = !collapsed.value;
  setLocalStorage(COLLAPSE_PLAYER_CARD_LOCALSTORAGE_KEY, collapsed.value);
};

const lastRefreshedTimestamp = computed(() => backup.value.settings!.lastBackupTime! * 1000);
const lastRefreshed = computed(() => dayjs(Math.min(lastRefreshedTimestamp.value, Date.now())));
const now = ref(dayjs());
const lastRefreshedRelative = computed(() => now.value && lastRefreshed.value.fromNow());
const refreshIntervalId = setInterval(() => {
  now.value = dayjs(); // Force recomputation of lastRefreshedRelative
}, 10000);
onBeforeUnmount(() => {
  clearInterval(refreshIntervalId);
});

const progress = computed(() => backup.value.game!);
const version = computed(() => backup.value.version ?? 'Unknown');
const artifactsDB = computed(() => backup.value.artifactsDb!);
const userId = computed(() => backup.value.eiUserId ?? '');
const userIdHash = computed(() => sha256(backup.value.eiUserId ?? ''));
const nickname = computed(() => backup.value.userName!);
const hasProPermit = computed(() => progress.value.permitLevel === 1);
const missionStats = computed(() => getMissionStatistics(artifactsDB.value, progress.value));
const artifactClub = computed((): ArtifactClub | null => {
  if (inventory.value.legendaryCount === 0) {
    if (completedExtendedHenerpriseCount.value >= 100) {
      const stats = missionStats.value;
      // The last ship must be Henerprise since we know at least 100
      // extended Henerprises have been completed.
      const henerpriseStats = stats.ships[stats.ships.length - 1];
      if (henerpriseStats.currentLevel >= henerpriseStats.maxLevel) {
        return ArtifactClub.ZERO_LEGENDARY_CLUB_7STAR;
      } else {
        return ArtifactClub.ZERO_LEGENDARY_CLUB_100;
      }
    } else {
      return ArtifactClub.ZERO_LEGENDARY_CLUB;
    }
  }
  if (inventory.value.distinctLegendaryCount >= 22) {
    return ArtifactClub.ALL_LEGENDARIES_CLUB;
  }
  if (STAFF_USER_ID_HASHES.includes(userIdHash.value)) {
    return ArtifactClub.STAFF_LEGENDARIES_CLUB;
  }
  return null;
});
const shipClub = computed((): ShipClub | null => {
  const stats = missionStats.value;
  let allMissionsMaxed = true;
  if (stats.ships.length === 0 || stats.ships[stats.ships.length - 1].shipType !== Spaceship.ATREGGIES) {
    allMissionsMaxed = false;
  } else {
    for (const ship of stats.ships) {
      if (ship.currentLevel < ship.maxLevel) {
        allMissionsMaxed = false;
        break;
      }
    }
  }
  if (allMissionsMaxed) {
    return ShipClub.ALL_STAR_CLUB;
  }
  return null;
});
const prophecyEggsProgress = computed(() => getProphecyEggsProgress(backup.value));
const NAH_BASE_THRESHOLD = 19845000000;
const nahCurrentThreshold = computed(
  () => NAH_BASE_THRESHOLD * maxModifierFromColleggtibles(ei.GameModifier.GameDimension.HAB_CAPACITY)
);
const hasLegacyNAH = computed(() => {
  const farmsize = progress.value.maxFarmSizeReached!;
  // subtract 1 for array indexing
  const enlight = ei.Egg.ENLIGHTENMENT - 1;
  if (farmsize[enlight] >= NAH_BASE_THRESHOLD) {
    return true;
  }
  return false;
});
const hasNAH = computed(() => {
  const farmsize = progress.value.maxFarmSizeReached!;
  // subtract 1 for array indexing
  const enlight = ei.Egg.ENLIGHTENMENT - 1;
  if (farmsize[enlight] >= nahCurrentThreshold.value) {
    return true;
  }
  return false;
});
const FED_BASE_THRESHOLD = 14175000000;
const fedCurrentThreshold = computed(
  () => FED_BASE_THRESHOLD * maxModifierFromColleggtibles(ei.GameModifier.GameDimension.HAB_CAPACITY)
);
const hasFED = computed(() => {
  const farmsize = progress.value.maxFarmSizeReached!;
  for (let i = 0; i < farmsize.length; i++) {
    const compareAgainst = i == ei.Egg.ENLIGHTENMENT - 1 ? nahCurrentThreshold.value : fedCurrentThreshold.value;
    if (farmsize[i] < compareAgainst) {
      return false;
    }
  }
  return true;
});
// crafting level 30 / crafting legend
const didGoodJob = computed(() => craftingLevel.value.level >= 30);
const hasEnlightenmentDiamondTrophy = computed(() => {
  const eggs = prophecyEggsProgress.value.fromTrophies.eggs;
  for (const egg of eggs) {
    if (egg.egg === ei.Egg.ENLIGHTENMENT) {
      return egg.level >= TrophyLevel.Diamond;
    }
  }
  return false;
});
const truthEggs = computed(() => getNumTruthEggs(backup.value));
const prophecyEggs = computed(() => prophecyEggsProgress.value.completed);
const soulEggs = computed(() => getNumSoulEggs(backup.value));
const earningBonus = computed(() => getNakedEarningBonus(backup.value));
const role = computed(() => earningBonusToFarmerRole(earningBonus.value));
const trophies = computed(() => prophecyEggsProgress.value.fromTrophies.eggs.reduce((sum, egg) => sum + egg.level, 0));
const dailyGifts = computed(() => prophecyEggsProgress.value.fromDailyGifts);
const lifetimeGoldenEggsEarned = computed(() => progress.value.goldenEggsEarned || 0);
const lifetimeGoldenEggsSpent = computed(() => progress.value.goldenEggsSpent || 0);
const goldenEggsSpentOnCrafting = computed(() => inventory.value.sunkCost);
const currentGoldenEggsBalance = computed(() => lifetimeGoldenEggsEarned.value - lifetimeGoldenEggsSpent.value);
const piggyLevel = computed(() => 1 + (backup.value.stats?.numPiggyBreaks || 0));
const piggyGoldenEggs = computed(() =>
  Math.floor((progress.value.piggyBank || 0) * (1 + piggyLevelBonus(piggyLevel.value)))
);
const piggyFullDate = computed(() => backup.value.stats?.timePiggyFilledRealtime || 0);
const piggyLostIncrements = computed(() => backup.value.stats?.lostPiggyIncrements || 0);
const numPrestiges = computed(() => backup.value.stats?.numPrestiges || 0);
const numShifts = computed(() => backup.value.virtue?.shiftCount || 0);
const numResets = computed(() => backup.value.virtue?.resets || 0);
const nextShiftCost = computed(() => {
  const basis = soulEggs.value * (0.02 * Math.pow(numShifts.value / 120, 3) + 0.0001);
  return Math.pow(10, 11) + 0.6 * basis + Math.pow(0.4 * basis, 0.9);
});
const launchedMissions = computed(() => getLaunchedMissions(artifactsDB.value));
const numMissions = computed(() => launchedMissions.value.length);
const numVirtueMissions = computed(
  () => launchedMissions.value.filter(m => m.type === ei.MissionInfo.MissionType.VIRTUE).length
);
const daysSinceFirstMission = computed(() => {
  if (numMissions.value === 0) {
    return -1;
  }
  const firstMissionLaunchedAt = dayjs(launchedMissions.value[0].startTimeDerived! * 1000);
  return dayjs().diff(firstMissionLaunchedAt, 'days');
});
// there is somehow ??? a bug with this not updating on reload
//const inventoryScore = computed(() => Math.floor(backup.value.artifacts?.inventoryScore || 1));
const inventoryScore = computed(() => {
  //dont calculate if they have over 9m of anything
  const tooManyItems = backup.value.artifactsDb?.inventoryItems?.find(item => (item.quantity ?? 0) > 9000000);
  if (tooManyItems) {
    return Math.floor(backup.value.artifacts?.inventoryScore || 1);
  }

  const scores = backup.value.artifactsDb?.inventoryItems?.map(arti =>
    arti.artifact?.spec
      ? getArtifactTierProps(arti.artifact.spec.name!, arti.artifact.spec.level!).quality * (arti.quantity ?? 0)
      : 0
  ) ?? [0];
  return Math.floor(scores.reduce((sum, artiscore) => sum + artiscore) || 1);
});
const craftingXp = computed(() => Math.floor(backup.value.artifacts?.craftingXp || 0));
const craftingLevel = computed(() => getCraftingLevelFromXp(craftingXp.value));
const nextLevelXP = computed(() => getXPFromCraftingLevel(craftingLevel.value.level + 1));

const inventoryConsumptionValue = computed(() => inventoryExpectedFullConsumption(inventory.value as Inventory));
const virtueInventoryConsumptionValue = computed(() =>
  inventoryExpectedFullConsumption(virtueInventory.value as Inventory)
);

// Contract Stuff
const contractProgress = computed(() => backup.value.contracts?.lastCpi);
const lastEvalTime = computed(() => contractProgress.value?.lastEvaluationTime || 0);
const lastEvalVersion = computed(() => contractProgress.value?.lastEvaluationVersion || 'unknown');
const seasonCxp = computed(() => contractProgress.value?.seasonCxp || 0);
const totalCxp = computed(() => contractProgress.value?.totalCxp || 0);
const playerGrade = computed(() => gradeName[contractProgress.value?.grade || 0]);
const gradeProgress = computed(() => (contractProgress.value?.gradeProgress || 0) * 100);

const lifetimeTicketsEarned = computed(() => progress.value.shellScriptsEarned || 0);
const lifetimeTicketsSpent = computed(() => progress.value.shellScriptsSpent || 0);
const currentTicketsBalance = computed(() => lifetimeTicketsEarned.value - lifetimeTicketsSpent.value);

const lifetimeDrones = computed(() => backup.value.stats?.droneTakedowns || 0);
const lifetimeEliteDrones = computed(() => backup.value.stats?.droneTakedownsElite || 0);
const lifetimeBoosts = computed(() => backup.value.stats?.boostsUsed || 0);
const lifetimeVidDoubler = computed(() => backup.value.stats?.videoDoublerUses || 0);
const hasTooManyLegendaries = computed(() => {
  let count = 0;
  for (const family of inventory.value.catalog) {
    for (const tier of family.tiers) {
      count += tier.haveLegendary;
    }
  }
  return count >= LEGENDARIES_JEALOUSY_THRESHOLD;
});
const completedExtendedHenerprises = computed(() => getCompletedExtendedHenerprises(artifactsDB.value));
const completedExtendedHenerpriseCount = computed(() => completedExtendedHenerprises.value.length);
const completedExtendedHenerpriseTotalDropCount = computed(() =>
  completedExtendedHenerprises.value.reduce((sum, mission) => sum + (mission.capacity ?? 0), 0)
);
const isInLegendaryStudy = getLegendariesStudyPreference() === true;
const isZLCRecordHolder = computed(
  () =>
    isInLegendaryStudy &&
    inventory.value.legendaryCount === 0 &&
    completedExtendedHenerpriseCount.value >= ZLC_EXTHEN_RECORD
);
const isZLCRecordCloseFollower = computed(
  () =>
    isInLegendaryStudy &&
    inventory.value.legendaryCount === 0 &&
    completedExtendedHenerpriseCount.value < ZLC_EXTHEN_RECORD &&
    completedExtendedHenerpriseCount.value >= ZLC_EXTHEN_RECORD - 30
);
const zlcExthenRecord = computed(() =>
  isZLCRecordHolder.value ? completedExtendedHenerpriseCount.value : ZLC_EXTHEN_RECORD
);
const zeroLegendaryShaming = computed(
  () =>
    inventory.value.legendaryCount === 0 &&
    completedExtendedHenerpriseCount.value >= ZERO_LEGENDARY_EXTHEN_COUNT_SHAME_TRESHOLD &&
    completedExtendedHenerpriseTotalDropCount.value >= ZERO_LEGENDARY_EXTHEN_TOTAL_DROP_SHAME_TRESHOLD
);
// Certain ZLC players have been longing the poop badge
// (zeroLegendaryShaming), but they are not worthy, yet.
// zeroLegendaryUnworthyNickname is their nickname if they qualify, or
// undefined otherwise.
const zeroLegendaryUnworthyNickname = computed(() =>
  inventory.value.legendaryCount === 0 && !zeroLegendaryShaming.value
    ? ZERO_LEGENDARY_UNWORTHY_USER_NICKNAMES.get(userIdHash.value)
    : undefined
);
// And, crazy as it may sound, some enjoy the personalized message more!
// Give it to them unconditionally.
const zeroLegendaryUnconditionallyUnworthyNickname = computed(() =>
  inventory.value.legendaryCount === 0
    ? ZERO_LEGENDARY_UNCONDITIONALLY_UNWORTHY_USER_NICKNAMES.get(userIdHash.value)
    : undefined
);
const randIndex = Math.floor(Math.random() * 10000);
const gradeName = ['None', 'C', 'B', 'A', 'AA', 'AAA'];

// Toggle opt in for menno's data collection
const optin = ref(getMissionDataPreference(userId.value));
const contributor = computed(() => (optin.value ? 'Yes' : 'No'));
const contributionTime = ref(getMissionDataSubmitTime(userId.value));

const refreshMissionDataParams = () => {
  optin.value = getMissionDataPreference(userId.value);
  contributionTime.value = getMissionDataSubmitTime(userId.value);
};
const toggleContribution = () => {
  recordMissionDataPreference(userId.value, !optin.value);
  // submit their data if they are now opted in. Does nothing if they're opted out
  eventBus.value.emit(REPORT_MISSIONDATA);
};
eventBus.value.on(REPORT_MISSIONDATA, () => {
  refreshMissionDataParams();
});

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtApprox(n: number): string {
  return n === 0 ? '0' : `~${formatEIValue(n, { precision: 2 })}`;
}

function piggyLevelBonus(level: number): number {
  switch (level) {
    case 0:
      return 0;
    case 1:
      return 0.02;
    case 2:
      return 0.25;
    default:
      return 0.1 * (level + 1);
  }
}

function fmtCraftingXpRarityMultiplier(craftingLevel: PlayerCraftingLevel): string {
  const mult = craftingLevel.rarityMult;

  // mimic the way EI shows the increase value on screen
  const increase = mult < 2 ? `${Math.floor((mult - 1) * 100)}%` : `${Number(mult.toFixed(2))}x`;

  return `${increase} increase in chance to craft Rare, Epic or Legendary Artifacts`;
}
</script>
