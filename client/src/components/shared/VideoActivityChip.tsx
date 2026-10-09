import React from 'react';
import { Chip } from '../ui';
import { useVideoActivity } from '../../providers/VideoActivityProvider';
import { getStatusIcon, getStatusLabel, getStatusChipStyle } from '../../utils/videoStatus';

export default function VideoActivityChip({ youtubeId }: { youtubeId: string }) {
  const { snapshot } = useVideoActivity();
  const state = snapshot.videos[youtubeId]?.state;
  if (!state) return null;
  return <Chip size="small" variant="outlined" color="info" icon={getStatusIcon(state)} label={getStatusLabel(state)} style={getStatusChipStyle(state)} />;
}
