jest.mock('node-cron', () => ({ schedule: jest.fn(), validate: jest.fn(() => true) }));
jest.mock('../../../logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../configModule', () => ({ getConfig: jest.fn(), onConfigChange: jest.fn() }));
jest.mock('../../../models/channel', () => ({ findAll: jest.fn() }));
jest.mock('../../../models/channelvideo', () => ({ count: jest.fn() }));
jest.mock('../channelVideoFetcher', () => ({
  shouldRefreshChannelVideos: jest.fn(),
  fetchAndSaveVideosViaYtDlp: jest.fn(),
  DEFAULT_MAX_VIDEO_COUNT: 50,
}));
jest.mock('../channelVideoQuery', () => ({ fetchNewestVideosFromDb: jest.fn() }));

describe('newVideoScanScheduler', () => {
  let scheduler;
  let cron;
  let configModule;
  let Channel;
  let ChannelVideo;
  let channelVideoFetcher;
  let channelVideoQuery;
  let logger;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    cron = require('node-cron');
    cron.validate.mockReturnValue(true);
    cron.schedule.mockReturnValue({ stop: jest.fn() });
    configModule = require('../../configModule');
    Channel = require('../../../models/channel');
    ChannelVideo = require('../../../models/channelvideo');
    channelVideoFetcher = require('../channelVideoFetcher');
    channelVideoQuery = require('../channelVideoQuery');
    logger = require('../../../logger');

    channelVideoQuery.fetchNewestVideosFromDb.mockResolvedValue([]);
    channelVideoFetcher.shouldRefreshChannelVideos.mockReturnValue(true);
    channelVideoFetcher.fetchAndSaveVideosViaYtDlp.mockResolvedValue(undefined);
    ChannelVideo.count.mockResolvedValue(0);
    configModule.getConfig.mockReturnValue({});

    scheduler = require('../newVideoScanScheduler');
  });

  describe('scheduleTask', () => {
    test('schedules a daily cron at the configured time when enabled', () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: true, channelScanTime: '14:30' });
      scheduler.scheduleTask();
      expect(cron.schedule).toHaveBeenCalledWith('30 14 * * *', expect.any(Function));
    });

    test('does not schedule when disabled', () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: false, channelScanTime: '14:00' });
      scheduler.scheduleTask();
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    test('falls back to the default time when unset', () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: true });
      scheduler.scheduleTask();
      expect(cron.schedule).toHaveBeenCalledWith('0 14 * * *', expect.any(Function));
    });

    test('does not schedule a malformed time', () => {
      configModule.getConfig.mockReturnValue({ channelScanEnabled: true, channelScanTime: 'not-a-time' });
      scheduler.scheduleTask();
      expect(cron.schedule).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    test('stops the previous task on reschedule', () => {
      const stop = jest.fn();
      cron.schedule.mockReturnValue({ stop });
      configModule.getConfig.mockReturnValue({ channelScanEnabled: true, channelScanTime: '14:00' });
      scheduler.scheduleTask();
      scheduler.scheduleTask();
      expect(stop).toHaveBeenCalledTimes(1);
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
        expect.objectContaining({ channel_id: 'UC1' }), 'UC1', 'videos', null, 50
      );
      expect(channelVideoFetcher.fetchAndSaveVideosViaYtDlp).toHaveBeenCalledWith(
        expect.objectContaining({ channel_id: 'UC1' }), 'UC1', 'shorts', null, 50
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
        expect.objectContaining({ channel_id: 'UC1' }), 'UC1', 'videos', null, 150
      );
    });

    test('skips channels with no enabled tabs', async () => {
      Channel.findAll.mockResolvedValue([
        { channel_id: 'UC1', auto_download_enabled_tabs: '' },
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
        expect.objectContaining({ channel_id: 'UC1' }), 'UC1', 'videos', null, 50
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
});
