---
paths:
  - "server/modules/channel/newVideoScanScheduler.js"
  - "server/modules/channel/newVideoScanRunSummary.js"
  - "server/modules/channel/newVideoQueueModule.js"
  - "server/routes/newVideos.js"
  - "client/src/components/DownloadManager/ManualDownload/NewVideosQueue/**/*"
---

# New videos scan and review queue (fork-only)

These features exist only in the flahercc fork; upstream merges never touch them, so keep them working when upstream changes the channel, playlist or scheduling code they reuse.

- `newVideoScanScheduler` registers the scan as the `channelScanFrequency` task on Settings > Scheduling. `channelScanEnabled` only stops the timer (`manualRunRequiresEnabled: false`); it re-registers on config change like `watchStatusScheduler`.
- `configModule.migrateChannelScanTime` converts legacy `channelScanTime` ("HH:MM") on the raw file before `mergeWithTemplate`, which would otherwise fill in the template default first.
- `scanAll()` (cron tick and `POST /api/new-videos/scan`) runs channels then playlists under one in-progress guard. Scan Now passes `force` to bypass the 1-hour freshness gates and awaits `completion` to answer with the full summary.
- Each channel/tab fetch is capped at `channelScanVideoLimit` (falling back to `channelVideoFetcher.DEFAULT_MAX_VIDEO_COUNT`); the channel page's own auto-refresh uses the same cap so a page visit cannot seed more rows into the queue.
- Per-channel/tab and per-playlist failures are isolated; a concurrent playlist fetch (`FETCH_IN_PROGRESS`) is a skip, not a failure. `newVideoScanRunSummary.toRunRecord` keeps counts in `details` (run history is a TEXT column).
- `newVideoQueueModule.getQueue()` merges channel candidates (reusing `channelDownloadAllModule`'s eligibility rule) and playlist candidates, tagged `source`, sorted newest-first by `ChannelVideo.first_seen_at` / `PlaylistVideo.added_at`.
- Single-video queueing goes through `channelDownloadAllModule.downloadSingleVideo` (`POST /api/channels/:channelId/videos/:youtubeId/download`). Bulk ignore/download is batched per channel or playlist to stay under the API rate limit.
