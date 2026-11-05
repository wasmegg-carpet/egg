export function getColleggtibleIconPath(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9]/g, '');
  return `egginc/egg_${sanitized}.png`;
}

const RESEARCH_ICON_MAP: Record<string, string> = {
  epic_internal_incubators: 'egginc/r_icon_epic_internal_hatchery.png',
  cheaper_research: 'egginc/r_icon_lab_upgrade.png',
  int_hatch_calm: 'egginc/r_icon_internal_hatchery_calm.png',
  afx_mission_time: 'egginc/r_icon_afx_mission_duration.png',
  soul_eggs: 'egginc/r_icon_soul_food.png',
  int_hatch_sharing: 'egginc/r_icon_internal_hatchery_sharing.png',
  comfy_nests: 'egginc/r_icon_comfortable_nests.png',
  nutritional_sup: 'egginc/r_icon_supplements.png',
  excitable_chickens: 'egginc/r_icon_excitable.png',
  hab_capacity1: 'egginc/r_icon_hab_capacity.png',
  internal_hatchery1: 'egginc/r_icon_internal_hatchery.png',
  hatchery_expansion: 'egginc/r_icon_hatchery_capacity.png',
  bigger_eggs: 'egginc/r_icon_double_egg_size.png',
  internal_hatchery2: 'egginc/r_icon_internal_hatchery2.png',
  leafsprings: 'egginc/r_icon_improved_leafsprings.png',
  vehicle_reliablity: 'egginc/r_icon_free_tuneups.png',
  rooster_booster: 'egginc/r_icon_better_incubators2.png',
  hatchery_rebuild1: 'egginc/r_icon_hatchery_rebuild.png',
  usde_prime: 'egginc/r_icon_prime_certification.png',
  microlux: 'egginc/r_icon_microlux_suites.png',
  excoskeletons: 'egginc/r_icon_exoskeletons.png',
  internal_hatchery3: 'egginc/r_icon_internal_hatchery_expansion.png',
  egg_loading_bots: 'egginc/r_icon_egg_bots.png',
  super_alloy: 'egginc/r_icon_super_alloy_frames.png',
  internal_hatchery4: 'egginc/r_icon_internal_hatchery_expansion2.png',
  quantum_storage: 'egginc/r_icon_quantum_egg_storage.png',
  internal_hatchery5: 'egginc/r_icon_machine_learning_incubators.png',
  time_compress: 'egginc/r_icon_time_compression.png',
  chrystal_shells: 'egginc/r_icon_crystalline_shelling.png',
  multi_layering: 'egginc/r_icon_multiversal_layering.png',
  eggsistor: 'egginc/r_icon_eggsistor_miniturization.png',
  micro_coupling: 'egginc/r_icon_gravitational_coupling.png',
  neural_net_refine: 'egginc/r_icon_neural_net_refinement.png',
  matter_reconfig: 'egginc/r_icon_matter_reconfiguration.png',
};

export function getResearchIconPath(id: string): string {
  return RESEARCH_ICON_MAP[id] ?? `egginc/r_icon_${id}.png`;
}
