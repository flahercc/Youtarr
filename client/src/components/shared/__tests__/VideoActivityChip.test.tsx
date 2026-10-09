import React from 'react';
import { render, screen } from '@testing-library/react';
import VideoActivityChip from '../VideoActivityChip';
import { useVideoActivity } from '../../../providers/VideoActivityProvider';

jest.mock('../../../providers/VideoActivityProvider');
const activity = useVideoActivity as jest.Mock;

it('follows queued, downloading, and completed activity for its video only', () => {
  activity.mockReturnValue({ snapshot: { videos: { other: { state: 'queued' } } } });
  const { container, rerender } = render(<VideoActivityChip youtubeId="aaaaaaaaaaa" />);
  expect(container).toBeEmptyDOMElement();
  activity.mockReturnValue({ snapshot: { videos: { aaaaaaaaaaa: { state: 'queued' } } } });
  rerender(<VideoActivityChip youtubeId="aaaaaaaaaaa" />);
  expect(screen.getByText('Queued…')).toBeInTheDocument();
  activity.mockReturnValue({ snapshot: { videos: { aaaaaaaaaaa: { state: 'downloading' } } } });
  rerender(<VideoActivityChip youtubeId="aaaaaaaaaaa" />);
  expect(screen.getByText(/Downloading/)).toBeInTheDocument();
  activity.mockReturnValue({ snapshot: { videos: {} } });
  rerender(<VideoActivityChip youtubeId="aaaaaaaaaaa" />);
  expect(container).toBeEmptyDOMElement();
});
