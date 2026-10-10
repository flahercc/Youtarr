jest.mock('../../scheduledTaskManager', () => ({ updateTask: jest.fn() }));
jest.mock('../../../logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../configModule', () => ({ getConfig: jest.fn(), onConfigChange: jest.fn() }));
jest.mock('../../../models/channel', () => ({ findAll: jest.fn() }));
jest.mock('../../../models/channelvideo', () => ({ count: jest.fn() }));
jest.mock('../../../models', () => ({
  Playlist: { findAll: jest.fn() },
  PlaylistVideo: { count: jest.fn() },
}));
jest.mock('../../playlistModule', () => ({ fetchAllPlaylistVideos: jest.fn() }));
jest.mock('../channelVideoFetcher', () => ({
  shouldRefreshChannelVideos: jest.fn(),
  fetchAndSaveVideosViaYtDlp: jest.fn(),
  DEFAULT_MAX_VIDEO_COUNT: 50,
}));
jest.mock('../channelVideoQuery', () => ({ fetchNewestVideosFromDb: jest.fn() }));

describe('newVideoScanScheduler', () => {
  let scheduler;
  let scheduledTasks;
  let configModule;
  let Channel;
  let ChannelVideo;
  let Playlist;
  let PlaylistVideo;
  let playlistModule;
  let channelVideoFetcher;
  let channelVideoQuery;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    scheduledTasks = require('../../scheduledTaskManager');
    configModule = require('../../configModule');
    Channel = require('../../../models/channel');
    ChannelVideo = require('../../../models/channelvideo');
    ({ Playlist, PlaylistVideo } = require('../../../models'));
    playlistModule = require('../../playlistModule');
    channelVideoFetcher = require('../channelVideoFetcher');
    channelVideoQuery = require('../channelVideoQuery');

    channelVideoQuery.fetchNewestVideosFromDb.mockResolvedValue([]);
    channelVideoFetcher.shouldRefreshChannelVideos.mockReturnValue(true);
    channelVideoFetcher.fetchAndSaveVideosViaYtDlp.mockResolvedValue(undefined);
    ChannelVideo.count.mockResolvedValue(0);
    Channel.findAll.mockResolvedValue([]);
    Playlist.findAll.mockResolvedValue([]);
    PlaylistVideo.count.mockResolvedValue(0);
    playlistModule.fetchAllPlaylistVideos.mockResolvedValue(0);
    configModule.getConfig.mockReturnValue({});

    scheduler = require('../newVideoScanScheduler');
  });

  describe('scheduleTask', () => {
    const registered = () => scheduledTasks.updateTask.mock.calls[0][0];

    test('registers the scan with the shared scheduler under its schedule key', () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: true, channelScanFrequency: '0 */6 * * *' });
      scheduler.scheduleTask();
      expect(registered()).toEqual(expect.objectContaining({ id: 'channelScanFrequency', expression: '0 */6 * * *' }));
    });

    test('falls back to the registry default schedule when unset', () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: true });
      scheduler.scheduleTask();
      expect(registered().expression).toBe('0 14 * * *');
    });

    test('registers the schedule as off when the scan is disabled', () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: false });
      scheduler.scheduleTask();
      expect(registered().enabled).toBe(false);
    });

    test('allows manual runs while the schedule is off', () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: false });
      scheduler.scheduleTask();
      expect(registered().manualRunRequiresEnabled).toBe(false);
    });

    test('passes force through to the scan', async () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: true });
      const scanAll = jest.spyOn(scheduler, 'scanAll').mockResolvedValue({ errors: [] });
      scheduler.scheduleTask();
      await registered().run({ trigger: 'manual', force: true });
      expect(scanAll).toHaveBeenCalledWith(true);
    });

    test('hands the raw scan summary to onSummary', async () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: true });
      const summary = { channelsScanned: 1, tabsScanned: 1, playlistsScanned: 0, newVideosFound: 2, errors: [] };
      jest.spyOn(scheduler, 'scanAll').mockResolvedValue(summary);
      const onSummary = jest.fn();
      scheduler.scheduleTask();
      await registered().run({ trigger: 'manual', onSummary });
      expect(onSummary).toHaveBeenCalledWith(summary);
    });

    test('resolves the run with a run record', async () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: true });
      jest.spyOn(scheduler, 'scanAll').mockResolvedValue({ errors: [] });
      scheduler.scheduleTask();
      await expect(registered().run({ trigger: 'scheduled' })).resolves.toEqual(expect.objectContaining({ status: 'success' }));
    });

    test('reports running while a scan is in progress', () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: true });
      scheduler.scheduleTask();
      scheduler.scanning = true;
      expect(registered().isRunning()).toBe(true);
    });

    test('subscribe registers a config-change listener', () => {
      scheduler.subscribe();
      expect(configModule.onConfigChange).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('scanAllChannels', () => {
    test('scans each enabled tab for each enabled channel', async () => {
      Channel.findAll.mockResolvedValue([
        { channel_id: 'UC1', auto_download_enabled_tabs: 'video,short' },
      ]);
      ChannelVideo.count.mockResolvedValueOnce(2).mockResolvedValueOnce(4)
        .mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      const summary = await scheduler.scanAllChannels();

      expect(Channel.findAll).toHaveBeenCalledWith({ where: { enabled: true } });
      expect(channelVideoFetcher.fetchAndSaveVideosViaYtDlp).toHaveBeenCalledWith(
        expect.objectContaining({ channel_id: 'UC1' }), 'UC1', 'videos', 50
      );
      expect(channelVideoFetcher.fetchAndSaveVideosViaYtDlp).toHaveBeenCalledWith(
        expect.objectContaining({ channel_id: 'UC1' }), 'UC1', 'shorts', 50
      );
      expect(summary.channelsScanned).toBe(1);
      expect(summary.tabsScanned).toBe(2);
      expect(summary.newVideosFound).toBe(2); // (4-2) + (1-1)
      expect(summary.errors).toEqual([]);
    });

    test('passes the configured channelScanVideoLimit through to the fetch', async () => {
      Channel.findAll.mockResolvedValue([
        { channel_id: 'UC1', auto_download_enabled_tabs: 'video' },
      ]);
      configModule.getConfig.mockReturnValue({ channelScanVideoLimit: 150 });

      await scheduler.scanAllChannels();

      expect(channelVideoFetcher.fetchAndSaveVideosViaYtDlp).toHaveBeenCalledWith(
        expect.objectContaining({ channel_id: 'UC1' }), 'UC1', 'videos', 150
      );
    });

    test('still scans the primary videos tab even with no auto-download tabs enabled', async () => {
      Channel.findAll.mockResolvedValue([
        { channel_id: 'UC1', auto_download_enabled_tabs: '' },
      ]);

      const summary = await scheduler.scanAllChannels();

      expect(channelVideoFetcher.fetchAndSaveVideosViaYtDlp).toHaveBeenCalledWith(
        expect.objectContaining({ channel_id: 'UC1' }), 'UC1', 'videos', 50
      );
      expect(summary.channelsScanned).toBe(1);
      expect(summary.tabsScanned).toBe(1);
    });

    test('skips a channel entirely when the videos tab is hidden and no auto-download tabs are enabled', async () => {
      Channel.findAll.mockResolvedValue([
        { channel_id: 'UC1', auto_download_enabled_tabs: '', hidden_tabs: 'videos' },
      ]);

      const summary = await scheduler.scanAllChannels();

      expect(channelVideoFetcher.fetchAndSaveVideosViaYtDlp).not.toHaveBeenCalled();
      expect(summary.channelsScanned).toBe(0);
      expect(summary.tabsScanned).toBe(0);
    });

    test('skips a tab whose freshness gate says no refresh is needed', async () => {
      Channel.findAll.mockResolvedValue([
        { channel_id: 'UC1', auto_download_enabled_tabs: 'video' },
      ]);
      channelVideoFetcher.shouldRefreshChannelVideos.mockReturnValue(false);

      await scheduler.scanAllChannels();

      expect(channelVideoFetcher.fetchAndSaveVideosViaYtDlp).not.toHaveBeenCalled();
    });

    test('force bypasses the freshness gate so a recently-fetched tab is still re-checked', async () => {
      Channel.findAll.mockResolvedValue([
        { channel_id: 'UC1', auto_download_enabled_tabs: 'video' },
      ]);
      channelVideoFetcher.shouldRefreshChannelVideos.mockReturnValue(false);

      await scheduler.scanAllChannels(true);

      expect(channelVideoFetcher.fetchAndSaveVideosViaYtDlp).toHaveBeenCalledWith(
        expect.objectContaining({ channel_id: 'UC1' }), 'UC1', 'videos', 50
      );
    });

    test('isolates one channel/tab failure so the rest of the scan still runs', async () => {
      Channel.findAll.mockResolvedValue([
        { channel_id: 'UC1', auto_download_enabled_tabs: 'video' },
        { channel_id: 'UC2', auto_download_enabled_tabs: 'video' },
      ]);
      channelVideoFetcher.fetchAndSaveVideosViaYtDlp
        .mockRejectedValueOnce(new Error('yt-dlp failed'))
        .mockResolvedValueOnce(undefined);

      const summary = await scheduler.scanAllChannels();

      expect(summary.channelsScanned).toBe(2);
      expect(summary.errors).toEqual([
        { channelId: 'UC1', tabType: 'videos', message: 'yt-dlp failed' },
      ]);
      expect(channelVideoFetcher.fetchAndSaveVideosViaYtDlp).toHaveBeenCalledTimes(2);
    });

    test('rejects with SCAN_IN_PROGRESS when a scan is already running', async () => {
      Channel.findAll.mockResolvedValue([]);
      const firstScan = scheduler.scanAllChannels();

      await expect(scheduler.scanAllChannels()).rejects.toThrow('SCAN_IN_PROGRESS');

      await firstScan;
    });

    test('allows a new scan once the previous one finishes', async () => {
      Channel.findAll.mockResolvedValue([]);
      await scheduler.scanAllChannels();
      await expect(scheduler.scanAllChannels()).resolves.toBeDefined();
    });
  });

  describe('scanAll', () => {
    test('scans channels and playlists in one pass', async () => {
      Channel.findAll.mockResolvedValue([
        { channel_id: 'UC1', auto_download_enabled_tabs: 'video' },
      ]);
      Playlist.findAll.mockResolvedValue([
        { playlist_id: 'PL1', lastFetched: null },
      ]);
      PlaylistVideo.count.mockResolvedValueOnce(2).mockResolvedValueOnce(5);

      const summary = await scheduler.scanAll();

      expect(Playlist.findAll).toHaveBeenCalledWith({ where: { enabled: true } });
      expect(playlistModule.fetchAllPlaylistVideos).toHaveBeenCalledWith('PL1');
      expect(summary.channelsScanned).toBe(1);
      expect(summary.playlistsScanned).toBe(1);
      expect(summary.newVideosFound).toBe(3); // 5 - 2 from the playlist (channel tab found none)
      expect(summary.errors).toEqual([]);
    });

    test('skips a playlist whose freshness gate says no refresh is needed', async () => {
      Playlist.findAll.mockResolvedValue([
        { playlist_id: 'PL1', lastFetched: new Date() },
      ]);

      await scheduler.scanAll();

      expect(playlistModule.fetchAllPlaylistVideos).not.toHaveBeenCalled();
    });

    test('force bypasses the playlist freshness gate', async () => {
      Playlist.findAll.mockResolvedValue([
        { playlist_id: 'PL1', lastFetched: new Date() },
      ]);

      await scheduler.scanAll(true);

      expect(playlistModule.fetchAllPlaylistVideos).toHaveBeenCalledWith('PL1');
    });

    test('treats a concurrent fetch of the same playlist as a skip, not an error', async () => {
      Playlist.findAll.mockResolvedValue([
        { playlist_id: 'PL1', lastFetched: null },
      ]);
      playlistModule.fetchAllPlaylistVideos.mockRejectedValue(new Error('FETCH_IN_PROGRESS'));

      const summary = await scheduler.scanAll();

      expect(summary.errors).toEqual([]);
    });

    test('isolates one playlist failure so the rest of the scan still runs', async () => {
      Playlist.findAll.mockResolvedValue([
        { playlist_id: 'PL1', lastFetched: null },
        { playlist_id: 'PL2', lastFetched: null },
      ]);
      playlistModule.fetchAllPlaylistVideos
        .mockRejectedValueOnce(new Error('yt-dlp failed'))
        .mockResolvedValueOnce(0);

      const summary = await scheduler.scanAll();

      expect(summary.playlistsScanned).toBe(2);
      expect(summary.errors).toEqual([
        { playlistId: 'PL1', message: 'yt-dlp failed' },
      ]);
      expect(playlistModule.fetchAllPlaylistVideos).toHaveBeenCalledTimes(2);
    });

    test('rejects with SCAN_IN_PROGRESS when a scan is already running', async () => {
      const firstScan = scheduler.scanAll();

      await expect(scheduler.scanAll()).rejects.toThrow('SCAN_IN_PROGRESS');

      await firstScan;
    });

    test('scanAllChannels also rejects while a scanAll is in progress, and vice versa', async () => {
      const firstScan = scheduler.scanAll();

      await expect(scheduler.scanAllChannels()).rejects.toThrow('SCAN_IN_PROGRESS');

      await firstScan;
    });
  });
});
