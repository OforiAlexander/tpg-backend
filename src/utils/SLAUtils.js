/**
 * Calculate SLA compliance based on response and resolution times
 */
function calculateSLACompliance(avgFirstResponse, avgResolution) {
  const slaTargets = {
    first_response_hours: 4,
    resolution_hours: 48
  };

  const responseCompliance =
    avgFirstResponse <= slaTargets.first_response_hours
      ? 100
      : (slaTargets.first_response_hours / avgFirstResponse) * 100;

  const resolutionCompliance =
    avgResolution <= slaTargets.resolution_hours
      ? 100
      : (slaTargets.resolution_hours / avgResolution) * 100;

  return Number(((responseCompliance + resolutionCompliance) / 2).toFixed(1));
}

function calculateEscalationRate(tickets) {
  // Placeholder logic – replace with actual
  const escalated = tickets.filter(t => t.escalated).length;
  return Number(((escalated / tickets.length) * 100).toFixed(1));
}

function calculateSatisfactionTrend(currentData, previousData) {
  const currentAvg = average(currentData);
  const previousAvg = average(previousData);
  const change = currentAvg - previousAvg;
  return Number(change.toFixed(1));

  function average(arr) {
    if (!arr || !arr.length) return 0;
    const sum = arr.reduce((acc, val) => acc + val, 0);
    return sum / arr.length;
  }
}

module.exports = {
  calculateSLACompliance,
  calculateEscalationRate,
  calculateSatisfactionTrend
};
