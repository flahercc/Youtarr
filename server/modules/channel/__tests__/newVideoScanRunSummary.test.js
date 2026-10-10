const { toRunRecord } = require('../newVideoScanRunSummary');

const summary = (overrides = {}) => ({
  channelsScanned: 12,
  tabsScanned: 14,
  playlistsScanned: 3,
  newVideosFound: 5,
  errors: [],
  ...overrides,
});

describe('newVideoScanRunSummary.toRunRecord', () => {
  test('records a clean scan as a completed success', () => {
    const record = toRunRecord(summary());
    expect([record.status, record.outcome]).toEqual(['success', 'completed']);
  });

  test('describes what a clean scan checked and found', () => {
    expect(toRunRecord(summary()).message)
      .toBe('Checked 12 channels (14 tabs) and 3 playlists; found 5 new videos.');
  });

  test('uses singular wording for counts of one', () => {
    const record = toRunRecord(summary({ channelsScanned: 1, tabsScanned: 1, playlistsScanned: 1, newVideosFound: 1 }));
    expect(record.message).toBe('Checked 1 channel (1 tab) and 1 playlist; found 1 new video.');
  });

  test('records counts in details', () => {
    expect(toRunRecord(summary()).details).toEqual({
      channelsScanned: 12,
      tabsScanned: 14,
      playlistsScanned: 3,
      newVideosFound: 5,
      failedTabs: 0,
      failedPlaylists: 0,
    });
  });

  test('records a scan with some failed sources as a partial error', () => {
    const record = toRunRecord(summary({ errors: [{ channelId: 'UC1', tabType: 'videos', message: 'boom' }] }));
    expect([record.status, record.outcome]).toEqual(['error', 'partial']);
  });

  test('records a scan where every source failed as an error', () => {
    const errors = [
      { channelId: 'UC1', tabType: 'videos', message: 'boom' },
      { playlistId: 'PL1', message: 'boom' },
    ];
    const record = toRunRecord(summary({ tabsScanned: 1, playlistsScanned: 1, errors }));
    expect([record.status, record.outcome]).toEqual(['error', 'error']);
  });

  test('names failed channel tabs and playlists separately', () => {
    const errors = [
      { channelId: 'UC1', tabType: 'videos', message: 'boom' },
      { channelId: 'UC2', tabType: 'shorts', message: 'boom' },
      { playlistId: 'PL1', message: 'boom' },
    ];
    expect(toRunRecord(summary({ errors })).message).toMatch(
      /found 5 new videos\. 2 channel tabs and 1 playlist could not be checked; see the server log\.$/
    );
  });

  test('keeps failure counts, never the raw error list, in details', () => {
    const errors = Array.from({ length: 500 }, (_, i) => ({ channelId: `UC${i}`, tabType: 'videos', message: 'x'.repeat(200) }));
    const { details } = toRunRecord(summary({ tabsScanned: 600, errors }));
    expect(JSON.stringify(details).length).toBeLessThan(300);
  });

  test('records a missing summary as an error', () => {
    expect(toRunRecord(undefined)).toEqual({
      status: 'error', outcome: 'error', message: 'The scan returned no result.', details: null,
    });
  });
});
