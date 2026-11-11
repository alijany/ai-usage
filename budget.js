// Daily budget on a fixed schedule: the weekly window is split into seven
// equal 24-hour days counted from the window's start (reset minus 7 days).
// Each day adds 100/7 % to the allowance, so whatever earlier days saved or
// overspent carries into today. Needs only the current reading: no history.

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const PER_DAY = 100 / 7;

function budget(used, resetsAt, now = Date.now()) {
  const reset = resetsAt.getTime();
  const weekStart = reset - WEEK;
  const elapsed = Math.min(WEEK - 1, Math.max(0, now - weekStart));
  const index = Math.floor(elapsed / DAY);          // 0..6
  const allowance = (index + 1) * PER_DAY;           // cumulative, through the end of today
  const daysLeft = Math.max(1, (reset - now) / DAY);

  return {
    day: index + 1,
    dayEnd: new Date(weekStart + (index + 1) * DAY),
    perDay: PER_DAY,
    allowance,
    left: allowance - used,
    evenFromNow: (100 - used) / daysLeft,           // alternative: spread what is left over the rest
    daysLeft: (reset - now) / DAY,
  };
}

module.exports = { budget };
