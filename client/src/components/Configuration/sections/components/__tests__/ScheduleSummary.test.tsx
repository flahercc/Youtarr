import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../../test-utils';
import { ScheduleSummary } from '../ScheduleSummary';

describe('ScheduleSummary', () => {
  test('shows the schedule in words under a generic heading by default', () => {
    renderWithProviders(<ScheduleSummary scheduleKey="channelScanFrequency" value="0 14 * * *" />);
    expect(screen.getByText(/^Schedule: /)).toBeInTheDocument();
  });

  test('links to the task on the Scheduling page', () => {
    renderWithProviders(<ScheduleSummary scheduleKey="channelScanFrequency" value="0 14 * * *" />);
    expect(screen.getByRole('link', { name: 'Edit schedule' })).toHaveAttribute(
      'href', '/settings/scheduling#channelScanFrequency'
    );
  });

  test('names the task in place of the generic heading when labelled', () => {
    renderWithProviders(<ScheduleSummary scheduleKey="channelScanFrequency" value="0 14 * * *" label="New videos scan" />);
    expect(screen.getByText(/^New videos scan: /)).toBeInTheDocument();
  });

  test('gives a labelled link an accessible name that starts with its visible text', () => {
    renderWithProviders(<ScheduleSummary scheduleKey="channelScanFrequency" value="0 14 * * *" label="New videos scan" />);
    expect(screen.getByRole('link', { name: 'Edit schedule for new videos scan' })).toBeInTheDocument();
  });
});
