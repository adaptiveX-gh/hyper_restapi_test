export function passesContextGuards(direction, ctx = {}) {
  const {
    bullPct = 0,
    bearPct = 0,
    confirm = 0,
    earlyWarn = 0,
    resilience = 0,
    LaR = 0,
    shock = 0,
    biasSlope15m = 0
  } = ctx;

  const reasons = [];
  const isLong = direction === 'LONG';

  const basicPass = isLong ? bullPct >= 45 : bearPct >= 45;
  if (!basicPass) {
    reasons.push('Composite below 45%');
  }

  if (isLong ? confirm < 0.1 : confirm > -0.1) {
    reasons.push('Confirmation weak');
  }

  if (isLong ? earlyWarn < 0 : earlyWarn > 0) {
    reasons.push('Early-Warn against');
  }

  if (LaR < 0.3) reasons.push('LaR < 0.30');

  if (isLong ? resilience < -0.2 : resilience > 0.2) {
    reasons.push('Low Resilience');
  }

  if (Math.abs(shock) > 0.7) reasons.push('Liquidity Shock');

  // biasSlope15m placeholder check
  if (Math.abs(biasSlope15m) > 0.5) reasons.push('Bias slope adverse');

  let grade = 'Strong';
  if (!basicPass || reasons.includes('Confirmation weak')) {
    grade = 'Vetoed';
  } else if (reasons.length) {
    grade = 'Caution';
  }

  return { grade, reasons };
}
