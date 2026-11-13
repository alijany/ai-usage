// Rolling daily budget. The weekly window is split into seven 24-hour days
// counted from the window's start (reset minus 7 days). At the start of each
// day, what is left of the week is spread evenly over the days that remain,
// today included:
//
//   today's budget = (100 - used at day start) / days remaining
//   left today     = today's budget - (used now - used at day start)
//
// Saving on earlier days raises later budgets; overspending lowers them.
// The reading at the start of the day is kept in `state` between calls.

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const SAME_WINDOW_MS = 60 * 60 * 1000; // reset times jitter slightly between readings

// state: { reset, day, start, lastUsed } from the previous call, or undefined.
function budget(used, resetsAt, state, now = Date.now()) {
  const reset = resetsAt.getTime();
  const weekStart = reset - WEEK;
  const elapsed = Math.min(WEEK - 1, Math.max(0, now - weekStart));
  const index = Math.floor(elapsed / DAY);          // 0..6
  const sameWindow = state && Math.abs(state.reset - reset) < SAME_WINDOW_MS;

  let start;
  if (sameWindow && state.day === index) start = state.start;
  // New day right after the previous one: its last reading is the closest
  // to the day boundary we have.
  else if (sameWindow && state.day === index - 1) start = state.lastUsed;
  // First day of a window: the window starts at 0.
  else if (index === 0) start = 0;
  // No usable history: count everything so far as earlier days' use.
  else start = used;
  start = Math.min(start, used);

  const daysRemaining = 7 - index;
  const today = Math.max(0, 100 - start) / daysRemaining;
  const usedToday = used - start;

  return {
    day: index + 1,
    dayEnd: new Date(weekStart + (index + 1) * DAY),
    start,
    today,
    usedToday,
    left: today - usedToday,
    allowance: start + today,                        // weekly % allowed through the end of today
    daysRemaining,
    state: { reset, day: index, start, lastUsed: used },
  };
}

module.exports = { budget };
