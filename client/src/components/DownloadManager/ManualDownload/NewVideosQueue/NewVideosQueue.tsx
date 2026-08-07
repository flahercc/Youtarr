import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Button, Paper, CircularProgress, Alert, Checkbox, FormControlLabel } from '../../../ui';
import { RefreshCw as ScanIcon, Sparkles as NewVideosIcon, Download as DownloadIcon, Ban as IgnoreIcon } from 'lucide-react';
import { useNewVideosQueue } from './hooks/useNewVideosQueue';
import NewVideoQueueItem from './NewVideoQueueItem';
import { NewQueueVideo } from './types';

interface NewVideosQueueProps {
  token: string | null;
}

const NewVideosQueue: React.FC<NewVideosQueueProps> = ({ token }) => {
  const { videos, loading, error, scanning, scan, ignoreVideo, downloadVideo, ignoreVideos, downloadVideos } = useNewVideosQueue(token);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Drop selections for videos that left the queue (downloaded, ignored, or
  // no longer returned by a rescan) so the count never outlives its videos.
  useEffect(() => {
    setSelectedIds((prev) => {
      const stillPresent = new Set(videos.map((v) => v.youtube_id));
      const next = new Set([...prev].filter((id) => stillPresent.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [videos]);

  const selectedVideos = useMemo(
    () => videos.filter((v) => selectedIds.has(v.youtube_id)),
    [videos, selectedIds]
  );
  const allSelected = videos.length > 0 && selectedIds.size === videos.length;

  const toggleSelect = (video: NewQueueVideo) => {
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
    setSelectedIds(allSelected ? new Set() : new Set(videos.map((v) => v.youtube_id)));
  };

  if (loading || videos.length === 0) {
    if (loading) {
      return null;
    }
    return (
      <Paper elevation={1} className="p-4 mb-4">
        <Box className="flex justify-between items-center">
          <Typography variant="body2" color="text.secondary">
            No new videos found from your subscribed channels.
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
      <Box className="flex justify-between items-center mb-3">
        <Typography variant="h6" gutterBottom className="flex items-center gap-2 !mb-0">
          <NewVideosIcon size={20} />
          New Videos ({videos.length})
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
              inputProps={{ 'aria-label': 'Select all new videos' }}
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
              onClick={() => void downloadVideos(selectedVideos)}
            >
              Download Selected
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<IgnoreIcon size={16} />}
              onClick={() => void ignoreVideos(selectedVideos)}
            >
              Ignore Selected
            </Button>
          </Box>
        )}
      </Box>

      <Box className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
        {videos.map((video) => (
          <NewVideoQueueItem
            key={video.youtube_id}
            video={video}
            selected={selectedIds.has(video.youtube_id)}
            onToggleSelect={toggleSelect}
            onDownload={downloadVideo}
            onIgnore={ignoreVideo}
          />
        ))}
      </Box>
    </Paper>
  );
};

export default NewVideosQueue;
