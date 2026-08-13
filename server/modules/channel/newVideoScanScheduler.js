const cron = require('node-cron');
const logger = require('../../logger');
const configModule = require('../configModule');
const Channel = require('../../models/channel');
const ChannelVideo = require('../../models/channelvideo');
const { Playlist, PlaylistVideo } = require('../../models');
const channelVideoFetcher = require('./channelVideoFetcher');
const channelVideoQuery = require('./channelVideoQuery');
const playlistModule = require('../playlistModule');
const { TAB_TYPES, MEDIA_TAB_TYPE_MAP, parseTabCsv } = require('../tabsUtils');

// Belt-and-braces default matching config.example.json, mirroring
// watchStatusScheduler's DEFAULT_SYNC_FREQUENCY handling.
const DEFAULT_SCAN_TIME = '14:00';
const DEFAULT_SCAN_VIDEO_LIMIT = channelVideoFetcher.DEFAULT_MAX_VIDEO_COUNT;

// Mirrors channelVideoFetcher.shouldRefreshChannelVideos's per-tab freshness
// window; playlists have a single lastFetched timestamp rather than a
// per-tab one, so a single threshold is enough here.
const PLAYLIST_FRESHNESS_MS = 60 * 60 * 1000;

// auto_download_enabled_tabs stores mediaType values ('video'/'short'/
// 'livestream'); fetchChannelVideos needs the tabType ('videos'/'shorts'/
// 'streams'). Invert the canonical map instead of hand-writing a second one.
const TAB_TYPE_BY_MEDIA_TYPE = Object.fromEntries(
  Object.entries(MEDIA_TAB_TYPE_MAP).map(([tabType, mediaType]) => [mediaType, tabType])
);

class NewVideoScanScheduler {
  constructor() {
    this.scanning = false;
  }

  /**
   * Schedule or reschedule the daily new-videos scan.
   * Manages cron job based on configuration settings.
   * @returns {void}
   */
  scheduleTask() {
    const config = configModule.getConfig();
    const time = config.channelScanTime || DEFAULT_SCAN_TIME;

    if (this.task) {
      this.task.stop();
      this.task = null;
    }

    if (!config.channelScanEnabled) {
      logger.info('Channel scan disabled');
      return;
    }

    const cronExpression = this.timeToCron(time);
    if (!cronExpression || !cron.validate(cronExpression)) {
      logger.warn({ time }, 'Invalid channel scan time; not scheduling');
      return;
    }

    this.task = cron.schedule(cronExpression, () => {
      this.scanAll().catch((err) => {
        logger.error({ err }, 'Scheduled new-videos scan failed');
      });
    });
    logger.info({ time, cronExpression }, 'Channel scan scheduled');
  }

  /**
   * Subscribe to configuration changes.
   * Reschedules the scan when configuration is updated.
   * @returns {void}
   */
  subscribe() {
    configModule.onConfigChange(this.scheduleTask.bind(this));
  }

  /**
   * Convert an "HH:MM" time-of-day (server-local) into a daily cron
   * expression. Returns null for a malformed time string.
   * @param {string} time
   * @returns {string|null}
   */
  timeToCron(time) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time || '');
    if (!match) return null;
    const [, hour, minute] = match;
    return `${Number(minute)} ${Number(hour)} * * *`;
  }

  /**
   * Scan every enabled channel's tabs and every enabled playlist for videos
   * not previously seen, in one atomic pass (single in-progress guard covers
   * both phases). This is the primary entrypoint used by the cron job and
   * the manual "Scan Now" trigger.
   * @param {boolean} force - Bypass the per-channel/per-playlist freshness
   *   gate. Used by the manual "Scan Now" trigger so it always re-checks
   *   YouTube instead of silently no-oping on sources fetched recently.
   * @returns {Promise<{channelsScanned: number, tabsScanned: number, playlistsScanned: number, newVideosFound: number, errors: Array}>}
   */
  async scanAll(force = false) {
    if (this.scanning) {
      throw new Error('SCAN_IN_PROGRESS');
    }
    this.scanning = true;

    const summary = { channelsScanned: 0, tabsScanned: 0, playlistsScanned: 0, newVideosFound: 0, errors: [] };

    try {
      await this._scanChannels(force, summary);
      await this._scanPlaylists(force, summary);

      logger.info(summary, 'New-videos scan complete');
      return summary;
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Scan every enabled channel's videos tab plus any of its
   * auto-download-enabled tabs, for videos not previously seen. Standalone
   * channel-only counterpart to scanAll, kept for focused testing/reuse.
   * @param {boolean} force - Bypass the per-tab freshness gate.
   * @returns {Promise<{channelsScanned: number, tabsScanned: number, newVideosFound: number, errors: Array<{channelId: string, tabType: string, message: string}>}>}
   */
  async scanAllChannels(force = false) {
    if (this.scanning) {
      throw new Error('SCAN_IN_PROGRESS');
    }
    this.scanning = true;

    const summary = { channelsScanned: 0, tabsScanned: 0, newVideosFound: 0, errors: [] };

    try {
      await this._scanChannels(force, summary);
      logger.info(summary, 'Channel scan complete');
      return summary;
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Channel-scanning body shared by scanAll and scanAllChannels. The videos
   * tab is included unconditionally (even with auto-download off) so the
   * New Videos review queue covers every subscribed channel, not just ones
   * opted into auto-download. Reuses the same fetch/insert pipeline that
   * channel page visits and "Load More" already use. One channel/tab
   * failing does not stop the rest.
   * @param {boolean} force
   * @param {Object} summary - Running scan summary, mutated in place
   * @returns {Promise<void>}
   * @private
   */
  async _scanChannels(force, summary) {
    const channels = await Channel.findAll({ where: { enabled: true } });

    for (const channel of channels) {
      const tabTypes = this.resolveScanTabTypes(channel);

      if (tabTypes.length === 0) continue;
      summary.channelsScanned += 1;

      for (const tabType of tabTypes) {
        summary.tabsScanned += 1;
        await this.scanChannelTab(channel, tabType, summary, force);
      }
    }
  }

  /**
   * Tabs to check for a channel: its auto-download-enabled tabs, plus the
   * primary "videos" tab unless the user explicitly hid it. Ensures the scan
   * covers every subscribed channel's regular uploads even when
   * auto-download is off.
   * @param {Object} channel - Channel database record
   * @returns {string[]} - tabType values ('videos' | 'shorts' | 'streams')
   * @private
   */
  resolveScanTabTypes(channel) {
    const autoTabTypes = parseTabCsv(channel.auto_download_enabled_tabs)
      .map((mediaType) => TAB_TYPE_BY_MEDIA_TYPE[mediaType])
      .filter(Boolean);

    const tabTypes = new Set(autoTabTypes);
    const hiddenTabs = new Set(parseTabCsv(channel.hidden_tabs));
    if (!hiddenTabs.has(TAB_TYPES.VIDEOS)) {
      tabTypes.add(TAB_TYPES.VIDEOS);
    }

    return Array.from(tabTypes);
  }

  /**
   * Refresh a single channel/tab and tally any newly-discovered videos onto
   * the running summary. Isolated per tab so one failure can't sink the scan.
   * @param {Object} channel - Channel database record
   * @param {string} tabType - 'videos' | 'shorts' | 'streams'
   * @param {Object} summary - Running scan summary, mutated in place
   * @param {boolean} force - Bypass the per-tab freshness gate
   * @returns {Promise<void>}
   * @private
   */
  async scanChannelTab(channel, tabType, summary, force = false) {
    const mediaType = MEDIA_TAB_TYPE_MAP[tabType];
    try {
      const recentVideos = await channelVideoQuery.fetchNewestVideosFromDb(
        channel.channel_id, 1, 0, 'off', '', 'date', 'desc', false, mediaType
      );

      if (!force && !channelVideoFetcher.shouldRefreshChannelVideos(channel, recentVideos.length, mediaType)) {
        return;
      }

      const beforeCount = await ChannelVideo.count({
        where: { channel_id: channel.channel_id, media_type: mediaType },
      });

      const maxVideoCount = configModule.getConfig().channelScanVideoLimit || DEFAULT_SCAN_VIDEO_LIMIT;
      await channelVideoFetcher.fetchAndSaveVideosViaYtDlp(channel, channel.channel_id, tabType, maxVideoCount);

      const afterCount = await ChannelVideo.count({
        where: { channel_id: channel.channel_id, media_type: mediaType },
      });
      summary.newVideosFound += Math.max(0, afterCount - beforeCount);
    } catch (err) {
      logger.error({ err, channelId: channel.channel_id, tabType }, 'Channel scan failed for tab');
      summary.errors.push({ channelId: channel.channel_id, tabType, message: err.message });
    }
  }

  /**
   * Playlist-scanning body shared by scanAll (there is no playlist-only
   * public counterpart, unlike channels, since nothing calls one standalone
   * today). One playlist failing does not stop the rest.
   * @param {boolean} force
   * @param {Object} summary - Running scan summary, mutated in place
   * @returns {Promise<void>}
   * @private
   */
  async _scanPlaylists(force, summary) {
    const playlists = await Playlist.findAll({ where: { enabled: true } });

    for (const playlist of playlists) {
      summary.playlistsScanned += 1;
      await this.scanPlaylist(playlist, summary, force);
    }
  }

  /**
   * Refresh a single playlist and tally any newly-discovered videos onto the
   * running summary. A concurrent fetch of the same playlist (e.g. the user
   * opened the playlist page moments earlier) is treated as a skip, not a
   * failure, since that fetch will have already brought the playlist current.
   * @param {Object} playlist - Playlist database record
   * @param {Object} summary - Running scan summary, mutated in place
   * @param {boolean} force - Bypass the freshness gate
   * @returns {Promise<void>}
   * @private
   */
  async scanPlaylist(playlist, summary, force = false) {
    try {
      if (!force && !this.shouldRefreshPlaylist(playlist)) {
        return;
      }

      const beforeCount = await PlaylistVideo.count({ where: { playlist_id: playlist.playlist_id } });
      await playlistModule.fetchAllPlaylistVideos(playlist.playlist_id);
      const afterCount = await PlaylistVideo.count({ where: { playlist_id: playlist.playlist_id } });
      summary.newVideosFound += Math.max(0, afterCount - beforeCount);
    } catch (err) {
      if (err.message === 'FETCH_IN_PROGRESS') {
        logger.info({ playlistId: playlist.playlist_id }, 'Playlist fetch already in progress; skipping this scan cycle');
        return;
      }
      logger.error({ err, playlistId: playlist.playlist_id }, 'Playlist scan failed');
      summary.errors.push({ playlistId: playlist.playlist_id, message: err.message });
    }
  }

  /**
   * @param {Object} playlist - Playlist database record
   * @returns {boolean} - True if the playlist hasn't been fetched recently
   * @private
   */
  shouldRefreshPlaylist(playlist) {
    if (!playlist.lastFetched) return true;
    return new Date() - new Date(playlist.lastFetched) > PLAYLIST_FRESHNESS_MS;
  }
}

module.exports = new NewVideoScanScheduler();
