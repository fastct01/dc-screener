/**
 * SEED TABLE — US states with a data-center sales/use-tax exemption or comparable statutory program,
 * per NCSL "Subsidizing Servers" and Good Jobs First coverage as generally reported through 2025.
 * This is a screening prior, not legal advice: thresholds, sunsets and eligibility change every session.
 * Each entry must be verified against the current statute before a memo leaves the building.
 */
export const STATE_DC_PROGRAMS = {
  'US-AL': 'Data processing center sales/use tax abatement',
  'US-AZ': 'Computer Data Center Program (TPT/use tax exemption)',
  'US-GA': 'High-technology data center equipment sales tax exemption',
  'US-IL': 'Data Center Investment Program (sales tax + credit)',
  'US-IN': 'Data center sales tax exemption (up to 50 yrs)',
  'US-IA': 'Data center sales/use tax exemption + property tax',
  'US-KS': 'Data center sales tax exemption (2024 statute)',
  'US-KY': 'Data center sales/use tax exemption (2024)',
  'US-MI': 'Data center sales/use tax exemption (enterprise/co-located)',
  'US-MN': 'Data center sales tax refund program',
  'US-MS': 'Data center sales tax exemption',
  'US-MO': 'Data center sales/use tax exemption',
  'US-NE': 'Nebraska Advantage / ImagiNE data center incentives',
  'US-NV': 'Data center partial sales & property tax abatement',
  'US-NC': 'Data center sales tax exemption',
  'US-ND': 'Data center sales tax exemption',
  'US-OH': 'Data center sales tax exemption',
  'US-OK': 'Computer services/data processing sales tax exemption',
  'US-OR': 'Enterprise zone property tax abatements (local)',
  'US-PA': 'Computer data center equipment sales tax exemption',
  'US-SC': 'Data center sales tax exemption',
  'US-SD': 'Data center sales tax exemption',
  'US-TN': 'Qualified data center sales tax exemption',
  'US-TX': 'Data center sales tax exemption (Tax Code §151.359)',
  'US-UT': 'Data center sales tax exemption',
  'US-VA': 'Data center retail sales/use tax exemption',
  'US-WA': 'Rural county data center sales tax exemption',
  'US-WV': 'High-technology / data center property & sales tax treatment',
  'US-WI': 'Data center sales/use tax exemption (2023)',
  'US-WY': 'Data center sales tax exemption',
  'US-ID': 'Data center sales tax exemption (2020)',
  'US-NY': 'Internet data center sales tax exemption',
  'US-CT': 'Data center incentive agreements (2021)',
};

export function lookupProgram(stateCode) {
  if (!stateCode) return { hasProgram: false, note: null };
  const note = STATE_DC_PROGRAMS[stateCode];
  return { hasProgram: !!note, note: note || null };
}
