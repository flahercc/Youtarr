// Translates the summary newVideoScanScheduler.scanAll resolves with into the
// scheduled task run record. Per-tab and per-playlist failures come back inside
// the summary (scanAll only rejects when it cannot start), so they are read out
// here. Details keep counts only: run history stores them in a TEXT column, and
// one scan can fail on many sources at once.

const plural = (count, one, many) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

function describeFailures(failedTabs, failedPlaylists) {
  const parts = [];
  if (failedTabs > 0) parts.push(plural(failedTabs, 'channel tab', 'channel tabs'));
  if (failedPlaylists > 0) parts.push(plural(failedPlaylists, 'playlist', 'playlists'));
  return `${parts.join(' and ')} could not be checked; see the server log.`;
}

function toRunRecord(summary) {
  if (!summary || typeof summary !== 'object') {
    return { status: 'error', outcome: 'error', message: 'The scan returned no result.', details: null };
  }

  const channels = Number(summary.channelsScanned) || 0;
  const tabs = Number(summary.tabsScanned) || 0;
  const playlists = Number(summary.playlistsScanned) || 0;
  const found = Number(summary.newVideosFound) || 0;
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  const failedPlaylists = errors.filter((entry) => entry && entry.playlistId).length;
  const failedTabs = errors.length - failedPlaylists;
  const details = {
    channelsScanned: channels,
    tabsScanned: tabs,
    playlistsScanned: playlists,
    newVideosFound: found,
    failedTabs,
    failedPlaylists,
  };

  const counts = `Checked ${plural(channels, 'channel', 'channels')} (${plural(tabs, 'tab', 'tabs')}) `
    + `and ${plural(playlists, 'playlist', 'playlists')}; found ${plural(found, 'new video', 'new videos')}.`;

  if (errors.length === 0) {
    return { status: 'success', outcome: 'completed', message: counts, details };
  }
  return {
    status: 'error',
    outcome: errors.length >= tabs + playlists ? 'error' : 'partial',
    message: `${counts} ${describeFailures(failedTabs, failedPlaylists)}`,
    details,
  };
}

module.exports = { toRunRecord };
