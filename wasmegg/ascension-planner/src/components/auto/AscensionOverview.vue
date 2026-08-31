<template>
  <div class="bg-white rounded-xl sm:rounded-2xl p-3.5 sm:p-4 text-slate-900 relative overflow-hidden shadow-md border border-slate-200">
    <!-- Background accents -->
    <div class="absolute -right-20 -top-20 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl"></div>
    <div class="absolute -left-20 -bottom-20 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl"></div>

    <div class="relative z-10">
      <div class="flex flex-col gap-2 sm:gap-3 mb-3">
        <div class="flex items-center gap-2.5 sm:gap-3">
          <div class="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-lg sm:rounded-xl flex items-center justify-center shadow-md shadow-indigo-100/50 flex-shrink-0">
            <svg class="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <div class="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2">
              <h3 class="text-base sm:text-lg font-black uppercase tracking-tight text-slate-800 leading-none">
                A{{ index + 1 }} of {{ total }}
                <span v-if="index === 0" class="ml-1 sm:ml-2 text-[8px] sm:text-[10px] font-bold text-slate-400 capitalize opacity-70">
                  — {{ summary.strategyLabel === 'Continue current' ? 'Continue current ascension' : 'Prestige Now' }}
                </span>
              </h3>
              <span v-if="!isEditingEndTime" class="flex items-center gap-1">
                <span class="text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">{{ formatTimeRange(summary.startTime, summary.endTime) }}</span>
                <button
                  v-tippy="hasEndTimeOverride ? 'Edit overridden end time' : 'Override end time'"
                  class="text-slate-300 hover:text-indigo-500 transition-colors flex-shrink-0"
                  @click="startEditingEndTime"
                >
                  <svg class="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <span
                  v-if="hasEndTimeOverride"
                  class="px-1 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100 text-[7px] font-black uppercase tracking-wider leading-none"
                >Overridden</span>
              </span>
            </div>

            <!-- Inline end-time override editor -->
            <div v-if="isEditingEndTime" class="flex flex-wrap items-center gap-1.5 mt-1.5">
              <input
                v-model="editEndDate"
                type="date"
                class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500/50 bg-white transition-all w-36"
              />
              <input
                v-model="editEndTime"
                type="time"
                class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500/50 bg-white transition-all w-28"
              />
              <button
                class="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[9px] font-black uppercase tracking-wider rounded-lg transition-all"
                @click="saveEndTimeOverride"
              >Save</button>
              <button
                class="px-2 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 text-slate-500 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all"
                @click="cancelEditingEndTime"
              >Cancel</button>
              <button
                v-if="hasEndTimeOverride"
                class="px-2 py-1 bg-slate-50 hover:bg-rose-50 border border-slate-200/80 hover:border-rose-200/50 text-slate-500 hover:text-rose-600 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all"
                @click="resetEndTimeOverride"
              >Reset to Auto</button>
            </div>
            <div v-if="endTimeEditError" class="text-[8px] sm:text-[9px] font-bold text-rose-500 mt-1">{{ endTimeEditError }}</div>

            <div v-if="displayComparisons.length > 0" class="flex flex-wrap gap-2 mt-1">
              <div v-for="(comp, ci) in displayComparisons" :key="ci"
                class="px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-sm w-fit"
                :class="comp.message ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'">
                <svg v-if="!comp.message" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <svg v-else class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <template v-if="comp.message">{{ comp.message }}</template>
                <template v-else>{{ comp.daysFaster.toFixed(1) }} days faster than {{ comp.otherPlanLabel }}</template>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap ml-[38px] sm:ml-[44px]">
          <button
            @click="isExpanded = !isExpanded"
            class="flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 border border-slate-200/80 hover:border-indigo-200/50 rounded-lg text-[9px] font-black text-slate-500 hover:text-indigo-600 transition-colors uppercase tracking-wider group shadow-sm flex-shrink-0"
          >
            <span>{{ isExpanded ? 'Hide details' : 'View details' }}</span>
            <svg
              class="w-3 h-3 transition-transform duration-500"
              :class="isExpanded ? 'rotate-180' : ''"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <!-- Plan variant dropdown -->
          <div class="relative flex-shrink-0" ref="dropdownRef">
            <button
              @click.stop="isDropdownOpen = !isDropdownOpen"
              class="flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 border border-slate-200/80 hover:border-indigo-200/50 rounded-lg text-[9px] font-black text-slate-500 hover:text-indigo-600 transition-colors uppercase tracking-wider shadow-sm"
            >
              <span>{{ activeVariantShortLabel }}</span>
              <svg class="w-3 h-3 transition-transform duration-200" :class="isDropdownOpen ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <div
              v-if="isDropdownOpen"
              class="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[190px]"
            >
              <div v-for="row in variantRows" :key="row.saleCount" class="flex items-center gap-1 px-1">
                <button
                  class="flex-1 text-left px-2 py-1.5 text-[9px] font-black uppercase tracking-wider transition-colors flex items-center gap-1.5 rounded-lg"
                  :class="
                    (row.plainKey ?? row.tier13Key) === activeVariantKey
                      ? 'bg-indigo-50 text-indigo-600'
                      : 'text-slate-600 hover:bg-slate-50'
                  "
                  @click="selectVariant(row.plainKey ?? row.tier13Key!)"
                >
                  <svg
                    v-if="(row.plainKey ?? row.tier13Key) === activeVariantKey"
                    class="w-2.5 h-2.5 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                  <span v-else class="w-2.5 flex-shrink-0" />
                  {{ row.saleCount }}-sale build{{ row.plainKey ? '' : ' +T13' }}
                </button>
                <!-- Only worth its own toggle when the plain build survived alongside Tier 13 —
                     otherwise Tier 13 is baked into the row above with no non-T13 alternative to pick. -->
                <button
                  v-if="row.tier13Key && row.plainKey"
                  v-tippy="'Also unlocks Tier 13 research'"
                  class="px-1.5 py-1 text-[8px] font-black uppercase tracking-wider rounded-md border transition-colors flex-shrink-0"
                  :class="
                    row.tier13Key === activeVariantKey
                      ? 'bg-amber-50 text-amber-600 border-amber-200'
                      : 'text-slate-400 border-slate-200 hover:bg-slate-50'
                  "
                  @click="selectVariant(row.tier13Key)"
                >
                  T13
                </button>
              </div>

              <!-- Continue Ascension (A1 only) -->
              <template v-if="index === 0">
                <div class="border-t border-slate-100 my-1" />
                <span v-if="!continueAvailable" v-tippy="continueDisabledTooltip" class="block">
                  <button
                    disabled
                    class="w-full text-left px-3 py-1.5 text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 opacity-40 cursor-not-allowed text-slate-500"
                  >
                    <span class="w-2.5 flex-shrink-0" />
                    Continue Asc.
                  </button>
                </span>
                <button
                  v-else
                  class="w-full text-left px-3 py-1.5 text-[9px] font-black uppercase tracking-wider transition-colors flex items-center gap-1.5"
                  :class="
                    activeVariantKey === 'continue'
                      ? 'bg-indigo-50 text-indigo-600'
                      : 'text-slate-600 hover:bg-slate-50'
                  "
                  @click="selectVariant('continue')"
                >
                  <svg
                    v-if="activeVariantKey === 'continue'"
                    class="w-2.5 h-2.5 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                  <span v-else class="w-2.5 flex-shrink-0" />
                  Continue Asc.
                </button>
              </template>
            </div>
          </div>

          <!-- Compare variants -->
          <button
            v-if="variantRows.length > 1 || continueAvailable"
            v-tippy="'Compare all variants side by side'"
            class="flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 border border-slate-200/80 hover:border-indigo-200/50 rounded-lg text-[9px] font-black text-slate-500 hover:text-indigo-600 transition-colors uppercase tracking-wider shadow-sm flex-shrink-0"
            @click="isComparisonOpen = true"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
              />
            </svg>
            Compare
          </button>

          <!-- Save single ascension to library -->
          <button
            @click="emit('saveSingleToLibrary')"
            :disabled="isSavingSingle"
            v-tippy="saveSingleSuccess ? 'Saved to plan library!' : 'Save to plan library'"
            class="flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 border border-slate-200/80 hover:border-indigo-200/50 rounded-lg text-[9px] font-black text-slate-500 hover:text-indigo-600 transition-colors uppercase tracking-wider shadow-sm flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg v-if="isSavingSingle" class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <svg v-else-if="saveSingleSuccess" class="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <svg v-else class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            {{ isSavingSingle ? 'Saving...' : saveSingleSuccess ? 'Saved!' : 'Save' }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-4 gap-x-1.5 sm:gap-x-3 gap-y-2 mb-3.5">
        <!-- TE Progress -->
        <div class="space-y-0.5">
          <div class="text-[7px] sm:text-[9px] font-black text-slate-400 uppercase tracking-wide flex items-center gap-1 sm:gap-1.5">
            <div class="w-1 h-1 rounded-full bg-emerald-500"></div>
            TE Progress
          </div>
          <div class="flex items-baseline gap-0.5 sm:gap-1.5">
            <span class="text-sm sm:text-xl font-mono-premium font-black text-slate-400">{{ summary.startTE }}</span>
            <svg class="w-1.5 h-1.5 sm:w-3.5 sm:h-3.5 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <span class="text-base sm:text-2xl font-mono-premium font-black text-emerald-600">{{ summary.endTE }}</span>
          </div>
          <div class="text-[8px] sm:text-[9px] font-black text-emerald-500/80 uppercase tracking-tight mt-0.5">+{{ summary.teGained }}</div>
        </div>

        <!-- Peak ELR -->
        <div class="space-y-0.5">
          <div class="text-[7px] sm:text-[9px] font-black text-slate-400 uppercase tracking-wide flex items-center gap-1 sm:gap-1.5">
            <div class="w-1 h-1 rounded-full bg-indigo-500"></div>
            <span class="sm:hidden">Delivery</span><span class="hidden sm:inline">Delivery Rate</span>
          </div>
          <div class="flex items-center gap-0.5 sm:gap-1.5">
            <span class="text-[11px] sm:text-xl font-mono-premium font-black text-indigo-600">{{ formatNumber(summary.maxELR * 3600, 3) }}</span>
            <span class="text-[6px] sm:text-[9px] font-black text-slate-400 uppercase">/HR</span>
          </div>
          <div v-if="summary.alternativeELRs && summary.alternativeELRs.length > 0" class="flex flex-col gap-0.5 mt-0.5">
            <div
              v-for="alt in summary.alternativeELRs"
              :key="alt.label"
              class="flex items-baseline gap-0.5 sm:gap-1"
            >
              <span
                class="text-[7px] sm:text-[10px] font-mono-premium font-bold"
                :class="alt.isActive ? 'text-indigo-500' : 'text-slate-400'"
              >{{ formatNumber(alt.elr * 3600, 3) }}</span>
              <span class="text-[6px] sm:text-[8px] font-black uppercase tracking-wide" :class="alt.isActive ? 'text-indigo-400' : 'text-slate-300'">/hr</span>
              <span class="text-[6px] sm:text-[8px] font-black uppercase tracking-wide" :class="alt.isActive ? 'text-indigo-500' : 'text-slate-400'">{{ alt.label }}<span v-if="alt.isActive"> (used)</span></span>
            </div>
          </div>
        </div>

        <!-- Total Duration -->
        <div class="space-y-0.5">
          <div class="text-[7px] sm:text-[9px] font-black text-slate-400 uppercase tracking-wide flex items-center gap-1 sm:gap-1.5">
            <div class="w-1 h-1 rounded-full bg-indigo-600"></div>
            Duration
          </div>
          <div class="flex items-center gap-1 sm:gap-1.5">
            <span class="text-sm sm:text-xl font-mono-premium font-black text-indigo-600">{{ formatDuration(summary.totalDurationSeconds) }}</span>
          </div>
        </div>

        <!-- Longest Single TE Wait -->
        <div v-if="summary.lastTEDurationSeconds > 0" class="space-y-0.5">
          <div class="text-[7px] sm:text-[9px] font-black text-slate-400 uppercase tracking-wide flex items-center gap-1 sm:gap-1.5">
            <div class="w-1 h-1 rounded-full bg-indigo-400"></div>
            Last TE Wait
          </div>
          <div class="flex items-center gap-1 sm:gap-1.5">
            <span class="text-sm sm:text-xl font-mono-premium font-black text-indigo-500">{{ formatDuration(summary.lastTEDurationSeconds) }}</span>
          </div>
        </div>
      </div>

      <!-- Warnings -->
      <div v-if="warnings.length > 0" class="mb-3 space-y-1">
        <div v-for="warning in warnings" :key="warning" 
             class="bg-amber-50 border border-amber-100 rounded-xl px-2.5 py-1.5 flex items-center gap-2 text-amber-600">
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span class="text-[9px] font-black uppercase tracking-wider leading-tight">{{ warning }}</span>
        </div>
      </div>

      <!-- Collapsible Detailed Breakdown Content -->
      <div v-if="isExpanded" class="mt-2.5 border-t border-slate-100 pt-2.5 space-y-2 animate-in fade-in slide-in-from-top-4 duration-500">
        <!-- SE Cost & Balance Grid -->
        <div class="grid grid-cols-3 gap-x-1.5 sm:gap-x-4 gap-y-2 bg-slate-50/50 border border-slate-100 rounded-xl p-2 sm:p-3">
          <!-- SE Cost -->
          <div class="space-y-0.5">
            <div class="text-[7px] sm:text-[9px] font-black text-slate-400 uppercase tracking-wide flex items-center gap-1 sm:gap-1.5">
              <div class="w-1 h-1 rounded-full bg-rose-500"></div>
              SE Consumed
            </div>
            <div class="flex items-center gap-1 sm:gap-1.5">
              <span class="text-sm sm:text-xl font-mono-premium font-black text-rose-600">{{ formatNumber(summary.totalShiftCost, 3) }}</span>
              <img :src="iconURL('egginc/egg_soul.png', 32)" class="w-3 h-3 sm:w-4 sm:h-4 opacity-80" alt="SE" />
            </div>
          </div>

          <!-- Ending SE Balance -->
          <div class="space-y-0.5">
            <div class="text-[7px] sm:text-[9px] font-black text-slate-400 uppercase tracking-wide flex items-center gap-1 sm:gap-1.5">
              <div class="w-1 h-1 rounded-full bg-slate-400"></div>
              Ending SE Balance
            </div>
            <div class="flex items-center gap-1 sm:gap-1.5">
              <span class="text-sm sm:text-xl font-mono-premium font-black" :class="summary.endSoulEggs < 0 ? 'text-rose-600' : 'text-slate-600'">
                {{ formatNumber(summary.endSoulEggs, 3) }}
              </span>
              <img :src="iconURL('egginc/egg_soul.png', 32)" class="w-3 h-3 sm:w-4 sm:h-4 opacity-40" alt="SE" />
            </div>
            <div class="text-[7px] sm:text-[9px] font-black text-slate-400 uppercase tracking-tight">shift count: {{ summary.endShiftCount }}</div>
          </div>

          <!-- Total Eggs Delivered -->
          <div class="space-y-0.5">
            <div class="text-[7px] sm:text-[9px] font-black text-slate-400 uppercase tracking-wide flex items-center gap-1 sm:gap-1.5">
              <div class="w-1 h-1 rounded-full bg-slate-400"></div>
              Eggs Delivered
            </div>
            <div class="flex items-center gap-1 sm:gap-1.5">
              <span class="text-sm sm:text-xl font-mono-premium font-black text-slate-600">
                {{ formatNumber(Object.values(summary.eggsDelivered).reduce((s, n) => s + n, 0), 3) }}
              </span>
            </div>
          </div>
        </div>

        <!-- TE Breakdown -->
        <div class="bg-slate-50/50 border border-slate-100 rounded-xl p-2 sm:p-3">
          <div class="grid grid-cols-5 gap-1 sm:gap-2">
            <div v-for="egg in eggs" :key="egg" class="flex flex-col items-center sm:flex-row sm:items-center gap-1 sm:gap-2 bg-white p-1 sm:p-1.5 rounded-lg border border-slate-200/50 shadow-sm">
              <!-- Egg Icon -->
              <div class="w-5 h-5 sm:w-12 sm:h-12 flex-shrink-0 bg-slate-50 rounded-md p-0.5 sm:p-1.5 border border-slate-100 shadow-inner">
                <img :src="iconURL(`egginc/egg_${egg}.png`, 64)" class="w-full h-full object-contain" :alt="egg" />
              </div>

              <div class="space-y-0 sm:space-y-0.5 text-center sm:text-left">
                <!-- TE Count -->
                <div class="flex items-center justify-center sm:justify-start gap-0.5 sm:gap-1">
                  <span class="text-[10px] sm:text-base font-mono-premium font-black text-slate-800 leading-none">
                    {{ summary.finalTE[egg] || 0 }}
                  </span>
                  <span v-if="summary.teEarned[egg]" class="text-[7px] sm:text-[8px] font-black text-emerald-500 leading-none">
                    (+{{ summary.teEarned[egg] }})
                  </span>
                </div>

                <!-- Eggs Delivered -->
                <div class="text-[7px] sm:text-[8px] font-bold text-slate-400 font-mono-premium leading-none">
                  {{ formatNumber(summary.eggsDelivered[egg], 3) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Shift List -->
        <ShiftSummary
          v-for="(shift, index) in shifts"
          :key="index"
          :title="shift.title"
          :egg="shift.egg"
          :actions="shift.actions"
          :duration="shift.duration"
          :cost="shift.cost"
          :cost-type="shift.costType"
          :start-time="shift.startTime"
          :end-time="shift.endTime"
        />
      </div>
    </div>

    <VariantComparisonModal
      :show="isComparisonOpen"
      :variants="variants"
      :active-variant-key="activeVariantKey"
      :target-t-e="targetTE"
      @close="isComparisonOpen = false"
      @select="onCompareSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { formatNumber, formatDuration, formatUnixToDateInput, formatUnixToTimeInput } from '@/lib/format';
import { getLocalTimestampInTimezone } from '@/lib/events';
import { iconURL } from 'lib';
import type { AscensionSummary } from '@/auto/types';
import type { VirtueEgg } from '@/types';
import VariantComparisonModal from './VariantComparisonModal.vue';
import type { VariantKey, VariantResult } from '@/stores/autoPlanner';
import ShiftSummary from './ShiftSummary.vue';

const props = defineProps<{
  summary: AscensionSummary & {
    comparison?: {
      daysFaster: number;
      otherPlanLabel: string;
      message?: string;
    };
    alternativeELRs?: {
      elr: number;
      label: string;
      isActive: boolean;
    }[];
  };
  actions: any[];
  index: number;
  total: number;
  targetTE: number | null;
  variants: Partial<Record<VariantKey, VariantResult>>;
  activeVariantKey?: VariantKey;
  result3SkippedReason?: string;
  isSavingSingle?: boolean;
  saveSingleSuccess?: boolean;
  /** IANA timezone name, same one the initial Start Time form (`SchedulingInputs.vue`) uses — the
   * end-time editor below reads and writes through this same timezone so an edited value lines up
   * with what the user typed for the plan's start. */
  timezone: string;
  /** True when this ascension already has a user-set end-time override active (`autoPlannerStore.endTimeOverrides`). */
  hasEndTimeOverride?: boolean;
}>();

const emit = defineEmits<{
  (e: 'setPlanVariant', variant: VariantKey): void;
  (e: 'saveSingleToLibrary'): void;
  /** Sets (a finite unix timestamp) or clears (`null`) this ascension's end-time override. */
  (e: 'overrideEndTime', endTime: number | null): void;
}>();

const isExpanded = ref(false);
const isDropdownOpen = ref(false);
const isComparisonOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

const isEditingEndTime = ref(false);
const editEndDate = ref('');
const editEndTime = ref('');
const endTimeEditError = ref('');

const startEditingEndTime = () => {
  editEndDate.value = formatUnixToDateInput(props.summary.endTime, props.timezone);
  editEndTime.value = formatUnixToTimeInput(props.summary.endTime, props.timezone);
  endTimeEditError.value = '';
  isEditingEndTime.value = true;
};

const cancelEditingEndTime = () => {
  isEditingEndTime.value = false;
  endTimeEditError.value = '';
};

const saveEndTimeOverride = () => {
  if (!editEndDate.value || !editEndTime.value) {
    endTimeEditError.value = 'Enter both a date and a time.';
    return;
  }
  const newEndTime = getLocalTimestampInTimezone(editEndDate.value, editEndTime.value, props.timezone);
  if (newEndTime <= props.summary.startTime) {
    endTimeEditError.value = "End time must be after this ascension's own start time.";
    return;
  }
  emit('overrideEndTime', newEndTime);
  isEditingEndTime.value = false;
  endTimeEditError.value = '';
};

const resetEndTimeOverride = () => {
  emit('overrideEndTime', null);
  isEditingEndTime.value = false;
  endTimeEditError.value = '';
};

const handleClickOutside = (e: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isDropdownOpen.value = false;
  }
};
onMounted(() => document.addEventListener('click', handleClickOutside));
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside));

// The variant key that actually produced `props.summary` — passed down from `bestResults`
// (`useAscensionGenerator.ts`) rather than re-derived by string-matching `strategyLabel`, which can't
// distinguish e.g. a 3-sale-tier13 build from a 1-sale one.
const activeVariantKey = computed(() => props.activeVariantKey ?? 'continue');

const activeVariantShortLabel = computed(() => {
  if (activeVariantKey.value === 'continue') return 'Continue';
  return activeVariantKey.value.replace('-tier13', '+T13');
});

// One row per sale count that has either variant present. The plain (non-Tier-13) variant is NOT
// guaranteed whenever the Tier-13 one is: runC3Variants (auto/shifts/c3.ts) skips computing the
// plain sibling once a Tier-13 attempt for that sale count succeeds, since it would always lose the
// comparison anyway — so a sale count can appear with only its `-tier13` key present.
const variantRows = computed(() => {
  const rows: { saleCount: number; plainKey?: VariantKey; tier13Key?: VariantKey }[] = [];
  for (const saleCount of [1, 2, 3] as const) {
    const plainKey: VariantKey = `${saleCount}-sale`;
    const tier13Key: VariantKey = `${saleCount}-sale-tier13`;
    const hasPlain = !!props.variants[plainKey];
    const hasTier13 = !!props.variants[tier13Key];
    if (!hasPlain && !hasTier13) continue;
    rows.push({ saleCount, plainKey: hasPlain ? plainKey : undefined, tier13Key: hasTier13 ? tier13Key : undefined });
  }
  return rows;
});

const continueAvailable = computed(() => !!props.variants.continue);

const continueDisabledTooltip = computed(() => {
  if (props.result3SkippedReason === 'startTimeTooFar') {
    return 'Start time must be within 1 hour of now to use Continue Ascension';
  }
  return 'No farm backup loaded — upload a backup to use Continue Ascension';
});

const selectVariant = (variant: VariantKey) => {
  isDropdownOpen.value = false;
  emit('setPlanVariant', variant);
};

// The modal is an alternate view onto the same picking mechanism as the dropdown, not a second
// source of truth — selecting a row calls the exact same emit.
const onCompareSelect = (variant: VariantKey) => {
  isComparisonOpen.value = false;
  emit('setPlanVariant', variant);
};
const eggs: VirtueEgg[] = ['curiosity', 'integrity', 'humility', 'resilience', 'kindness'];

const displayComparisons = computed(() => {
  const comparison = props.summary.comparison;
  if (!comparison) return [];
  if (comparison.message || comparison.daysFaster > 0.01) return [comparison];
  return [];
});

const warnings = computed(() => {
  const list: string[] = [];
  if (props.summary.endSoulEggs < 0) {
    list.push('Soul Egg balance will go negative. You may not be able to afford all shifts.');
  }
  if (props.summary.endTE < props.summary.startTE + 1) {
    list.push('No TE gained during this ascension. Goal may be unreachable or already met.');
  }
  return list;
});

const shifts = computed(() => {
  const actions = props.actions;
  const ascStartTime = props.summary.startTime;
  const shifts: any[] = [];
  let absoluteTime = ascStartTime;

  const isContinueCurrent = props.summary.strategyLabel === 'Continue current';
  const startEgg = (actions[0]?.type === 'start_ascension' && actions[0]?.payload?.initialEgg) || 'curiosity';

  let currentShift = {
    title: isContinueCurrent
      ? `${startEgg.charAt(0).toUpperCase() + startEgg.slice(1)} Shift`
      : 'C1 Shift',
    egg: startEgg,
    actions: [] as any[],
    duration: 0,
    cost: 0,
    costType: 'SE' as 'SE' | 'Virtue',
    startTime: absoluteTime,
    endTime: absoluteTime,
  };

  // Indices 1 and 2 are deliberately absent: the C1 -> {K1, I1} order is chosen dynamically at
  // simulation time (see runC1K1I1Segment in ascension.ts), so whichever shift lands in that
  // position isn't always K1 then I1 — those two are labeled from the shift's actual target egg
  // below instead of by fixed position.
  const titles = [
    'C1 Shift', undefined, undefined,
    'C2 Shift', 'K2 Shift', 'R1 Shift',
    'C3 Shift', 'H1 Shift', 'K3 Shift',
    'C4 Shift', 'I2 Shift', 'R2 Shift',
    'H2 Shift',
  ];
  const eggShiftTitles: Partial<Record<VirtueEgg, string>> = { kindness: 'K1 Shift', integrity: 'I1 Shift' };
  let shiftIndex = 0;

  for (const action of actions) {
    if (action.type === 'shift') {
      if (currentShift.actions.length > 0) {
        currentShift.endTime = absoluteTime;
        shifts.push(currentShift);
      }
      shiftIndex++;
      const nextEgg = action.payload.toEgg;
      const defaultTitle = `${nextEgg.charAt(0).toUpperCase() + nextEgg.slice(1)} Shift`;
      const title = isContinueCurrent
        ? defaultTitle
        : (shiftIndex === 1 || shiftIndex === 2)
          ? (eggShiftTitles[nextEgg as VirtueEgg] || defaultTitle)
          : (titles[shiftIndex] || defaultTitle);

      currentShift = {
        title: title,
        egg: nextEgg,
        actions: [action],
        duration: 0,
        cost: action.cost || 0,
        costType: 'SE',
        startTime: absoluteTime,
        endTime: absoluteTime,
      };
    } else {
      currentShift.actions.push(action);
      if (action.type.startsWith('wait_')) {
        const dt = action.totalTimeSeconds || action.payload.totalTimeSeconds || action.payload.timeSeconds || 0;
        currentShift.duration += dt;
        absoluteTime += dt;
      }
    }
  }

  if (currentShift.actions.length > 0) {
    currentShift.endTime = absoluteTime;
    shifts.push(currentShift);
  }

  return shifts;
});

const formatTimeRange = (start: number, end: number) => {
  // `Math.round`, not a bare `new Date(...)` — see `secondsToDate`'s doc comment (lib/format.ts):
  // `start`/`end` (an ascension's `summary.startTime`/`endTime`) are sums of hundreds of accumulated
  // purchase/wait durations and routinely land a sub-microsecond residue short of a whole second
  // even when "really" exactly on a boundary.
  const s = new Date(Math.round(start * 1000));
  const e = new Date(Math.round(end * 1000));

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    // Without this, `toLocaleString` falls back to the browser's own local timezone rather than the
    // plan's configured one (`props.timezone`, the same zone the Start Time form and the end-time
    // editor both read/write through) — whenever those two differ, this display and the editor it
    // opens would silently disagree by the zones' offset.
    timeZone: props.timezone,
  };

  return `${s.toLocaleString('en-US', options)} — ${e.toLocaleString('en-US', options)}`;
};
</script>

<style scoped>
.font-mono-premium {
  font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
}
</style>
