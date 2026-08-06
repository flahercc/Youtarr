import React from 'react';
import { Box, Typography, Button, Paper, CircularProgress, Alert } from '../../../ui';
import { RefreshCw as ScanIcon, Sparkles as NewVideosIcon } from 'lucide-react';
import { useNewVideosQueue } from './hooks/useNewVideosQueue';
import NewVideoQueueItem from './NewVideoQueueItem';

interface NewVideosQueueProps {
  token: string | null;
}

const NewVideosQueue: React.FC<NewVideosQueueProps> = ({ token }) => {
  const { videos, loading, error, scanning, scan, ignoreVideo, downloadVideo } = useNewVideosQueue(token);

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

      <Box className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
        {videos.map((video) => (
          <NewVideoQueueItem
            key={video.youtube_id}
            video={video}
            onDownload={downloadVideo}
            onIgnore={ignoreVideo}
          />
        ))}
      </Box>
    </Paper>
  );
};

export default NewVideosQueue;
