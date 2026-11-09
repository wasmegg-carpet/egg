<template>
  <div class="space-y-4">
    <!-- Ascension Settings -->
    <div class="section-premium p-5 overflow-hidden">
      <h3 class="style-guide-label mb-6">Ascension Settings</h3>

      <div class="space-y-6">
        <!-- Ascension Start Time -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 md:flex-wrap">
          <div>
            <div class="text-sm font-bold text-slate-700">Ascension Start</div>
            <div class="hidden md:block text-[10px] uppercase font-black text-slate-400 tracking-wider">When this journey begins</div>
          </div>
          <div class="flex flex-col md:flex-row md:items-center md:flex-wrap md:justify-end gap-2 w-full md:w-auto mt-1 md:mt-0">
            <DateTimeZonePicker
              v-model:date="localAscensionDate"
              v-model:time="localAscensionTime"
              v-model:timezone="localAscensionTimezone"
            />
            <button
              class="btn-premium btn-primary w-full md:w-auto px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all disabled:opacity-30"
              :disabled="!hasAscensionChanges"
              @click="applyAscensionChanges"
            >
              Apply
            </button>
          </div>
        </div>

        <!-- Starting Egg -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0">
          <div>
            <div class="text-sm font-bold text-slate-700">Starting Egg</div>
            <div class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider">Initial Egg</div>
          </div>
          <div class="flex gap-2 justify-between w-full sm:w-auto mt-1 sm:mt-0">
            <button
              v-for="egg in VIRTUE_EGGS"
              :key="egg"
              class="group relative w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 shadow-sm border-2 overflow-visible"
              :class="[
                initialEgg === egg
                  ? 'border-brand-primary scale-110 shadow-lg shadow-brand-primary/20 bg-white'
                  : 'border-slate-100 bg-slate-50 opacity-60 hover:opacity-100 hover:border-slate-200',
              ]"
              v-tippy="VIRTUE_EGG_NAMES[egg]"
              @click="handleInitialEggClick(egg)"
            >
              <img
                :src="iconURL(`egginc/egg_${egg}.png`, 64)"
                class="w-8 h-8 object-contain transition-transform"
                :class="{ 'scale-110 drop-shadow-sm': initialEgg === egg }"
                :alt="egg"
              />

              <!-- Active indicator dot -->
              <div
                v-if="initialEgg === egg"
                class="absolute -top-1 -right-1 w-3 h-3 bg-slate-900 rounded-full border-2 border-white shadow-sm pointer-events-none"
              ></div>
            </button>
          </div>
        </div>

        <!-- Previous Shifts (editable) -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0">
          <div>
            <div class="text-sm font-bold text-slate-700">Previous Shifts</div>
            <div class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider">Experience baseline</div>
          </div>
          <div class="flex items-center gap-2 w-full sm:w-auto mt-1 sm:mt-0">
            <input
              type="number"
              :value="initialShiftCount"
              :min="0"
              class="input-premium w-full sm:w-40 text-right text-sm font-mono-premium font-bold text-slate-900"
              @change="$emit('set-initial-shift-count', parseInt(($event.target as HTMLInputElement).value) || 0)"
            />
          </div>
        </div>

        <!-- Soul Eggs -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0">
          <div>
            <div class="flex items-center gap-1.5">
              <div class="text-sm font-bold text-slate-700">Soul Eggs (SE)</div>
              <img :src="iconURL('egginc/egg_soul.png', 32)" class="w-4 h-4 mb-0.5" alt="SE" />
            </div>
            <div class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider">
              Earnings potential multiplier
            </div>
          </div>
          <div class="flex items-center gap-2 w-full sm:w-auto mt-1 sm:mt-0">
            <input
              type="text"
              :value="formatNumber(soulEggs, 3)"
              class="input-premium w-full sm:w-40 text-right text-sm font-mono-premium font-bold text-slate-900"
              @blur="handleSoulEggsChange(($event.target as HTMLInputElement).value)"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
          </div>
        </div>

        <!-- Assume Double Earnings -->
        <div
          class="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-slate-100 group hover:bg-slate-50 transition-colors"
        >
          <div>
            <div class="text-sm font-bold text-slate-700">Assume Double Earnings</div>
            <div
              class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider group-hover:text-slate-500 transition-colors"
            >
              Active Video Doubler or Ultra
            </div>
          </div>
          <div class="flex items-center">
            <button
              class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
              :class="[assumeDoubleEarnings ? 'bg-brand-primary' : 'bg-slate-300']"
              role="switch"
              :aria-checked="assumeDoubleEarnings"
              @click="$emit('set-assume-double-earnings', !assumeDoubleEarnings)"
            >
              <span class="sr-only">Use video doubler</span>
              <span
                aria-hidden="true"
                class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                :class="[assumeDoubleEarnings ? 'translate-x-5' : 'translate-x-0']"
              />
            </button>
          </div>
        </div>

        <ProPermitToggle :model-value="proPermit" @update:model-value="$emit('set-pro-permit', $event)" />
      </div>
    </div>

    <!-- Virtue Progress (collapsible) -->
    <div class="section-premium overflow-hidden">
      <button
        class="w-full px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center hover:bg-slate-100 transition-colors group"
        @click="truthEggsExpanded = !truthEggsExpanded"
      >
        <div class="flex items-center gap-3">
          <div class="p-1.5 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            <img :src="iconURL('egginc/egg_truth.png', 64)" class="w-5 h-5 object-contain" alt="Truth Egg" />
          </div>
          <h3 class="style-guide-label mb-0">Virtue Progress</h3>
        </div>
        <div class="flex items-center gap-4">
          <div class="px-2 py-0.5 bg-brand-primary/10 rounded-full">
            <span class="text-[10px] font-black text-slate-900 uppercase tracking-widest leading-none">
              {{ totalTe }} <span class="opacity-50">/ 490</span> TE
            </span>
          </div>
          <svg
            class="w-4 h-4 text-slate-400 transition-transform duration-300"
            :class="{ 'rotate-180': truthEggsExpanded }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      <div v-if="truthEggsExpanded" class="p-5 space-y-6">
        <!-- Eggs of Truth (Total display) -->
        <div class="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 flex items-center justify-between">
          <div>
            <div class="text-sm font-bold text-slate-700">Total Eggs of Truth</div>
            <div class="text-[10px] uppercase font-black text-slate-400 tracking-wider">
              Multiplies IHR & Earnings by 1.1^TE
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="relative">
              <div class="text-lg font-mono-premium font-bold text-slate-900 px-3">{{ totalTe }}</div>
            </div>
            <span class="text-[10px] font-black text-slate-300 uppercase tracking-widest mt-1">Max: 490</span>
          </div>
        </div>

        <!-- Per-Egg TE Progress -->
        <div class="grid grid-cols-1 gap-3">
          <div
            v-for="egg in VIRTUE_FUEL_ORDER"
            :key="egg"
            class="flex flex-col gap-3 p-3 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl transition-all group"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center p-1.5 group-hover:bg-white group-hover:shadow-inner transition-all"
              >
                <img
                  :src="iconURL(`egginc/egg_${egg}.png`, 64)"
                  class="w-full h-full object-contain drop-shadow-sm"
                  :alt="egg"
                />
              </div>
              <div class="text-xs font-bold text-slate-800 uppercase tracking-tight">
                {{ VIRTUE_EGG_NAMES[egg] }}
              </div>
            </div>
            <div class="flex-1 w-full">
              <div class="grid grid-cols-2 gap-3 w-full">
                <!-- Delivered -->
                <div class="flex flex-col gap-1">
                  <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Delivered</span>
                  <input
                    type="text"
                    :value="formatNumber(eggsDelivered[egg], 3)"
                    class="input-premium w-full text-right text-sm font-mono-premium font-bold text-slate-900"
                    placeholder="0"
                    @change="handleEggsDeliveredChange(egg, ($event.target as HTMLInputElement).value)"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  />
                </div>
                <!-- TE -->
                <div class="flex flex-col gap-1">
                  <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate">TE <span class="text-slate-300 font-bold ml-0.5">/ 98</span></span>
                  <input
                    type="number"
                    :value="teEarned[egg]"
                    :min="0"
                    :max="98"
                    class="input-premium w-full text-right text-sm font-mono-premium font-bold text-slate-900"
                    @change="handleTEEarnedChange(egg, ($event.target as HTMLInputElement).value)"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Include Pending TE Button -->
        <div class="mt-4 flex justify-end">
          <button
            class="btn-premium btn-primary px-4 py-2 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!hasData || totalPendingTe === 0"
            @click="$emit('include-pending-te')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            <span
              >Include Pending TE <span v-if="totalPendingTe > 0">({{ totalPendingTe }})</span></span
            >
          </button>
        </div>
      </div>
    </div>

    <!-- Artifact Loadout -->
    <div class="section-premium overflow-visible">
      <div class="px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center">
        <h3 class="style-guide-label mb-0">Artifact Sets</h3>
        <div v-if="hasArtifactSets" class="flex gap-1 bg-slate-200/50 p-1 rounded-xl">
          <button
            v-for="setName in ['earnings', 'elr'] as const"
            :key="setName"
            class="px-4 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all"
            :class="[
              activeSetTab === setName
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 hover:bg-white/50',
            ]"
            @click="activeSetTab = setName"
          >
            {{ setName }}
          </button>
        </div>
      </div>
      <div class="p-4">
        <div v-if="activeSetTab === 'earnings' && clothedTe !== null" class="mt-4 flex justify-between items-center px-1">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clothed TE</span>
          <span class="text-sm font-mono-premium font-bold text-slate-900">{{ Math.round(clothedTe) }}</span>
        </div>
        <template v-if="!hasArtifactSets">
          <div class="mb-4">
            <ArtifactSelector
              :model-value="artifactLoadout"
              :slot-count="artifactSlotCount(proPermit)"
              @update:model-value="$emit('update:artifact-loadout', $event)"
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <button
              class="btn-premium btn-primary py-2 text-[10px] font-black uppercase tracking-widest"
              @click="$emit('save-current-to-set', 'earnings')"
            >
              Save as Earnings
            </button>
            <button
              class="btn-premium btn-primary py-2 text-[10px] font-black uppercase tracking-widest"
              @click="$emit('save-current-to-set', 'elr')"
            >
              Save as Delivery
            </button>
          </div>
        </template>
        <template v-else>
          <div v-if="activeSetTab === 'earnings'">
            <ArtifactSelector
              :model-value="artifactSets.earnings || createEmptyLoadout()"
              :slot-count="artifactSlotCount(proPermit)"
              @update:model-value="$emit('update-artifact-set', 'earnings', $event)"
            />
          </div>
          <div v-if="activeSetTab === 'elr'">
            <ArtifactSelector
              :model-value="artifactSets.elr || createEmptyLoadout()"
              :slot-count="artifactSlotCount(proPermit)"
              @update:model-value="$emit('update-artifact-set', 'elr', $event)"
            />
          </div>
          <div v-if="activeArtifactSet !== activeSetTab" class="mt-4 flex justify-end">
            <button
              class="btn-premium btn-secondary py-1.5 px-4 text-[10px] font-black uppercase tracking-widest"
              @click="$emit('set-active-artifact-set', activeSetTab)"
            >
              Equip as Active
            </button>
          </div>
          <div
            v-else
            class="mt-4 flex justify-end items-center gap-3 bg-brand-primary/5 p-2 rounded-xl border border-brand-primary/10"
          >
            <div class="w-2 h-2 rounded-full bg-brand-primary animate-pulse"></div>
            <span class="text-[10px] font-black text-slate-900 uppercase tracking-widest"
              >Currently Active Loadout</span
            >
          </div>
        </template>
      </div>
    </div>

    <!-- Fuel Tank (collapsible) -->
    <div class="section-premium overflow-hidden">
      <button
        class="w-full px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center hover:bg-slate-100 transition-colors group"
        @click="fuelTankExpanded = !fuelTankExpanded"
      >
        <div class="flex items-center gap-3">
          <div class="p-1.5 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
              />
            </svg>
          </div>
          <h3 class="style-guide-label mb-0">Fuel Tank</h3>
        </div>
        <div class="flex items-center gap-4">
          <div class="px-2 py-0.5 bg-slate-200/50 rounded-full">
            <span
              class="text-[10px] font-black text-slate-600 uppercase tracking-widest leading-none font-mono-premium"
            >
              {{ formatNumber(totalFuel, 1) }} <span class="opacity-40">/</span> {{ formatNumber(tankCapacity, 1) }}
            </span>
          </div>
          <svg
            class="w-4 h-4 text-slate-400 transition-transform duration-300"
            :class="{ 'rotate-180': fuelTankExpanded }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      <div v-if="fuelTankExpanded" class="p-5 space-y-6">
        <!-- Tank Level Selector -->
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-bold text-slate-700">Tank Level</div>
            <div class="text-[10px] uppercase font-black text-slate-400 tracking-wider">Storage capacity tier</div>
          </div>
          <select
            :value="tankLevel"
            class="input-premium w-auto text-sm font-bold text-slate-900 py-2.5 pl-4 pr-12"
            @change="$emit('set-tank-level', parseInt(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="opt in tankLevelOptions" :key="opt.level" :value="opt.level">
              {{ opt.label }} ({{ opt.capacity }})
            </option>
          </select>
        </div>

        <!-- Capacity Bar -->
        <div class="space-y-2 p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
          <div class="flex justify-between items-end mb-1">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Utilization</span>
            <span class="text-xs font-bold text-slate-700 font-mono-premium">{{ fillPercent.toFixed(1) }}%</span>
          </div>
          <div class="h-3 bg-white shadow-inner rounded-full overflow-hidden border border-slate-100">
            <div
              class="h-full transition-all duration-700 ease-out relative"
              :class="fillPercent > 90 ? 'bg-danger' : fillPercent > 70 ? 'bg-warning' : 'bg-success'"
              :style="{ width: `${fillPercent}%` }"
            >
              <div class="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent"></div>
            </div>
          </div>
        </div>

        <!-- Per-Egg Fuel Amounts -->
        <div class="space-y-3">
          <h4 class="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Stored Inventory</h4>
          <div class="grid grid-cols-1 gap-2">
            <div
              v-for="egg in VIRTUE_FUEL_ORDER"
              :key="egg"
              class="flex items-center gap-4 p-3 bg-white hover:bg-slate-50 border border-slate-50 rounded-2xl transition-all group"
            >
              <div
                class="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center p-1.5 group-hover:bg-white group-hover:shadow-sm transition-all"
              >
                <img
                  :src="iconURL(`egginc/egg_${egg}.png`, 64)"
                  class="w-full h-full object-contain drop-shadow-sm"
                  :alt="egg"
                />
              </div>
              <div class="flex-1">
                <div class="text-xs font-bold text-slate-700 uppercase tracking-tight">{{ VIRTUE_EGG_NAMES[egg] }}</div>
              </div>
              <div class="flex flex-col items-end">
                <div class="flex items-center gap-2">
                  <svg
                    v-if="getRoundingShortfall(fuelAmounts[egg]) > 0"
                    v-tippy="'Rounding is likely to cause a problem for you, since you are below the displayed number of eggs.'"
                    class="w-4 h-4 text-warning"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <input
                    type="text"
                    :value="formatNumber(fuelAmounts[egg], 1)"
                    class="input-premium w-40 text-right text-sm font-mono-premium font-bold text-slate-900"
                    placeholder="0"
                    @blur="handleFuelAmountChange(egg, ($event.target as HTMLInputElement).value)"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  />
                </div>
                <div v-if="getRoundingShortfall(fuelAmounts[egg]) > 0" class="text-[9px] text-danger font-bold uppercase tracking-widest mt-1">
                  You're short by {{ formatFullNumber(getRoundingShortfall(fuelAmounts[egg])) }} eggs
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Epic Research (collapsible) -->
    <div class="section-premium overflow-hidden">
      <button
        class="w-full px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center hover:bg-slate-100 transition-colors group"
        @click="epicResearchExpanded = !epicResearchExpanded"
      >
        <div class="flex items-center gap-3">
          <div class="p-1.5 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
              />
            </svg>
          </div>
          <h3 class="style-guide-label mb-0">Epic Research</h3>
        </div>
        <svg
          class="w-4 h-4 text-slate-400 transition-transform duration-300"
          :class="{ 'rotate-180': epicResearchExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="epicResearchExpanded" class="divide-y divide-slate-50 max-h-80 overflow-y-auto custom-scrollbar">
        <div
          v-for="research in epicResearchList"
          :key="research.id"
          class="px-5 py-3 hover:bg-slate-50/50 transition-colors group flex flex-col gap-1.5"
        >
          <div class="flex justify-between items-center gap-4">
            <div class="flex items-center gap-4 flex-1 min-w-0">
              <div
                class="w-10 h-10 bg-slate-50 rounded-lg flex-shrink-0 flex items-center justify-center p-2 group-hover:bg-white group-hover:shadow-sm transition-all"
              >
                <img
                  :src="iconURL(getResearchIconPath(research.id), 64)"
                  class="w-full h-full object-contain opacity-80"
                  :alt="research.name"
                />
              </div>
              <div class="min-w-0">
                <div class="text-xs font-bold text-slate-800 uppercase tracking-tight">{{ research.name }}</div>
              </div>
            </div>
            <div class="flex flex-shrink-0 items-center gap-2">
              <div class="flex items-center gap-1.5">
                <input
                  type="number"
                  :value="research.level"
                  :min="0"
                  :max="research.maxLevel"
                  class="input-premium w-16 text-center text-xs font-mono-premium py-1 font-bold"
                  @change="
                    $emit(
                      'set-epic-research-level',
                      research.id,
                      parseInt(($event.target as HTMLInputElement).value) || 0
                    )
                  "
                />
                <span class="text-[9px] font-black text-slate-300 uppercase tracking-widest w-10"
                  >/ {{ research.maxLevel }}</span
                >
              </div>
            </div>
          </div>
          <div class="text-[10px] text-slate-500 font-medium italic leading-relaxed pl-14 pr-2 pb-1">
            {{ research.effect }}
          </div>
        </div>
      </div>
    </div>

    <!-- Colleggtibles (collapsible) -->
    <div class="section-premium overflow-hidden">
      <button
        class="w-full px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center hover:bg-slate-100 transition-colors group"
        @click="colleggtiblesExpanded = !colleggtiblesExpanded"
      >
        <div class="flex items-center gap-3">
          <div class="p-1.5 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            <img :src="iconURL('egginc/egg_unknown.png', 32)" class="w-5 h-5 opacity-60" alt="" />
          </div>
          <h3 class="style-guide-label mb-0">Colleggtibles</h3>
        </div>
        <svg
          class="w-4 h-4 text-slate-400 transition-transform duration-300"
          :class="{ 'rotate-180': colleggtiblesExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="colleggtiblesExpanded" class="divide-y divide-slate-50 max-h-80 overflow-y-auto custom-scrollbar">
        <div
          v-for="egg in colleggtiblesList"
          :key="egg.id"
          class="px-5 py-4 hover:bg-slate-50/50 transition-colors group"
        >
          <div class="flex justify-between items-center gap-4">
            <div class="flex items-center gap-4 flex-1 min-w-0">
              <div
                class="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center p-1.5 group-hover:bg-white group-hover:shadow-sm transition-all"
              >
                <img
                  :src="iconURL(getColleggtibleIconPath(egg.id), 64)"
                  class="w-full h-full object-contain"
                  :alt="egg.name"
                />
              </div>
              <div class="min-w-0">
                <div class="text-xs font-bold text-slate-800 uppercase tracking-tight">{{ egg.name }}</div>
                <div class="text-[10px] text-slate-400 font-medium truncate italic leading-relaxed">
                  {{ egg.bonusText }} {{ egg.effect.toLowerCase() }}
                </div>
              </div>
            </div>

            <div class="flex items-center gap-4">
              <select
                :value="egg.tierIndex"
                class="input-premium py-1 pl-3 pr-10 text-xs font-bold text-slate-900 border-none bg-slate-100 hover:bg-slate-200 transition-colors w-auto"
                @change="$emit('set-colleggtible-tier', egg.id, parseInt(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="opt in TIER_OPTIONS" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { iconURL } from 'lib';
import { getResearchIconPath, getColleggtibleIconPath } from 'lib/planners/assets';
import type { ResearchLevels, VirtueEgg } from '@/types';
import { VIRTUE_EGGS, VIRTUE_EGG_NAMES } from '@/types';
import { epicResearchDefs } from 'lib/planners/epicResearch';
import type { EquippedArtifact } from '@/lib/artifacts';
import { TANK_CAPACITIES, VIRTUE_FUEL_ORDER } from '@/stores/fuelTank';
import { formatNumber, parseNumber, formatFullNumber } from '@/lib/format';
import ArtifactSelector from '@/components/ArtifactSelector.vue';
import ProPermitToggle from 'ui/components/planners/ProPermitToggle.vue';
import DateTimeZonePicker from 'ui/components/planners/DateTimeZonePicker.vue';
import { createEmptyLoadout, artifactSlotCount } from '@/lib/artifacts';
import {
  colleggtibleDefs,
  formatColleggtibleBonus,
  getColleggtibleMultiplier,
  FARM_SIZE_TIERS,
} from 'lib/collegtibles';

const props = defineProps<{
  hasData: boolean;
  epicResearchLevels: ResearchLevels;
  artifactLoadout: EquippedArtifact[];
  initialShiftCount: number;
  initialEgg: VirtueEgg;
  te: number;
  ascensionDate: string;
  ascensionTime: string;
  ascensionTimezone: string;
  tankLevel: number;
  fuelAmounts: Record<VirtueEgg, number>;
  tankCapacity: number;
  eggsDelivered: Record<VirtueEgg, number>;
  teEarned: Record<VirtueEgg, number>;
  tePending: Record<VirtueEgg, number>;
  totalTe: number;

  soulEggs: number;
  assumeDoubleEarnings: boolean;
  proPermit: boolean;
  artifactSets: Record<import('@/types').ArtifactSetName, EquippedArtifact[] | null>;
  activeArtifactSet: import('@/types').ArtifactSetName | null;
  colleggtibleTiers: import('lib/collegtibles').ColleggtibleTiers;
  clothedTe: number | null;
}>();

function handleInitialEggClick(egg: VirtueEgg) {
  if (props.initialEgg === egg) return;
  if (confirm('Changing the initial egg will reset your entire plan. Are you sure you want to continue?')) {
    emit('set-initial-egg', egg);
  }
}

const emit = defineEmits<{
  'set-epic-research-level': [researchId: string, level: number];
  'update:artifact-loadout': [loadout: EquippedArtifact[]];
  'set-initial-egg': [egg: VirtueEgg];
  'set-te': [value: number];
  'set-initial-shift-count': [value: number];
  'set-ascension-date': [value: string];
  'set-ascension-time': [value: string];
  'set-ascension-timezone': [value: string];
  'apply-ascension-settings': [date: string, time: string, timezone: string];
  'set-tank-level': [level: number];
  'set-fuel-amount': [egg: VirtueEgg, amount: number];
  'set-eggs-delivered': [egg: VirtueEgg, amount: number];
  'set-te-earned': [egg: VirtueEgg, count: number];
  'include-pending-te': [];

  'set-soul-eggs': [count: number];
  'set-assume-double-earnings': [enabled: boolean];
  'set-pro-permit': [enabled: boolean];
  'update-artifact-set': [setName: import('@/types').ArtifactSetName, loadout: EquippedArtifact[]];
  'save-current-to-set': [setName: import('@/types').ArtifactSetName];
  'set-active-artifact-set': [setName: import('@/types').ArtifactSetName];
  'set-colleggtible-tier': [id: string, tierIndex: number];
}>();

// Ascension Start local state for staged updates
const localAscensionDate = ref(props.ascensionDate);
const localAscensionTime = ref(props.ascensionTime);
const localAscensionTimezone = ref(props.ascensionTimezone);

// Sync with props when they change externally
watch(() => props.ascensionDate, val => (localAscensionDate.value = val));
watch(() => props.ascensionTime, val => (localAscensionTime.value = val));
watch(
  () => props.ascensionTimezone,
  val => (localAscensionTimezone.value = val)
);

const hasAscensionChanges = computed(() => {
  return (
    localAscensionDate.value !== props.ascensionDate ||
    localAscensionTime.value !== props.ascensionTime ||
    localAscensionTimezone.value !== props.ascensionTimezone
  );
});

function applyAscensionChanges() {
  emit('apply-ascension-settings', localAscensionDate.value, localAscensionTime.value, localAscensionTimezone.value);
}

defineExpose({ hasAscensionChanges, applyAscensionChanges });

// Collapsible state
const epicResearchExpanded = ref(false);
const colleggtiblesExpanded = ref(false);
const fuelTankExpanded = ref(false);
const truthEggsExpanded = ref(true);

const activeSetTab = ref<import('@/types').ArtifactSetName>(props.activeArtifactSet || 'earnings');

// Keep tab in sync with active set (important for imports)
watch(
  () => props.activeArtifactSet,
  newVal => {
    if (newVal) {
      activeSetTab.value = newVal;
    }
  }
);

const hasArtifactSets = computed(() => props.artifactSets.earnings || props.artifactSets.elr);

// Total fuel in tank
const totalFuel = computed(() => Object.values(props.fuelAmounts).reduce((sum, amt) => sum + amt, 0));

// Total pending TE
const totalPendingTe = computed(() => Object.values(props.tePending).reduce((sum, val) => sum + val, 0));

// Fill percentage for visual bar
const fillPercent = computed(() => {
  if (props.tankCapacity === 0) return 0;
  return Math.min(100, (totalFuel.value / props.tankCapacity) * 100);
});

// Tank level options (0-7)
const tankLevelOptions = TANK_CAPACITIES.map((capacity, index) => ({
  level: index,
  label: `Level ${index}`,
  capacity: formatNumber(capacity, 1),
}));

// Handle fuel amount input change
function handleFuelAmountChange(egg: VirtueEgg, inputValue: string) {
  const parsed = parseNumber(inputValue);
  if (parsed !== null && !isNaN(parsed)) {
    emit('set-fuel-amount', egg, parsed);
  }
}

// Handle eggs delivered input change
function handleEggsDeliveredChange(egg: VirtueEgg, inputValue: string) {
  const parsed = parseNumber(inputValue);
  if (parsed !== null && !isNaN(parsed)) {
    emit('set-eggs-delivered', egg, parsed);
  }
}

// Handle TE earned input change
function handleTEEarnedChange(egg: VirtueEgg, inputValue: string) {
  const value = parseInt(inputValue);
  if (!isNaN(value)) {
    emit('set-te-earned', egg, value);
  }
}

// Handle soul eggs input change
function handleSoulEggsChange(inputValue: string) {
  const parsed = parseNumber(inputValue);
  if (parsed !== null && !isNaN(parsed)) {
    emit('set-soul-eggs', parsed);
  }
}

// Calculate rounding shortfall
function getRoundingShortfall(actual: number): number {
  if (!actual || actual <= 0) return 0;
  const formatted = formatNumber(actual, 1);
  const parsed = parseNumber(formatted);
  if (parsed > actual) {
    const diff = parsed - actual;
    if (diff < 100) {
      return Math.round(diff);
    }
  }
  return 0;
}

const epicResearchList = computed(() =>
  epicResearchDefs.map(def => ({
    id: def.id,
    name: def.name,
    effect: def.effect,
    maxLevel: def.maxLevel,
    level: props.epicResearchLevels[def.id] || 0,
  }))
);

const colleggtiblesList = computed(() =>
  colleggtibleDefs.map(def => {
    const tierIndex = props.colleggtibleTiers[def.id] ?? -1;
    const multiplier = getColleggtibleMultiplier(def.id, tierIndex);
    return {
      id: def.id,
      name: def.name,
      effect: def.effect,
      tierIndex,
      bonusText: formatColleggtibleBonus(multiplier, def.id),
    };
  })
);

const TIER_OPTIONS = [
  { value: -1, label: '<10M' },
  { value: 0, label: '10M' },
  { value: 1, label: '100M' },
  { value: 2, label: '1B' },
  { value: 3, label: '10B' },
];
</script>
