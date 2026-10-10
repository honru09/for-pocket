export function aiUiEnabled({ isRemote = false, config = {}, service = null } = {}) {
  return Boolean(isRemote && typeof service?.aiParseExpense === 'function');
}

export function aiSummaryUiEnabled({ isRemote = false, config = {}, service = null } = {}) {
  return Boolean(isRemote && typeof service?.aiSummary === 'function');
}
