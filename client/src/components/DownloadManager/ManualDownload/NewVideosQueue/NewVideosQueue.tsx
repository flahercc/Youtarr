import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, Button, Paper, CircularProgress, Alert, Checkbox, FormControlLabel } from '../../../ui';
import { RefreshCw as ScanIcon, Sparkles as NewVideosIcon, Download as DownloadIcon, Ban as IgnoreIcon } from 'lucide-react';
import VideoListViewToggle from '../../../shared/VideoList/VideoListViewToggle';
import { VideoListViewMode } from '../../../shared/VideoList/types';
import { useNewVideosQueue } from './hooks/useNewVideosQueue';
import NewVideoQueueItem from './NewVideoQueueItem';
import NewVideoQueueCard from './NewVideoQueueCard';
import { NewQueueVideo, ManualQueueVideo, PendingDownloadItem } from './types';
import { VideoInfo } from '../types';

const VIEW_MODE_STORAGE_KEY = 'youtarr:downloadsQueueViewMode';
const VIEW_MODES: VideoListViewMode[] = ['list', 'grid'];

function readStoredViewMode(): VideoListViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === 'grid' || stored === 'list' ? stored : 'list';
  } catch {
    return 'list';
  }
}

function toManualQueueVideo(video: VideoInfo): ManualQueueVideo {
  return {
    source: 'manual',
    youtube_id: video.youtubeId,
    source_id: null,
    source_title: video.channelName || 'Manually added',
    title: video.videoTitle,
    thumbnail: null,
    duration: video.duration || null,
    first_seen_at: null,
    published_at: video.publishedAt || null,
    is_already_downloaded: video.isAlreadyDownloaded,
    is_members_only: video.isMembersOnly,
    is_bulk_import: !!video.isBulkImport,
  };
}

interface NewVideosQueueProps {
  token: string | null;
  manualVideos: VideoInfo[];
  isDownloadingManual: boolean;
  onRemoveManual: (youtubeIds: string[]) => void;
  onDownloadManualSelected: (videos: VideoInfo[]) => void;
}

const NewVideosQueue: React.FC<NewVideosQueueProps> = ({
  token,
  manualVideos,
  isDownloadingManual,
  onRemoveManual,
  onDownloadManualSelected,
}) => {
  const { videos, loading, error, scanning, scan, ignoreVideo, downloadVideo, ignoreVideos, downloadVideos } = useNewVideosQueue(token);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<VideoListViewMode>(readStoredViewMode);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // Ignore storage failures (private browsing, quota, etc.) - view mode
      // just won't persist across reloads.
    }
  }, [viewMode]);

  // Discovered items already carry the same youtube_id namespace as manual
  // ones; if a video the user pastes is already sitting in the discovered
  // queue, show it once (as the discovered item) rather than duplicating it.
  const discoveredIds = useMemo(() => new Set(videos.map((v) => v.youtube_id)), [videos]);
  const manualItems = useMemo(
    () => manualVideos.filter((v) => !discoveredIds.has(v.youtubeId)).map(toManualQueueVideo),
    [manualVideos, discoveredIds]
  );
  const merged: PendingDownloadItem[] = useMemo(() => [...manualItems, ...videos], [manualItems, videos]);

  // Drop selections for videos that left the list (downloaded, ignored,
  // removed, or no longer returned by a rescan) so the count never outlives
  // its videos.
  useEffect(() => {
    setSelectedIds((prev) => {
      const stillPresent = new Set(merged.map((v) => v.youtube_id));
      const next = new Set([...prev].filter((id) => stillPresent.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [merged]);

  // Auto-select freshly-pasted manual videos so "paste -> Download Selected"
  // stays a one-click flow, without re-selecting a video the user explicitly
  // deselected (only a genuine addition to manualVideos triggers this).
  const prevManualIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = manualVideos.map((v) => v.youtubeId);
    const newlyAdded = currentIds.filter((id) => !prevManualIdsRef.current.has(id));
    prevManualIdsRef.current = new Set(currentIds);
    if (newlyAdded.length > 0) {
      setSelectedIds((prev) => new Set([...prev, ...newlyAdded]));
    }
  }, [manualVideos]);

  const selectedItems = useMemo(() => merged.filter((v) => selectedIds.has(v.youtube_id)), [merged, selectedIds]);
  const allSelected = merged.length > 0 && selectedIds.size === merged.length;

  const toggleSelect = (video: PendingDownloadItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(video.youtube_id)) {
        next.delete(video.youtube_id);
      } else {
        next.add(video.youtube_id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(merged.map((v) => v.youtube_id)));
  };

  const handleItemDownload = (video: PendingDownloadItem) => {
    if (video.source === 'manual') return;
    void downloadVideo(video);
  };

  const handleItemRemove = (video: PendingDownloadItem) => {
    if (video.source === 'manual') {
      onRemoveManual([video.youtube_id]);
    } else {
      void ignoreVideo(video);
    }
  };

  const handleDownloadSelected = () => {
    const discovered = selectedItems.filter((v): v is NewQueueVideo => v.source !== 'manual');
    const manualSelectedIds = new Set(selectedItems.filter((v) => v.source === 'manual').map((v) => v.youtube_id));

    if (discovered.length > 0) void downloadVideos(discovered);
    if (manualSelectedIds.size > 0) {
      onDownloadManualSelected(manualVideos.filter((v) => manualSelectedIds.has(v.youtubeId)));
    }
  };

  const handleRemoveSelected = () => {
    const discovered = selectedItems.filter((v): v is NewQueueVideo => v.source !== 'manual');
    const manualSelectedIds = selectedItems.filter((v) => v.source === 'manual').map((v) => v.youtube_id);

    if (discovered.length > 0) void ignoreVideos(discovered);
    if (manualSelectedIds.length > 0) onRemoveManual(manualSelectedIds);
  };

  if (loading && merged.length === 0) {
    return null;
  }

  if (merged.length === 0) {
    return (
      <Paper elevation={1} className="p-4 mb-4">
        <Box className="flex justify-between items-center">
          <Typography variant="body2" color="text.secondary">
            No videos queued for download. Add a URL above, or Scan Now to check subscribed channels and playlists.
          </Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={() => void scan()}
            disabled={scanning}
            startIcon={scanning ? <CircularProgress size={16} /> : <ScanIcon size={16} />}
          >
            {scanning ? 'Scanning...' : 'Scan Now'}
          </Button>
        </Box>
        {error && (
          <Alert severity="error" className="mt-2">
            {error}
          </Alert>
        )}
      </Paper>
    );
  }

  return (
    <Paper elevation={1} className="p-4 mb-4">
      <Box className="flex justify-between items-center mb-3 gap-2 flex-wrap">
        <Typography variant="h6" gutterBottom className="flex items-center gap-2 !mb-0">
          <NewVideosIcon size={20} />
          Videos to Download ({merged.length})
        </Typography>
        <Box className="flex items-center gap-2">
          <VideoListViewToggle value={viewMode} modes={VIEW_MODES} onChange={setViewMode} />
          <Button
            variant="outlined"
            size="small"
            onClick={() => void scan()}
            disabled={scanning}
            startIcon={scanning ? <CircularProgress size={16} /> : <ScanIcon size={16} />}
          >
            {scanning ? 'Scanning...' : 'Scan Now'}
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" className="mb-3">
          {error}
        </Alert>
      )}

      <Box className="flex justify-between items-center mb-2 flex-wrap gap-2">
        <FormControlLabel
          control={
            <Checkbox
              checked={allSelected}
              indeterminate={selectedIds.size > 0 && !allSelected}
              onChange={toggleSelectAll}
              inputProps={{ 'aria-label': 'Select all videos to download' }}
            />
          }
          label={selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
        />
        {selectedIds.size > 0 && (
          <Box className="flex items-center gap-2">
            <Button
              variant="outlined"
              size="small"
              startIcon={<DownloadIcon size={16} />}
              onClick={handleDownloadSelected}
              disabled={isDownloadingManual}
            >
              Download Selected
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<IgnoreIcon size={16} />}
              onClick={handleRemoveSelected}
            >
              Remove Selected
            </Button>
          </Box>
        )}
      </Box>

      {viewMode === 'grid' ? (
        <Box
          className="grid gap-3 max-h-[600px] overflow-y-auto"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
        >
          {merged.map((video) => (
            <NewVideoQueueCard
              key={`${video.source}-${video.youtube_id}`}
              video={video}
              selected={selectedIds.has(video.youtube_id)}
              onToggleSelect={toggleSelect}
              onDownload={handleItemDownload}
              onRemove={handleItemRemove}
            />
          ))}
        </Box>
      ) : (
        <Box className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
          {merged.map((video) => (
            <NewVideoQueueItem
              key={`${video.source}-${video.youtube_id}`}
              video={video}
              selected={selectedIds.has(video.youtube_id)}
              onToggleSelect={toggleSelect}
              onDownload={handleItemDownload}
              onRemove={handleItemRemove}
            />
          ))}
        </Box>
      )}
    </Paper>
  );
};

export default NewVideosQueue;
