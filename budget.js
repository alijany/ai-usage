// Daily budget from the current reading alone; nothing is stored.
//
// The weekly window is split into seven 24-hour days counted from the
// window's start (reset minus 7 days). Earlier days are allotted their even
// share, 100/7 % each; weekly use beyond that counts as today's. If earlier
// days used less, the saving is spread over today and the days that remain:
//
//   earlier days   = min(used, days passed × 100/7)
//   today's budget = (100 - earlier days) / days remaining, today included
//   used today     = used - earlier days
//
// Within the even pace today's budget is 100/7 %. Below it, today's use
// cannot be told apart from earlier days' use, so it lowers the budget for
// today and the remaining days instead of showing as used today.

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const PER_DAY = 100 / 7;

function budget(used, resetsAt, now = Date.now()) {
  const reset = resetsAt.getTime();
  const weekStart = reset - WEEK;
  const elapsed = Math.min(WEEK - 1, Math.max(0, now - weekStart));
  const index = Math.floor(elapsed / DAY);          // 0..6
  const daysRemaining = 7 - index;
  const earlier = Math.min(used, index * PER_DAY);
  const today = Math.max(0, 100 - earlier) / daysRemaining;
  const usedToday = used - earlier;

  return {
    day: index + 1,
    dayEnd: new Date(weekStart + (index + 1) * DAY),
    earlier,
    today,
    usedToday,
    left: today - usedToday,
    allowance: earlier + today,                      // weekly % allowed through the end of today
    daysRemaining,
  };
}

module.exports = { budget };
